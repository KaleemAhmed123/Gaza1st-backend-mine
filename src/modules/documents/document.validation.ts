import { DocumentType } from "@prisma/client";
import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";
import { allowedDocumentTypes } from "./document.constants";

export const uploadDocumentSchema = z.object({
  documentType: z.nativeEnum(DocumentType).refine(
    (documentType) => allowedDocumentTypes.includes(documentType),
    "Unsupported document type"
  ),
  offerId: objectIdSchema.optional(),
  studentUserId: objectIdSchema.optional()
});

// Public-facing key used in legal-document routes — never trust ":key" from a URL as a
// DocumentType directly, always resolve it through this schema + legalDocumentKeyMap first.
export const legalDocumentKeySchema = z.enum(["community_guidelines", "data_privacy"]);
