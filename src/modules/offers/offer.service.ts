import { DocumentStatus, DocumentType, OfferReviewStatus, Prisma, ProfileStatus, RoleCode, QueryStatus, VolunteerStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { recordAuditLog } from "../../shared/audit";
import { sendEmailBestEffort } from "../../shared/email";
import { emailTemplates } from "../../shared/email-templates";
import { env } from "../../config/env";
import { toCsv } from "../../shared/csv";
import { ApiError } from "../../shared/http";
import { notifyAdminsOfOfferReview } from "../../shared/review-email";
import { appEmitter, AppEvents } from "../../shared/events";
import {
  calculateOfferFinancialSummary,
  decimalToNumber,
  type FinancialRules,
  parseFinancialRules
} from "./offer-financial";
import type { listAdminOffersQuerySchema, offerInputSchema, reviewOfferSchema } from "./offer.validation";
import type { z } from "zod";

type OfferInput = z.infer<typeof offerInputSchema>;
type ListAdminOffersQuery = z.infer<typeof listAdminOffersQuerySchema>;
type ReviewOfferInput = z.infer<typeof reviewOfferSchema>;

const offerInclude = {
  region: true,
  university: true,
  student: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      dateOfBirth: true
    }
  },
  mentor: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  documents: {
    where: { status: DocumentStatus.active, deletedAt: null },
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
} as const satisfies Prisma.OfferInclude;

const offerSummarySelect = {
  offerType: true,
  universityName: true,
  reviewStatus: true,
  hasScholarship: true,
  scholarshipCoversLivingCost: true,
  privateFundingAmount: true
} satisfies Prisma.OfferSelect;

const editableOfferStatuses = new Set<OfferReviewStatus>([
  OfferReviewStatus.draft,
  OfferReviewStatus.changes_requested,
  OfferReviewStatus.approved
]);

function snapshotValue(value: unknown): Prisma.JsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof (value as { toString?: unknown }).toString === "function") {
    return (value as { toString: () => string }).toString();
  }

  return null;
}

function offerSnapshot(offer: Record<string, unknown>): Prisma.JsonObject {
  return {
    regionId: snapshotValue(offer.regionId),
    universityId: snapshotValue(offer.universityId),
    universityName: snapshotValue(offer.universityName),
    courseName: snapshotValue(offer.courseName),
    courseField: snapshotValue(offer.courseField),
    courseLevel: snapshotValue(offer.courseLevel),
    durationYears: snapshotValue(offer.durationYears),
    programmeStartDate: snapshotValue(offer.programmeStartDate),
    offerType: snapshotValue(offer.offerType),
    conditions: snapshotValue(offer.conditions),
    tuitionFeePerYear: snapshotValue(offer.tuitionFeePerYear),
    courseFeeSourceUrl: snapshotValue(offer.courseFeeSourceUrl),
    hasScholarship: snapshotValue(offer.hasScholarship),
    scholarshipName: snapshotValue(offer.scholarshipName),
    scholarshipAmountPerYear: snapshotValue(offer.scholarshipAmountPerYear),
    scholarshipCoversLivingCost: snapshotValue(offer.scholarshipCoversLivingCost),
    privateFundingAmount: snapshotValue(offer.privateFundingAmount),
    privateFundingSource: snapshotValue(offer.privateFundingSource),
    privateFundingInterval: snapshotValue(offer.privateFundingInterval),
    livingCostLocationKey: snapshotValue(offer.livingCostLocationKey),
    livingCostForVisa: snapshotValue(offer.livingCostForVisa),
    boardingFees: snapshotValue(offer.boardingFees)
  };
}

function changedFields(beforeData: Record<string, unknown>, afterData: Record<string, unknown>) {
  return Object.keys(afterData).filter(
    (key) => JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key])
  );
}

async function getApprovedStudentProfile(userId: string) {
  const profile = await prisma.studentProfile.findUnique({ where: { userId } });

  if (!profile || profile.deletedAt) {
    throw new ApiError(404, "Student profile not found");
  }

  if (profile.profileStatus !== ProfileStatus.approved) {
    throw new ApiError(403, "Student profile must be approved before managing offers");
  }

  return profile;
}

export async function getOfferFinancialRules() {
  const config = await prisma.appConfig.findUnique({
    where: { key: "offer_financial_rules" }
  });

  if (!config) {
    throw new ApiError(500, "Offer financial rules config is missing");
  }

  return parseFinancialRules(config.value);
}

function notifyOfferReviewBestEffort(input: {
  studentName: string;
  studentEmail: string;
  offerId: string;
  regionId: string;
  universityName: string;
  courseName: string;
  reason: "submitted" | "edited_after_approval";
}) {
  void notifyAdminsOfOfferReview(input).catch((error) => {
    console.error(
      `Offer review email notification failed: ${error instanceof Error ? error.message : "Unknown notification error"}`
    );
  });
}

