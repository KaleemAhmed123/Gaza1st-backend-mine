import fs from "fs";
import path from "path";
import { DocumentStatus, DocumentType, RoleCode } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { recordAuditLog } from "../../shared/audit";
import { ApiError } from "../../shared/http";
import {
  imageOnlyDocumentTypes,
  localPrivateBucket,
  mentorVisibleDocumentTypes,
  offerDocumentTypes,
  privateUploadRoot,
  profileDocumentTypes,
  regionalAdminVisibleProfileDocumentTypes,
  signatureMaxUploadSizeBytes
} from "./document.constants";
import { uploadToStorage, getSignedStorageUrl } from "../../shared/storage";


export async function saveDocument(input: {
  userId: string;
  studentUserId?: string;
  documentType: DocumentType;
  offerId?: string;
  file: Express.Multer.File;
}) {
  const targetStudentUserId = input.studentUserId ?? input.userId;
  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId: targetStudentUserId }
  });

  if (!studentProfile || studentProfile.deletedAt) {
    throw new ApiError(404, "Student profile not found");
  }

  // Enforce 1MB limit for signature documents
  if (imageOnlyDocumentTypes.has(input.documentType) && input.file.size > signatureMaxUploadSizeBytes) {
    throw new ApiError(400, "Signature image must be under 1MB");
  }

  if (profileDocumentTypes.has(input.documentType) && input.offerId) {
    throw new ApiError(400, "Profile documents cannot be attached to offers");
  }

  if (offerDocumentTypes.has(input.documentType) && !input.offerId) {
    throw new ApiError(400, "offerId is required for offer documents");
  }

  let offer: { id: string } | null = null;
  if (input.offerId) {
    offer = await prisma.offer.findFirst({
      where: {
        id: input.offerId,
        studentUserId: targetStudentUserId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!offer) {
      throw new ApiError(404, "Offer not found");
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.document.updateMany({
      where: {
        ownerUserId: targetStudentUserId,
        studentProfileId: studentProfile.id,
        offerId: offer?.id,
        documentType: input.documentType,
        status: DocumentStatus.active
      },
      data: {
        status: DocumentStatus.superseded
      }
    });

    // Upload to R2 (or fallback to local)
    const { key, bucket } = await uploadToStorage(
      input.file.buffer,
      input.file.originalname,
      input.file.mimetype,
      "documents"
    );

    const document = await tx.document.create({
      data: {
        ownerUserId: targetStudentUserId,
        studentProfileId: studentProfile.id,
        offerId: offer?.id,
        documentType: input.documentType,
        originalFilename: input.file.originalname,
        mimeType: input.file.mimetype,
        fileSizeBytes: input.file.size,
        storageBucket: bucket,
        storageKey: key,
        status: DocumentStatus.active,
        uploadedBy: input.userId,
        deletedAt: null
      }
    });

    if (input.documentType === DocumentType.consent_form) {
      await tx.studentProfile.update({
        where: { id: studentProfile.id },
        data: { consentSigned: true }
      });
    }

    return document;
  });
}

export async function getDownloadableDocument(input: {
  documentId: string;
  requesterUserId: string;
  ipAddress?: string;
  userAgent?: string;
  download?: boolean;
}) {
  const document = await prisma.document.findFirst({
    where: {
      id: input.documentId,
      status: DocumentStatus.active,
      deletedAt: null
    }
  });

  if (!document) {
    throw new ApiError(404, "Document not found");
  }

  let hasAccess = document.ownerUserId === input.requesterUserId;

  if (!hasAccess) {
    const user = await prisma.user.findFirst({
      where: {
        id: input.requesterUserId,
        deletedAt: null,
        accountStatus: "active"
      },
      include: { regionalAdminProfile: true }
    });

    if (user) {
      if (user.roles.includes(RoleCode.master_admin) || user.roles.includes(RoleCode.reviewer)) {
        hasAccess = true;
      } else if (
        user.roles.includes(RoleCode.regional_admin) &&
        user.regionalAdminProfile?.status === "active" &&
        !user.regionalAdminProfile.deletedAt
      ) {
        const regionId = user.regionalAdminProfile.regionId;
        if (document.offerId) {
          const offer = await prisma.offer.findFirst({
            where: { id: document.offerId, regionId, deletedAt: null }
          });
          if (offer) hasAccess = true;
        } else {
          // Regional admins cannot access passport or national_id documents
          if (regionalAdminVisibleProfileDocumentTypes.has(document.documentType)) {
            const hasOfferInRegion = await prisma.offer.findFirst({
              where: { studentUserId: document.ownerUserId, regionId, deletedAt: null }
            });
            if (hasOfferInRegion) {
              hasAccess = true;
            } else {
              const hasQueryInRegion = await prisma.query.findFirst({
                where: { studentUserId: document.ownerUserId, regionId, deletedAt: null }
              });
              if (hasQueryInRegion) hasAccess = true;
            }
          } else if (!profileDocumentTypes.has(document.documentType)) {
            // For non-profile documents not tied to an offer, check if student has any offer in this region
            const hasOfferInRegion = await prisma.offer.findFirst({
              where: { studentUserId: document.ownerUserId, regionId, deletedAt: null }
            });
            if (hasOfferInRegion) hasAccess = true;
          }
          // passport and national_id are in profileDocumentTypes but NOT in regionalAdminVisibleProfileDocumentTypes → access denied
        }
      } else if (user.roles.includes(RoleCode.mentor)) {
        // Mentors cannot access passport or national_id documents
        if (!mentorVisibleDocumentTypes.has(document.documentType)) {
          // Do not grant access — fall through to hasAccess = false
        } else if (document.offerId) {
          const offer = await prisma.offer.findFirst({
            where: { id: document.offerId, mentorId: input.requesterUserId, deletedAt: null }
          });
          if (offer) hasAccess = true;
        } else {
          const hasAssignedOffer = await prisma.offer.findFirst({
            where: { studentUserId: document.ownerUserId, mentorId: input.requesterUserId, deletedAt: null }
          });
          if (hasAssignedOffer) hasAccess = true;
        }
      }
    }
  }

  if (!hasAccess) {
    throw new ApiError(403, "You do not have permission to access this document");
  }

  if (document.storageBucket === "local_private") {
    // Legacy local files handling
    const absolutePath = path.resolve(process.cwd(), document.storageKey);
    const expectedRoot = path.resolve(process.cwd(), privateUploadRoot);
    if (!absolutePath.startsWith(expectedRoot)) {
      throw new ApiError(400, "Invalid storage key");
    }
    if (!fs.existsSync(absolutePath)) {
      throw new ApiError(404, "Document file not found");
    }
  }

  const signedUrl = await getSignedStorageUrl(
    document.storageKey,
    document.storageBucket,
    3600,
    input.download ? document.originalFilename : undefined
  );

  await recordAuditLog({
    actorUserId: input.requesterUserId,
    action: "document_downloaded",
    entityType: "document",
    entityId: document.id,
    metadata: {
      ownerUserId: document.ownerUserId,
      documentType: document.documentType,
      offerId: document.offerId,
      studentProfileId: document.studentProfileId
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return {
    document,
    absolutePath: document.storageBucket === "local_private" ? path.join(process.cwd(), document.storageKey) : undefined,
    url: signedUrl
  };
}

export async function deleteDocument(documentId: string, requestingUserId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, status: DocumentStatus.active, deletedAt: null }
  });

  if (!document) {
    throw new ApiError(404, "Document not found");
  }

  let hasPermission = document.ownerUserId === requestingUserId;
  if (!hasPermission) {
    const requester = await prisma.user.findFirst({
      where: { id: requestingUserId, deletedAt: null, accountStatus: "active" },
      include: { regionalAdminProfile: true }
    });
    if (requester?.roles.includes(RoleCode.master_admin)) {
      hasPermission = true;
    } else if (requester?.roles.includes(RoleCode.reviewer) && !offerDocumentTypes.has(document.documentType)) {
      hasPermission = true;
    } else if (
      requester?.roles.includes(RoleCode.regional_admin) &&
      requester.regionalAdminProfile?.status === "active" &&
      !requester.regionalAdminProfile.deletedAt
    ) {
      const regionId = requester.regionalAdminProfile.regionId;
      if (document.offerId) {
        const offer = await prisma.offer.findFirst({
          where: { id: document.offerId, regionId, deletedAt: null }
        });
        if (offer) hasPermission = true;
      } else {
        const hasOfferInRegion = await prisma.offer.findFirst({
          where: { studentUserId: document.ownerUserId, regionId, deletedAt: null }
        });
        if (hasOfferInRegion) hasPermission = true;
      }
    }
  }

  if (!hasPermission) {
    throw new ApiError(403, "You do not have permission to delete this document");
  }

  return prisma.document.update({
    where: { id: documentId },
    data: { status: DocumentStatus.superseded, deletedAt: new Date() }
  });
}
