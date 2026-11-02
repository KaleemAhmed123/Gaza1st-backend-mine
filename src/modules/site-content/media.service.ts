import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../shared/http";
import { recordAuditLog } from "../../shared/audit";
import { deleteFromStorage, getObjectStreamFromStorage, uploadToStorage } from "../../shared/storage";
import sharp from "sharp";
import path from "path";
import type { Readable } from "stream";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 2000;

type ImageType = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

/**
 * Identify the image from its magic bytes. The client-supplied MIME type and filename are
 * never trusted (and SVG is deliberately unsupported because it can carry script).
 */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/** Auto-orient, cap the size and re-encode. Re-encoding drops all metadata, including GPS EXIF. */
async function normaliseImage(buffer: Buffer, type: ImageType) {
  let pipeline = sharp(buffer, { failOn: "error" })
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true });

  if (type.mime === "image/jpeg") pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  else if (type.mime === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
  else pipeline = pipeline.webp({ quality: 82 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

type UploadInput = {
  buffer: Buffer;
  alt: string;
  /** Story photos start private and only become public through the consent rules. */
  isPublic: boolean;
  actorUserId: string;
  ipAddress?: string;
  userAgent?: string;
};

export async function uploadMediaAsset(input: UploadInput) {
  const type = detectImageType(input.buffer);
  if (!type) {
    throw new ApiError(400, "Only JPEG, PNG or WebP images are allowed", "INVALID_IMAGE");
  }

  let processed;
  try {
    processed = await normaliseImage(input.buffer, type);
  } catch {
    throw new ApiError(400, "The image could not be processed", "INVALID_IMAGE");
  }

  const { key, bucket } = await uploadToStorage(processed.data, `image.${type.ext}`, type.mime, "site-media");

  const asset = await prisma.mediaAsset.create({
    data: {
      storageKey: key,
      storageBucket: bucket,
      mimeType: type.mime,
      sizeBytes: processed.data.length,
      width: processed.width,
      height: processed.height,
      alt: input.alt,
      isPublic: input.isPublic,
      uploadedBy: input.actorUserId,
      deletedAt: null // explicit: on MongoDB a missing field does not match `deletedAt: null`
    }
  });

  await recordAuditLog({
    actorUserId: input.actorUserId,
    action: "media_uploaded",
    entityType: "media_asset",
    entityId: asset.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return toMediaDto(asset);
}

export function toMediaDto(asset: { id: string; alt: string; width: number | null; height: number | null }) {
  return {
    id: asset.id,
    url: mediaUrl(asset.id),
    alt: asset.alt,
    width: asset.width,
    height: asset.height
  };
}

export function mediaUrl(id: string) {
  return `/api/public/media/${id}`;
}

export async function updateMediaAlt(id: string, alt: string, actorUserId: string) {
  const existing = await prisma.mediaAsset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(404, "Media not found");

  const asset = await prisma.mediaAsset.update({ where: { id }, data: { alt } });
  await recordAuditLog({
    actorUserId,
    action: "media_updated",
    entityType: "media_asset",
    entityId: id
  });
  return toMediaDto(asset);
}

export async function deleteMediaAsset(id: string, actorUserId: string) {
  const existing = await prisma.mediaAsset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(404, "Media not found");

  await prisma.mediaAsset.update({ where: { id }, data: { deletedAt: new Date(), isPublic: false } });
  await deleteFromStorage(existing.storageKey, existing.storageBucket);
  await recordAuditLog({
    actorUserId,
    action: "media_deleted",
    entityType: "media_asset",
    entityId: id
  });
}

/** Used by stories: flip visibility without deleting, so a consent change takes effect at once. */
export async function setMediaPublic(id: string, isPublic: boolean) {
  await prisma.mediaAsset.updateMany({ where: { id, deletedAt: null }, data: { isPublic } });
}

export type ServableMedia =
  | { kind: "stream"; stream: Readable; mimeType: string; sizeBytes: number }
  | { kind: "file"; path: string; mimeType: string; sizeBytes: number };

/**
 * Look the asset up by DB id and return a way to serve it. Null means "respond 404".
 * `includePrivate` is for the admin preview route only.
 */
export async function getServableMedia(id: string, includePrivate = false): Promise<ServableMedia | null> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, deletedAt: null, ...(includePrivate ? {} : { isPublic: true }) }
  });
  if (!asset) return null;

  const stream = await getObjectStreamFromStorage(asset.storageKey, asset.storageBucket || env.R2_BUCKET_NAME);
  if (stream) {
    return { kind: "stream", stream, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes };
  }

  if (asset.storageBucket === "local_private") {
    return {
      kind: "file",
      path: path.join(process.cwd(), asset.storageKey),
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes
    };
  }
  return null;
}
