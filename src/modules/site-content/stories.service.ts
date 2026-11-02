import type { StudentStory } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../shared/http";
import { recordAuditLog } from "../../shared/audit";
import { setMediaPublic, toMediaDto } from "./media.service";
import type { Actor } from "./request-actor";
import type { createStorySchema, setConsentSchema, updateStorySchema } from "./stories.validation";

// A story is publicly visible only when it is published AND consent is currently granted.
// Every public query repeats the consent check (defence in depth), and the photo is a separate,
// narrower condition: it also needs explicit photo consent.
const PUBLIC_WHERE = { isPublished: true, consentStatus: "granted", deletedAt: null } as const;

async function findOrThrow(id: string) {
  const story = await prisma.studentStory.findFirst({ where: { id, deletedAt: null } });
  if (!story) throw new ApiError(404, "Story not found");
  return story;
}

const photoIsPublic = (story: Pick<StudentStory, "isPublished" | "consentStatus" | "photoConsent">) =>
  story.isPublished && story.consentStatus === "granted" && story.photoConsent;

/** Keep the attached photo's public visibility in lock-step with the story's consent state. */
async function syncPhotoVisibility(story: StudentStory) {
  if (story.photoMediaId) await setMediaPublic(story.photoMediaId, photoIsPublic(story));
}

async function assertPhotoExists(photoMediaId: string | null | undefined) {
  if (!photoMediaId) return;
  const count = await prisma.mediaAsset.count({ where: { id: photoMediaId, deletedAt: null } });
  if (!count) throw new ApiError(400, "The selected photo no longer exists", "MEDIA_NOT_FOUND");
}

async function photoDtoFor(story: StudentStory) {
  if (!story.photoMediaId) return null;
  const asset = await prisma.mediaAsset.findFirst({ where: { id: story.photoMediaId, deletedAt: null } });
  return asset ? toMediaDto(asset) : null;
}

/** Admin shape: everything, including consent metadata. Never returned by a public route. */
async function toAdminDto(story: StudentStory) {
  return {
    id: story.id,
    displayName: story.displayName,
    country: story.country,
    previousEducation: story.previousEducation,
    university: story.university,
    course: story.course,
    scholarship: story.scholarship,
    journey: story.journey,
    currentStatus: story.currentStatus,
    quote: story.quote,
    photo: await photoDtoFor(story),
    consentStatus: story.consentStatus,
    photoConsent: story.photoConsent,
    consentRecordedAt: story.consentRecordedAt,
    consentNote: story.consentNote,
    isPublished: story.isPublished,
    publishedAt: story.publishedAt,
    sortOrder: story.sortOrder,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt
  };
}

/** Public shape: an explicit field-by-field whitelist so internal fields cannot leak by accident. */
async function toPublicDto(story: StudentStory) {
  return {
    id: story.id,
    displayName: story.displayName,
    country: story.country,
    previousEducation: story.previousEducation,
    university: story.university,
    course: story.course,
    scholarship: story.scholarship,
    journey: story.journey,
    currentStatus: story.currentStatus,
    quote: story.quote,
    photo: story.photoConsent ? await photoDtoFor(story) : null,
    publishedAt: story.publishedAt
  };
}

export async function listPublicStories(params: { limit: number; page: number }) {
  const [stories, total] = await Promise.all([
    prisma.studentStory.findMany({
      where: PUBLIC_WHERE,
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
      take: params.limit,
      skip: (params.page - 1) * params.limit
    }),
    prisma.studentStory.count({ where: PUBLIC_WHERE })
  ]);
  return { stories: await Promise.all(stories.map(toPublicDto)), total, page: params.page, limit: params.limit };
}

export async function getPublicStory(id: string) {
  const story = await prisma.studentStory.findFirst({ where: { id, ...PUBLIC_WHERE } });
  if (!story) throw new ApiError(404, "Story not found");
  return toPublicDto(story);
}

