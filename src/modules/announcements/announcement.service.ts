import { prisma } from "../../db/prisma";
import { recordAuditLog } from "../../shared/audit";
import { ApiError } from "../../shared/http";
import { appEmitter, AppEvents } from "../../shared/events";
import { uploadToStorage, getSignedStorageUrl, deleteFromStorage } from "../../shared/storage";
import type {
  CreateAnnouncementInput,
  ListAdminAnnouncementsQuery,
  ListAnnouncementsQuery,
  ListPublicAnnouncementsQuery,
  UpdateAnnouncementInput
} from "./announcement.validation";

const announcementInclude = {
  createdBy: {
    select: {
      id: true,
      fullName: true,
      email: true
    }
  },
  university: {
    select: {
      id: true,
      name: true,
      city: true,
      logoUrl: true,
      regionId: true,
      region: {
        select: {
          id: true,
          name: true,
          code: true
        }
      }
    }
  },
  region: {
    select: {
      id: true,
      name: true,
      code: true
    }
  }
};

// Static list of valid announcement categories (matches frontend form options)
const VALID_ANNOUNCEMENT_CATEGORIES = new Set([
  "misc",
  "deadlines",
  "scholarships",
  "passports",
  "webinars",
  "general",
  "update",
  "alert",
  "university_process"
]);

async function ensureCategory(category?: string) {
  if (!category) {
    return;
  }

  // First check against static list of known categories (always valid)
  if (VALID_ANNOUNCEMENT_CATEGORIES.has(category)) {
    return;
  }

  // Fall back to DB config options for any dynamically added categories
  const option = await prisma.configOption.findFirst({
    where: {
      groupKey: "announcement_category",
      value: category,
      isActive: true,
      deletedAt: null
    }
  });

  if (!option) {
    throw new ApiError(400, `Announcement category "${category}" is invalid or inactive`);
  }
}

async function ensureAnnouncement(id: string) {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new ApiError(400, "Invalid announcement ID format");
  }
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    include: announcementInclude
  });

  if (!announcement) {
    throw new ApiError(404, "Announcement not found");
  }

  return announcement;
}

/**
 * Resolves the set of region IDs the user is allowed to access.
 * Returns null to indicate unrestricted access (master admin).
 */
async function getUserAccessibleRegionIds(user: { id: string; roles: string[] }): Promise<string[] | null> {
  if (user.roles.includes("master_admin")) {
    return null; // unrestricted
  }

  if (user.roles.includes("regional_admin")) {
    const profile = await prisma.regionalAdminProfile.findUnique({ where: { userId: user.id } });
    return profile?.regionId ? [profile.regionId] : [];
  }

  if (user.roles.includes("student")) {
    const offers = await prisma.offer.findMany({
      where: { studentUserId: user.id, deletedAt: null },
      select: { regionId: true }
    });
    return offers.map(o => o.regionId).filter((id): id is string => Boolean(id));
  }

  if (user.roles.includes("mentor")) {
    const [volunteerProfile, mentorOffers] = await Promise.all([
      prisma.volunteerProfile.findUnique({ where: { userId: user.id } }),
      prisma.offer.findMany({ where: { mentorId: user.id, deletedAt: null }, select: { regionId: true } })
    ]);
    return [
      ...(volunteerProfile?.preferredRegionId ? [volunteerProfile.preferredRegionId] : []),
      ...mentorOffers.map(o => o.regionId)
    ].filter((id): id is string => Boolean(id));
  }

  return [];
}

/**
 * Builds a Prisma-compatible region filter clause based on the user's accessible regions.
 */
async function buildRegionFilter(user: { id: string; roles: string[] }) {
  const accessibleRegionIds = await getUserAccessibleRegionIds(user);

  if (accessibleRegionIds === null) return {}; // master admin: no filter

  return {
    OR: [
      { regionId: null },
      ...(accessibleRegionIds.length > 0 ? [{ regionId: { in: accessibleRegionIds } }] : [])
    ]
  };
}

/**
 * Validates a user can view a specific announcement.
 * Global announcements (no region) are open to all.
 * Region-targeted announcements are restricted to users who have access to that region.
 */
