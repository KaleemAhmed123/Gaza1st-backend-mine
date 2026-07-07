import { appEmitter, AppEvents } from "../../shared/events";
import { createNotification } from "./notification.service";
import { emitToUser } from "../chat/chat.socket";
import { prisma } from "../../db/prisma";

/**
 * A helper to safely dispatch a notification without throwing errors.
 */
async function safelyDispatchNotification(input: {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
}) {
  try {
    const notification = await createNotification(input);
    if (notification) {
      emitToUser(input.userId, "notification_new_message", notification);
    }
  } catch (error) {
    console.error("[Notification Listener] Failed to dispatch notification:", error);
  }
}

// ---------------------------------------------------------------------------
// Student Profile Events
// ---------------------------------------------------------------------------

appEmitter.on(AppEvents.PROFILE_SUBMITTED, async (payload: { studentUserId: string }) => {
  safelyDispatchNotification({
    userId: payload.studentUserId,
    type: "profile_submitted",
    title: "Profile Submitted",
    body: "Your profile has been successfully submitted and is now under review.",
    link: "/student/profile",
  });

  // Notify Master Admins and Reviewers
  try {
    const student = await prisma.user.findUnique({ where: { id: payload.studentUserId }, select: { fullName: true }});
    const reviewersAndAdmins = await prisma.user.findMany({
      where: {
        roles: { hasSome: ["master_admin", "reviewer"] },
        deletedAt: null,
        accountStatus: "active"
      },
      select: { id: true, roles: true }
    });
    
    reviewersAndAdmins.forEach(admin => {
      const isReviewer = admin.roles.includes("reviewer");
      safelyDispatchNotification({
        userId: admin.id,
        type: "admin_profile_submitted",
        title: "New Profile Submitted",
        body: `${student?.fullName || 'A student'} has submitted a new profile for review.`,
        link: isReviewer ? "/reviewer/student-reviews" : "/admin/student-reviews"
      });
    });
  } catch(e) {
    console.error("[Notification Listener] Failed to notify admins for profile submission:", e);
  }
});

appEmitter.on(AppEvents.PROFILE_APPROVED, (payload: { studentUserId: string }) => {
  safelyDispatchNotification({
    userId: payload.studentUserId,
    type: "profile_approved",
    title: "Profile Approved!",
    body: "Congratulations! Your profile has been approved.",
    link: "/student/profile",
  });
});

appEmitter.on(AppEvents.PROFILE_REJECTED, (payload: { studentUserId: string, reason?: string }) => {
  safelyDispatchNotification({
    userId: payload.studentUserId,
    type: "profile_rejected",
    title: "Profile Update Required",
    body: "Your profile requires some updates or has been rejected. Please review.",
    link: "/student/profile",
  });
});

appEmitter.on(AppEvents.PROFILE_CHANGES_REQUESTED, (payload: { studentUserId: string }) => {
  safelyDispatchNotification({
    userId: payload.studentUserId,
    type: "profile_changes_requested",
    title: "Changes Requested",
    body: "Action required: We've requested some changes to your profile.",
    link: "/student/profile",
  });
});

// ---------------------------------------------------------------------------
// Offer Events
// ---------------------------------------------------------------------------

appEmitter.on(AppEvents.OFFER_SUBMITTED, async (payload: { studentUserId: string, studentName: string, offerId: string, regionId: string, submissionKind?: "new" | "requested_edits" }) => {
  // We notify admins (Master & Regional)
  const isRequestedEdits = payload.submissionKind === "requested_edits";
  const title = isRequestedEdits ? "Offer Resubmitted" : "New Offer Submitted";
  const body = isRequestedEdits
    ? `${payload.studentName} has submitted an offer with requested edits for review.`
    : `${payload.studentName} has submitted a new offer for review.`;
  try {
    const admins = await prisma.user.findMany({
      where: {
        deletedAt: null,
        accountStatus: "active",
        OR: [
          { roles: { has: "master_admin" } },
          {
            roles: { has: "regional_admin" },
            regionalAdminProfile: { regionId: payload.regionId, status: "active", deletedAt: null }
          }
        ]
      },
      select: { id: true, roles: true }
    });

    admins.forEach(admin => {
      const isRegionalAdmin = admin.roles.includes("regional_admin") && !admin.roles.includes("master_admin");
      const link = isRegionalAdmin
        ? `/regional-admin/offer-reviews?offerId=${payload.offerId}`
        : `/admin/offers?offerId=${payload.offerId}`;

      safelyDispatchNotification({
        userId: admin.id,
        type: "admin_offer_submitted",
        title,
        body,
        link: link
      });
    });
  } catch (e) {
    console.error("[Notification Listener] Failed to notify admins for offer submission:", e);
  }
});

appEmitter.on(AppEvents.OFFER_STATUS_UPDATED, (payload: { studentUserId: string, status: string, offerId: string }) => {
  safelyDispatchNotification({
    userId: payload.studentUserId,
    type: "offer_status_updated",
    title: "Offer Status Updated",
    body: `Your offer status has been updated to: ${payload.status}.`,
    link: `/student/offers?offerId=${payload.offerId}`,
  });
});

