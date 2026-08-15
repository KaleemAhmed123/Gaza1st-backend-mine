import { Router } from "express";
import { RoleCode } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import {
  csvSignedDownloadHandler,
  deleteDocumentHandler,
  deleteLegalDocumentHandler,
  downloadDocumentHandler,
  getLegalDocumentMetadataHandler,
  previewDocumentHandler,
  previewLegalDocumentHandler,
  shortLinkDownloadHandler,
  uploadDocumentHandler,
  uploadLegalDocumentHandler
} from "./document.controller";
import { uploadSingleDocument, uploadSingleLegalDocument } from "./upload.middleware";

export const documentRouter = Router();

// Legal documents (Community Guidelines, Data Privacy Policy) — admin management + fully
// public preview. Mounted ahead of the generic "/:id/..." routes below for clarity, though
// segment counts don't actually collide.
documentRouter.post(
  "/admin/legal/:key",
  requireAuth,
  requireRole([RoleCode.master_admin]),
  uploadSingleLegalDocument,
  uploadLegalDocumentHandler
);
documentRouter.delete("/admin/legal/:key", requireAuth, requireRole([RoleCode.master_admin]), deleteLegalDocumentHandler);
documentRouter.get("/admin/legal/:key", requireAuth, requireRole([RoleCode.master_admin]), getLegalDocumentMetadataHandler);
// No auth — must be readable by anonymous visitors (login/signup footer links) and by
// students mid-onboarding before they've approved anything else.
documentRouter.get("/legal/:key/preview", previewLegalDocumentHandler);

documentRouter.post("/", requireAuth, uploadSingleDocument, uploadDocumentHandler);
documentRouter.get("/:id/download", requireAuth, downloadDocumentHandler);
documentRouter.get("/:id/preview", requireAuth, previewDocumentHandler);
// No auth required — token in query param validates access (used in CSV offer letter links)
documentRouter.get("/:id/signed-download", csvSignedDownloadHandler);
documentRouter.get("/short/:code", shortLinkDownloadHandler);
documentRouter.delete("/:id", requireAuth, deleteDocumentHandler);
