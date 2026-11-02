import { RoleCode } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { uploadRateLimiter } from "../../middleware/rate-limit.middleware";
import {
  getAboutPreviewHandler,
  getAdminAboutHandler,
  getPublicAboutHandler,
  publishAboutHandler,
  saveAboutDraftHandler
} from "./about.controller";
import {
  createImpactHandler,
  deleteImpactHandler,
  listAdminImpactHandler,
  listPublicImpactHandler,
  reorderImpactHandler,
  updateImpactHandler
} from "./impact.controller";
import {
  deleteMediaHandler,
  getAdminMediaFileHandler,
  getPublicMediaHandler,
  updateMediaHandler,
  uploadMediaHandler
} from "./media.controller";
import { MAX_IMAGE_BYTES } from "./media.service";
import {
  createStoryHandler,
  deleteStoryHandler,
  getAdminStoryHandler,
  getPublicStoryHandler,
  listAdminStoriesHandler,
  listPublicStoriesHandler,
  publishStoryHandler,
  setStoryConsentHandler,
  unpublishStoryHandler,
  updateStoryHandler
} from "./stories.controller";

// The real type check is by magic bytes in the service; this only bounds size and field count.
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 }
}).fields([{ name: "file", maxCount: 1 }]);

/** Mounted at /api/public. No authentication. */
export const publicSiteRouter = Router();
publicSiteRouter.get("/about", getPublicAboutHandler);
publicSiteRouter.get("/impact", listPublicImpactHandler);
publicSiteRouter.get("/stories", listPublicStoriesHandler);
publicSiteRouter.get("/stories/:id", getPublicStoryHandler);
publicSiteRouter.get("/media/:id", getPublicMediaHandler);

/** Mounted at /api/admin/site. master_admin only. */
export const adminSiteRouter = Router();
adminSiteRouter.use(requireAuth, requireRole([RoleCode.master_admin]));

adminSiteRouter.post("/media", uploadRateLimiter, uploadImage, uploadMediaHandler);
adminSiteRouter.get("/media/:id/file", getAdminMediaFileHandler);
adminSiteRouter.patch("/media/:id", updateMediaHandler);
adminSiteRouter.delete("/media/:id", deleteMediaHandler);

adminSiteRouter.get("/impact", listAdminImpactHandler);
adminSiteRouter.post("/impact", createImpactHandler);
adminSiteRouter.put("/impact/order", reorderImpactHandler);
adminSiteRouter.patch("/impact/:id", updateImpactHandler);
adminSiteRouter.delete("/impact/:id", deleteImpactHandler);

adminSiteRouter.get("/about", getAdminAboutHandler);
adminSiteRouter.put("/about/draft", saveAboutDraftHandler);
adminSiteRouter.get("/about/preview", getAboutPreviewHandler);
adminSiteRouter.post("/about/publish", publishAboutHandler);

adminSiteRouter.get("/stories", listAdminStoriesHandler);
adminSiteRouter.post("/stories", createStoryHandler);
adminSiteRouter.get("/stories/:id", getAdminStoryHandler);
adminSiteRouter.patch("/stories/:id", updateStoryHandler);
adminSiteRouter.put("/stories/:id/consent", setStoryConsentHandler);
adminSiteRouter.post("/stories/:id/publish", publishStoryHandler);
adminSiteRouter.post("/stories/:id/unpublish", unpublishStoryHandler);
adminSiteRouter.delete("/stories/:id", deleteStoryHandler);