async function formatOffer(
  offer: Prisma.OfferGetPayload<{ include: typeof offerInclude }>,
  rules?: FinancialRules
) {
  const financialRules = rules ?? await getOfferFinancialRules();
  const summary = calculateOfferFinancialSummary(financialRules, {
    countryName: offer.region.name,
    courseLevel: offer.courseLevel,
    durationYears: decimalToNumber(offer.durationYears),
    tuitionFeePerYear: decimalToNumber(offer.tuitionFeePerYear),
    scholarshipAmountPerYear: offer.scholarshipAmountPerYear
      ? decimalToNumber(offer.scholarshipAmountPerYear)
      : undefined,
    scholarshipCoversLivingCost: offer.scholarshipCoversLivingCost,
    privateFundingAmount: decimalToNumber(offer.privateFundingAmount),
    privateFundingInterval: offer.privateFundingInterval,
    livingCostLocationKey: offer.livingCostLocationKey,
    livingCostForVisa: offer.livingCostForVisa ? decimalToNumber(offer.livingCostForVisa) : undefined,
    boardingFees: offer.boardingFees ? decimalToNumber(offer.boardingFees) : undefined
  });

  return { ...offer, financialSummary: summary };
}

function toOfferData(input: OfferInput) {
  return {
    universityName: input.universityName,
    courseName: input.courseName,
    courseField: input.courseField,
    courseLevel: input.courseLevel,
    durationYears: input.durationYears,
    programmeStartDate: input.programmeStartDate,
    offerType: input.offerType,
    conditions: input.conditions,
    tuitionFeePerYear: input.tuitionFeePerYear,
    courseFeeSourceUrl: input.courseFeeSourceUrl,
    hasScholarship: input.hasScholarship,
    scholarshipName: input.scholarshipName,
    scholarshipAmountPerYear: input.scholarshipAmountPerYear,
    scholarshipCoversLivingCost: input.scholarshipCoversLivingCost,
    privateFundingAmount: input.privateFundingAmount,
    privateFundingSource: input.privateFundingSource,
    privateFundingInterval: input.privateFundingInterval,
    livingCostLocationKey: input.livingCostLocationKey,
    livingCostForVisa: input.livingCostForVisa,
    boardingFees: input.boardingFees
  };
}

async function resolveOfferRegionAndUniversity(
  input: Pick<OfferInput, "regionId" | "universityId" | "universityCountry">
) {
  if (input.universityId) {
    const university = await prisma.university.findFirst({
      where: { id: input.universityId, isActive: true, deletedAt: null },
      include: { region: true }
    });

    if (!university || !university.region.isActive || university.region.deletedAt) {
      throw new ApiError(400, "Invalid university");
    }

    return { region: university.region, university };
  }

  const region = await prisma.region.findFirst({
    where: {
      isActive: true,
      deletedAt: null,
      ...(input.regionId
        ? { id: input.regionId }
        : { name: { equals: input.universityCountry, mode: "insensitive" } })
    }
  });

  if (!region) {
    throw new ApiError(400, "Invalid university country");
  }

  return { region, university: null };
}

function isResidentialSchool(courseLevel: string) {
  return courseLevel.trim().toLowerCase() === "residential independent school";
}

async function validateOfferBusinessRules(
  input: OfferInput,
  regionCountryName: string,
  rules?: FinancialRules
) {
  const financialRules = rules ?? await getOfferFinancialRules();

  if (input.offerType.trim().toLowerCase() === "conditional" && !input.conditions) {
    throw new ApiError(400, "Conditions are required for conditional offers");
  }

  if (input.hasScholarship && (!input.scholarshipName || input.scholarshipAmountPerYear === undefined)) {
    throw new ApiError(400, "Scholarship name and amount are required when scholarship is selected");
  }

  if (!input.hasScholarship) {
    if (input.scholarshipName && input.scholarshipName.trim() !== "") {
      throw new ApiError(400, "Scholarship name cannot be set when hasScholarship is false");
    }
    if (input.scholarshipAmountPerYear && input.scholarshipAmountPerYear > 0) {
      throw new ApiError(400, "Scholarship amount cannot be set when hasScholarship is false");
    }
  }

  if (isResidentialSchool(input.courseLevel) && input.boardingFees === undefined) {
    throw new ApiError(400, "Boarding fees are required for residential independent school offers");
  }

  if (!isResidentialSchool(input.courseLevel) && regionCountryName.toLowerCase() === "uk") {
    const ukRules = financialRules.livingCostRules.UK ?? {};
    if (!input.livingCostLocationKey || !ukRules[input.livingCostLocationKey]) {
      throw new ApiError(400, "Valid UK living cost location is required");
    }
  }

  if (!isResidentialSchool(input.courseLevel) && regionCountryName.toLowerCase() !== "uk") {
    if (input.livingCostForVisa === undefined) {
      throw new ApiError(400, "Living cost for visa is required for non-UK offers");
    }
  }
}

export async function listMyOffers(userId: string) {
  await getApprovedStudentProfile(userId);
  const offers = await prisma.offer.findMany({
    where: { studentUserId: userId, deletedAt: null },
    include: offerInclude,
    orderBy: { updatedAt: "desc" }
  });
  const financialRules = offers.length > 0 ? await getOfferFinancialRules() : undefined;

  return Promise.all(offers.map((offer) => formatOffer(offer, financialRules)));
}

