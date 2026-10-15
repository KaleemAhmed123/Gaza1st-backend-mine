import { RoleCode } from "@prisma/client";
import { Router } from "express";
import { requireRole, requireAuth } from "../../middleware/auth.middleware";
import { requireModuleEnabled } from "../../middleware/module-access.middleware";
import { uploadSingleDocument } from "../documents/upload.middleware";
import {
  createAnnouncementHandler,
  deleteAnnouncementHandler,
  getAdminAnnouncementHandler,
  getPublishedAnnouncementHandler,
  listAdminAnnouncementsHandler,
  listPublishedAnnouncementsHandler,
  listPublicAnnouncementsHandler,
  getPublicAnnouncementHandler,
  downloadPublicAnnouncementGuideHandler,
  updateAnnouncementHandler,
  uploadAnnouncementGuideHandler,
  removeAnnouncementGuideHandler,
  downloadAnnouncementGuideHandler
} from "./announcement.controller";

export const announcementRouter = Router();
export const adminAnnouncementRouter = Router();

// Public endpoints (no authentication required)
announcementRouter.get("/public", listPublicAnnouncementsHandler);
announcementRouter.get("/public/:id/guide", downloadPublicAnnouncementGuideHandler);
announcementRouter.get("/public/:id", getPublicAnnouncementHandler);

// Internal published endpoints (authentication required)
announcementRouter.use(requireAuth, requireModuleEnabled("announcements"));
announcementRouter.get("/", listPublishedAnnouncementsHandler);
announcementRouter.get("/:id/guide", downloadAnnouncementGuideHandler);
announcementRouter.get("/:id", getPublishedAnnouncementHandler);

adminAnnouncementRouter.use(requireAuth, requireModuleEnabled("announcements"), requireRole([RoleCode.master_admin, RoleCode.regional_admin]));
adminAnnouncementRouter.get("/", listAdminAnnouncementsHandler);
adminAnnouncementRouter.post("/", createAnnouncementHandler);
adminAnnouncementRouter.get("/:id", getAdminAnnouncementHandler);
adminAnnouncementRouter.patch("/:id", updateAnnouncementHandler);
adminAnnouncementRouter.post("/:id/guide", uploadSingleDocument, uploadAnnouncementGuideHandler);
adminAnnouncementRouter.delete("/:id/guide", removeAnnouncementGuideHandler);
adminAnnouncementRouter.delete("/:id", deleteAnnouncementHandler);