async function ensureAnnouncementViewAccess(announcement: { regionId: string | null }, user: { id: string; roles: string[] }) {
  if (!announcement.regionId) return; // global announcement, open to all

  const accessibleRegionIds = await getUserAccessibleRegionIds(user);

  if (accessibleRegionIds === null) return; // master admin, unrestricted

  if (!accessibleRegionIds.includes(announcement.regionId)) {
    throw new ApiError(403, "You do not have permission to access this announcement");
  }
}

/**
 * Validates a user can mutate (edit/delete) an announcement.
 * Master admins can modify any announcement.
 * Non-master-admin roles (including regional_admin) can only modify their own.
 */
function ensureAuthorOrAdmin(announcement: { createdByUserId: string }, user: { id: string; roles: string[] }) {
  if (user.roles.includes("master_admin")) return;
  if (announcement.createdByUserId === user.id) return;
  throw new ApiError(403, "Only the author or a Master Admin can modify this announcement");
}

async function validateRegionTarget(regionId: string | null | undefined, user: { id: string; roles: string[] }) {
  if (!regionId) return;

  const region = await prisma.region.findFirst({ where: { id: regionId, deletedAt: null } });
  if (!region) {
    throw new ApiError(400, "Target region does not exist");
  }

  if (user.roles.includes("regional_admin") && !user.roles.includes("master_admin")) {
    const profile = await prisma.regionalAdminProfile.findUnique({ where: { userId: user.id } });
    if (!profile || profile.regionId !== regionId) {
      throw new ApiError(403, "You can only target announcements to your assigned region");
    }
  }
}

export async function listPublishedAnnouncements(query: ListAnnouncementsQuery, user: { id: string; roles: string[] }) {
  const regionFilter = await buildRegionFilter(user);

  return prisma.announcement.findMany({
    where: {
      deletedAt: null,
      isPublished: true,
      ...(query.category ? { category: query.category } : {}),
      ...(query.universityId ? { universityId: query.universityId } : {}),
      ...(query.regionId ? { regionId: query.regionId } : {}),
      ...(query.isPublic !== undefined ? { isPublic: query.isPublic } : {}),
      ...regionFilter
    },
    include: announcementInclude,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function listPublicAnnouncements(query: ListPublicAnnouncementsQuery) {
  const now = new Date();
  const fourteenDaysLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  let deadlineCondition: any = undefined;
  if (query.deadlineStatus === 'closing_soon') {
    deadlineCondition = {
      deadline: {
        gte: now,
        lte: fourteenDaysLater
      }
    };
  } else if (query.deadlineStatus === 'open') {
    deadlineCondition = {
      OR: [
        { isRollingDeadline: true },
        { deadline: { gte: now } },
        { deadline: null, isRollingDeadline: false }
      ]
    };
  } else if (query.deadlineStatus === 'future') {
    deadlineCondition = {
      deadline: { gt: fourteenDaysLater }
    };
  } else if (query.deadlineStatus === 'rolling') {
    deadlineCondition = {
      isRollingDeadline: true
    };
  } else if (query.deadlineStatus === 'closed') {
    deadlineCondition = {
      OR: [
        { scholarshipStatus: 'closed' },
        {
          AND: [
            { isRollingDeadline: false },
            { deadline: { lt: now } }
          ]
        }
      ]
    };
  }

  return prisma.announcement.findMany({
    where: {
      deletedAt: null,
      isPublished: true,
      isPublic: true,
      ...(query.category ? { category: query.category } : {}),
      ...(query.universityId ? { universityId: query.universityId } : {}),
      ...(query.regionId ? { regionId: query.regionId } : {}),
      ...(query.degreeLevel ? { degreeLevel: query.degreeLevel } : {}),
      ...(query.fundingType ? { fundingType: query.fundingType } : {}),
      ...(query.subject ? { subject: query.subject } : {}),
      ...(query.scholarshipStatus ? { scholarshipStatus: query.scholarshipStatus } : {}),
      ...(deadlineCondition ? deadlineCondition : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { body: { contains: query.search, mode: "insensitive" } },
              { provider: { contains: query.search, mode: "insensitive" } },
              { university: { name: { contains: query.search, mode: "insensitive" } } }
            ]
          }
        : {})
    },
    include: announcementInclude,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function getPublicAnnouncement(id: string) {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new ApiError(400, "Invalid announcement ID format");
  }
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null, isPublished: true, isPublic: true },
    include: announcementInclude
  });

  if (!announcement) {
    throw new ApiError(404, "Announcement not found or not publicly accessible");
  }

  return announcement;
}