appEmitter.on(AppEvents.OFFER_MENTOR_ASSIGNED, (payload: { mentorUserId: string, offerId: string, studentName: string }) => {
  safelyDispatchNotification({
    userId: payload.mentorUserId,
    type: "mentor_assigned",
    title: "New Student Assigned",
    body: `You have been assigned to mentor ${payload.studentName} for their offer.`,
    link: `/mentor/offers?offerId=${payload.offerId}`,
  });
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

appEmitter.on(AppEvents.ANNOUNCEMENT_CREATED, async (payload: { title: string, targetUserIds: string[] }) => {
  // To avoid spamming thousands of socket emits simultaneously, 
  // you might want a specialized broadcast logic, but for simplicity we iterate.
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: payload.targetUserIds } },
      select: { id: true, roles: true }
    });

    users.forEach(user => {
      let link = "/student/announcements";
      if (user.roles.includes("master_admin")) {
        link = "/admin/announcements";
      } else if (user.roles.includes("regional_admin")) {
        link = "/regional-admin/announcements";
      } else if (user.roles.includes("mentor")) {
        link = "/mentor/announcements";
      }

      safelyDispatchNotification({
        userId: user.id,
        type: "new_announcement",
        title: "New Announcement",
        body: payload.title,
        link: link
      });
    });
  } catch (e) {
    console.error("[Notification Listener] Failed to notify users for announcements:", e);
  }
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

appEmitter.on(AppEvents.QUERY_REPLIED, async (payload: { targetUserId: string, queryId: string, title: string }) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.targetUserId },
      select: { roles: true }
    });

    let link = `/student/queries?queryId=${payload.queryId}`;
    if (user) {
      if (user.roles.includes("master_admin")) {
        link = `/admin/queries?queryId=${payload.queryId}`;
      } else if (user.roles.includes("regional_admin")) {
        link = `/regional-admin/queries?queryId=${payload.queryId}`;
      } else if (user.roles.includes("mentor")) {
        link = `/mentor/queries?queryId=${payload.queryId}`;
      }
    }

    safelyDispatchNotification({
      userId: payload.targetUserId,
      type: "query_replied",
      title: "New Reply to your Query",
      body: `You have a new reply regarding: ${payload.title}`,
      link: link,
    });
  } catch (e) {
    console.error("[Notification Listener] Failed to notify for query reply:", e);
  }
});

appEmitter.on(AppEvents.QUERY_ASSIGNED, async (payload: { assigneeUserId: string, queryId: string, title: string }) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.assigneeUserId },
      select: { roles: true }
    });

    let link = `/mentor/queries?queryId=${payload.queryId}`;
    if (user) {
      if (user.roles.includes("master_admin")) {
        link = `/admin/queries?queryId=${payload.queryId}`;
      } else if (user.roles.includes("regional_admin")) {
        link = `/regional-admin/queries?queryId=${payload.queryId}`;
      }
    }

    safelyDispatchNotification({
      userId: payload.assigneeUserId,
      type: "query_assigned",
      title: "Query Assigned to You",
      body: `You have been assigned to handle a query: ${payload.title}`,
      link: link, 
    });
  } catch (e) {
    console.error("[Notification Listener] Failed to notify for query assignment:", e);
  }
});

// ---------------------------------------------------------------------------
// Regional Admin
// ---------------------------------------------------------------------------
// Note: Regional Admins are notified about new offers within the OFFER_SUBMITTED listener above.

appEmitter.on(AppEvents.QUERY_ESCALATED, async (payload: { 
  queryId: string; 
  title: string; 
  escalatedTo: "master_admin" | "regional_admin"; 
  regionId?: string | null; 
  remark: string; 
}) => {
  try {
    if (payload.escalatedTo === "master_admin") {
      const masterAdmins = await prisma.user.findMany({
        where: {
          deletedAt: null,
          accountStatus: "active",
          roles: { has: "master_admin" }
        },
        select: { id: true }
      });

      masterAdmins.forEach(admin => {
        safelyDispatchNotification({
          userId: admin.id,
          type: "query_escalated",
          title: "Query Escalated to Admin",
          body: `A query has been escalated to Admin: ${payload.title}`,
          link: `/admin/queries?queryId=${payload.queryId}`
        });
      });
    } else if (payload.escalatedTo === "regional_admin" && payload.regionId) {
      const regionalAdmins = await prisma.user.findMany({
        where: {
          deletedAt: null,
          accountStatus: "active",
          roles: { has: "regional_admin" },
          regionalAdminProfile: {
            regionId: payload.regionId,
            status: "active",
            deletedAt: null
          }
        },
        select: { id: true }
      });

      regionalAdmins.forEach(admin => {
        safelyDispatchNotification({
          userId: admin.id,
          type: "query_escalated",
          title: "Query Escalated to Regional Admin",
          body: `A query has been escalated to Regional Admin: ${payload.title}`,
          link: `/regional-admin/queries?queryId=${payload.queryId}`
        });
      });
    }
  } catch (e) {
    console.error("[Notification Listener] Failed to notify for query escalation:", e);
  }
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

appEmitter.on(AppEvents.CHAT_GROUP_ADDED, (payload: { userId: string, groupName: string }) => {
  safelyDispatchNotification({
    userId: payload.userId,
    type: "chat_group_added",
    title: "Added to Group",
    body: `You have been added to the chat group: ${payload.groupName}`,
    link: "/chat",
  });
});

console.log("[Events] Notification listeners registered successfully.");
