import { asyncHandler, sendSuccess } from "../../shared/http";
import { objectIdSchema } from "../../shared/validation";
import { actorFrom } from "./request-actor";
import {
  createStory,
  deleteStory,
  getAdminStory,
  getPublicStory,
  listAdminStories,
  listPublicStories,
  publishStory,
  setStoryConsent,
  unpublishStory,
  updateStory
} from "./stories.service";
import {
  createStorySchema,
  listPublicStoriesQuerySchema,
  setConsentSchema,
  updateStorySchema
} from "./stories.validation";

const idParam = (req: { params: Record<string, string> }) => objectIdSchema.parse(req.params.id);

export const listPublicStoriesHandler = asyncHandler(async (req, res) => {
  const result = await listPublicStories(listPublicStoriesQuerySchema.parse(req.query));
  res.setHeader("Cache-Control", "public, max-age=60");
  sendSuccess(res, result);
});

export const getPublicStoryHandler = asyncHandler(async (req, res) => {
  const story = await getPublicStory(idParam(req));
  res.setHeader("Cache-Control", "public, max-age=60");
  sendSuccess(res, { story });
});

export const listAdminStoriesHandler = asyncHandler(async (_req, res) => {
  sendSuccess(res, { stories: await listAdminStories() });
});

export const getAdminStoryHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, { story: await getAdminStory(idParam(req)) });
});

export const createStoryHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, { story: await createStory(createStorySchema.parse(req.body), actorFrom(req)) }, 201);
});

export const updateStoryHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, { story: await updateStory(idParam(req), updateStorySchema.parse(req.body), actorFrom(req)) });
});

export const setStoryConsentHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, { story: await setStoryConsent(idParam(req), setConsentSchema.parse(req.body), actorFrom(req)) });
});

export const publishStoryHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, { story: await publishStory(idParam(req), actorFrom(req)) });
});

export const unpublishStoryHandler = asyncHandler(async (req, res) => {
  sendSuccess(res, { story: await unpublishStory(idParam(req), actorFrom(req)) });
});

export const deleteStoryHandler = asyncHandler(async (req, res) => {
  await deleteStory(idParam(req), actorFrom(req));
  sendSuccess(res, { deleted: true });
});
