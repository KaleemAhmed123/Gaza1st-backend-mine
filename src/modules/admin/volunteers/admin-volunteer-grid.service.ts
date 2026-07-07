import { RoleCode } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { recordAuditLog } from "../../../shared/audit";
import { toCsv } from "../../../shared/csv";
import { ApiError } from "../../../shared/http";
import { getAdminScope, type AdminScope } from "../../../shared/auth-scope";
import type {
  ListAdminVolunteersQuery,
  UpdateVolunteerAssignmentInput
} from "./admin-volunteer-grid.validation";

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
        volunteerProfile: {
          is: {
            universityAffiliation: { contains: search, mode: "insensitive" }
          }
        }
      }
    ]
  };
}

function buildBaseWhere(query: ListAdminVolunteersQuery): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    roles: { has: query.role ?? RoleCode.mentor },
    ...buildSearchWhere(query.search),
    volunteerProfile: {
      is: {
        deletedAt: null,
        ...(query.volunteerStatus ? { volunteerStatus: query.volunteerStatus } : {}),
        ...(query.preferredRegionId ? { preferredRegionId: query.preferredRegionId } : {})
      }
    }
  };
}

export async function listAdminVolunteers(userId: string, query: ListAdminVolunteersQuery) {
  const scope = await getAdminScope(userId);
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;

  const where = buildBaseWhere(query);

  if (scope.role === "regional_admin") {
    where.volunteerProfile = {
      is: {
        deletedAt: null,
        preferredRegionId: scope.regionId,
        ...(query.volunteerStatus ? { volunteerStatus: query.volunteerStatus } : {})
      }
    };
  }

  const [volunteers, total, summaryVolunteers] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        roles: true,
        accountStatus: true,
        createdAt: true,
        volunteerProfile: {
          select: {
            id: true,
            universityAffiliation: true,
            preferredRegionId: true,
            volunteerStatus: true,
            reviewedBy: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true
          }
        },
        regionalAdminProfile: {
          select: {
            id: true,
            regionId: true,
            status: true,
            region: {
              select: {
                id: true,
                code: true,
                name: true
              }
            }
          }
        },
        _count: {
          select: {
            mentorOffers: {
              where: { deletedAt: null }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take
    }),
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        roles: true
      }
    })
  ]);

  const userIds = summaryVolunteers.map(v => v.id);
  const summaryProfiles = await prisma.volunteerProfile.findMany({
    where: { userId: { in: userIds } },
    select: {
      volunteerStatus: true,
      preferredRegionId: true
    }
  });

  // Get distinct student counts per mentor (from mentorOffers)
  const mentorIds = volunteers.map((v) => v.id);
  const studentCountRows = await prisma.offer.groupBy({
    by: ["mentorId"],
    where: {
      mentorId: { in: mentorIds },
      deletedAt: null
    },
    _count: { studentUserId: true }
  });
  const studentCountByMentorId = new Map(
    studentCountRows.map((row) => [row.mentorId!, row._count.studentUserId])
  );

  const summary = {
    total,
    byVolunteerStatus: {} as Record<string, number>,
    byRole: {} as Record<string, number>,
    byPreferredRegionId: {} as Record<string, number>
  };

  for (const volunteer of summaryVolunteers) {
    for (const role of volunteer.roles) {
      addCount(summary.byRole, role);
    }
  }

  for (const profile of summaryProfiles) {
    addCount(summary.byVolunteerStatus, profile.volunteerStatus);
    addCount(summary.byPreferredRegionId, profile.preferredRegionId);
  }

  return {
    scope,
    volunteers: volunteers.map((volunteer) => ({
      id: volunteer.id,
      fullName: volunteer.fullName,
      email: volunteer.email,
      phone: volunteer.phone,
      dateOfBirth: volunteer.dateOfBirth,
      roles: volunteer.roles,
      accountStatus: volunteer.accountStatus,
      createdAt: volunteer.createdAt,
      profile: volunteer.volunteerProfile,
      regionalAdminProfile: volunteer.regionalAdminProfile,
      assignedOffersCount: volunteer._count.mentorOffers,
      assignedStudentCount: studentCountByMentorId.get(volunteer.id) ?? 0
    })),
    summary,
    pagination: { page: query.page, pageSize: query.pageSize, total }
  };
}

