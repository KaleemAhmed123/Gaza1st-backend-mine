import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { verifyAccessToken } from "../auth/token";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import crypto from "crypto";

export let io: Server;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      let token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(" ")[1];
      
      // Try to parse from cookie if not provided
      if (!token && socket.handshake.headers.cookie) {
        const cookies = socket.handshake.headers.cookie.split(";").reduce((acc, cookie) => {
          const [key, value] = cookie.trim().split("=");
          acc[key] = value;
          return acc;
        }, {} as Record<string, string>);
        token = cookies.accessToken;
      }

      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const decoded = verifyAccessToken(token);
      (socket as any).user = decoded;
      next();
    } catch (err) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket as any).user;


    // Join personal room for direct notifications
    socket.join(`user_${user.id}`);

    socket.on("join_conversations", async () => {
      try {
        const memberships = await prisma.conversationMember.findMany({
          where: { userId: user.id },
          select: { conversationId: true },
        });
        
        memberships.forEach(m => {
          socket.join(`conv_${m.conversationId}`);
        });


      } catch (err) {
        console.error("[Socket] join_conversations error:", err);
      }
    });

    socket.on("send_message", async (data: { conversationId: string; content?: string; clientMessageId?: string; attachmentUrl?: string; attachmentName?: string; attachmentSize?: number; attachmentType?: string }) => {
      try {
        if (typeof data.conversationId !== "string") {
          socket.emit("error", { message: "Invalid conversation ID" });
          return;
        }

        // Validate access
        let hasAccess = false;
        if (user.roles.includes("master_admin")) {
           hasAccess = true;
        } else {
           const membership = await prisma.conversationMember.findUnique({
             where: { conversationId_userId: { conversationId: data.conversationId, userId: user.id } }
           });
           if (membership) hasAccess = true;
        }

        if (!hasAccess) {
          socket.emit("error", { message: "Not authorized to send message in this conversation" });
          return;
        }

        // Save message to DB
        const message = await prisma.chatMessage.create({
          data: {
            conversationId: data.conversationId,
            senderUserId: user.id,
            content: data.content,
            clientMessageId: data.clientMessageId || crypto.randomUUID(),
            attachmentUrl: data.attachmentUrl,
            attachmentName: data.attachmentName,
            attachmentSize: data.attachmentSize,
            attachmentType: data.attachmentType
          },
          include: {
            sender: { select: { id: true, fullName: true, roles: true } }
          }
        });

        // Update conversation lastMessageAt
        await prisma.conversation.update({
          where: { id: data.conversationId },
          data: { lastMessageAt: new Date() }
        });

        // Broadcast to everyone in the conversation room
        io.to(`conv_${data.conversationId}`).emit("new_message", message);
        
        // Also send a specific event to members for unread badges/notifications
        // (if they aren't actively in the room on frontend, they can listen to user_ notifications)
        const members = await prisma.conversationMember.findMany({
          where: { conversationId: data.conversationId }
        });
        
        const notificationsToCreate: any[] = [];

        members.forEach(m => {
          if (m.userId !== user.id) {
             io.to(`user_${m.userId}`).emit("notification_new_message", message);
             
             notificationsToCreate.push({
               userId: m.userId,
               type: "chat_message",
               title: "New Message",
               body: `New message from ${message.sender?.fullName || "someone"}`,
               link: `/chat?conversationId=${data.conversationId}`
             });
          }
        });

        if (notificationsToCreate.length > 0) {
          prisma.notification.createMany({
            data: notificationsToCreate
          }).catch(e => console.error("Failed to create bulk chat notifications", e));
        }

      } catch (err) {
        console.error("[Socket] send_message error:", err);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("typing_start", (data: { conversationId: string, fullName?: string }) => {
      socket.to(`conv_${data.conversationId}`).emit("user_typing", {
        conversationId: data.conversationId,
        userId: user.id,
        fullName: data.fullName || user.fullName || "Someone",
        isTyping: true
      });
    });

    socket.on("typing_stop", (data: { conversationId: string, fullName?: string }) => {
      socket.to(`conv_${data.conversationId}`).emit("user_typing", {
        conversationId: data.conversationId,
        userId: user.id,
        fullName: data.fullName || user.fullName || "Someone",
        isTyping: false
      });
    });

    socket.on("mark_read", async (data: { conversationId: string }) => {
      try {
        const now = new Date();
        await prisma.conversationMember.update({
          where: { conversationId_userId: { conversationId: data.conversationId, userId: user.id } },
          data: { lastReadAt: now }
        });
        
        // Broadcast that this user read the chat up to this point
        io.to(`conv_${data.conversationId}`).emit("members_read_updated", {
          conversationId: data.conversationId,
          userId: user.id,
          lastReadAt: now
        });
      } catch (err) {
        console.error("[Socket] mark_read error:", err);
      }
    });

    socket.on("disconnect", () => {

    });
  });
}

// Helper for other parts of the app to emit events
export function emitToUser(userId: string, event: string, data: any) {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
}

export function emitToConversation(conversationId: string, event: string, data: any) {
  if (io) {
    io.to(`conv_${conversationId}`).emit(event, data);
  }
}
