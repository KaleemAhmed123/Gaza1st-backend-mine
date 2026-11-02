import { asyncHandler, sendSuccess } from "../../shared/http";
import { getAboutPreview, getAdminAbout, getPublicAbout, publishAbout, saveAboutDraft } from "./about.service";
import { actorFrom } from "./request-actor";

export const getPublicAboutHandler = asyncHandler(async (_req, res) => {
  const page = await getPublicAbout();
  res.setHeader("Cache-Control", "public, max-age=60");
  sendSuccess(res, { page });
});

export const getAdminAboutHandler = asyncHandler(async (_req, res) => {
  sendSuccess(res, await getAdminAbout());
});

export const saveAboutDraftHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, await saveAboutDraft(req.body, actorFrom(req)));
});

export const publishAboutHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, await publishAbout(actorFrom(req)));
});

export const getAboutPreviewHandler = asyncHandler(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  sendSuccess(res, await getAboutPreview());
});
