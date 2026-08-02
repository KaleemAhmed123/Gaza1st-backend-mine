import { OfferReviewStatus, QueryStatus, RoleCode } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../shared/http";
import { getAdminScope as getAdminScopeCentral } from "../../shared/auth-scope";
import { calculateOfferFinancialSummary, decimalToNumber } from "../offers/offer-financial";
import { getOfferFinancialRules } from "../offers/offer.service";

type AdminScope =
  | { role: "master_admin"; regionId?: never; regionName?: never }
  | { role: "regional_admin"; regionId: string; regionName: string }
  | { role: "reviewer"; regionId?: never; regionName?: never };

function countRows<T extends string>(rows: Array<{ key: T; count: number }>) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.key] = row.count;
    return acc;
  }, {});
}

function groupCount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object") {
    const count = (value as { id?: unknown; _all?: unknown }).id ?? (value as { _all?: unknown })._all;
    return typeof count === "number" ? count : 0;
  }

  return 0;
}

async function getAdminScope(userId: string): Promise<AdminScope> {
  const scope = await getAdminScopeCentral(userId);
  let regionName: string | undefined;
  if (scope.role === "regional_admin" && scope.regionId) {
    const region = await prisma.region.findFirst({
      where: { id: scope.regionId }
    });
    regionName = region?.name;
  }
  return {
    role: scope.role,
    regionId: scope.regionId,
    regionName
  } as AdminScope;
}

export async function getStudentDashboard(userId: string) {
  const [profile, offerCounts, queryCounts, recentOffers, recentQueries, latestAnnouncements] =
    await Promise.all([
      prisma.studentProfile.findUnique({
        where: { userId },
        select: {
          profileStatus: true,
          consentSigned: true,
          hasOfferSelfReported: true,
          hasVerifiedOffer: true,
          passportStatus: true,
          locationInGaza: true,
          reviewNotes: true
        }
      }),
      prisma.offer.groupBy({
        by: ["reviewStatus"],
        where: { studentUserId: userId, deletedAt: null },
        orderBy: { reviewStatus: "asc" },
        _count: { id: true }
      }),
      prisma.query.groupBy({
        by: ["status"],
        where: { studentUserId: userId, deletedAt: null },
        orderBy: { status: "asc" },
        _count: { id: true }
      }),
      prisma.offer.findMany({
        where: { studentUserId: userId, deletedAt: null },
        select: {
          id: true,
          universityName: true,
          courseName: true,
          reviewStatus: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "desc" },
        take: 5
      }),
      prisma.query.findMany({
        where: { studentUserId: userId, deletedAt: null },
        select: {
          id: true,
          title: true,
          queryType: true,
          status: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "desc" },
        take: 5
      }),
      prisma.announcement.findMany({
        where: { deletedAt: null, isPublished: true },
        select: {
          id: true,
          title: true,
          category: true,
          publishedAt: true,
          createdAt: true
        },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: 5
      })
    ]);

  if (!profile) {
    throw new ApiError(404, "Student profile not found");
  }

  return {
    profile,
    counts: {
      offersByStatus: countRows(
        offerCounts.map((row) => ({ key: row.reviewStatus, count: groupCount(row._count) }))
      ),
      queriesByStatus: countRows(
        queryCounts.map((row) => ({ key: row.status, count: groupCount(row._count) }))
      )
    },
    recent: {
      offers: recentOffers,
      queries: recentQueries,
      announcements: latestAnnouncements
    }
  };
}

