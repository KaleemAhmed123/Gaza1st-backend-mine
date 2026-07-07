import { DocumentType } from "@prisma/client";

export const allowedDocumentTypes = [
  DocumentType.national_id,
  DocumentType.passport,
  DocumentType.moi_letter,
  DocumentType.consent_form,
  DocumentType.offer_letter,
  DocumentType.scholarship_letter,
  DocumentType.signature,
  DocumentType.english_proficiency,
  DocumentType.tawjihi,
  DocumentType.cv
] as const;

export const profileDocumentTypes = new Set<DocumentType>([
  DocumentType.national_id,
  DocumentType.passport,
  DocumentType.moi_letter,
  DocumentType.consent_form,
  DocumentType.signature,
  DocumentType.english_proficiency,
  DocumentType.tawjihi,
  DocumentType.cv
]);

export const offerDocumentTypes = new Set<DocumentType>([
  DocumentType.offer_letter,
  DocumentType.scholarship_letter
]);

// Document types visible to mentors (exclude identity documents)
export const mentorVisibleDocumentTypes = new Set<DocumentType>([
  DocumentType.moi_letter,
  DocumentType.consent_form,
  DocumentType.offer_letter,
  DocumentType.scholarship_letter,
  DocumentType.english_proficiency,
  DocumentType.tawjihi,
  DocumentType.cv
]);

// Document types that regional admins can access
export const regionalAdminVisibleProfileDocumentTypes = new Set<DocumentType>([
  DocumentType.moi_letter,
  DocumentType.consent_form,
  DocumentType.signature,
  DocumentType.english_proficiency,
  DocumentType.tawjihi,
  DocumentType.cv
]);

// Document types restricted to image uploads only
export const imageOnlyDocumentTypes = new Set<DocumentType>([
  DocumentType.signature
]);

export const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png"
]);

export const imageOnlyMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png"
]);

export const allowedFileExtensions = new Set([".pdf", ".jpeg", ".jpg", ".png"]);

export const maxUploadSizeBytes = 5 * 1024 * 1024;
export const signatureMaxUploadSizeBytes = 1 * 1024 * 1024; // 1MB for signatures
export const localPrivateBucket = "local_private";
export const privateUploadRoot = "uploads/private";

