import { RoleCode } from "@prisma/client";
import { Router } from "express";
import { requireActiveMentor, requireAuth, requireRole } from "../../middleware/auth.middleware";
import {
  addAdminQueryMessageHandler,
  assignQueryHandler,
  escalateAdminQueryHandler,
  getAdminQueryHandler,
  listAdminQueriesHandler,
  resolveAdminQueryHandler,
  reopenAdminQueryHandler
} from "./admin-query.controller";
import {
  acceptMentorQueryHandler,
  addMentorQueryMessageHandler,
  escalateMentorQueryHandler,
  getMentorQueryHandler,
  listMentorQueriesHandler,
  resolveMentorQueryHandler
} from "./mentor-query.controller";
import {
  addStudentQueryMessageHandler,
  createQueryHandler,
  getMyQueryHandler,
  listMyQueriesHandler
} from "./student-query.controller";

export const studentQueryRouter = Router();
export const adminQueryRouter = Router();
export const mentorQueryRouter = Router();

studentQueryRouter.use(requireAuth, requireRole([RoleCode.student]));
studentQueryRouter.post("/", createQueryHandler);
studentQueryRouter.get("/my", listMyQueriesHandler);
studentQueryRouter.get("/:id", getMyQueryHandler);
studentQueryRouter.post("/:id/messages", addStudentQueryMessageHandler);

adminQueryRouter.use(requireAuth, requireRole([RoleCode.master_admin, RoleCode.regional_admin]));
adminQueryRouter.get("/", listAdminQueriesHandler);
adminQueryRouter.get("/:id", getAdminQueryHandler);
adminQueryRouter.patch("/:id/assign", assignQueryHandler);
adminQueryRouter.post("/:id/messages", addAdminQueryMessageHandler);
adminQueryRouter.patch("/:id/resolve", resolveAdminQueryHandler);
adminQueryRouter.patch("/:id/reopen", reopenAdminQueryHandler);
adminQueryRouter.patch("/:id/escalate", escalateAdminQueryHandler);

mentorQueryRouter.use(requireAuth, requireActiveMentor);
mentorQueryRouter.get("/", listMentorQueriesHandler);
mentorQueryRouter.get("/:id", getMentorQueryHandler);
mentorQueryRouter.patch("/:id/accept", acceptMentorQueryHandler);
mentorQueryRouter.post("/:id/messages", addMentorQueryMessageHandler);
mentorQueryRouter.patch("/:id/resolve", resolveMentorQueryHandler);
mentorQueryRouter.patch("/:id/escalate", escalateMentorQueryHandler);