export async function getMyOffer(userId: string, offerId: string) {
  await getApprovedStudentProfile(userId);
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, studentUserId: userId, deletedAt: null },
    include: offerInclude
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  const financialRules = await getOfferFinancialRules();
  return formatOffer(offer, financialRules);
}

export async function createMyOffer(userId: string, input: OfferInput) {
  await getApprovedStudentProfile(userId);
  const { region, university } = await resolveOfferRegionAndUniversity(input);
  const financialRules = await getOfferFinancialRules();
  await validateOfferBusinessRules(input, region.name, financialRules);

  const offer = await prisma.offer.create({
    data: {
      studentUserId: userId,
      regionId: region.id,
      universityId: university?.id,
      ...toOfferData(input),
      deletedAt: null
    },
    include: offerInclude
  });

  await recordAuditLog({
    actorUserId: userId,
    action: "offer_created",
    entityType: "offer",
    entityId: offer.id,
    metadata: {
      universityName: offer.universityName,
      courseName: offer.courseName,
      regionId: offer.regionId
    }
  });

  return formatOffer(offer, financialRules);
}

export async function updateMyOffer(input: {
  userId: string;
  offerId: string;
  data: OfferInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  await getApprovedStudentProfile(input.userId);
  const existingOffer = await prisma.offer.findFirst({
    where: { id: input.offerId, studentUserId: input.userId, deletedAt: null }
  });

  if (!existingOffer) {
    throw new ApiError(404, "Offer not found");
  }

  const isEditable = !existingOffer.mentorId || editableOfferStatuses.has(existingOffer.reviewStatus);
  if (!isEditable) {
    throw new ApiError(409, "Offer cannot be edited in its current status");
  }

  const { region, university } = await resolveOfferRegionAndUniversity(input.data);
  const financialRules = await getOfferFinancialRules();
  await validateOfferBusinessRules(input.data, region.name, financialRules);

  const beforeData = offerSnapshot(existingOffer);
  const nextData = { regionId: region.id, universityId: university?.id, ...toOfferData(input.data) };
  const afterData = offerSnapshot({ ...existingOffer, ...nextData });
  const fieldsChanged = changedFields(beforeData, afterData);
  if (fieldsChanged.length === 0) {
    const fullOffer = await prisma.offer.findFirst({
      where: { id: existingOffer.id },
      include: offerInclude
    });
    if (!fullOffer) {
      throw new ApiError(404, "Offer not found");
    }
    return formatOffer(fullOffer, financialRules);
  }

  const editedApprovedOffer = existingOffer.reviewStatus === OfferReviewStatus.approved;

  const offer = await prisma.$transaction(async (tx) => {
    const updatedOffer = await tx.offer.update({
      where: { id: existingOffer.id },
      data: {
        ...nextData,
        ...(editedApprovedOffer
          ? {
            reviewStatus: OfferReviewStatus.under_review,
            lockedForReview: true,
            reviewedAt: null,
            reviewedBy: null,
            reviewNotes: null
          }
          : {})
      },
      include: offerInclude
    });

    if (editedApprovedOffer) {
      await tx.offerRevision.create({
        data: {
          offerId: existingOffer.id,
          editedBy: input.userId,
          beforeData,
          afterData,
          changedFields: fieldsChanged
        }
      });
    }

    return updatedOffer;
  });

  if (editedApprovedOffer) {
    await recordAuditLog({
      actorUserId: input.userId,
      action: "approved_offer_edited",
      entityType: "offer",
      entityId: existingOffer.id,
      metadata: { changedFields: fieldsChanged },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    });

    const student = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { fullName: true, email: true }
    });

    if (student) {
      notifyOfferReviewBestEffort({
        studentName: student.fullName,
        studentEmail: student.email,
        offerId: existingOffer.id,
        regionId: offer.regionId,
        universityName: offer.universityName,
        courseName: offer.courseName,
        reason: "edited_after_approval"
      });

      // Editing an approved offer sends it back to review — admins need an in-app
      // notification too (previously only an email was sent, so the bell stayed silent).
      appEmitter.emit(AppEvents.OFFER_SUBMITTED, {
        studentUserId: input.userId,
        studentName: student.fullName,
        offerId: existingOffer.id,
        regionId: offer.regionId,
        submissionKind: "requested_edits"
      });
    }
  }

  return formatOffer(offer, financialRules);
}

