import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../shared/http";
import { recordAuditLog } from "../../shared/audit";
import { DEFAULT_ABOUT_DOCUMENT } from "./about.defaults";
import { aboutDocumentSchema, type AboutBlock, type AboutDocument } from "./about.validation";
import { toMediaDto } from "./media.service";
import type { Actor } from "./request-actor";

const ABOUT_SLUG = "about";

type MediaDto = ReturnType<typeof toMediaDto>;
type WithMedia<T> = T extends { mediaId?: string | null } ? Omit<T, "mediaId"> & { media: MediaDto | null } : T;
export type ResolvedAboutBlock = WithMedia<AboutBlock>;

/** The page row is created lazily from the starter scaffold, so no seeding step is needed. */
async function getOrCreatePage() {
  const existing = await prisma.sitePage.findUnique({ where: { slug: ABOUT_SLUG } });
  if (existing) return existing;

  return prisma.sitePage.upsert({
    where: { slug: ABOUT_SLUG },
    create: { slug: ABOUT_SLUG, draft: DEFAULT_ABOUT_DOCUMENT as Prisma.InputJsonValue },
    update: {}
  });
}

function parseDocument(value: unknown): AboutDocument {
  const parsed = aboutDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(500, "Stored About content is invalid", "ABOUT_CONTENT_INVALID");
  }
  return parsed.data;
}

const mediaIdsOf = (blocks: AboutBlock[]) =>
  blocks.flatMap((block) => ("mediaId" in block && block.mediaId ? [block.mediaId] : []));

async function assertMediaExists(blocks: AboutBlock[]) {
  const ids = [...new Set(mediaIdsOf(blocks))];
  if (!ids.length) return;
  const found = await prisma.mediaAsset.count({ where: { id: { in: ids }, isPublic: true, deletedAt: null } });
  if (found !== ids.length) {
    throw new ApiError(400, "One or more selected images no longer exist", "MEDIA_NOT_FOUND");
  }
}

async function resolveMedia(document: AboutDocument): Promise<ResolvedAboutBlock[]> {
  const ids = [...new Set(mediaIdsOf(document.blocks))];
  const assets = ids.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: ids }, isPublic: true, deletedAt: null } })
    : [];
  const byId = new Map(assets.map((asset) => [asset.id, toMediaDto(asset)]));

  return document.blocks.map((block) => {
    if (!("mediaId" in block)) return block as ResolvedAboutBlock;
    const { mediaId, ...rest } = block;
    return { ...rest, media: mediaId ? (byId.get(mediaId) ?? null) : null } as ResolvedAboutBlock;
  });
}

export async function getAdminAbout() {
  const page = await getOrCreatePage();
  const draft = parseDocument(page.draft);
  return {
    draft,
    version: page.version,
    publishedAt: page.publishedAt,
    hasUnpublishedChanges: page.published === null || JSON.stringify(page.published) !== JSON.stringify(draft),
    // The editor needs image URLs/alt text for the blocks it is showing.
    media: Object.fromEntries(
      (await resolveMedia(draft))
        .flatMap((block) => ("media" in block && block.media ? [block.media] : []))
        .map((media) => [media.id, media])
    )
  };
}

export async function saveAboutDraft(input: unknown, actor: Actor) {
  const document = aboutDocumentSchema.parse(input);
  await assertMediaExists(document.blocks);
  await getOrCreatePage();

  await prisma.sitePage.update({
    where: { slug: ABOUT_SLUG },
    data: { draft: document as Prisma.InputJsonValue, updatedBy: actor.actorUserId }
  });
  await recordAuditLog({
    ...actor,
    action: "about_draft_saved",
    entityType: "site_page",
    metadata: { slug: ABOUT_SLUG, blocks: document.blocks.length }
  });
  return getAdminAbout();
}

export async function publishAbout(actor: Actor) {
  const page = await getOrCreatePage();
  const draft = parseDocument(page.draft);
  await assertMediaExists(draft.blocks);

  const updated = await prisma.sitePage.update({
    where: { slug: ABOUT_SLUG },
    data: {
      published: draft as Prisma.InputJsonValue,
      version: page.version + 1,
      publishedAt: new Date(),
      publishedBy: actor.actorUserId
    }
  });
  await recordAuditLog({
    ...actor,
    action: "about_published",
    entityType: "site_page",
    metadata: { slug: ABOUT_SLUG, version: updated.version }
  });
  return getAdminAbout();
}

export async function getAboutPreview() {
  const page = await getOrCreatePage();
  return { blocks: await resolveMedia(parseDocument(page.draft)) };
}

/** Public: published content only. `page: null` until the first publish. */
export async function getPublicAbout() {
  const page = await prisma.sitePage.findUnique({ where: { slug: ABOUT_SLUG } });
  if (!page?.published) return null;

  return {
    version: page.version,
    publishedAt: page.publishedAt,
    blocks: await resolveMedia(parseDocument(page.published))
  };
}
