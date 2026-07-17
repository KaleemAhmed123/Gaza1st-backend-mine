import { RoleCode } from "@prisma/client";
import { Router } from "express";
import { requireRole, requireAuth } from "../../../middleware/auth.middleware";
import {
  getStudentProfileForAdminHandler,
  listStudentProfilesHandler,
  reviewStudentProfileHandler
} from "./admin-student-profile.controller";

export const adminStudentProfileRouter = Router();

adminStudentProfileRouter.use(
  requireAuth,
  requireRole([RoleCode.master_admin, RoleCode.reviewer])
);
adminStudentProfileRouter.get("/", listStudentProfilesHandler);
adminStudentProfileRouter.get("/:id", getStudentProfileForAdminHandler);
adminStudentProfileRouter.patch("/:id/review", reviewStudentProfileHandler);
