import { EventEmitter } from "events";

class AppEventEmitter extends EventEmitter { }

export const appEmitter = new AppEventEmitter();

// Centralized list of event names to avoid typos
export const AppEvents = {
  // Student Profile
  PROFILE_SUBMITTED: "profile.submitted",
  PROFILE_APPROVED: "profile.approved",
  PROFILE_REJECTED: "profile.rejected",
  PROFILE_CHANGES_REQUESTED: "profile.changes_requested",

  // Offers
  OFFER_SUBMITTED: "offer.submitted",
  OFFER_STATUS_UPDATED: "offer.status_updated",
  OFFER_MENTOR_ASSIGNED: "offer.mentor_assigned",

  // Announcements
  ANNOUNCEMENT_CREATED: "announcement.created",

  // Scholarships
  SCHOLARSHIP_CREATED: "scholarship.created",

  // Queries
  QUERY_REPLIED: "query.replied",
  QUERY_ASSIGNED: "query.assigned",
  QUERY_ESCALATED: "query.escalated",

  // Chat
  CHAT_GROUP_ADDED: "chat.group_added",
  CHAT_GROUP_REMOVED: "chat.group_removed"
};
