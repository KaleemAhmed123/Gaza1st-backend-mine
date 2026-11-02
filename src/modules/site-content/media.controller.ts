import type { NextFunction, Response } from "express";
import { pipeline } from "stream";
import { z } from "zod";
import { asyncHandler, ApiError, sendSuccess } from "../../shared/http";
import { objectIdSchema } from "../../shared/validation";
import { actorFrom } from "./request-actor";
import {
  deleteMediaAsset,
  getServableMedia,
  updateMediaAlt,
  uploadMediaAsset,
  type ServableMedia
} from "./media.service";

const altSchema = z.string().trim().min(1, "Alt text is required").max(300);
// "story" photos start private; they only become public through the story consent rules.
const uploadBodySchema = z.object({ alt: altSchema, purpose: z.enum(["site", "story"]).default("site") });
const updateBodySchema = z.object({ alt: altSchema });

export const uploadMediaHandler = asyncHandler(async (req, res) => {
  const file = (req.files as Record<string, Express.Multer.File[]> | undefined)?.file?.[0];
  if (!file) throw new ApiError(400, "No image file provided");

  const { alt, purpose } = uploadBodySchema.parse(req.body);
  const media = await uploadMediaAsset({
    buffer: file.buffer,
    alt,
    isPublic: purpose === "site",
    ...actorFrom(req)
  });
  sendSuccess(res, { media }, 201);
});

export const updateMediaHandler = asyncHandler(async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);
  const { alt } = updateBodySchema.parse(req.body);
  sendSuccess(res, { media: await updateMediaAlt(id, alt, req.authUser!.id) });
});

export const deleteMediaHandler = asyncHandler(async (req, res) => {
  await deleteMediaAsset(objectIdSchema.parse(req.params.id), req.authUser!.id);
  sendSuccess(res, { deleted: true });
});

function sendMedia(res: Response, next: NextFunction, media: ServableMedia, cacheControl: string) {
  res.setHeader("Content-Type", media.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // helmet defaults to same-origin; these are images the website (a different origin) embeds.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", cacheControl);

  if (media.kind === "file") {
    res.sendFile(media.path, (err) => {
      if (err && !res.headersSent) next(new ApiError(404, "Not found"));
    });
    return;
  }
  pipeline(media.stream, res, (err) => {
    if (err && !res.headersSent) next(err);
  });
}

export const getPublicMediaHandler = asyncHandler(async (req, res, next) => {
  const parsed = objectIdSchema.safeParse(req.params.id);
  const media = parsed.success ? await getServableMedia(parsed.data) : null;
  if (!media) throw new ApiError(404, "Not found");

  // Short-lived rather than immutable so a consent withdrawal cuts a photo off within minutes.
  sendMedia(res, next, media, "public, max-age=300");
});

/** Admin preview: serves private assets too (e.g. a story photo before it is published). */
export const getAdminMediaFileHandler = asyncHandler(async (req, res, next) => {
  const media = await getServableMedia(objectIdSchema.parse(req.params.id), true);
  if (!media) throw new ApiError(404, "Not found");
  sendMedia(res, next, media, "private, no-store");
});
