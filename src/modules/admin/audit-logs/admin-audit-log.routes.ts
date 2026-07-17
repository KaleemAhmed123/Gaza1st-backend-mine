import { RoleCode } from "@prisma/client";
import { Router } from "express";
import { requireRole, requireAuth } from "../../../middleware/auth.middleware";
import { getAuditLogHandler, listAuditLogsHandler } from "./admin-audit-log.controller";

export const adminAuditLogRouter = Router();

adminAuditLogRouter.use(requireAuth, requireRole([RoleCode.master_admin]));
adminAuditLogRouter.get("/", listAuditLogsHandler);
adminAuditLogRouter.get("/:id", getAuditLogHandler);