export async function getAdminDashboard(userId: string) {
  const scope = await getAdminScope(userId);

  if (scope.role === "reviewer") {
    const studentTotal = await prisma.user.count({
      where: {
        deletedAt: null,
        roles: { has: RoleCode.student }
      }
    });
    return {
      scope,
      counts: {
        students: {
          total: studentTotal,
          byProfileStatus: {}
        },
        offers: {
          total: 0,
          byReviewStatus: {}
        },
        queries: {
          total: 0,
          byStatus: {}
        },
        volunteers: {
          total: 0,
          byStatus: {}
        },
        announcements: {
          published: 0,
          draft: 0
        }
      },
      recent: {
        offers: [],
        queries: [],
        auditLogs: []
      },
      totalFundingGap: 0,
      fullyFundedStudentsCount: 0
    };
  }

  const offerWhere = {
    deletedAt: null,
    ...(scope.role === "regional_admin" ? { regionId: scope.regionId } : {})
  };
  const queryWhere = {
    deletedAt: null,
    ...(scope.role === "regional_admin" ? { regionId: scope.regionId } : {})
  };
  const studentWhere = {
    deletedAt: null,
    roles: { has: RoleCode.student },
    ...(scope.role === "regional_admin"
      ? { studentOffers: { some: { regionId: scope.regionId, deletedAt: null } } }
      : {})
  };
  const volunteerWhere = {
    deletedAt: null,
    roles: { has: RoleCode.mentor },
    volunteerProfile: {
      is: {
        deletedAt: null,
        ...(scope.role === "regional_admin" ? { preferredRegionId: scope.regionId } : {})
      }
    }
  };

  const [
    studentTotal,
    profileCounts,
    offerTotal,
    offerCounts,
    queryTotal,
    queryCounts,
    volunteerTotal,
    volunteerCounts,
    publishedAnnouncements,
    draftAnnouncements,
    recentOffers,
    recentQueries,
    recentAuditLogs,
    approvedOffersForMetrics
  ] = await Promise.all([
    prisma.user.count({ where: studentWhere }),
    prisma.studentProfile.groupBy({
      by: ["profileStatus"],
      where:
        scope.role === "regional_admin"
          ? { user: { studentOffers: { some: { regionId: scope.regionId, deletedAt: null } } } }
          : { deletedAt: null },
      orderBy: { profileStatus: "asc" },
      _count: { id: true }
    }),
    prisma.offer.count({ where: offerWhere }),
    prisma.offer.groupBy({
      by: ["reviewStatus"],
      where: offerWhere,
      orderBy: { reviewStatus: "asc" },
      _count: { id: true }
    }),
    prisma.query.count({ where: queryWhere }),
    prisma.query.groupBy({
      by: ["status"],
      where: queryWhere,
      orderBy: { status: "asc" },
      _count: { id: true }
    }),
    prisma.user.count({ where: volunteerWhere }),
    prisma.volunteerProfile.groupBy({
      by: ["volunteerStatus"],
      where:
        scope.role === "regional_admin"
          ? { deletedAt: null, preferredRegionId: scope.regionId }
          : { deletedAt: null },
      orderBy: { volunteerStatus: "asc" },
      _count: { id: true }
    }),
    prisma.announcement.count({ where: { deletedAt: null, isPublished: true } }),
    prisma.announcement.count({ where: { deletedAt: null, isPublished: false } }),
    prisma.offer.findMany({
      where: offerWhere,
      select: {
        id: true,
        universityName: true,
        courseName: true,
        reviewStatus: true,
        updatedAt: true,
        student: { select: { id: true, fullName: true, email: true } },
        region: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.query.findMany({
      where: queryWhere,
      select: {
        id: true,
        title: true,
        queryType: true,
        status: true,
        updatedAt: true,
        student: { select: { id: true, fullName: true, email: true } },
        region: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    scope.role === "master_admin"
      ? prisma.auditLog.findMany({
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            createdAt: true,
            actor: { select: { id: true, fullName: true, email: true } }
          },
          orderBy: { createdAt: "desc" },
          take: 5
        })
      : prisma.auditLog.findMany({ where: { id: "__never__" }, take: 0 }),
    prisma.offer.findMany({
      where: {
        reviewStatus: OfferReviewStatus.approved,
        deletedAt: null,
        ...(scope.role === "regional_admin" ? { regionId: scope.regionId } : {})
      },
      select: {
        id: true,
        studentUserId: true,
        region: { select: { name: true } },
        courseLevel: true,
        durationYears: true,
        tuitionFeePerYear: true,
        scholarshipAmount: true,
        scholarshipCoversLivingCost: true,
        privateFundingAmount: true,
        privateFundingInterval: true,
        livingCostLocationKey: true,
        livingCostForVisa: true,
        boardingFees: true,
        programmeStartDate: true
      }
    })
  ]);

  let totalFundingGap = 0;
  let fullyFundedStudentsCount = 0;

  try {
    const financialRules = await getOfferFinancialRules();
    const studentOffersMap: Record<string, typeof approvedOffersForMetrics> = {};
    for (const offer of approvedOffersForMetrics) {
      if (!studentOffersMap[offer.studentUserId]) {
        studentOffersMap[offer.studentUserId] = [];
      }
      studentOffersMap[offer.studentUserId].push(offer);
    }

    const nowTime = Date.now();

    for (const studentUserId of Object.keys(studentOffersMap)) {
      const studentOffers = studentOffersMap[studentUserId];
      
      const offersWithGap = studentOffers.map((offer) => {
        let gap = 0;
        try {
          const summary = calculateOfferFinancialSummary(financialRules, {
            countryName: offer.region.name,
            courseLevel: offer.courseLevel,
            durationYears: decimalToNumber(offer.durationYears),
            tuitionFeePerYear: decimalToNumber(offer.tuitionFeePerYear),
            scholarshipAmount: offer.scholarshipAmount
              ? decimalToNumber(offer.scholarshipAmount)
              : undefined,
            scholarshipCoversLivingCost: offer.scholarshipCoversLivingCost,
            privateFundingAmount: decimalToNumber(offer.privateFundingAmount),
            privateFundingInterval: offer.privateFundingInterval,
            livingCostLocationKey: offer.livingCostLocationKey,
            livingCostForVisa: offer.livingCostForVisa ? decimalToNumber(offer.livingCostForVisa) : undefined,
            boardingFees: offer.boardingFees ? decimalToNumber(offer.boardingFees) : undefined
          });
          gap = summary.tuitionFeePerYearGap + summary.livingCostGap;
        } catch (e) {
          console.error(`Error calculating gap for offer ${offer.id}:`, e);
        }
        return { offer, gap };
      });

      if (offersWithGap.length > 0) {
        // sum of all approved offer's funding gap - pick the one with least gap per student
        const minGapObj = offersWithGap.reduce((min, curr) => (curr.gap < min.gap ? curr : min), offersWithGap[0]);
        totalFundingGap += minGapObj.gap;

        if (minGapObj.gap === 0) {
          fullyFundedStudentsCount += 1;
        }
      }
    }
  } catch (err) {
    console.error("Failed to calculate dashboard funding gap and fully funded metrics:", err);
  }

  return {
    scope,
    counts: {
      students: {
        total: studentTotal,
        byProfileStatus: countRows(
          profileCounts.map((row) => ({ key: row.profileStatus, count: groupCount(row._count) }))
        )
      },
      offers: {
        total: offerTotal,
        byReviewStatus: countRows(
          offerCounts.map((row) => ({ key: row.reviewStatus, count: groupCount(row._count) }))
        )
      },
      queries: {
        total: queryTotal,
        byStatus: countRows(queryCounts.map((row) => ({ key: row.status, count: groupCount(row._count) })))
      },
      volunteers: {
        total: volunteerTotal,
        byStatus: countRows(
          volunteerCounts.map((row) => ({ key: row.volunteerStatus, count: groupCount(row._count) }))
        )
      },
      announcements: {
        published: publishedAnnouncements,
        draft: draftAnnouncements
      }
    },
    recent: {
      offers: recentOffers,
      queries: recentQueries,
      auditLogs: recentAuditLogs
    },
    totalFundingGap,
    fullyFundedStudentsCount
  };
}

export async function getMentorDashboard(userId: string) {
  const [queryCounts, recentQueries, offerCounts, recentOffers, assignedOffersForStudents, assignedQueriesForStudents] = await Promise.all([
    prisma.query.groupBy({
      by: ["status"],
      where: { assignedToUserId: userId, deletedAt: null },
      orderBy: { status: "asc" },
      _count: { id: true }
    }),
    prisma.query.findMany({
      where: { assignedToUserId: userId, deletedAt: null },
      select: {
        id: true,
        title: true,
        queryType: true,
        status: true,
        updatedAt: true,
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true
          }
        },
        region: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.offer.groupBy({
      by: ["reviewStatus"],
      where: { mentorId: userId, deletedAt: null },
      orderBy: { reviewStatus: "asc" },
      _count: { id: true }
    }),
    prisma.offer.findMany({
      where: { mentorId: userId, deletedAt: null },
      select: {
        id: true,
        universityName: true,
        courseName: true,
        reviewStatus: true,
        updatedAt: true,
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true
          }
        },
        region: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.offer.findMany({
      where: { mentorId: userId, deletedAt: null },
      select: { studentUserId: true }
    }),
    prisma.query.findMany({
      where: { assignedToUserId: userId, deletedAt: null },
      select: { studentUserId: true }
    })
  ]);

  const assignedStudentUserIds = Array.from(
    new Set([
      ...assignedOffersForStudents.map((o) => o.studentUserId),
      ...assignedQueriesForStudents.map((q) => q.studentUserId)
    ])
  );

  let totalFundingGap = 0;
  let fullyFundedStudentsCount = 0;

  if (assignedStudentUserIds.length > 0) {
    try {
      const [approvedOffersForMetrics, financialRules] = await Promise.all([
        prisma.offer.findMany({
          where: {
            mentorId: userId,
            reviewStatus: OfferReviewStatus.approved,
            deletedAt: null
          },
          select: {
            id: true,
            studentUserId: true,
            region: { select: { name: true } },
            courseLevel: true,
            durationYears: true,
            tuitionFeePerYear: true,
            scholarshipAmount: true,
            scholarshipCoversLivingCost: true,
            privateFundingAmount: true,
            privateFundingInterval: true,
            livingCostLocationKey: true,
            livingCostForVisa: true,
            boardingFees: true,
            programmeStartDate: true
          }
        }),
        getOfferFinancialRules()
      ]);

      const studentOffersMap: Record<string, typeof approvedOffersForMetrics> = {};
      for (const offer of approvedOffersForMetrics) {
        if (!studentOffersMap[offer.studentUserId]) {
          studentOffersMap[offer.studentUserId] = [];
        }
        studentOffersMap[offer.studentUserId].push(offer);
      }

      for (const studentUserId of Object.keys(studentOffersMap)) {
        const studentOffers = studentOffersMap[studentUserId];
        
        const offersWithGap = studentOffers.map((offer) => {
          let gap = 0;
          try {
            const summary = calculateOfferFinancialSummary(financialRules, {
              countryName: offer.region.name,
              courseLevel: offer.courseLevel,
              durationYears: decimalToNumber(offer.durationYears),
              tuitionFeePerYear: decimalToNumber(offer.tuitionFeePerYear),
              scholarshipAmount: offer.scholarshipAmount
                ? decimalToNumber(offer.scholarshipAmount)
                : undefined,
              scholarshipCoversLivingCost: offer.scholarshipCoversLivingCost,
              privateFundingAmount: decimalToNumber(offer.privateFundingAmount),
              privateFundingInterval: offer.privateFundingInterval,
              livingCostLocationKey: offer.livingCostLocationKey,
              livingCostForVisa: offer.livingCostForVisa ? decimalToNumber(offer.livingCostForVisa) : undefined,
              boardingFees: offer.boardingFees ? decimalToNumber(offer.boardingFees) : undefined
            });
            gap = summary.tuitionFeePerYearGap + summary.livingCostGap;
          } catch (e) {
            console.error(`Error calculating gap for offer ${offer.id}:`, e);
          }
          return { offer, gap };
        });

        if (offersWithGap.length > 0) {
          const minGapObj = offersWithGap.reduce((min, curr) => (curr.gap < min.gap ? curr : min), offersWithGap[0]);
          totalFundingGap += minGapObj.gap;

          if (minGapObj.gap === 0) {
            fullyFundedStudentsCount += 1;
          }
        }
      }
    } catch (err) {
      console.error("Failed to calculate mentor dashboard funding gap metrics:", err);
    }
  }

  const byStatus = countRows(queryCounts.map((row) => ({ key: row.status, count: groupCount(row._count) })));
  const offersByStatus = countRows(
    offerCounts.map((row) => ({ key: row.reviewStatus, count: groupCount(row._count) }))
  );

  return {
    counts: {
      assignedQueries: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        openOrAssigned: (byStatus[QueryStatus.open] ?? 0) + (byStatus[QueryStatus.assigned] ?? 0),
        byStatus
      },
      assignedOffers: {
        total: Object.values(offersByStatus).reduce((sum, count) => sum + count, 0),
        byStatus: offersByStatus
      }
    },
    recent: {
      assignedQueries: recentQueries,
      assignedOffers: recentOffers
    },
    totalFundingGap,
    fullyFundedStudentsCount
  };
}