export async function getPublicAnnouncementGuideForDownload(id: string) {
  const announcement = await getPublicAnnouncement(id);
  const key = (announcement as any).guideStorageKey as string | null;
  const bucket = (announcement as any).guideStorageBucket as string | null;
  const fileName = (announcement as any).guideFileName as string | null;

  if (!key || !bucket) {
    throw new ApiError(404, "This announcement does not have a guide attached");
  }

  if (bucket === "local_private") {
    return { isLocal: true as const, key, fileName: fileName || "guide.pdf" };
  }

  const url = await getSignedStorageUrl(key, bucket, 3600, fileName || undefined);
  if (!url) {
    throw new ApiError(503, "Could not generate the guide download link right now. Please try again.");
  }
  return { isLocal: false as const, url, fileName: fileName || "guide.pdf" };
}

export async function getPublishedAnnouncement(id: string, user: { id: string; roles: string[] }) {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new ApiError(400, "Invalid announcement ID format");
  }
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null, isPublished: true },
    include: announcementInclude
  });

  if (!announcement) {
    throw new ApiError(404, "Announcement not found");
  }

  await ensureAnnouncementViewAccess(announcement, user);

  return announcement;
}

export async function listAdminAnnouncements(
  query: ListAdminAnnouncementsQuery,
  user: { id: string; roles: string[] }
) {
  const isRegional = user.roles.includes("regional_admin") && !user.roles.includes("master_admin");
  let filter: any = { deletedAt: null };

  if (isRegional) {
    const profile = await prisma.regionalAdminProfile.findUnique({
      where: { userId: user.id }
    });
    const regId = profile?.regionId ?? null;
    filter.OR = [
      { regionId: null },
      ...(regId ? [{ regionId: regId }] : []),
      { createdByUserId: user.id }
    ];
  }

  if (query.category) {
    filter.category = query.category;
  }
  if (query.isPublished !== undefined) {
    filter.isPublished = query.isPublished;
  }
  if (query.isPublic !== undefined) {
    filter.isPublic = query.isPublic;
  }
  if (query.universityId) {
    filter.universityId = query.universityId;
  }
  if (query.regionId) {
    filter.regionId = query.regionId;
  }

  return prisma.announcement.findMany({
    where: filter,
    include: announcementInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function getAdminAnnouncement(id: string, user: { id: string; roles: string[] }) {
  const announcement = await ensureAnnouncement(id);
  await ensureAnnouncementViewAccess(announcement, user);
  return announcement;
}

async function validateAnnouncementLimits(body: string) {
  if (!body) return;

  const limits = await prisma.appConfig.findUnique({
    where: { key: "announcement_limits" }
  });
  const limitsValue = (limits?.value as any) || {};
  const maxCharacters = Number(limitsValue.maxCharacters) ?? 15000;
  const maxImages = Number(limitsValue.maxImages) ?? 5;

  const plainText = body.replace(/<[^>]*>/g, '').trim();
  if (plainText.length > maxCharacters) {
    throw new ApiError(
      400,
      `Announcement text length (${plainText.length}) exceeds the maximum allowed limit of ${maxCharacters} characters (excluding HTML formatting).`
    );
  }

  const imageCount = (body.match(/<img[^>]*>/g) || []).length;
  if (imageCount > maxImages) {
    throw new ApiError(
      400,
      `Announcement contains ${imageCount} images, which exceeds the maximum allowed limit of ${maxImages} images.`
    );
  }
}

export async function createAnnouncement(input: {
  user: { id: string; roles: string[] };
  data: CreateAnnouncementInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  await ensureCategory(input.data.category);
  await validateRegionTarget(input.data.regionId, input.user);
  await validateAnnouncementLimits(input.data.body);

  const isPublished = input.data.isPublished ?? false;
  const createPayload: any = {
    title: input.data.title,
    body: input.data.body,
    category: input.data.category,
    regionId: input.data.regionId || null,
    universityId: input.data.universityId || null,
    isPublic: Boolean(input.data.isPublic),
    createdByUserId: input.user.id,
    isPublished,
    publishedAt: isPublished ? new Date() : undefined,
    showApplyButton: (input.data as any).showApplyButton ?? false,
    applyLink: (input.data as any).applyLink || null,
    degreeLevel: input.data.degreeLevel || null,
    subject: input.data.subject || null,
    fundingType: input.data.fundingType || null,
    scholarshipStatus: input.data.scholarshipStatus || 'open',
    deadline: input.data.deadline || null,
    isRollingDeadline: Boolean(input.data.isRollingDeadline),
    provider: input.data.provider || null,
    officialUrl: input.data.officialUrl || null,
    duration: input.data.duration || null,
    scholarshipDetails: input.data.scholarshipDetails || undefined,
    deletedAt: null
  };
  const announcement = await (prisma.announcement as any).create({
    data: createPayload,
    include: announcementInclude
  });

  await recordAuditLog({
    actorUserId: input.user.id,
    action: "announcement_created",
    entityType: "announcement",
    entityId: announcement.id,
    metadata: { isPublished, category: input.data.category, regionId: input.data.regionId },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  if (isPublished) {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, accountStatus: "active", roles: { hasSome: ["student", "mentor"] } },
      select: { id: true }
    });
    appEmitter.emit(AppEvents.ANNOUNCEMENT_CREATED, {
      title: announcement.title,
      targetUserIds: users.map(u => u.id)
    });
  }

  return announcement;
}

export async function updateAnnouncement(input: {
  user: { id: string; roles: string[] };
  announcementId: string;
  data: UpdateAnnouncementInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const announcement = await ensureAnnouncement(input.announcementId);
  ensureAuthorOrAdmin(announcement, input.user);

  await ensureCategory(input.data.category);
  if (input.data.regionId !== undefined) {
    await validateRegionTarget(input.data.regionId, input.user);
  }
  if (input.data.body !== undefined) {
    await validateAnnouncementLimits(input.data.body);
  }

  const publishNow = input.data.isPublished === true && !announcement.isPublished;
  const unpublishNow = input.data.isPublished === false;

  const updatePayload: any = {
    title: input.data.title,
    body: input.data.body,
    category: input.data.category,
    regionId: input.data.regionId !== undefined ? (input.data.regionId || null) : undefined,
    universityId: input.data.universityId !== undefined ? (input.data.universityId || null) : undefined,
    isPublic: input.data.isPublic !== undefined ? Boolean(input.data.isPublic) : undefined,
    isPublished: input.data.isPublished,
    publishedAt: publishNow ? new Date() : unpublishNow ? null : undefined,
    showApplyButton: (input.data as any).showApplyButton,
    applyLink: (input.data as any).applyLink,
    degreeLevel: input.data.degreeLevel !== undefined ? (input.data.degreeLevel || null) : undefined,
    subject: input.data.subject !== undefined ? (input.data.subject || null) : undefined,
    fundingType: input.data.fundingType !== undefined ? (input.data.fundingType || null) : undefined,
    scholarshipStatus: input.data.scholarshipStatus !== undefined ? (input.data.scholarshipStatus || 'open') : undefined,
    deadline: input.data.deadline !== undefined ? (input.data.deadline || null) : undefined,
    isRollingDeadline: input.data.isRollingDeadline !== undefined ? Boolean(input.data.isRollingDeadline) : undefined,
    provider: input.data.provider !== undefined ? (input.data.provider || null) : undefined,
    officialUrl: input.data.officialUrl !== undefined ? (input.data.officialUrl || null) : undefined,
    duration: input.data.duration !== undefined ? (input.data.duration || null) : undefined,
    scholarshipDetails: input.data.scholarshipDetails !== undefined ? input.data.scholarshipDetails : undefined
  };
  const updatedAnnouncement = await (prisma.announcement as any).update({
    where: { id: announcement.id },
    data: updatePayload,
    include: announcementInclude
  });

  await recordAuditLog({
    actorUserId: input.user.id,
    action: "announcement_updated",
    entityType: "announcement",
    entityId: announcement.id,
    metadata: { isPublished: updatedAnnouncement.isPublished, category: updatedAnnouncement.category, regionId: updatedAnnouncement.regionId },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  if (publishNow) {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, accountStatus: "active", roles: { hasSome: ["student", "mentor"] } },
      select: { id: true }
    });
    appEmitter.emit(AppEvents.ANNOUNCEMENT_CREATED, {
      title: updatedAnnouncement.title,
      targetUserIds: users.map(u => u.id)
    });
  }

  return updatedAnnouncement;
}

export async function setAnnouncementGuide(input: {
  user: { id: string; roles: string[] };
  announcementId: string;
  file: { buffer: Buffer; originalname: string; mimetype: string };
}) {
  const announcement = await ensureAnnouncement(input.announcementId);
  ensureAuthorOrAdmin(announcement, input.user);

  if (input.file.mimetype !== "application/pdf") {
    throw new ApiError(400, "The announcement guide must be a PDF file");
  }

  const { key, bucket } = await uploadToStorage(
    input.file.buffer,
    input.file.originalname,
    input.file.mimetype,
    "announcement-guides"
  );

  // Remove the previous guide file if one existed.
  if (announcement.guideStorageKey && announcement.guideStorageBucket) {
    await deleteFromStorage(announcement.guideStorageKey, announcement.guideStorageBucket).catch(() => undefined);
  }

  return (prisma.announcement as any).update({
    where: { id: announcement.id },
    data: {
      guideFileName: input.file.originalname,
      guideStorageKey: key,
      guideStorageBucket: bucket
    },
    include: announcementInclude
  });
}

export async function removeAnnouncementGuide(input: {
  user: { id: string; roles: string[] };
  announcementId: string;
}) {
  const announcement = await ensureAnnouncement(input.announcementId);
  ensureAuthorOrAdmin(announcement, input.user);

  if ((announcement as any).guideStorageKey && (announcement as any).guideStorageBucket) {
    await deleteFromStorage((announcement as any).guideStorageKey, (announcement as any).guideStorageBucket).catch(() => undefined);
  }

  return (prisma.announcement as any).update({
    where: { id: announcement.id },
    data: { guideFileName: null, guideStorageKey: null, guideStorageBucket: null },
    include: announcementInclude
  });
}

/**
 * Resolves the guide file for download. Returns either a signed R2 URL to redirect to,
 * or a local file path to stream. View access follows the same region rules as the announcement.
 */
export async function getAnnouncementGuideForDownload(id: string, user: { id: string; roles: string[] }) {
  const announcement = await getPublishedAnnouncement(id, user);
  const key = (announcement as any).guideStorageKey as string | null;
  const bucket = (announcement as any).guideStorageBucket as string | null;
  const fileName = (announcement as any).guideFileName as string | null;

  if (!key || !bucket) {
    throw new ApiError(404, "This announcement has no guide file");
  }

  if (bucket === "local_private") {
    return { isLocal: true as const, key, fileName: fileName || "guide.pdf" };
  }

  const url = await getSignedStorageUrl(key, bucket, 3600, fileName || undefined);
  if (!url) {
    throw new ApiError(503, "Could not generate the guide download link right now. Please try again.");
  }
  return { isLocal: false as const, url, fileName: fileName || "guide.pdf" };
}

export async function deleteAnnouncement(input: {
  user: { id: string; roles: string[] };
  announcementId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const announcement = await ensureAnnouncement(input.announcementId);
  ensureAuthorOrAdmin(announcement, input.user);

  const deletedAnnouncement = await prisma.announcement.update({
    where: { id: announcement.id },
    data: {
      isPublished: false,
      deletedAt: new Date()
    },
    include: announcementInclude
  });

  await recordAuditLog({
    actorUserId: input.user.id,
    action: "announcement_deleted",
    entityType: "announcement",
    entityId: announcement.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return deletedAnnouncement;
}