export async function exportAdminVolunteersCsv(input: {
  userId: string;
  query: ListAdminVolunteersQuery;
  ipAddress?: string;
  userAgent?: string;
}) {
  const scope = await getAdminScope(input.userId);
  const where = buildBaseWhere(input.query);

  if (scope.role === "regional_admin") {
    where.volunteerProfile = {
      is: {
        deletedAt: null,
        preferredRegionId: scope.regionId,
        ...(input.query.volunteerStatus ? { volunteerStatus: input.query.volunteerStatus } : {})
      }
    };
  }

  const volunteers = await prisma.user.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      dateOfBirth: true,
      roles: true,
      accountStatus: true,
      createdAt: true,
      volunteerProfile: {
        select: {
          universityAffiliation: true,
          volunteerStatus: true,
          preferredRegionId: true
        }
      },
      regionalAdminProfile: {
        select: {
          status: true,
          region: {
            select: {
              name: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const preferredRegionIds = volunteers
    .map((volunteer) => volunteer.volunteerProfile?.preferredRegionId)
    .filter((regionId): regionId is string => Boolean(regionId));
  const preferredRegions = await prisma.region.findMany({
    where: { id: { in: preferredRegionIds } },
    select: { id: true, name: true }
  });
  const preferredRegionNameById = new Map(preferredRegions.map((region) => [region.id, region.name]));

  const rows = volunteers.map((volunteer) => ({
    volunteerId: volunteer.id,
    fullName: volunteer.fullName,
    email: volunteer.email,
    phone: volunteer.phone,
    dateOfBirth: volunteer.dateOfBirth,
    roles: volunteer.roles,
    accountStatus: volunteer.accountStatus,
    volunteerStatus: volunteer.volunteerProfile?.volunteerStatus,
    universityAffiliation: volunteer.volunteerProfile?.universityAffiliation,
    preferredRegion: volunteer.volunteerProfile?.preferredRegionId
      ? preferredRegionNameById.get(volunteer.volunteerProfile.preferredRegionId)
      : undefined,
    regionalAdminStatus: volunteer.regionalAdminProfile?.status,
    regionalAdminRegion: volunteer.regionalAdminProfile?.region.name,
    createdAt: volunteer.createdAt
  }));

  await recordAuditLog({
    actorUserId: input.userId,
    action: "volunteers_exported",
    entityType: "volunteer",
    metadata: { scope: scope as any, filters: input.query, rowCount: rows.length },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return toCsv(rows);
}

export async function updateVolunteerAssignment(input: {
  actorUserId: string;
  volunteerUserId: string;
  data: UpdateVolunteerAssignmentInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const scope = await getAdminScope(input.actorUserId);
  const volunteer = await prisma.user.findFirst({
    where: {
      id: input.volunteerUserId,
      deletedAt: null,
      volunteerProfile: { is: { deletedAt: null } }
    },
    include: { volunteerProfile: true }
  });

  if (!volunteer || !volunteer.volunteerProfile) {
    throw new ApiError(404, "Volunteer not found");
  }

  if (volunteer.roles.includes(RoleCode.master_admin) || volunteer.roles.includes(RoleCode.regional_admin)) {
    throw new ApiError(400, "Privileged accounts cannot be managed through volunteer assignment");
  }

  if (scope.role === "regional_admin") {
    if (input.data.preferredRegionId && input.data.preferredRegionId !== scope.regionId) {
      throw new ApiError(403, "Regional Admin cannot assign volunteers to another region");
    }

    // Regional admins may act on volunteers in their own region OR volunteers that
    // are still unassigned (preferredRegionId == null) — those appear in the regional
    // list, so blocking rejection of them left "Global / Unassigned" volunteers unactionable.
    if (
      volunteer.volunteerProfile.preferredRegionId &&
      volunteer.volunteerProfile.preferredRegionId !== scope.regionId
    ) {
      throw new ApiError(403, "Regional Admin can only manage volunteers in their own region or unassigned volunteers");
    }

    if (input.data.mentorEnabled === false) {
      throw new ApiError(403, "Regional Admin cannot remove mentor role");
    }
  }

  if (input.data.preferredRegionId) {
    const region = await prisma.region.findFirst({
      where: { id: input.data.preferredRegionId, isActive: true, deletedAt: null }
    });

    if (!region) {
      throw new ApiError(400, "Invalid preferred region");
    }
  }

  const nextRoles = input.data.mentorEnabled
    ? Array.from(new Set([...volunteer.roles, RoleCode.mentor]))
    : volunteer.roles;

  const updatedVolunteer = await prisma.$transaction(async (tx) => {
    await tx.volunteerProfile.update({
      where: { userId: volunteer.id },
      data: {
        ...(input.data.volunteerStatus ? { volunteerStatus: input.data.volunteerStatus } : {}),
        ...(input.data.preferredRegionId ? { preferredRegionId: input.data.preferredRegionId } : {}),
        ...(input.data.notes !== undefined ? { reviewNotes: input.data.notes } : {}),
        ...(input.data.volunteerStatus
          ? {
              reviewedBy: input.actorUserId,
              reviewedAt: new Date()
            }
          : {})
      }
    });

    return tx.user.update({
      where: { id: volunteer.id },
      data: { roles: { set: nextRoles } },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        roles: true,
        accountStatus: true,
        volunteerProfile: {
          select: {
            id: true,
            universityAffiliation: true,
            preferredRegionId: true,
            volunteerStatus: true,
            reviewedBy: true,
            reviewedAt: true,
            updatedAt: true
          }
        }
      }
    });
  });

  await recordAuditLog({
    actorUserId: input.actorUserId,
    action: "volunteer_assignment_updated",
    entityType: "volunteer",
    entityId: volunteer.id,
    metadata: {
      scope: scope as any,
      previousStatus: volunteer.volunteerProfile.volunteerStatus,
      previousPreferredRegionId: volunteer.volunteerProfile.preferredRegionId,
      next: input.data
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return updatedVolunteer;
}
