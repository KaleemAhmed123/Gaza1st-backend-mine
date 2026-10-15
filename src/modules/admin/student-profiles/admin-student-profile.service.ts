import { DocumentStatus, ProfileStatus } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { recordAuditLog } from "../../../shared/audit";
import { sendEmailBestEffort } from "../../../shared/email";
import { ApiError } from "../../../shared/http";
import { appEmitter, AppEvents } from "../../../shared/events";


const profileInclude = {
  user: {
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true
    }
  },
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
    orderBy: { createdAt: "desc" as const }
  }
};

export async function listStudentProfiles(status?: ProfileStatus) {
  return prisma.studentProfile.findMany({
    where: {
      deletedAt: null,
      ...(status ? { profileStatus: status } : {})
    },
    include: profileInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function getStudentProfileForAdmin(profileId: string) {
  const profile = await prisma.studentProfile.findFirst({
    where: {
      id: profileId,
      deletedAt: null
    },
    include: profileInclude
  });

  if (!profile) {
    throw new ApiError(404, "Student profile not found");
  }

  return profile;
}

const allowedReviewStatuses = [
  ProfileStatus.approved,
  ProfileStatus.changes_requested,
  ProfileStatus.rejected
] as const;

type ReviewStatus = (typeof allowedReviewStatuses)[number];

const reviewActions: Record<ReviewStatus, string> = {
  approved: "student_profile_approved",
  changes_requested: "student_profile_changes_requested",
  rejected: "student_profile_rejected"
};

export async function reviewStudentProfile(input: {
  profileId: string;
  reviewerUserId: string;
  status: ReviewStatus;
  notes?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  // Single-query optimization: Fetch the profile and the related user fields at once
  const profile = await prisma.studentProfile.findFirst({
    where: {
      id: input.profileId,
      deletedAt: null
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true
        }
      }
    }
  });

  if (!profile) {
    throw new ApiError(404, "Student profile not found");
  }

  // Idempotent check (must occur before transition validation to prevent false 409s)
  if (profile.profileStatus === input.status) {
    return prisma.studentProfile.findUnique({
      where: { id: profile.id },
      include: profileInclude
    });
  }

  // Explicit state transition map for clarity and correctness
  const allowedTransitions: Record<ProfileStatus, ProfileStatus[]> = {
    [ProfileStatus.under_review]: [
      ProfileStatus.approved,
      ProfileStatus.rejected,
      ProfileStatus.changes_requested
    ],
    [ProfileStatus.rejected]: [
      ProfileStatus.approved,
      ProfileStatus.changes_requested
    ],
    [ProfileStatus.changes_requested]: [
      ProfileStatus.approved,
      ProfileStatus.rejected
    ],
    [ProfileStatus.approved]: [],
    [ProfileStatus.draft]: [],
    [ProfileStatus.submitted]: []
  };

  if (!allowedTransitions[profile.profileStatus]?.includes(input.status)) {
    throw new ApiError(
      409,
      `Cannot transition profile from ${profile.profileStatus} to ${input.status}`
    );
  }

  // Optimistic concurrency control using updateMany with a status check
  const updated = await prisma.studentProfile.updateMany({
    where: {
      id: profile.id,
      profileStatus: profile.profileStatus
    },
    data: {
      profileStatus: input.status,
      reviewedBy: input.reviewerUserId,
      reviewedAt: new Date(),
      reviewNotes: input.notes ?? null
    }
  });

  if (updated.count === 0) {
    throw new ApiError(
      409,
      "This profile was reviewed by another user. Please refresh and try again."
    );
  }

  const reviewedProfile = await prisma.studentProfile.findUnique({
    where: { id: profile.id },
    include: profileInclude
  });

  if (!reviewedProfile) {
    throw new ApiError(500, "Failed to load updated profile");
  }

  // Audit logging (non-transactional because recordAuditLog writes to a separate collection and does not support transactions)
  await recordAuditLog({
    actorUserId: input.reviewerUserId,
    action: reviewActions[input.status],
    entityType: "student_profile",
    entityId: profile.id,
    metadata: {
      previousStatus: profile.profileStatus,
      newStatus: input.status,
      notesProvided: Boolean(input.notes)
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  // Notify the student by email
  if (profile.user) {
    const frontendUrl = process.env.FRONTEND_URL ?? "https://app.gaza40.org";
    const adminEmail = process.env.ADMIN_CONTACT_EMAIL ?? "admin@gaza40.org";

    switch (input.status) {
      case ProfileStatus.approved:
        void sendEmailBestEffort({
          to: [profile.user.email],
          subject: "Your Gaza1st profile has been approved!",
          text: `Hi ${profile.user.fullName},\n\nGreat news! Your Gaza1st onboarding profile has been reviewed and approved.\n\nYou can now log in to your student portal to submit university offers, track your application, and connect with your mentor.\n\nLog in at: ${frontendUrl}\n\nBest regards,\nThe Gaza1st Team`
        });
        break;

      case ProfileStatus.rejected:
        const reasonSection = input.notes ? `\n\nReason for rejection:\n${input.notes}\n` : "";
        void sendEmailBestEffort({
          to: [profile.user.email],
          subject: "Update on your Gaza1st profile review",
          text: `Hi ${profile.user.fullName},\n\nThank you for submitting your Gaza1st onboarding profile. Unfortunately, after review, we were unable to approve your profile at this time.${reasonSection}\nIf you have questions or would like to appeal this decision, please contact us at ${adminEmail}.\n\nBest regards,\nThe Gaza1st Team`
        });
        break;

      case ProfileStatus.changes_requested:
        const changesSection = input.notes ? `\n\nRequested changes:\n${input.notes}\n` : "";
        void sendEmailBestEffort({
          to: [profile.user.email],
          subject: "Changes requested for your Gaza1st profile",
          text: `Hi ${profile.user.fullName},\n\nYour Gaza1st onboarding profile has been reviewed, and we'd like you to make a few updates before it can be approved.${changesSection}\nPlease log in to your student portal, update your profile, and resubmit it for review.\n\nLog in at: ${frontendUrl}\n\nBest regards,\nThe Gaza1st Team`
        });
        break;
    }
  }

  // Emit event for in-app notifications
  switch (input.status) {
    case ProfileStatus.approved:
      appEmitter.emit(AppEvents.PROFILE_APPROVED, { studentUserId: profile.userId });
      break;

    case ProfileStatus.rejected:
      appEmitter.emit(AppEvents.PROFILE_REJECTED, { studentUserId: profile.userId, reason: input.notes });
      break;

    case ProfileStatus.changes_requested:
      appEmitter.emit(AppEvents.PROFILE_CHANGES_REQUESTED, { studentUserId: profile.userId, reason: input.notes });
      break;
  }

  return reviewedProfile;
}
