import type { Request } from "express";

export type Actor = { actorUserId: string; ipAddress?: string; userAgent?: string };

/** Who is performing an admin mutation, in the shape the services pass to the audit log. */
export const actorFrom = (req: Request): Actor => ({
  actorUserId: req.authUser!.id,
  ipAddress: req.ip,
  userAgent: req.get("user-agent")
});