export async function removeMyOffer(input: {
  userId: string;
  offerId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  await getApprovedStudentProfile(input.userId);
  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, studentUserId: input.userId, deletedAt: null }
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (offer.mentorId) {
    throw new ApiError(409, "Offer cannot be deleted after a mentor has been assigned");
  }

  const removedOffer = await prisma.offer.update({
    where: { id: offer.id },
    data: {
      reviewStatus: OfferReviewStatus.removed,
      deletedAt: new Date()
    }
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "offer_removed",
    entityType: "offer",
    entityId: offer.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return removedOffer;
}

export async function removeOfferAsAdmin(input: {
  userId: string;
  offerId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, deletedAt: null }
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  // Master admin (all regions) or regional admin (own region only) — same gate as review/assign.
  if (!(await canReviewOffer(input.userId, offer.regionId))) {
    throw new ApiError(403, "You do not have permission to delete this offer");
  }

  const removedOffer = await prisma.offer.update({
    where: { id: offer.id },
    data: {
      reviewStatus: OfferReviewStatus.removed,
      deletedAt: new Date()
    }
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "offer_removed_by_admin",
    entityType: "offer",
    entityId: offer.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return removedOffer;
}

export async function submitMyOffer(input: {
  userId: string;
  offerId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  await getApprovedStudentProfile(input.userId);
  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, studentUserId: input.userId, deletedAt: null },
    include: { documents: { where: { status: DocumentStatus.active, deletedAt: null } } }
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  // A resubmission after "changes requested" should read differently to admins than a brand-new offer.
  const isResubmission = offer.reviewStatus === OfferReviewStatus.changes_requested;

  if (
    offer.reviewStatus !== OfferReviewStatus.draft &&
    offer.reviewStatus !== OfferReviewStatus.changes_requested
  ) {
    throw new ApiError(409, "Offer cannot be submitted in its current status");
  }

  if (offer.reviewStatus === OfferReviewStatus.changes_requested && offer.reviewedAt) {
    const reviewedTime = new Date(offer.reviewedAt).getTime();
    
    // Find the latest document creation time
    const maxDocCreatedAt = offer.documents.reduce((max, doc) => {
      const docTime = new Date(doc.createdAt).getTime();
      return docTime > max ? docTime : max;
    }, 0);

    const hasOfferChanges = new Date(offer.updatedAt).getTime() > reviewedTime + 1000;
    const hasDocChanges = maxDocCreatedAt > reviewedTime + 1000;

    if (!hasOfferChanges && !hasDocChanges) {
      throw new ApiError(
        400,
        "No changes detected. Please modify the offer details or upload/replace a document before resubmitting."
      );
    }
  }

  const hasOfferLetter = offer.documents.some(
    (document) => document.documentType === DocumentType.offer_letter
  );
  if (!hasOfferLetter) {
    throw new ApiError(400, "Offer letter is required before submitting an offer");
  }

  const hasScholarshipLetter = offer.documents.some(
    (document) => document.documentType === DocumentType.scholarship_letter
  );
  if (offer.hasScholarship && !hasScholarshipLetter) {
    throw new ApiError(400, "Scholarship letter is required when scholarship is selected");
  }

  const submittedOffer = await prisma.offer.update({
    where: { id: offer.id },
    data: {
      reviewStatus: OfferReviewStatus.under_review,
      lockedForReview: true,
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null
    },
    include: offerInclude
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "offer_submitted",
    entityType: "offer",
    entityId: offer.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  const student = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { fullName: true, email: true }
  });

  if (student) {
    notifyOfferReviewBestEffort({
      studentName: student.fullName,
      studentEmail: student.email,
      offerId: submittedOffer.id,
      regionId: submittedOffer.regionId,
      universityName: submittedOffer.universityName,
      courseName: submittedOffer.courseName,
      reason: "submitted"
    });

    appEmitter.emit(AppEvents.OFFER_SUBMITTED, {
      studentUserId: input.userId,
      studentName: student.fullName,
      offerId: submittedOffer.id,
      regionId: submittedOffer.regionId,
      submissionKind: isResubmission ? "requested_edits" : "new"
    });
  }

  const financialRules = await getOfferFinancialRules();
  return formatOffer(submittedOffer, financialRules);
}

async function canReviewOffer(userId: string, regionId: string, offerId?: string) {
  const masterAdmin = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.master_admin }
    }
  });

  if (masterAdmin) {
    return true;
  }

  const regionalAdmin = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.regional_admin },
      regionalAdminProfile: {
        regionId,
        status: "active",
        deletedAt: null
      }
    }
  });

  if (regionalAdmin) {
    return true;
  }

  if (offerId) {
    const isAssignedMentor = await prisma.offer.findFirst({
      where: {
        id: offerId,
        mentorId: userId,
        deletedAt: null
      }
    });

    if (isAssignedMentor) {
      const mentor = await prisma.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
          accountStatus: "active",
          roles: { has: RoleCode.mentor }
        }
      });
      return Boolean(mentor);
    }
  }

  return false;
}

type AdminOfferScope =
  | { role: "master_admin"; regionId?: never }
  | { role: "regional_admin"; regionId: string };

async function getAdminOfferScope(userId: string): Promise<AdminOfferScope> {
  const masterAdmin = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.master_admin }
    }
  });

  if (masterAdmin) {
    return { role: "master_admin" };
  }

  const regionalAdmin = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.regional_admin }
    },
    include: { regionalAdminProfile: true }
  });

  if (!regionalAdmin?.regionalAdminProfile || regionalAdmin.regionalAdminProfile.status !== "active") {
    throw new ApiError(403, "You do not have permission to access offers");
  }

  return { role: "regional_admin", regionId: regionalAdmin.regionalAdminProfile.regionId };
}

