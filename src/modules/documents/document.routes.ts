import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { csvSignedDownloadHandler, deleteDocumentHandler, downloadDocumentHandler, previewDocumentHandler, uploadDocumentHandler, shortLinkDownloadHandler } from "./document.controller";
import { uploadSingleDocument } from "./upload.middleware";

export const documentRouter = Router();

documentRouter.post("/", requireAuth, uploadSingleDocument, uploadDocumentHandler);
documentRouter.get("/:id/download", requireAuth, downloadDocumentHandler);
documentRouter.get("/:id/preview", requireAuth, previewDocumentHandler);
// No auth required — token in query param validates access (used in CSV offer letter links)
documentRouter.get("/:id/signed-download", csvSignedDownloadHandler);
documentRouter.get("/short/:code", shortLinkDownloadHandler);
documentRouter.delete("/:id", requireAuth, deleteDocumentHandler);
