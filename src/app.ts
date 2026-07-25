import compression from "compression";
import express from "express";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env } from "./config/env";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}

import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { requireCsrfHeader } from "./middleware/csrf.middleware";
import { requireVerified } from "./middleware/auth.middleware";
import { apiRateLimiter, authRateLimiter, uploadRateLimiter } from "./middleware/rate-limit.middleware";
import { adminAuditLogRouter } from "./modules/admin/audit-logs/admin-audit-log.routes";
import { adminRegionalAdminRouter } from "./modules/admin/regional-admins/admin-regional-admin.routes";
import { adminStudentProfileRouter } from "./modules/admin/student-profiles/admin-student-profile.routes";
import { adminStudentGridRouter } from "./modules/admin/students/admin-student-grid.routes";
import { adminVolunteerGridRouter } from "./modules/admin/volunteers/admin-volunteer-grid.routes";
import { adminAnnouncementRouter, announcementRouter } from "./modules/announcements/announcement.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { adminConfigRouter, configRouter } from "./modules/config/config.routes";
import {
  adminDashboardRouter,
  mentorDashboardRouter,
  studentDashboardRouter
} from "./modules/dashboard/dashboard.routes";
import { documentRouter } from "./modules/documents/document.routes";
import { healthRouter } from "./modules/health/health.routes";
import { notificationRouter } from "./modules/notifications/notification.routes";
import { chatRouter } from "./modules/chat/chat.routes";
import { adminOfferRouter } from "./modules/offers/admin-offer.routes";
import { studentOfferRouter } from "./modules/offers/student-offer.routes";
import { mentorOfferRouter } from "./modules/offers/mentor-offer.routes";
import { mentorStudentRouter } from "./modules/offers/mentor-student.routes";
import { adminQueryRouter, mentorQueryRouter, studentQueryRouter } from "./modules/queries/query.routes";
import { studentProfileRouter } from "./modules/student-profile/student-profile.routes";
import { universityRouter } from "./modules/offers/university.routes";
import { csvGeneratorRouter } from "./modules/csv-generator/csv-generator.routes";

export const app = express();

if (env.TRUST_PROXY || env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(compression());
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// Enforce CSRF protection
app.use(requireCsrfHeader);

app.use("/health", healthRouter);
app.use("/api/auth", authRateLimiter, authRouter);
// Self-signup users (students/mentors) must verify their email before using any API below.
// Mounted after /api/auth so /me, /refresh, /verify-email and /send-verification-email stay reachable.
app.use("/api", requireVerified);
app.use("/api/documents", uploadRateLimiter, documentRouter);
app.use("/api", apiRateLimiter);
app.use("/api/config", configRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/chat", chatRouter);
app.use("/api/announcements", announcementRouter);
app.use("/api/student/dashboard", studentDashboardRouter);
app.use("/api/student/profile", studentProfileRouter);
app.use("/api/student/offers", studentOfferRouter);
app.use("/api/queries", studentQueryRouter);
app.use("/api/admin/dashboard", adminDashboardRouter);
app.use("/api/admin/student-profiles", adminStudentProfileRouter);
app.use("/api/admin/students", adminStudentGridRouter);
app.use("/api/admin/volunteers", adminVolunteerGridRouter);
app.use("/api/admin/regional-admins", adminRegionalAdminRouter);
app.use("/api/admin/offers", adminOfferRouter);
app.use("/api/admin/config", adminConfigRouter);
app.use("/api/admin/queries", adminQueryRouter);
app.use("/api/admin/announcements", adminAnnouncementRouter);
app.use("/api/admin/audit-logs", adminAuditLogRouter);

app.use("/api/mentor/dashboard", mentorDashboardRouter);
app.use("/api/mentor/offers", mentorOfferRouter);
app.use("/api/mentor/students", mentorStudentRouter);
app.use("/api/mentor/queries", mentorQueryRouter);
app.use("/api/universities", universityRouter);
app.use("/api/csv-generator", csvGeneratorRouter);

app.use("*", notFoundHandler);
app.use(errorHandler);