function buildAdminOfferWhere(query: ListAdminOffersQuery, scope: AdminOfferScope): Prisma.OfferWhereInput {
  return {
    deletedAt: null,
    ...(query.status ? { reviewStatus: query.status } : {}),
    ...(query.regionId ? { regionId: query.regionId } : {}),
    ...(query.offerType ? { offerType: { equals: query.offerType, mode: "insensitive" } } : {}),
    ...(query.universityName
      ? { universityName: { contains: query.universityName, mode: "insensitive" } }
      : {}),
    ...(query.courseField ? { courseField: { equals: query.courseField, mode: "insensitive" } } : {}),
    ...(query.courseLevel ? { courseLevel: { equals: query.courseLevel, mode: "insensitive" } } : {}),
    ...(query.hasScholarship === undefined ? {} : { hasScholarship: query.hasScholarship }),
    ...(query.search
      ? {
        OR: [
          { universityName: { contains: query.search, mode: "insensitive" } },
          { courseName: { contains: query.search, mode: "insensitive" } },
          { courseField: { contains: query.search, mode: "insensitive" } },
          { student: { fullName: { contains: query.search, mode: "insensitive" } } },
          { student: { email: { contains: query.search, mode: "insensitive" } } }
        ]
      }
      : {}),
    ...(query.fundingType === "fully_funded"
      ? { hasScholarship: true, scholarshipCoversLivingCost: true }
      : {}),
    ...(query.fundingType === "partial_funding"
      ? { hasScholarship: true, scholarshipCoversLivingCost: false }
      : {}),
    ...(query.fundingType === "private_funding"
      ? { hasScholarship: false, privateFundingAmount: { gt: 0 } }
      : {}),
    ...(query.fundingType === "no_funding"
      ? { hasScholarship: false, privateFundingAmount: 0 }
      : {}),
    ...(scope.role === "regional_admin" ? { regionId: scope.regionId } : {})
  };
}

function emptySummary() {
  return {
    total: 0,
    byOfferType: {} as Record<string, number>,
    byUniversity: {} as Record<string, number>,
    byFundingType: {
      fully_funded: 0,
      partial_funding: 0,
      private_funding: 0,
      no_funding: 0
    },
    byReviewStatus: {} as Record<string, number>
  };
}

function getFundingType(offer: {
  hasScholarship: boolean;
  scholarshipCoversLivingCost: boolean;
  privateFundingAmount: number | string;
}) {
  if (offer.hasScholarship && offer.scholarshipCoversLivingCost) {
    return "fully_funded";
  }

  if (offer.hasScholarship) {
    return "partial_funding";
  }

  if (decimalToNumber(offer.privateFundingAmount) > 0) {
    return "private_funding";
  }

  return "no_funding";
}

function buildOfferSummary(offers: Prisma.OfferGetPayload<{ select: typeof offerSummarySelect }>[]) {
  const summary = emptySummary();
  summary.total = offers.length;

  for (const offer of offers) {
    summary.byOfferType[offer.offerType] = (summary.byOfferType[offer.offerType] ?? 0) + 1;
    summary.byUniversity[offer.universityName] = (summary.byUniversity[offer.universityName] ?? 0) + 1;
    summary.byReviewStatus[offer.reviewStatus] = (summary.byReviewStatus[offer.reviewStatus] ?? 0) + 1;
    summary.byFundingType[getFundingType(offer)] += 1;
  }

  return summary;
}

