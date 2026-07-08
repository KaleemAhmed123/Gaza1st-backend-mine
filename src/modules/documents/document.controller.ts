import fs from "fs/promises";
import { asyncHandler, sendSuccess } from "../../shared/http";
import { uploadDocumentSchema } from "./document.validation";
import { RoleCode } from "@prisma/client";
import { getDownloadableDocument, saveDocument, deleteDocument } from "./document.service";
import { verifyCsvDocToken } from "./csv-doc-token";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../shared/http";
import { getSignedStorageUrl, getObjectStreamFromStorage } from "../../shared/storage";
import { pipeline } from "stream";

import { offerDocumentTypes } from "./document.constants";

export const uploadDocumentHandler = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: { message: "File is required" } });
    return;
  }

  try {
    const input = uploadDocumentSchema.parse(req.body);

    let targetStudentUserId = req.authUser!.id;
    if (input.studentUserId && input.studentUserId !== req.authUser!.id) {
      const isAuthorized = req.authUser!.roles.includes(RoleCode.master_admin) ||
        (req.authUser!.roles.includes(RoleCode.reviewer) && !offerDocumentTypes.has(input.documentType)) ||
        req.authUser!.roles.includes(RoleCode.regional_admin);
      if (!isAuthorized) {
        throw new ApiError(403, "You do not have permission to upload documents on behalf of this student");
      }
      targetStudentUserId = input.studentUserId;
    }

    const document = await saveDocument({
      userId: req.authUser!.id,
      studentUserId: targetStudentUserId,
      documentType: input.documentType,
      offerId: input.offerId,
      file: req.file
    });

    sendSuccess(
      res,
      {
        document: {
          id: document.id,
          documentType: document.documentType,
          originalFilename: document.originalFilename,
          mimeType: document.mimeType,
          fileSizeBytes: document.fileSizeBytes,
          createdAt: document.createdAt
        }
      },
      201
    );
  } catch (error) {
    throw error;
  }
});

export const downloadDocumentHandler = asyncHandler(async (req, res, next) => {
  const { document, absolutePath } = await getDownloadableDocument({
    documentId: req.params.id,
    requesterUserId: req.authUser!.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    download: true
  });

  if (document.storageBucket !== "local_private") {
    const s3Stream = await getObjectStreamFromStorage(document.storageKey, document.storageBucket);
    if (s3Stream) {
      res.setHeader("Content-Type", document.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(document.originalFilename)}"`
      );
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      pipeline(s3Stream, res, (err) => {
        if (err) {
          console.error("Pipeline download error:", err);
          if (!res.headersSent) {
            next(err);
          }
        }
      });
      return;
    }
  }

  res.download(absolutePath!, document.originalFilename);
});

export const previewDocumentHandler = asyncHandler(async (req, res, next) => {
  const { document, absolutePath } = await getDownloadableDocument({
    documentId: req.params.id,
    requesterUserId: req.authUser!.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });

  if (document.storageBucket !== "local_private") {
    const s3Stream = await getObjectStreamFromStorage(document.storageKey, document.storageBucket);
    if (s3Stream) {
      res.setHeader("Content-Type", document.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(document.originalFilename)}"`
      );
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      pipeline(s3Stream, res, (err) => {
        if (err) {
          console.error("Pipeline preview error:", err);
          if (!res.headersSent) {
            next(err);
          }
        }
      });
      return;
    }
  }

  // Set headers for inline browser rendering
  res.setHeader("Content-Type", document.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(document.originalFilename)}"`
  );
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

  const stream = await fs.readFile(absolutePath!);
  res.end(stream);
});

/**
 * GET /api/documents/:id/signed-download?token=<jwt>
 *
 * No platform login required. Validates a CSV doc JWT, then 302-redirects
 * to a fresh 1-hour R2 presigned URL so the browser downloads the file directly.
 * Used for offer letter URLs embedded inside generated CSVs.
 */
export const csvSignedDownloadHandler = asyncHandler(async (req, res) => {
  const docId = req.params.id;
  const token = typeof req.query.token === "string" ? req.query.token : "";

  if (!token) {
    throw new ApiError(400, "Missing download token");
  }

  try {
    verifyCsvDocToken(token, docId);
  } catch {
    throw new ApiError(403, "Invalid or expired download token");
  }

  const doc = await prisma.document.findFirst({
    where: { id: docId, status: "active", deletedAt: null },
    select: { storageKey: true, storageBucket: true, originalFilename: true }
  });

  if (!doc) {
    throw new ApiError(404, "Document not found");
  }

  // Generate a fresh 1-hour R2 presigned URL — browser follows and downloads directly
  const presignedUrl = await getSignedStorageUrl(
    doc.storageKey,
    doc.storageBucket,
    3600,
    doc.originalFilename
  );

  if (!presignedUrl) {
    throw new ApiError(500, "Could not generate download URL");
  }

  res.redirect(302, presignedUrl);
});

/**
 * GET /api/documents/short/:code
 *
 * No platform login required. Resolves a unique 6-character short link,
 * fetches a fresh 1-hour R2 presigned URL, and redirects (302) to download.
 */
export const shortLinkDownloadHandler = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const shortLink = await prisma.shortLink.findUnique({
    where: { code },
  });

  if (!shortLink) {
    throw new ApiError(404, "Short link not found");
  }

  if (shortLink.expiresAt < new Date()) {
    // Clean up expired short links
    await prisma.shortLink.delete({ where: { id: shortLink.id } }).catch(() => { });
    throw new ApiError(410, "Short link has expired");
  }

  const doc = await prisma.document.findFirst({
    where: { id: shortLink.docId, status: "active", deletedAt: null },
    select: { storageKey: true, storageBucket: true, originalFilename: true }
  });

  if (!doc) {
    throw new ApiError(404, "Document not found");
  }

  const presignedUrl = await getSignedStorageUrl(
    doc.storageKey,
    doc.storageBucket,
    3600,
    doc.originalFilename
  );

  if (!presignedUrl) {
    throw new ApiError(500, "Could not generate download URL");
  }

  res.redirect(302, presignedUrl);
});

export const deleteDocumentHandler = asyncHandler(async (req, res) => {
  await deleteDocument(req.params.id, req.authUser!.id);
  sendSuccess(res, { message: "Document removed" });
});
