import { Router } from "express";
import { requireAuth, requireCommunityGuidelines } from "../../middleware/auth.middleware";
import {
  getConversationsHandler,
  getDirectChatHandler,
  createGroupChatHandler,
  addGroupMemberHandler,
  getMessagesHandler,
  uploadAttachmentHandler,
  getAttachmentUrlHandler,
  searchUsersHandler,
  deleteConversationHandler,
  deleteMessageHandler,
  removeGroupMemberHandler,
  editMessageHandler,
  getChatShortcutsHandler
} from "./chat.controller";
import { uploadChatAttachment } from "./chat.upload";

export const chatRouter = Router();

chatRouter.use(requireAuth, requireCommunityGuidelines);

chatRouter.get("/conversations", getConversationsHandler);
chatRouter.get("/shortcuts", getChatShortcutsHandler);
chatRouter.post("/conversations/direct", getDirectChatHandler);
chatRouter.post("/conversations/group", createGroupChatHandler);
chatRouter.post("/conversations/:id/members", addGroupMemberHandler);
chatRouter.delete("/conversations/:id/members/:userId", removeGroupMemberHandler);
chatRouter.get("/conversations/:id/messages", getMessagesHandler);
chatRouter.post("/conversations/:id/attachments", uploadChatAttachment.single("file"), uploadAttachmentHandler);
chatRouter.get("/attachments/:conversationId/:fileId", getAttachmentUrlHandler);
chatRouter.get("/users/search", searchUsersHandler);
chatRouter.delete("/conversations/:id", deleteConversationHandler);
chatRouter.delete("/conversations/:id/messages/:messageId", deleteMessageHandler);
chatRouter.put("/conversations/:id/messages/:messageId", editMessageHandler);