function jsonRecord(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function formatOfferRevision(
  revision: Prisma.OfferRevisionGetPayload<{
    include: { editor: { select: { id: true; fullName: true; email: true } } };
  }>
) {
  const beforeData = jsonRecord(revision.beforeData);
  const afterData = jsonRecord(revision.afterData);

  return {
    id: revision.id,
    offerId: revision.offerId,
    editedBy: revision.editedBy,
    editor: revision.editor,
    changedFields: revision.changedFields,
    changes: revision.changedFields.map((field) => ({
      field,
      before: beforeData[field] ?? null,
      after: afterData[field] ?? null
    })),
    createdAt: revision.createdAt
  };
}

async function getLatestOfferRevisionByOfferId(offerIds: string[]) {
  if (offerIds.length === 0) {
    return new Map<string, ReturnType<typeof formatOfferRevision>>();
  }

  const revisions = await prisma.offerRevision.findMany({
    where: { offerId: { in: offerIds } },
    include: { editor: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: "desc" }
  });

  const latestByOfferId = new Map<string, ReturnType<typeof formatOfferRevision>>();
  for (const revision of revisions) {
    if (!latestByOfferId.has(revision.offerId)) {
      latestByOfferId.set(revision.offerId, formatOfferRevision(revision));
    }
  }

  return latestByOfferId;
}

export async function listAdminOffers(userId: string, query: ListAdminOffersQuery) {
  const scope = await getAdminOfferScope(userId);

  if (scope.role === "regional_admin" && query.regionId && query.regionId !== scope.regionId) {
    throw new ApiError(403, "You do not have permission to access offers in this region");
  }

  const where = buildAdminOfferWhere(query, scope);
  const skip = (query.page - 1) * query.pageSize;

  const [offers, total, summaryOffers] = await Promise.all([
    prisma.offer.findMany({
      where,
      include: offerInclude,
      orderBy: { updatedAt: "desc" },
      skip,
      take: query.pageSize
    }),
    prisma.offer.count({ where }),
    prisma.offer.findMany({
      where,
      select: offerSummarySelect
    }
    )
  ]);

  const financialRules = offers.length > 0 ? await getOfferFinancialRules() : undefined;
  const formattedOffers = await Promise.all(offers.map((offer) => formatOffer(offer, financialRules)));
  const latestRevisionByOfferId = await getLatestOfferRevisionByOfferId(offers.map((offer) => offer.id));

  return {
    scope,
    offers: formattedOffers.map((offer) => ({
      ...offer,
      latestRevision: latestRevisionByOfferId.get(offer.id) ?? null
    })),
    summary: buildOfferSummary(summaryOffers),
    pagination: { page: query.page, pageSize: query.pageSize, total }
  };
}

export async function exportAdminOffersCsv(input: {
  userId: string;
  query: ListAdminOffersQuery;
  ipAddress?: string;
  userAgent?: string;
}) {
  const scope = await getAdminOfferScope(input.userId);

  if (scope.role === "regional_admin" && input.query.regionId && input.query.regionId !== scope.regionId) {
    throw new ApiError(403, "You do not have permission to access offers in this region");
  }

  const where = buildAdminOfferWhere(input.query, scope);
  const offers = await prisma.offer.findMany({
    where,
    include: {
      ...offerInclude,
      student: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          dateOfBirth: true,
          studentProfile: {
            select: {
              emergencyContactFirstName: true,
              emergencyContactRelation: true,
              emergencyContactPhone: true
            }
          }
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const financialRules = offers.length > 0 ? await getOfferFinancialRules() : undefined;
  const financialSummaries = await Promise.all(
    offers.map((offer) => formatOffer(offer, financialRules))
  );
  const rows = offers.map((offer, index) => ({
    offerId: offer.id,
    studentId: offer.studentUserId,
    studentName: offer.student.fullName,
    studentEmail: offer.student.email,
    studentPhone: offer.student.phone,
    emergencyContactName: offer.student.studentProfile?.emergencyContactFirstName,
    emergencyContactRelation: offer.student.studentProfile?.emergencyContactRelation,
    emergencyContactPhone: offer.student.studentProfile?.emergencyContactPhone,
    region: offer.region.name,
    universityName: offer.universityName,
    courseName: offer.courseName,
    courseField: offer.courseField,
    courseLevel: offer.courseLevel,
    durationYears: decimalToNumber(offer.durationYears),
    programmeStartDate: offer.programmeStartDate,
    offerType: offer.offerType,
    reviewStatus: offer.reviewStatus,
    tuitionFeePerYear: decimalToNumber(offer.tuitionFeePerYear),
    hasScholarship: offer.hasScholarship,
    scholarshipName: offer.scholarshipName,
    scholarshipAmountPerYear: offer.scholarshipAmountPerYear
      ? decimalToNumber(offer.scholarshipAmountPerYear)
      : undefined,
    scholarshipCoversLivingCost: offer.scholarshipCoversLivingCost,
    privateFundingAmount: decimalToNumber(offer.privateFundingAmount),
    fundingType: getFundingType(offer),
    currency: financialSummaries[index].financialSummary.currency,
    completeYears: financialSummaries[index].financialSummary.completeYears,
    availableFundsForYear: financialSummaries[index].financialSummary.availableFundsForYear,
    tuitionFeePerYearCovered: financialSummaries[index].financialSummary.tuitionFeePerYearCovered,
    tuitionFeePerYearGap: financialSummaries[index].financialSummary.tuitionFeePerYearGap,
    estimatedLivingOrBoardingCost: financialSummaries[index].financialSummary.estimatedLivingOrBoardingCost,
    livingCostCovered: financialSummaries[index].financialSummary.livingCostCovered,
    livingCostGap: financialSummaries[index].financialSummary.livingCostGap,
    livingCostSource: financialSummaries[index].financialSummary.livingCostSource,
    documents: offer.documents.map((document) => document.originalFilename),
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt
  }));

  await recordAuditLog({
    actorUserId: input.userId,
    action: "offers_exported",
    entityType: "offer",
    metadata: { scope, filters: input.query, rowCount: rows.length },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return toCsv(rows);
}

export async function getAdminOffer(userId: string, offerId: string) {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    include: offerInclude
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (!(await canReviewOffer(userId, offer.regionId, offer.id))) {
    throw new ApiError(403, "You do not have permission to access this offer");
  }

  const revisions = await prisma.offerRevision.findMany({
    where: { offerId: offer.id },
    include: { editor: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: "desc" }
  });

  return {
    ...(await formatOffer(offer, await getOfferFinancialRules())),
    revisions: revisions.map(formatOfferRevision)
  };
}

export async function getAdminOfferRevisions(userId: string, offerId: string) {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, deletedAt: null },
    select: { id: true, regionId: true }
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (!(await canReviewOffer(userId, offer.regionId, offer.id))) {
    throw new ApiError(403, "You do not have permission to access this offer");
  }

  const revisions = await prisma.offerRevision.findMany({
    where: { offerId: offer.id },
    include: { editor: { select: { id: true, fullName: true, email: true } } },
    orderBy: { createdAt: "desc" }
  });

  return revisions.map(formatOfferRevision);
}

export async function reviewOffer(input: {
  userId: string;
  offerId: string;
  data: ReviewOfferInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, deletedAt: null }
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (!(await canReviewOffer(input.userId, offer.regionId, offer.id))) {
    throw new ApiError(403, "You do not have permission to review this offer");
  }

  // Offers under review can be reviewed; already-decided offers (approved/rejected) can also be
  // re-flagged by an admin/mentor (e.g. reject or request changes after approval). Draft and
  // changes_requested belong to the student's edit cycle, and removed offers are gone.
  const reviewableStatuses: OfferReviewStatus[] = [
    OfferReviewStatus.under_review,
    OfferReviewStatus.approved,
    OfferReviewStatus.rejected
  ];
  if (!reviewableStatuses.includes(offer.reviewStatus)) {
    throw new ApiError(409, "This offer cannot be reviewed in its current status");
  }

  const wasApproved = offer.reviewStatus === OfferReviewStatus.approved;
  const nextStatus = input.data.status as OfferReviewStatus;
  const reviewedOffer = await prisma.$transaction(async (tx) => {
    const updatedOffer = await tx.offer.update({
      where: { id: offer.id },
      data: {
        reviewStatus: nextStatus,
        lockedForReview: nextStatus === OfferReviewStatus.approved || nextStatus === OfferReviewStatus.rejected,
        reviewedBy: input.userId,
        reviewedAt: new Date(),
        reviewNotes: input.data.notes
      },
      include: offerInclude
    });

    if (nextStatus === OfferReviewStatus.approved) {
      await tx.studentProfile.update({
        where: { userId: offer.studentUserId },
        data: { hasVerifiedOffer: true }
      });
    } else if (wasApproved) {
      // Un-approving: keep hasVerifiedOffer only if the student still has another approved offer.
      const otherApproved = await tx.offer.count({
        where: {
          studentUserId: offer.studentUserId,
          reviewStatus: OfferReviewStatus.approved,
          deletedAt: null,
          id: { not: offer.id }
        }
      });
      await tx.studentProfile.update({
        where: { userId: offer.studentUserId },
        data: { hasVerifiedOffer: otherApproved > 0 }
      });
    }

    return updatedOffer;
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: `offer_${input.data.status}`,
    entityType: "offer",
    entityId: offer.id,
    metadata: { notesProvided: Boolean(input.data.notes) },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  // Emit in-app notification
  appEmitter.emit(AppEvents.OFFER_STATUS_UPDATED, { 
    studentUserId: offer.studentUserId, 
    status: nextStatus,
    offerId: offer.id
  });

  return formatOffer(reviewedOffer, await getOfferFinancialRules());
}

export async function assignMentorToOffer(input: {
  userId: string;
  offerId: string;
  mentorId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, deletedAt: null },
    include: offerInclude
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (!(await canReviewOffer(input.userId, offer.regionId))) {
    throw new ApiError(403, "You do not have permission to assign a mentor to this offer");
  }

  const mentor = await prisma.user.findFirst({
    where: {
      id: input.mentorId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.mentor },
      volunteerProfile: {
        is: {
          deletedAt: null,
          volunteerStatus: VolunteerStatus.approved
        }
      }
    },
    select: { id: true, fullName: true, email: true }
  });

  if (!mentor) {
    throw new ApiError(400, "Assigned user must be an approved mentor");
  }

  // Directly attach mentor to the offer — no Query creation
  const updatedOffer = await prisma.offer.update({
    where: { id: offer.id },
    data: { mentorId: mentor.id },
    include: offerInclude
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "offer_mentor_assigned",
    entityType: "offer",
    entityId: offer.id,
    metadata: { mentorId: mentor.id, mentorName: mentor.fullName },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  // Emit in-app notification for the mentor
  appEmitter.emit(AppEvents.OFFER_MENTOR_ASSIGNED, {
    mentorUserId: mentor.id,
    offerId: offer.id,
    studentName: offer.student.fullName
  });

  sendEmailBestEffort({
    to: [mentor.email],
    subject: "Gaza40 Offer Assigned",
    text: `You have been assigned to review an offer for ${offer.student.fullName}.`,
    html: emailTemplates.notification(
      mentor.fullName,
      "Offer Assigned",
      `You have been assigned to review an offer for <strong>${offer.student.fullName}</strong>. Please log in to review the details.`,
      `${env.FRONTEND_URL}/mentor/offers/${offer.id}`,
      "View Offer"
    )
  });

  return formatOffer(updatedOffer, await getOfferFinancialRules());
}

export async function listMentorOffers(userId: string) {
  // Verify caller is an active mentor
  const mentor = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.mentor }
    }
  });

  if (!mentor) {
    throw new ApiError(403, "You do not have permission to access mentor offers");
  }

  const offers = await prisma.offer.findMany({
    where: { mentorId: userId, deletedAt: null },
    include: offerInclude,
    orderBy: { updatedAt: "desc" }
  });

  const financialRules = offers.length > 0 ? await getOfferFinancialRules() : undefined;
  return Promise.all(offers.map((offer) => formatOffer(offer, financialRules)));
}

export async function getMentorStudentDetails(mentorId: string, studentId: string) {
  const mentor = await prisma.user.findFirst({
    where: {
      id: mentorId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.mentor }
    }
  });

  if (!mentor) {
    throw new ApiError(403, "You do not have permission to access student details");
  }

  const assignedOffers = await prisma.offer.findMany({
    where: { studentUserId: studentId, mentorId, deletedAt: null },
    include: {
      region: true,
      university: true,
      documents: {
        where: { status: "active", deletedAt: null }
      },
      queries: {
        where: { deletedAt: null },
        include: {
          assignedTo: { select: { id: true, fullName: true, email: true } },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (assignedOffers.length === 0) {
    throw new ApiError(403, "You do not have permission to access details of this student");
  }

  const student = await prisma.user.findFirst({
    where: { id: studentId, roles: { has: RoleCode.student }, deletedAt: null },
    include: {
      studentProfile: {
        include: {
          documents: {
            where: {
              status: "active",
              deletedAt: null,
              documentType: { in: ["moi_letter", "consent_form", "english_proficiency"] }
            }
          }
        }
      },
      documents: {
        where: {
          status: "active",
          deletedAt: null,
          documentType: { in: ["moi_letter", "consent_form", "english_proficiency"] }
        }
      },
      studentQueries: {
        where: {
          deletedAt: null,
          OR: [
            { assignedToUserId: mentorId },
            { offerId: { in: assignedOffers.map(o => o.id) } }
          ]
        },
        include: {
          region: true,
          assignedTo: { select: { id: true, fullName: true, email: true } },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  // Handle expired passport and sensitive profile fields cleanup
  if (student.studentProfile) {
    const isExpired = student.studentProfile.passportExpiry && new Date(student.studentProfile.passportExpiry) < new Date();
    if (isExpired) {
      student.studentProfile.passportStatus = "expired" as any;
    }

    student.studentProfile.passportNumber = null;
    student.studentProfile.nationalIdNumber = null;
    student.studentProfile.passportExpiry = null;
  }

  const timeline: any[] = [];

  timeline.push({
    id: "create_account",
    title: "Account Registered",
    description: `Registered student account with email ${student.email}.`,
    timestamp: student.createdAt,
    type: "registration"
  });

  if (student.studentProfile) {
    if (student.studentProfile.createdAt) {
      timeline.push({
        id: "create_profile",
        title: "Profile Onboarding Initiated",
        description: "Student started entering onboarding details.",
        timestamp: student.studentProfile.createdAt,
        type: "profile"
      });
    }
    if (student.studentProfile.profileStatus === "approved" && student.studentProfile.reviewedAt) {
      timeline.push({
        id: "profile_approved",
        title: "Profile Onboarding Approved",
        description: `Profile approved by administrative review.`,
        timestamp: student.studentProfile.reviewedAt,
        type: "profile_approved"
      });
    } else if (student.studentProfile.profileStatus === "under_review" && student.studentProfile.updatedAt) {
      timeline.push({
        id: "profile_submitted",
        title: "Profile Onboarding Submitted",
        description: "Profile submitted for administrative verification.",
        timestamp: student.studentProfile.updatedAt,
        type: "profile_review"
      });
    }
  }

  for (const doc of student.documents) {
    timeline.push({
      id: `doc_${doc.id}`,
      title: "Document Uploaded",
      description: `Uploaded document of type '${doc.documentType}' (${doc.originalFilename}).`,
      timestamp: doc.createdAt,
      type: "document"
    });
  }

  for (const offer of assignedOffers) {
    timeline.push({
      id: `offer_created_${offer.id}`,
      title: "Offer Submitted",
      description: `Submitted placement offer for ${offer.universityName} (${offer.courseName}, ${offer.courseLevel}).`,
      timestamp: offer.createdAt,
      type: "offer"
    });
    if (offer.reviewStatus === "approved" && offer.reviewedAt) {
      timeline.push({
        id: `offer_approved_${offer.id}`,
        title: "Offer Placement Approved",
        description: `Verified and approved placement offer at ${offer.universityName}.`,
        timestamp: offer.reviewedAt,
        type: "offer_approved"
      });
    }
  }

  for (const query of student.studentQueries) {
    timeline.push({
      id: `query_raised_${query.id}`,
      title: "Query Raised",
      description: `Raised assistance query of type '${query.queryType}': "${query.title}".`,
      timestamp: query.createdAt,
      type: "query"
    });
    if (query.status === "resolved" && query.resolvedAt) {
      timeline.push({
        id: `query_resolved_${query.id}`,
        title: "Query Resolved",
        description: `Query "${query.title}" was resolved.`,
        timestamp: query.resolvedAt,
        type: "query_resolved"
      });
    }
  }

  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      email: student.email,
      phone: student.phone,
      dateOfBirth: student.dateOfBirth,
      accountStatus: student.accountStatus,
      createdAt: student.createdAt,
      studentProfile: student.studentProfile,
      documents: student.documents,
      offers: assignedOffers,
      queries: student.studentQueries
    },
    timeline
  };
}
