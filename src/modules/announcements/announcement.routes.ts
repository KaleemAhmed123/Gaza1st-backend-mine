import { RoleCode } from "@prisma/client";
import { Router } from "express";
import { requireAnyActiveDbRole, requireAuth } from "../../middleware/auth.middleware";
import { uploadSingleDocument } from "../documents/upload.middleware";
import {
  createAnnouncementHandler,
  deleteAnnouncementHandler,
  getAdminAnnouncementHandler,
  getPublishedAnnouncementHandler,
  listAdminAnnouncementsHandler,
  listPublishedAnnouncementsHandler,
  updateAnnouncementHandler,
  uploadAnnouncementGuideHandler,
  removeAnnouncementGuideHandler,
  downloadAnnouncementGuideHandler
} from "./announcement.controller";

export const announcementRouter = Router();
export const adminAnnouncementRouter = Router();

announcementRouter.use(requireAuth);
announcementRouter.get("/", listPublishedAnnouncementsHandler);
announcementRouter.get("/:id/guide", downloadAnnouncementGuideHandler);
announcementRouter.get("/:id", getPublishedAnnouncementHandler);

adminAnnouncementRouter.use(requireAuth, requireAnyActiveDbRole([RoleCode.master_admin, RoleCode.regional_admin]));
adminAnnouncementRouter.get("/", listAdminAnnouncementsHandler);
adminAnnouncementRouter.post("/", createAnnouncementHandler);
adminAnnouncementRouter.get("/:id", getAdminAnnouncementHandler);
adminAnnouncementRouter.patch("/:id", updateAnnouncementHandler);
adminAnnouncementRouter.post("/:id/guide", uploadSingleDocument, uploadAnnouncementGuideHandler);
adminAnnouncementRouter.delete("/:id/guide", removeAnnouncementGuideHandler);
adminAnnouncementRouter.delete("/:id", deleteAnnouncementHandler);
