import { RoleCode } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { recordAuditLog } from "../../../shared/audit";
import { toCsv } from "../../../shared/csv";
import { ApiError } from "../../../shared/http";
import { getAdminScope, type AdminScope } from "../../../shared/auth-scope";
import type { ListAdminStudentsQuery } from "./admin-student-grid.validation";

function addCount(summary: Record<string, number>, key?: string | null) {
  if (!key) {
    return;
  }

  summary[key] = (summary[key] ?? 0) + 1;
}

function buildSearchWhere(search?: string): Prisma.UserWhereInput {
  if (!search) {
    return {};
  }

  return {
    OR: [
      { fullName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      {
        studentProfile: {
          is: {
            fullNameEnglish: { contains: search, mode: "insensitive" }
          }
        }
      }
    ]
  };
}

function buildMasterWhere(query: ListAdminStudentsQuery): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    roles: { has: RoleCode.student },
    ...buildSearchWhere(query.search),
    studentProfile: {
      is: {
        deletedAt: null,
        ...(query.profileStatus ? { profileStatus: query.profileStatus } : {}),
        ...(query.passportStatus ? { passportStatus: query.passportStatus } : {}),
        ...(query.locationInGaza ? { locationInGaza: query.locationInGaza } : {}),
        ...(query.hasVerifiedOffer === undefined ? {} : { hasVerifiedOffer: query.hasVerifiedOffer }),
        ...(query.consentSigned === undefined ? {} : { consentSigned: query.consentSigned })
      }
    }
  };
}

function buildRegionalWhere(query: ListAdminStudentsQuery, regionId: string): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    roles: { has: RoleCode.student },
    ...buildSearchWhere(query.search),
    studentOffers: {
      some: {
        regionId,
        deletedAt: null
      }
    }
  };
}

export async function listAdminStudents(userId: string, query: ListAdminStudentsQuery) {
  const scope = await getAdminScope(userId);
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;

  if (scope.role === "regional_admin") {
    const where = buildRegionalWhere(query, scope.regionId);
    const [students, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          dateOfBirth: true,
          studentProfile: {
            select: {
              dateOfBirth: true,
              locationInGaza: true,
              passportStatus: true,
              passportExpiry: true,
              consentSigned: true,
              profileStatus: true,
              hasVerifiedOffer: true
            }
          },
          studentOffers: {
            where: { regionId: scope.regionId, deletedAt: null },
            select: {
              id: true,
              regionId: true,
              universityName: true,
              courseName: true,
              courseField: true,
              courseLevel: true,
              reviewStatus: true,
              region: {
                select: {
                  id: true,
                  code: true,
                  name: true
                }
              }
            },
            orderBy: { updatedAt: "desc" }
          }
        },
        orderBy: { createdAt: "desc" },
        skip,
        take
      }),
      prisma.user.count({ where })
    ]);

    return {
      scope,
      students: students.map((student) => {
        const profile = student.studentProfile ? { ...student.studentProfile } : null;
        if (profile) {
          const isExpired = profile.passportExpiry && new Date(profile.passportExpiry) < new Date();
          if (isExpired) {
            profile.passportStatus = "expired" as any;
          }
          profile.passportExpiry = null;
        }
        return {
          id: student.id,
          fullName: student.fullName,
          email: student.email,
          phone: student.phone,
          dateOfBirth: student.studentProfile?.dateOfBirth ?? student.dateOfBirth,
          profile,
          offerCountInRegion: student.studentOffers.length,
          offers: student.studentOffers
        };
      }),
      summary: {
        total
      },
      pagination: { page: query.page, pageSize: query.pageSize, total }
    };
  }

  const where = buildMasterWhere(query);
  const profileWhere: Prisma.StudentProfileWhereInput = {
    deletedAt: null,
    ...(query.profileStatus ? { profileStatus: query.profileStatus } : {}),
    ...(query.passportStatus ? { passportStatus: query.passportStatus } : {}),
    ...(query.locationInGaza ? { locationInGaza: query.locationInGaza } : {}),
    ...(query.hasVerifiedOffer === undefined ? {} : { hasVerifiedOffer: query.hasVerifiedOffer }),
    ...(query.consentSigned === undefined ? {} : { consentSigned: query.consentSigned }),
    user: {
      deletedAt: null,
      roles: { has: RoleCode.student },
      ...buildSearchWhere(query.search)
    }
  };

  const [
    students,
    total,
    byProfileStatus,
    byPassportStatus,
    byLocationInGaza,
    consentCounts,
    verifiedCounts
  ] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        createdAt: true,
        accountStatus: true,
        studentProfile: {
          select: {
            id: true,
            fullNameEnglish: true,
            sex: true,
            dateOfBirth: true,
            locationInGaza: true,
            passportStatus: true,
            passportLocation: true,
            passportExpiry: true,
            consentSigned: true,
            profileStatus: true,
            hasOfferSelfReported: true,
            hasVerifiedOffer: true,
            emergencyContactFirstName: true,
            emergencyContactRelation: true,
            emergencyContactPhone: true
          }
        },
        studentOffers: {
          where: { deletedAt: null },
          select: {
            id: true,
            regionId: true,
            universityName: true,
            reviewStatus: true,
            region: {
              select: {
                id: true,
                code: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take
    }),
    prisma.user.count({ where }),
    prisma.studentProfile.groupBy({
      by: ["profileStatus"],
      where: profileWhere,
      _count: true
    }),
    prisma.studentProfile.groupBy({
      by: ["passportStatus"],
      where: profileWhere,
      _count: true
    }),
    prisma.studentProfile.groupBy({
      by: ["locationInGaza"],
      where: profileWhere,
      _count: true
    }),
    prisma.studentProfile.groupBy({
      by: ["consentSigned"],
      where: profileWhere,
      _count: true
    }),
    prisma.studentProfile.groupBy({
      by: ["hasVerifiedOffer"],
      where: profileWhere,
      _count: true
    })
  ]);

  const summary = {
    total,
    byProfileStatus: {} as Record<string, number>,
    byPassportStatus: {} as Record<string, number>,
    byLocationInGaza: {} as Record<string, number>,
    consentSigned: { true: 0, false: 0 },
    hasVerifiedOffer: { true: 0, false: 0 }
  };

  for (const item of byProfileStatus) {
    if (item.profileStatus) summary.byProfileStatus[item.profileStatus] = item._count;
  }
  for (const item of byPassportStatus) {
    if (item.passportStatus) summary.byPassportStatus[item.passportStatus] = item._count;
  }
  for (const item of byLocationInGaza) {
    if (item.locationInGaza) summary.byLocationInGaza[item.locationInGaza] = item._count;
  }
  for (const item of consentCounts) {
    summary.consentSigned[String(item.consentSigned) as "true" | "false"] = item._count;
  }
  for (const item of verifiedCounts) {
    summary.hasVerifiedOffer[String(item.hasVerifiedOffer) as "true" | "false"] = item._count;
  }

  return {
    scope,
    students: students.map((student) => {
      const profile = student.studentProfile ? { ...student.studentProfile } : null;
      if (profile) {
        const isExpired = profile.passportExpiry && new Date(profile.passportExpiry) < new Date();
        if (isExpired) {
          profile.passportStatus = "expired" as any;
        }
      }
      return {
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        phone: student.phone,
        dateOfBirth: student.studentProfile?.dateOfBirth ?? student.dateOfBirth,
        createdAt: student.createdAt,
        accountStatus: student.accountStatus,
        profile,
        offerCount: student.studentOffers.length,
        offers: student.studentOffers
      };
    }),
    summary,
    pagination: { page: query.page, pageSize: query.pageSize, total }
  };
}

