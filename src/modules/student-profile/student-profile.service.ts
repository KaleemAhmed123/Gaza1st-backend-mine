import { DocumentStatus, DocumentType, PassportStatus, ProfileStatus, RoleCode } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { recordAuditLog } from "../../shared/audit";
import { ApiError } from "../../shared/http";
import { notifyMasterAdminsOfProfileSubmission } from "../../shared/review-email";
import { appEmitter, AppEvents } from "../../shared/events";
import type { updateStudentProfileSchema } from "./student-profile.validation";
import type { z } from "zod";

type UpdateStudentProfileInput = z.infer<typeof updateStudentProfileSchema>;

const editableStatuses = new Set<ProfileStatus>([
  ProfileStatus.draft,
  ProfileStatus.changes_requested
]);

const passportRequiresDocument = new Set<PassportStatus>([
  PassportStatus.valid,
  PassportStatus.valid_expires_within_year
]);

function formatProfile(profile: any) {
  if (profile) {
    const isExpired = profile.passportExpiry && new Date(profile.passportExpiry) < new Date();
    if (isExpired) {
      profile.passportStatus = "expired";
    }
  }
  return profile;
}

export async function getStudentProfileByUserId(userId: string) {
  let profile = await prisma.studentProfile.findUnique({
    where: { userId },
    include: {
      documents: {
        where: {
          status: DocumentStatus.active,
          deletedAt: null
        },
        select: {
          id: true,
          documentType: true,
          originalFilename: true,
          mimeType: true,
          fileSizeBytes: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (profile?.deletedAt) {
    profile = await prisma.studentProfile.update({
      where: { id: profile.id },
      data: { deletedAt: null },
      include: {
        documents: {
          where: {
            status: DocumentStatus.active,
            deletedAt: null
          },
          select: {
            id: true,
            documentType: true,
            originalFilename: true,
            mimeType: true,
            fileSizeBytes: true,
            createdAt: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });
  }

  if (!profile) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        roles: { has: RoleCode.student }
      },
      select: { id: true }
    });

    if (!user) {
      throw new ApiError(404, "Student profile not found");
    }

    profile = await prisma.studentProfile.create({
      data: {
        userId,
        hasOfferSelfReported: false,
        deletedAt: null
      },
      include: {
        documents: {
          where: {
            status: DocumentStatus.active,
            deletedAt: null
          },
          select: {
            id: true,
            documentType: true,
            originalFilename: true,
            mimeType: true,
            fileSizeBytes: true,
            createdAt: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });
  }

  return formatProfile(profile);
}

export async function updateMyStudentProfile(userId: string, input: UpdateStudentProfileInput) {
  const profile = await getStudentProfileByUserId(userId);

  if (!editableStatuses.has(profile.profileStatus)) {
    throw new ApiError(409, "Profile cannot be edited in its current status");
  }

  const updatedProfile = await prisma.studentProfile.update({
    where: { id: profile.id },
    data: input,
    include: {
      documents: {
        where: {
          status: DocumentStatus.active,
          deletedAt: null
        },
        select: {
          id: true,
          documentType: true,
          originalFilename: true,
          mimeType: true,
          fileSizeBytes: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  return formatProfile(updatedProfile);
}

export async function approveCommunityGuidelines(userId: string) {
  const profile = await getStudentProfileByUserId(userId);
  
  if (profile.communityGuidelinesApproved) {
    return formatProfile(profile);
  }
  
  const updatedProfile = await prisma.studentProfile.update({
    where: { id: profile.id },
    data: { communityGuidelinesApproved: true },
    include: {
      documents: {
        where: {
          status: DocumentStatus.active,
          deletedAt: null
        },
        select: {
          id: true,
          documentType: true,
          originalFilename: true,
          mimeType: true,
          fileSizeBytes: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  return formatProfile(updatedProfile);
}

function requireProfileField(value: unknown, fieldName: string, missingFields: string[]) {
  if (value === null || value === undefined || value === "") {
    missingFields.push(fieldName);
  }
}

async function getActiveDocumentTypes(studentProfileId: string) {
  const documents = await prisma.document.findMany({
    where: {
      studentProfileId,
      status: DocumentStatus.active,
      deletedAt: null
    },
    select: { documentType: true }
  });

  return new Set(documents.map((document) => document.documentType));
}

export async function submitMyStudentProfile(input: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const profile = await getStudentProfileByUserId(input.userId);

  if (!editableStatuses.has(profile.profileStatus)) {
    throw new ApiError(409, "Profile cannot be submitted in its current status");
  }

  const missingFields: string[] = [];
  requireProfileField(profile.fullNameEnglish, "fullNameEnglish", missingFields);
  requireProfileField(profile.sex, "sex", missingFields);
  requireProfileField(profile.dateOfBirth, "dateOfBirth", missingFields);
  requireProfileField(profile.locationInGaza, "locationInGaza", missingFields);
  requireProfileField(profile.hasOfferSelfReported, "hasOfferSelfReported", missingFields);
  requireProfileField(profile.passportStatus, "passportStatus", missingFields);
  requireProfileField(profile.emergencyContactFirstName, "emergencyContactFirstName", missingFields);
  requireProfileField(profile.emergencyContactRelation, "emergencyContactRelation", missingFields);
  requireProfileField(profile.emergencyContactPhone, "emergencyContactPhone", missingFields);
  requireProfileField(profile.consentSigned, "consentSigned", missingFields);

  if (profile.locationInGaza === "other") {
    requireProfileField(profile.locationOther, "locationOther", missingFields);
  }

  if (profile.passportStatus && passportRequiresDocument.has(profile.passportStatus)) {
    requireProfileField(profile.passportLocation, "passportLocation", missingFields);
    if (profile.passportLocation === "other") {
      requireProfileField(profile.passportLocationOther, "passportLocationOther", missingFields);
    }
  }

  if (profile.englishMoi) {
    requireProfileField(profile.moiInstitutionName, "moiInstitutionName", missingFields);
    requireProfileField(profile.moiInstitutionType, "moiInstitutionType", missingFields);
  }

  const missingDocuments: string[] = [];

  const activeDocumentTypes = await getActiveDocumentTypes(profile.id);
  if (profile.englishMoi && !activeDocumentTypes.has(DocumentType.moi_letter)) {
    missingDocuments.push(DocumentType.moi_letter);
  }
  if (
    profile.passportStatus &&
    passportRequiresDocument.has(profile.passportStatus) &&
    !activeDocumentTypes.has(DocumentType.passport)
  ) {
    missingDocuments.push(DocumentType.passport);
  }

  if (missingFields.length > 0 || missingDocuments.length > 0) {
    throw new ApiError(
      400,
      `Profile is incomplete. Missing fields: ${missingFields.join(", ") || "none"}. Missing documents: ${missingDocuments.join(", ") || "none"}.`
    );
  }

  if (!profile.communityGuidelinesApproved) {
    throw new ApiError(400, "You must read and approve the Community Guidelines before submitting your profile.");
  }

  const submittedProfile = await prisma.studentProfile.update({
    where: { id: profile.id },
    data: {
      profileStatus: ProfileStatus.under_review,
      consentSigned: true,
      reviewNotes: null,
      reviewedAt: null,
      reviewedBy: null
    }
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "student_profile_submitted",
    entityType: "student_profile",
    entityId: profile.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  const student = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { fullName: true, email: true }
  });

  if (student) {
    void notifyMasterAdminsOfProfileSubmission({
      studentName: student.fullName,
      studentEmail: student.email
    }).catch((error) => {
      console.error(
        `Profile review email notification failed: ${error instanceof Error ? error.message : "Unknown notification error"}`
      );
    });
  }

  // Emit event for in-app notification
  appEmitter.emit(AppEvents.PROFILE_SUBMITTED, { studentUserId: input.userId });

  return submittedProfile;
}
