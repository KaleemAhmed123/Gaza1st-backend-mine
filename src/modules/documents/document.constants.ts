import { DocumentType } from "@prisma/client";

// Explicitly typed DocumentType[] (not a narrowed `as const` literal) — community_guidelines
// and data_privacy_policy exist on the enum but are deliberately excluded here; they go
// through the separate legal-document upload path in this file, never the general one.
export const allowedDocumentTypes: DocumentType[] = [
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
];

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

// Legal documents (Community Guidelines, Data Privacy Policy) — app-level, not tied to a
// student. Own upload size limit so it never shares (and can never accidentally loosen)
// the 5MB cap on student profile documents above.
export const legalDocumentMaxUploadSizeBytes = 10 * 1024 * 1024; // 10MB

export const legalDocumentKeyMap: Record<string, DocumentType> = {
  community_guidelines: DocumentType.community_guidelines,
  data_privacy: DocumentType.data_privacy_policy
};

export const legalDocumentTypes = new Set<DocumentType>(Object.values(legalDocumentKeyMap));

