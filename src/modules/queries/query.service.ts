import { QueryStatus, RegionalAdminStatus, RoleCode, VolunteerStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { recordAuditLog } from "../../shared/audit";
import { sendEmailBestEffort } from "../../shared/email";
import { emailTemplates } from "../../shared/email-templates";
import { env } from "../../config/env";
import { ApiError } from "../../shared/http";
import { getAdminScope as getAdminScopeCentral } from "../../shared/auth-scope";
import { appEmitter, AppEvents } from "../../shared/events";
import type {
  AddQueryMessageInput,
  AssignQueryInput,
  CreateQueryInput,
  EscalateQueryInput,
  ListQueriesQuery
} from "./query.validation";

const queryInclude = {
  student: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      studentProfile: {
        select: {
          emergencyContactFirstName: true,
          emergencyContactRelation: true,
          emergencyContactPhone: true
        }
      }
    }
  },
  region: true,
  offer: {
    select: {
      id: true,
      universityName: true,
      courseName: true,
      reviewStatus: true,
      regionId: true
    }
  },
  assignedTo: {
    select: { id: true, fullName: true, email: true }
  },
  assignedBy: {
    select: { id: true, fullName: true, email: true }
  },
  messages: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
    include: {
      sender: {
        select: { id: true, fullName: true, email: true, roles: true }
      }
    }
  }
};

const queryListInclude = {
  student: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true
    }
  },
  region: {
    select: {
      id: true,
      code: true,
      name: true
    }
  },
  offer: {
    select: {
      id: true,
      universityName: true,
      courseName: true,
      reviewStatus: true,
      regionId: true
    }
  },
  assignedTo: {
    select: { id: true, fullName: true, email: true }
  },
  assignedBy: {
    select: { id: true, fullName: true, email: true }
  },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function categoryMetadataRequires(metadata: unknown, key: "requiresRegion" | "requiresOffer") {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      key in metadata &&
      (metadata as Record<string, unknown>)[key] === true
  );
}

async function getActiveQueryCategory(queryType: string) {
  const category = await prisma.configOption.findFirst({
    where: {
      groupKey: "query_type",
      value: queryType,
      isActive: true,
      deletedAt: null
    }
  });

  if (!category) {
    throw new ApiError(400, "Query type is invalid or inactive");
  }

  return category;
}

async function getAdminScope(userId: string) {
  const scope = await getAdminScopeCentral(userId);
  return {
    isMasterAdmin: scope.role === "master_admin",
    regionId: scope.regionId
  };
}

async function assertAdminCanAccessQuery(userId: string, regionId: string | null) {
  const scope = await getAdminScope(userId);

  if (scope.isMasterAdmin) {
    return scope;
  }

  if (!regionId || scope.regionId !== regionId) {
    throw new ApiError(403, "You do not have permission to access this query");
  }

  return scope;
}

async function getQueryOrThrow(queryId: string) {
  const query = await prisma.query.findFirst({
    where: { id: queryId, deletedAt: null },
    include: queryInclude
  });

  if (!query) {
    throw new ApiError(404, "Query not found");
  }

  return query;
}

function assertQueryWritable(status: QueryStatus) {
  if (status === QueryStatus.resolved) {
    throw new ApiError(409, "Resolved queries are read-only");
  }
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

async function notifyAdmins(queryId: string) {
  const query = await getQueryOrThrow(queryId);
  const admins = await prisma.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: "active",
      OR: [
        { roles: { has: RoleCode.master_admin } },
        ...(query.regionId
          ? [
              {
                roles: { has: RoleCode.regional_admin },
                regionalAdminProfile: {
                  regionId: query.regionId,
                  status: RegionalAdminStatus.active,
                  deletedAt: null
                }
              }
            ]
          : [])
      ]
    },
    select: { email: true, roles: true }
  });

  const masterAdminEmails = admins
    .filter((admin) => admin.roles.includes(RoleCode.master_admin))
    .map((admin) => admin.email);

  const regionalAdminEmails = admins
    .filter((admin) => admin.roles.includes(RoleCode.regional_admin) && !admin.roles.includes(RoleCode.master_admin))
    .map((admin) => admin.email);

  if (masterAdminEmails.length > 0) {
    sendEmailBestEffort({
      to: masterAdminEmails,
      subject: `New Gaza40 query: ${query.title}`,
      text: `${query.student.fullName} raised a query.\n\n${query.message}`,
      html: emailTemplates.notification(
        "Admin",
        "New Query Raised",
        `${query.student.fullName} raised a new query: <strong>${query.title}</strong><br/><br/>${query.message}`,
        `${env.FRONTEND_URL}/admin/queries?queryId=${query.id}`,
        "View Query"
      )
    });
  }

  if (regionalAdminEmails.length > 0) {
    sendEmailBestEffort({
      to: regionalAdminEmails,
      subject: `New Gaza40 query: ${query.title}`,
      text: `${query.student.fullName} raised a query.\n\n${query.message}`,
      html: emailTemplates.notification(
        "Regional Admin",
        "New Query Raised",
        `${query.student.fullName} raised a new query: <strong>${query.title}</strong><br/><br/>${query.message}`,
        `${env.FRONTEND_URL}/regional-admin/queries?queryId=${query.id}`,
        "View Query"
      )
    });
  }
}