export async function listAdminStories() {
  const stories = await prisma.studentStory.findMany({
    where: { deletedAt: null },
    orderBy: [{ createdAt: "desc" }]
  });
  return Promise.all(stories.map(toAdminDto));
}

export async function getAdminStory(id: string) {
  return toAdminDto(await findOrThrow(id));
}

export async function createStory(data: z.infer<typeof createStorySchema>, actor: Actor) {
  await assertPhotoExists(data.photoMediaId);
  // deletedAt is explicit: on MongoDB a missing field does not match `deletedAt: null`.
  const story = await prisma.studentStory.create({ data: { ...data, createdBy: actor.actorUserId, deletedAt: null } });
  await syncPhotoVisibility(story); // new stories are unpublished, so a photo starts private
  await recordAuditLog({ ...actor, action: "story_created", entityType: "student_story", entityId: story.id });
  return toAdminDto(story);
}

export async function updateStory(id: string, data: z.infer<typeof updateStorySchema>, actor: Actor) {
  const before = await findOrThrow(id);
  await assertPhotoExists(data.photoMediaId);

  const story = await prisma.studentStory.update({ where: { id }, data });
  if (before.photoMediaId && before.photoMediaId !== story.photoMediaId) {
    await setMediaPublic(before.photoMediaId, false); // a replaced photo must not stay reachable
  }
  await syncPhotoVisibility(story);
  await recordAuditLog({
    ...actor,
    action: "story_updated",
    entityType: "student_story",
    entityId: id,
    metadata: { fields: Object.keys(data) } // field names only, never story content
  });
  return toAdminDto(story);
}

export async function setStoryConsent(id: string, input: z.infer<typeof setConsentSchema>, actor: Actor) {
  const before = await findOrThrow(id);
  const granted = input.status === "granted";

  const story = await prisma.studentStory.update({
    where: { id },
    data: {
      consentStatus: input.status,
      // Photo consent can only exist while overall consent is granted.
      photoConsent: granted ? input.photoConsent : false,
      consentNote: input.note ?? before.consentNote,
      consentRecordedAt: new Date(),
      consentRecordedBy: actor.actorUserId,
      // Anything other than "granted" takes the story down immediately.
      ...(granted ? {} : { isPublished: false })
    }
  });
  await syncPhotoVisibility(story);
  await recordAuditLog({
    ...actor,
    action: input.status === "withdrawn" ? "story_consent_withdrawn" : "story_consent_updated",
    entityType: "student_story",
    entityId: id,
    metadata: { status: input.status, photoConsent: story.photoConsent, wasPublished: before.isPublished }
  });
  return toAdminDto(story);
}

export async function publishStory(id: string, actor: Actor) {
  const before = await findOrThrow(id);
  if (before.consentStatus !== "granted") {
    throw new ApiError(409, "A story cannot be published until consent has been granted", "CONSENT_REQUIRED");
  }

  const story = await prisma.studentStory.update({
    where: { id },
    data: { isPublished: true, publishedAt: before.publishedAt ?? new Date() }
  });
  await syncPhotoVisibility(story);
  await recordAuditLog({ ...actor, action: "story_published", entityType: "student_story", entityId: id });
  return toAdminDto(story);
}

export async function unpublishStory(id: string, actor: Actor) {
  await findOrThrow(id);
  const story = await prisma.studentStory.update({ where: { id }, data: { isPublished: false } });
  await syncPhotoVisibility(story);
  await recordAuditLog({ ...actor, action: "story_unpublished", entityType: "student_story", entityId: id });
  return toAdminDto(story);
}

export async function deleteStory(id: string, actor: Actor) {
  const before = await findOrThrow(id);
  await prisma.studentStory.update({ where: { id }, data: { deletedAt: new Date(), isPublished: false } });
  if (before.photoMediaId) await setMediaPublic(before.photoMediaId, false);
  await recordAuditLog({ ...actor, action: "story_deleted", entityType: "student_story", entityId: id });
}