export async function streamAdminStudentsCsv(input: {
  userId: string;
  query: ListAdminStudentsQuery;
  res: import("express").Response;
  ipAddress?: string;
  userAgent?: string;
}) {
  const scope = await getAdminScope(input.userId);
  if (scope.role === "regional_admin" && input.query.regionId && input.query.regionId !== scope.regionId) {
    throw new ApiError(403, "You do not have permission to export students from this region");
  }

  const where =
    scope.role === "regional_admin"
      ? buildRegionalWhere(input.query, scope.regionId)
      : buildMasterWhere(input.query);

  let hasMore = true;
  let cursor: string | undefined = undefined;
  const batchSize = 1000;
  let headersWritten = false;
  let totalRows = 0;

  while (hasMore) {
    const students: any[] = await prisma.user.findMany({
      where,
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        createdAt: true,
        accountStatus: true,
        studentProfile: {
          select: {
            fullNameEnglish: true,
            sex: true,
            dateOfBirth: true,
            locationInGaza: true,
            passportStatus: true,
            passportLocation: true,
            consentSigned: true,
            profileStatus: true,
            hasOfferSelfReported: true,
            hasVerifiedOffer: true,
            emergencyContactFirstName: true,
            emergencyContactRelation: true,
            emergencyContactPhone: true
          }
        },
        studentOffers: {
          where: {
            deletedAt: null,
            ...(scope.role === "regional_admin" ? { regionId: scope.regionId } : {})
          },
          select: {
            id: true,
            universityName: true,
            courseName: true,
            courseField: true,
            courseLevel: true,
            reviewStatus: true,
            tuitionFeePerYear: true,
            scholarshipAmount: true,
            privateFundingAmount: true,
            createdAt: true,
            updatedAt: true,
            region: { select: { name: true } },
            documents: {
              where: { status: "active", deletedAt: null },
              select: {
                id: true,
                documentType: true,
                originalFilename: true
              }
            }
          },
          orderBy: { updatedAt: "desc" }
        }
      },
      orderBy: { id: "asc" }
    });

    if (students.length === 0) {
      hasMore = false;
      break;
    }

    cursor = students[students.length - 1].id;

    // One row per offer (student details repeated across rows)
    const rows: Record<string, unknown>[] = [];
    for (const student of students) {
      const studentBase = {
        studentId: student.id,
        studentName: student.fullName,
        email: student.email,
        phone: student.phone,
        dateOfBirth: student.studentProfile?.dateOfBirth ?? student.dateOfBirth,
        locationInGaza: student.studentProfile?.locationInGaza,
        passportStatus: student.studentProfile?.passportStatus,
        profileStatus: student.studentProfile?.profileStatus,
        consentSigned: student.studentProfile?.consentSigned,
        hasVerifiedOffer: student.studentProfile?.hasVerifiedOffer,
        emergencyContactName: student.studentProfile?.emergencyContactFirstName,
        emergencyContactRelation: student.studentProfile?.emergencyContactRelation,
        emergencyContactPhone: student.studentProfile?.emergencyContactPhone,
        accountStatus: student.accountStatus,
        registeredAt: student.createdAt
      };

      if (student.studentOffers.length === 0) {
        rows.push({ ...studentBase, offerId: "", universityName: "No offers", region: "", courseName: "", courseField: "", courseLevel: "", offerStatus: "", tuitionFeePerYear: "", scholarshipAmount: "", privateFundingAmount: "", offerLetterUrl: "", scholarshipLetterUrl: "", offerCreatedAt: "", offerUpdatedAt: "" });
      } else {
        for (const offer of student.studentOffers) {
          const offerLetterDoc = offer.documents.find((d: any) => d.documentType === "offer_letter");
          const scholarshipLetterDoc = offer.documents.find((d: any) => d.documentType === "scholarship_letter");

          rows.push({
            ...studentBase,
            offerId: offer.id,
            universityName: offer.universityName,
            region: offer.region.name,
            courseName: offer.courseName,
            courseField: offer.courseField,
            courseLevel: offer.courseLevel,
            offerStatus: offer.reviewStatus,
            tuitionFeePerYear: offer.tuitionFeePerYear,
            scholarshipAmount: offer.scholarshipAmount ?? "",
            privateFundingAmount: offer.privateFundingAmount,
            offerLetterUrl: offerLetterDoc
              ? `${process.env.API_BASE_URL ?? ""}/api/documents/${offerLetterDoc.id}/download`
              : "",
            offerLetterFileName: offerLetterDoc?.originalFilename ?? "",
            scholarshipLetterUrl: scholarshipLetterDoc
              ? `${process.env.API_BASE_URL ?? ""}/api/documents/${scholarshipLetterDoc.id}/download`
              : "",
            scholarshipLetterFileName: scholarshipLetterDoc?.originalFilename ?? "",
            offerCreatedAt: offer.createdAt,
            offerUpdatedAt: offer.updatedAt
          });
        }
      }
    }

    if (rows.length > 0) {
      totalRows += rows.length;
      const headers = Object.keys(rows[0]);
      
      if (!headersWritten) {
        input.res.write(headers.map(h => `"${h}"`).join(",") + "\n");
        headersWritten = true;
      }
      
      const chunk = rows.map(row => 
        headers.map(h => {
          const v = row[h];
          if (v === null || v === undefined) return '""';
          if (v instanceof Date) return `"${v.toISOString()}"`;
          return `"${String(v).replace(/"/g, '""')}"`;
        }).join(",")
      ).join("\n") + "\n";
      
      input.res.write(chunk);
    }
  }

  input.res.end();

  await recordAuditLog({
    actorUserId: input.userId,
    action: "students_exported",
    entityType: "student",
    metadata: { scope: scope as any, filters: input.query, rowCount: totalRows },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });
}