async function notifyRegionalAdmins(
  queryId: string,
  regionId: string,
  subject: string,
  body: string
): Promise<number> {
  const admins = await prisma.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.regional_admin },
      regionalAdminProfile: {
        regionId,
        status: RegionalAdminStatus.active,
        deletedAt: null
      }
    },
    select: { email: true }
  });

  if (admins.length === 0) return 0;

  sendEmailBestEffort({
    to: admins.map((a) => a.email),
    subject,
    text: body,
    html: emailTemplates.notification(
      "Regional Admin",
      subject,
      body,
      `${env.FRONTEND_URL}/regional-admin/queries?queryId=${queryId}`,
      "View Query"
    )
  });

  return admins.length;
}

async function notifyMasterAdmins(subject: string, body: string, queryId: string) {
  const admins = await prisma.user.findMany({
    where: {
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.master_admin }
    },
    select: { email: true }
  });

  if (admins.length === 0) return;

  sendEmailBestEffort({
    to: admins.map((a) => a.email),
    subject,
    text: body,
    html: emailTemplates.notification(
      "Admin",
      subject,
      body,
      `${env.FRONTEND_URL}/admin/queries?queryId=${queryId}`,
      "View Query"
    )
  });
}

function notifyAssignee(email: string, title: string) {
  sendEmailBestEffort({
    to: [email],
    subject: `Gaza40 query assigned: ${title}`,
    text: `A query has been assigned to you: ${title}`,
    html: emailTemplates.notification(
      "Mentor",
      "Query Assigned",
      `A new query has been assigned to you: <strong>${title}</strong>. Please log in to review and respond.`,
      `${env.FRONTEND_URL}/mentor/queries`,
      "View My Queries"
    )
  });
}

function notifyStudent(email: string, title: string) {
  sendEmailBestEffort({
    to: [email],
    subject: `Gaza40 query updated: ${title}`,
    text: `Your query has been updated: ${title}`,
    html: emailTemplates.notification(
      "Student",
      "Query Updated",
      `Your query <strong>${title}</strong> has a new update. Please log in to view the latest messages or status.`,
      `${env.FRONTEND_URL}/student/queries`,
      "View My Queries"
    )
  });
}

// ---------------------------------------------------------------------------
// Student actions
// ---------------------------------------------------------------------------

