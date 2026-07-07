import path from "path";
import { asyncHandler, ApiError, sendSuccess } from "../../shared/http";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAdminAnnouncement,
  getPublishedAnnouncement,
  listAdminAnnouncements,
  listPublishedAnnouncements,
  updateAnnouncement,
  setAnnouncementGuide,
  removeAnnouncementGuide,
  getAnnouncementGuideForDownload
} from "./announcement.service";
import {
  createAnnouncementSchema,
  listAdminAnnouncementsQuerySchema,
  listAnnouncementsQuerySchema,
  updateAnnouncementSchema
} from "./announcement.validation";

export const listPublishedAnnouncementsHandler = asyncHandler(async (req, res) => {
  const query = listAnnouncementsQuerySchema.parse(req.query);
  const announcements = await listPublishedAnnouncements(query, req.authUser!);
  sendSuccess(res, { announcements });
});

export const getPublishedAnnouncementHandler = asyncHandler(async (req, res) => {
  const announcement = await getPublishedAnnouncement(req.params.id, req.authUser!);
  sendSuccess(res, { announcement });
});

export const listAdminAnnouncementsHandler = asyncHandler(async (req, res) => {
  const query = listAdminAnnouncementsQuerySchema.parse(req.query);
  const announcements = await listAdminAnnouncements(query, req.authUser!);
  sendSuccess(res, { announcements });
});

export const getAdminAnnouncementHandler = asyncHandler(async (req, res) => {
  const announcement = await getAdminAnnouncement(req.params.id, req.authUser!);
  sendSuccess(res, { announcement });
});

export const createAnnouncementHandler = asyncHandler(async (req, res) => {
  const input = createAnnouncementSchema.parse(req.body);
  const announcement = await createAnnouncement({
    user: req.authUser!,
    data: input,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { announcement }, 201);
});

export const updateAnnouncementHandler = asyncHandler(async (req, res) => {
  const input = updateAnnouncementSchema.parse(req.body);
  const announcement = await updateAnnouncement({
    user: req.authUser!,
    announcementId: req.params.id,
    data: input,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { announcement });
});

export const deleteAnnouncementHandler = asyncHandler(async (req, res) => {
  const announcement = await deleteAnnouncement({
    user: req.authUser!,
    announcementId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { announcement });
});

export const uploadAnnouncementGuideHandler = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "No file uploaded");
  }
  const announcement = await setAnnouncementGuide({
    user: req.authUser!,
    announcementId: req.params.id,
    file: req.file
  });
  sendSuccess(res, { announcement });
});

export const removeAnnouncementGuideHandler = asyncHandler(async (req, res) => {
  const announcement = await removeAnnouncementGuide({
    user: req.authUser!,
    announcementId: req.params.id
  });
  sendSuccess(res, { announcement });
});

export const downloadAnnouncementGuideHandler = asyncHandler(async (req, res) => {
  const guide = await getAnnouncementGuideForDownload(req.params.id, req.authUser!);
  if (guide.isLocal) {
    res.download(path.join(process.cwd(), guide.key), guide.fileName);
    return;
  }
  res.redirect(guide.url);
});