export async function getAdminStudentDetails(userId: string, studentId: string) {
  const scope = await getAdminScope(userId);

  const allowedDocTypes = scope.role === "regional_admin"
    ? ["moi_letter", "consent_form", "signature", "english_proficiency"]
    : ["passport", "national_id", "moi_letter", "consent_form", "signature", "english_proficiency"];

  const student = await prisma.user.findFirst({
    where: { id: studentId, roles: { has: RoleCode.student }, deletedAt: null },
    include: {
      studentProfile: {
        include: {
          documents: {
            where: {
              status: "active",
              deletedAt: null,
              documentType: { in: allowedDocTypes as any[] }
            }
          }
        }
      },
      documents: {
        where: {
          status: "active",
          deletedAt: null,
          documentType: { in: allowedDocTypes as any[] }
        }
      },
      studentOffers: {
        where: {
          deletedAt: null,
          ...(scope.role === "regional_admin" ? { regionId: scope.regionId } : {})
        },
        include: {
          region: true,
          university: true,
          documents: {
            where: { status: "active", deletedAt: null }
          },
          queries: {
            where: { deletedAt: null },
            include: {
              assignedTo: { select: { id: true, fullName: true, email: true } },
              messages: {
                where: { deletedAt: null },
                orderBy: { createdAt: "asc" }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" }
      },
      studentQueries: {
        where: {
          deletedAt: null,
          ...(scope.role === "regional_admin" ? { regionId: scope.regionId } : {})
        },
        include: {
          region: true,
          assignedTo: { select: { id: true, fullName: true, email: true } },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  if (scope.role === "regional_admin") {
    const hasOfferInRegion = student.studentOffers.some((o) => o.regionId === scope.regionId);
    const hasQueryInRegion = student.studentQueries.some((q) => q.regionId === scope.regionId);
    if (!hasOfferInRegion && !hasQueryInRegion) {
      throw new ApiError(403, "You do not have permission to access this student");
    }
  }

  // Handle expired passport and sensitive profile fields cleanup
  if (student.studentProfile) {
    const isExpired = student.studentProfile.passportExpiry && new Date(student.studentProfile.passportExpiry) < new Date();
    if (isExpired) {
      student.studentProfile.passportStatus = "expired" as any;
    }

    if (scope.role === "regional_admin") {
      student.studentProfile.passportNumber = null;
      student.studentProfile.nationalIdNumber = null;
      student.studentProfile.passportExpiry = null;
    }
  }

  const timeline: any[] = [];

  timeline.push({
    id: "create_account",
    title: "Account Registered",
    description: `Registered student account with email ${student.email}.`,
    timestamp: student.createdAt,
    type: "registration"
  });

  if (student.studentProfile) {
    if (student.studentProfile.createdAt) {
      timeline.push({
        id: "create_profile",
        title: "Profile Onboarding Initiated",
        description: "Student started entering onboarding details.",
        timestamp: student.studentProfile.createdAt,
        type: "profile"
      });
    }
    if (student.studentProfile.profileStatus === "approved" && student.studentProfile.reviewedAt) {
      timeline.push({
        id: "profile_approved",
        title: "Profile Onboarding Approved",
        description: `Profile approved by administrative review. ${student.studentProfile.reviewNotes ? `Notes: ${student.studentProfile.reviewNotes}` : ""}`,
        timestamp: student.studentProfile.reviewedAt,
        type: "profile_approved"
      });
    } else if (student.studentProfile.profileStatus === "under_review" && student.studentProfile.updatedAt) {
      timeline.push({
        id: "profile_submitted",
        title: "Profile Onboarding Submitted",
        description: "Profile submitted for administrative verification.",
        timestamp: student.studentProfile.updatedAt,
        type: "profile_review"
      });
    }
  }

  for (const doc of student.documents) {
    timeline.push({
      id: `doc_${doc.id}`,
      title: "Document Uploaded",
      description: `Uploaded document of type '${doc.documentType}' (${doc.originalFilename}).`,
      timestamp: doc.createdAt,
      type: "document"
    });
  }

  for (const offer of student.studentOffers) {
    timeline.push({
      id: `offer_created_${offer.id}`,
      title: "Offer Submitted",
      description: `Submitted placement offer for ${offer.universityName} (${offer.courseName}, ${offer.courseLevel}).`,
      timestamp: offer.createdAt,
      type: "offer"
    });
    if (offer.reviewStatus === "approved" && offer.reviewedAt) {
      timeline.push({
        id: `offer_approved_${offer.id}`,
        title: "Offer Placement Approved",
        description: `Verified and approved placement offer at ${offer.universityName}.`,
        timestamp: offer.reviewedAt,
        type: "offer_approved"
      });
    }
  }

  for (const query of student.studentQueries) {
    timeline.push({
      id: `query_raised_${query.id}`,
      title: "Query Raised",
      description: `Raised assistance query of type '${query.queryType}': "${query.title}".`,
      timestamp: query.createdAt,
      type: "query"
    });
    if (query.status === "resolved" && query.resolvedAt) {
      timeline.push({
        id: `query_resolved_${query.id}`,
        title: "Query Resolved",
        description: `Query "${query.title}" was resolved.`,
        timestamp: query.resolvedAt,
        type: "query_resolved"
      });
    }
  }

  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      email: student.email,
      phone: student.phone,
      dateOfBirth: student.dateOfBirth,
      accountStatus: student.accountStatus,
      createdAt: student.createdAt,
      studentProfile: student.studentProfile,
      documents: student.documents,
      offers: student.studentOffers,
      queries: student.studentQueries
    },
    timeline
  };
}