export async function createQuery(input: {
  userId: string;
  data: CreateQueryInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const category = await getActiveQueryCategory(input.data.queryType);
  let regionId = input.data.regionId;
  let offerId = input.data.offerId;
  let autoAssignUserId: string | null = null;
  let autoAssignEmail: string | null = null;

  const metadata = category.metadata as Record<string, any> | null;
  const assignTo = metadata?.assignTo;
  const isMentor = assignTo === "mentor" || categoryMetadataRequires(category.metadata, "requiresOffer");
  const isRegionalAdmin = assignTo === "regional_admin" || categoryMetadataRequires(category.metadata, "requiresRegion");
  const isMasterAdmin = assignTo === "master_admin";

  if (isMentor && !offerId) {
    throw new ApiError(400, "An offer letter is required for this query type");
  }

  if (isRegionalAdmin && !regionId) {
    throw new ApiError(400, "Destination country is required for this query type");
  }

  // Offer-letter query type: resolve region + potential mentor from offer
  if (offerId) {
    const offer = await prisma.offer.findFirst({
      where: { id: offerId, studentUserId: input.userId, deletedAt: null },
      select: {
        id: true,
        regionId: true,
        mentorId: true,
        mentor: {
          select: {
            id: true,
            email: true,
            accountStatus: true,
            volunteerProfile: {
              select: { volunteerStatus: true, deletedAt: true }
            }
          }
        }
      }
    });

    if (!offer) {
      throw new ApiError(404, "Offer not found for this student");
    }

    regionId = offer.regionId;
    offerId = offer.id;

    // Auto-assign to mentor if the offer already has an approved, active mentor
    if (
      isMentor &&
      offer.mentorId &&
      offer.mentor?.accountStatus === "active" &&
      offer.mentor.volunteerProfile?.volunteerStatus === VolunteerStatus.approved &&
      !offer.mentor.volunteerProfile.deletedAt
    ) {
      autoAssignUserId = offer.mentorId;
      autoAssignEmail = offer.mentor.email;
    }
  }

  // If assignTo is mentor, and we didn't specify an offerId (or the specified offer has no mentor),
  // search the student's other offers with an active mentor
  if (isMentor && !autoAssignUserId) {
    const offerWithMentor = await prisma.offer.findFirst({
      where: {
        studentUserId: input.userId,
        deletedAt: null,
        mentorId: { not: null },
        mentor: {
          accountStatus: "active",
          volunteerProfile: {
            volunteerStatus: VolunteerStatus.approved,
            deletedAt: null
          }
        }
      },
      select: {
        mentorId: true,
        mentor: { select: { email: true } }
      }
    });
    if (offerWithMentor && offerWithMentor.mentor) {
      autoAssignUserId = offerWithMentor.mentorId;
      autoAssignEmail = offerWithMentor.mentor.email;
    }
  }

  // If isRegionalAdmin is true, let's find the active Regional Admin for this regionId
  if (isRegionalAdmin && regionId) {
    const regionalAdmin = await prisma.regionalAdminProfile.findFirst({
      where: {
        regionId,
        status: RegionalAdminStatus.active,
        deletedAt: null,
        user: { accountStatus: "active" }
      },
      select: {
        userId: true,
        user: { select: { email: true } }
      }
    });
    if (regionalAdmin) {
      autoAssignUserId = regionalAdmin.userId;
      autoAssignEmail = regionalAdmin.user.email;
    }
  }

  // If isMasterAdmin is true, let's find the first active Master Admin
  if (isMasterAdmin) {
    const masterAdmin = await prisma.user.findFirst({
      where: {
        roles: { has: RoleCode.master_admin },
        accountStatus: "active",
        deletedAt: null
      },
      select: {
        id: true,
        email: true
      }
    });
    if (masterAdmin) {
      autoAssignUserId = masterAdmin.id;
      autoAssignEmail = masterAdmin.email;
    }
  }

  // Fallback look-up for any other custom role added in the future
  if (assignTo && !autoAssignUserId && assignTo !== "mentor" && assignTo !== "regional_admin" && assignTo !== "master_admin") {
    const matchingUser = await prisma.user.findFirst({
      where: {
        roles: { has: assignTo as any },
        accountStatus: "active",
        deletedAt: null
      },
      select: {
        id: true,
        email: true
      }
    });
    if (matchingUser) {
      autoAssignUserId = matchingUser.id;
      autoAssignEmail = matchingUser.email;
    }
  }

  if (regionId) {
    const region = await prisma.region.findFirst({
      where: { id: regionId, isActive: true, deletedAt: null },
      select: { id: true }
    });

    if (!region) {
      throw new ApiError(400, "Region is invalid or inactive");
    }
  }

  const query = await prisma.$transaction(async (tx) => {
    const createdQuery = await tx.query.create({
      data: {
        studentUserId: input.userId,
        queryType: input.data.queryType,
        title: input.data.title,
        message: input.data.message,
        regionId,
        offerId,
        ...(autoAssignUserId
          ? { assignedToUserId: autoAssignUserId, status: QueryStatus.assigned }
          : {}),
        deletedAt: null
      }
    });

    await tx.queryMessage.create({
      data: {
        queryId: createdQuery.id,
        senderUserId: input.userId,
        message: input.data.message,
        deletedAt: null
      }
    });

    return createdQuery;
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_created",
    entityType: "query",
    entityId: query.id,
    metadata: {
      queryType: input.data.queryType,
      regionId,
      offerId,
      autoAssigned: Boolean(autoAssignUserId)
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  if (autoAssignUserId && autoAssignEmail) {
    notifyAssignee(autoAssignEmail, input.data.title);
    appEmitter.emit(AppEvents.QUERY_ASSIGNED, {
      assigneeUserId: autoAssignUserId,
      queryId: query.id,
      title: query.title
    });
  } else {
    void notifyAdmins(query.id).catch((error) => {
      console.error(
        `Query admin notification failed: ${error instanceof Error ? error.message : "Unknown notification error"}`
      );
    });
  }

  return getQueryOrThrow(query.id);
}

export async function listMyQueries(userId: string) {
  return prisma.query.findMany({
    where: { studentUserId: userId, deletedAt: null },
    include: queryListInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function getMyQuery(userId: string, queryId: string) {
  const query = await prisma.query.findFirst({
    where: { id: queryId, studentUserId: userId, deletedAt: null },
    include: queryInclude
  });

  if (!query) {
    throw new ApiError(404, "Query not found");
  }

  return query;
}

export async function addStudentMessage(input: {
  userId: string;
  queryId: string;
  data: AddQueryMessageInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getMyQuery(input.userId, input.queryId);
  assertQueryWritable(query.status);

  const message = await prisma.queryMessage.create({
    data: {
      queryId: query.id,
      senderUserId: input.userId,
      message: input.data.message,
      deletedAt: null
    },
    include: { sender: { select: { id: true, fullName: true, email: true, roles: true } } }
  });

  await prisma.query.update({ where: { id: query.id }, data: { updatedAt: new Date() } });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_message_added",
    entityType: "query",
    entityId: query.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  if (query.assignedTo?.email) {
    notifyAssignee(query.assignedTo.email, query.title);
  }

  if (query.assignedToUserId) {
    appEmitter.emit(AppEvents.QUERY_REPLIED, {
      targetUserId: query.assignedToUserId,
      queryId: query.id,
      title: query.title
    });
  }

  return message;
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export async function listAdminQueries(userId: string, query: ListQueriesQuery) {
  const scope = await getAdminScope(userId);
  const wherePayload: any = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.queryType ? { queryType: query.queryType } : {}),
    ...(query.regionId ? { regionId: query.regionId } : {}),
    ...(query.universityId ? { offer: { universityId: query.universityId } } : {}),
    ...(query.assignedToName
      ? {
          assignedTo: {
            fullName: { contains: query.assignedToName, mode: "insensitive" }
          }
        }
      : {}),
    ...(query.title ? { title: { contains: query.title, mode: "insensitive" } } : {}),
    isEscalated: scope.isMasterAdmin
      ? (query.isEscalated !== undefined ? query.isEscalated : undefined)
      : false,
    ...(scope.isMasterAdmin ? {} : { regionId: scope.regionId }),
  };

  return (prisma.query as any).findMany({
    where: wherePayload,
    include: queryListInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function getAdminQuery(userId: string, queryId: string) {
  const query = await getQueryOrThrow(queryId);
  const scope = await assertAdminCanAccessQuery(userId, query.regionId);
  if (!scope.isMasterAdmin && query.isEscalated) {
    throw new ApiError(403, "You do not have permission to access this query");
  }
  return query;
}

export async function assignQuery(input: {
  userId: string;
  queryId: string;
  data: AssignQueryInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getQueryOrThrow(input.queryId);
  const scope = await assertAdminCanAccessQuery(input.userId, query.regionId);
  if (!scope.isMasterAdmin && query.isEscalated) {
    throw new ApiError(403, "You do not have permission to access this query");
  }
  assertQueryWritable(query.status);

  const assignee = await prisma.user.findFirst({
    where: {
      id: input.data.assignedToUserId,
      deletedAt: null,
      accountStatus: "active",
      roles: { has: RoleCode.mentor },
      volunteerProfile: {
        is: {
          deletedAt: null,
          volunteerStatus: VolunteerStatus.approved
        }
      }
    },
    select: { id: true, email: true }
  });

  if (!assignee) {
    throw new ApiError(400, "Assigned user must be an approved mentor");
  }

  const updatedQuery = await (prisma.query as any).update({
    where: { id: query.id },
    data: {
      assignedToUserId: assignee.id,
      assignedByUserId: input.userId,
      status: QueryStatus.assigned,
      isEscalated: false
    },
    include: queryInclude
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_assigned",
    entityType: "query",
    entityId: query.id,
    metadata: { assignedToUserId: assignee.id },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  notifyAssignee(assignee.email, query.title);
  appEmitter.emit(AppEvents.QUERY_ASSIGNED, {
    assigneeUserId: assignee.id,
    queryId: query.id,
    title: query.title
  });

  return updatedQuery;
}

export async function addAdminMessage(input: {
  userId: string;
  queryId: string;
  data: AddQueryMessageInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getAdminQuery(input.userId, input.queryId);
  assertQueryWritable(query.status);

  const message = await prisma.queryMessage.create({
    data: {
      queryId: query.id,
      senderUserId: input.userId,
      message: input.data.message,
      deletedAt: null
    },
    include: { sender: { select: { id: true, fullName: true, email: true, roles: true } } }
  });

  await prisma.query.update({ where: { id: query.id }, data: { updatedAt: new Date() } });
  notifyStudent(query.student.email, query.title);

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_message_added",
    entityType: "query",
    entityId: query.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  appEmitter.emit(AppEvents.QUERY_REPLIED, {
    targetUserId: query.studentUserId,
    queryId: query.id,
    title: query.title
  });

  return message;
}

export async function resolveAdminQuery(input: {
  userId: string;
  queryId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getAdminQuery(input.userId, input.queryId);

  if (query.status === QueryStatus.resolved) {
    return query;
  }

  const updatedQuery = await (prisma.query as any).update({
    where: { id: query.id },
    data: { status: QueryStatus.resolved, resolvedAt: new Date(), isEscalated: false },
    include: queryInclude
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_resolved",
    entityType: "query",
    entityId: query.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  notifyStudent(query.student.email, query.title);

  return updatedQuery;
}

export async function reopenAdminQuery(input: {
  userId: string;
  queryId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getAdminQuery(input.userId, input.queryId);

  if (query.status !== QueryStatus.resolved) {
    return query;
  }

  // Reopen to "assigned" if a mentor is still assigned, otherwise back to the open pool.
  const nextStatus = query.assignedToUserId ? QueryStatus.assigned : QueryStatus.open;

  const updatedQuery = await (prisma.query as any).update({
    where: { id: query.id },
    data: { status: nextStatus, resolvedAt: null },
    include: queryInclude
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_reopened",
    entityType: "query",
    entityId: query.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return updatedQuery;
}

/**
 * Regional Admin escalates a query to Master Admin.
 * Posts an escalation remark in the thread and notifies all master admins.
 */
export async function escalateAdminQuery(input: {
  userId: string;
  queryId: string;
  data: EscalateQueryInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getAdminQuery(input.userId, input.queryId);
  assertQueryWritable(query.status);

  const escalationMessage = `[ESCALATED TO ADMIN] ${input.data.remark}`;

  await prisma.$transaction(async (tx) => {
    await tx.queryMessage.create({
      data: {
        queryId: query.id,
        senderUserId: input.userId,
        message: escalationMessage,
        deletedAt: null
      }
    });

    // Reset to open so master admin can pick it up
    await (tx.query as any).update({
      where: { id: query.id },
      data: { 
        assignedToUserId: null,
        assignedByUserId: null,
        acceptedAt: null,
        isEscalated: true,
        status: QueryStatus.open, 
        updatedAt: new Date() 
      }
    });
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_escalated_to_admin",
    entityType: "query",
    entityId: query.id,
    metadata: { remark: input.data.remark },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  void notifyMasterAdmins(
    `Escalated query: ${query.title}`,
    `A Regional Admin has escalated a query to master admin level.<br/><br/><strong>Query:</strong> ${query.title}<br/><strong>Remark:</strong> ${input.data.remark}`,
    query.id
  ).catch((err) => {
    console.error(
      `Master admin escalation notification failed: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  });

  appEmitter.emit(AppEvents.QUERY_ESCALATED, {
    queryId: query.id,
    title: query.title,
    escalatedTo: "master_admin",
    remark: input.data.remark,
  });

  return getQueryOrThrow(query.id);
}

// ---------------------------------------------------------------------------
// Mentor actions
// ---------------------------------------------------------------------------

export async function listMentorQueries(userId: string, query?: ListQueriesQuery) {
  return prisma.query.findMany({
    where: {
      assignedToUserId: userId,
      deletedAt: null,
      ...(query?.universityId ? { offer: { universityId: query.universityId } } : {}),
      ...(query?.title ? { title: { contains: query.title, mode: "insensitive" } } : {})
    },
    include: queryListInclude,
    orderBy: { updatedAt: "desc" }
  });
}

export async function getMentorQuery(userId: string, queryId: string) {
  const query = await prisma.query.findFirst({
    where: { id: queryId, assignedToUserId: userId, deletedAt: null },
    include: queryInclude
  });

  if (!query) {
    throw new ApiError(404, "Query not found");
  }

  return query;
}

export async function acceptMentorQuery(input: {
  userId: string;
  queryId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getMentorQuery(input.userId, input.queryId);
  assertQueryWritable(query.status);

  if (query.acceptedAt) {
    return query;
  }

  const updatedQuery = await prisma.query.update({
    where: { id: query.id },
    data: { acceptedAt: new Date() },
    include: queryInclude
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_accepted",
    entityType: "query",
    entityId: query.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  notifyStudent(query.student.email, query.title);

  return updatedQuery;
}

export async function addMentorMessage(input: {
  userId: string;
  queryId: string;
  data: AddQueryMessageInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getMentorQuery(input.userId, input.queryId);
  assertQueryWritable(query.status);

  const message = await prisma.queryMessage.create({
    data: {
      queryId: query.id,
      senderUserId: input.userId,
      message: input.data.message,
      deletedAt: null
    },
    include: { sender: { select: { id: true, fullName: true, email: true, roles: true } } }
  });

  await prisma.query.update({ where: { id: query.id }, data: { updatedAt: new Date() } });
  notifyStudent(query.student.email, query.title);

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_message_added",
    entityType: "query",
    entityId: query.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return message;
}

export async function resolveMentorQuery(input: {
  userId: string;
  queryId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getMentorQuery(input.userId, input.queryId);

  if (query.status === QueryStatus.resolved) {
    return query;
  }

  const updatedQuery = await (prisma.query as any).update({
    where: { id: query.id },
    data: { status: QueryStatus.resolved, resolvedAt: new Date(), isEscalated: false },
    include: queryInclude
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_resolved",
    entityType: "query",
    entityId: query.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  notifyStudent(query.student.email, query.title);

  return updatedQuery;
}

/**
 * Mentor escalates a query to their Regional Admin.
 * Releases the mentor assignment so it reappears in the admin queue.
 */
export async function escalateMentorQuery(input: {
  userId: string;
  queryId: string;
  data: EscalateQueryInput;
  ipAddress?: string;
  userAgent?: string;
}) {
  const query = await getMentorQuery(input.userId, input.queryId);
  assertQueryWritable(query.status);

  const escalationMessage = `[ESCALATED TO REGIONAL ADMIN] ${input.data.remark}`;

  await prisma.$transaction(async (tx) => {
    await tx.queryMessage.create({
      data: {
        queryId: query.id,
        senderUserId: input.userId,
        message: escalationMessage,
        deletedAt: null
      }
    });

    // Release mentor assignment — query returns to admin open queue
    await (tx.query as any).update({
      where: { id: query.id },
      data: {
        assignedToUserId: null,
        assignedByUserId: null,
        acceptedAt: null,
        status: QueryStatus.open,
        isEscalated: true,
        updatedAt: new Date()
      }
    });
  });

  await recordAuditLog({
    actorUserId: input.userId,
    action: "query_escalated_to_regional_admin",
    entityType: "query",
    entityId: query.id,
    metadata: { remark: input.data.remark },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  let targetRegionId = query.regionId;
  if (!targetRegionId) {
    const mentorProfile = await prisma.volunteerProfile.findUnique({
      where: { userId: input.userId },
      select: { preferredRegionId: true }
    });
    targetRegionId = mentorProfile?.preferredRegionId || null;
  }

  let notifiedCount = 0;
  if (targetRegionId) {
    try {
      notifiedCount = await notifyRegionalAdmins(
        query.id,
        targetRegionId,
        `Escalated query: ${query.title}`,
        `A mentor has escalated a student query to your attention.<br/><br/><strong>Query:</strong> ${query.title}<br/><strong>Remark:</strong> ${input.data.remark}`
      );
    } catch (err) {
      console.error(
        `Regional admin escalation notification failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  if (notifiedCount === 0) {
    void notifyMasterAdmins(
      `[Escalated query fallback] ${query.title}`,
      `A mentor has escalated a student query, but no active Regional Admin is assigned. Escalating to Master Admins.<br/><br/><strong>Query:</strong> ${query.title}<br/><strong>Remark:</strong> ${input.data.remark}`,
      query.id
    ).catch((err) => {
      console.error(
        `Master admin fallback escalation notification failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    });
  }

  appEmitter.emit(AppEvents.QUERY_ESCALATED, {
    queryId: query.id,
    title: query.title,
    escalatedTo: targetRegionId ? "regional_admin" : "master_admin",
    regionId: targetRegionId,
    remark: input.data.remark,
  });

  return getQueryOrThrow(query.id);
}
