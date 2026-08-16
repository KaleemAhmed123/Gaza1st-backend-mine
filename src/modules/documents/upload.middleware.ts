import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import path from "path";
import multer from "multer";
import { ApiError } from "../../shared/http";
import {
  allowedFileExtensions,
  allowedMimeTypes,
  imageOnlyDocumentTypes,
  imageOnlyMimeTypes,
  legalDocumentMaxUploadSizeBytes,
  maxUploadSizeBytes,
  privateUploadRoot,
  signatureMaxUploadSizeBytes
} from "./document.constants";
import { DocumentType } from "@prisma/client";

const uploadDirectory = path.join(process.cwd(), privateUploadRoot);
mkdirSync(uploadDirectory, { recursive: true });

export const uploadSingleDocument = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadSizeBytes
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const docType = req.body?.documentType as DocumentType | undefined;
    const isImageOnly = docType && imageOnlyDocumentTypes.has(docType);

    if (isImageOnly) {
      // Signature uploads: images only
      if (!imageOnlyMimeTypes.has(file.mimetype) || ![".jpg", ".jpeg", ".png"].includes(extension)) {
        callback(new ApiError(400, "Signature uploads must be JPG or PNG images only"));
        return;
      }
      // 1MB limit will be enforced in service layer after upload
    } else {
      if (!allowedMimeTypes.has(file.mimetype) || !allowedFileExtensions.has(extension)) {
        callback(new ApiError(400, "Only PDF, JPG, JPEG, and PNG files are allowed"));
        return;
      }
    }

    callback(null, true);
  }
}).single("file");

// Community Guidelines / Data Privacy Policy uploads — its own multer instance so the
// 10MB cap here can never bleed into (or be confused with) the 5MB student-document limit
// enforced by uploadSingleDocument above.
export const uploadSingleLegalDocument = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: legalDocumentMaxUploadSizeBytes
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedMimeTypes.has(file.mimetype) || !allowedFileExtensions.has(extension)) {
      callback(new ApiError(400, "Only PDF, JPG, JPEG, and PNG files are allowed"));
      return;
    }
    callback(null, true);
  }
}).single("file");

