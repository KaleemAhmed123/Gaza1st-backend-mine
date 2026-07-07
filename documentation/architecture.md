# Architecture

> Definitive quick-reference lives in `CLAUDE.md`. This doc expands the backend architecture.

## Stack (verified against code — 2026)

- **Backend:** Node.js 22 + Express 4 + TypeScript.
- **Database: MongoDB**, accessed through Prisma (`provider = "mongodb"`).
  (Historical note: an earlier plan targeted PostgreSQL/Supabase — that was replaced by MongoDB.
  `prisma/migrations.postgres/` is dead history.)
- **ORM:** Prisma 6.
- **Auth:** JWT access token in an httpOnly cookie (`accessToken`); bcrypt password hashing.
- **Realtime:** Socket.IO (chat + live notifications).
- **File storage:** Cloudflare R2 (via AWS S3 SDK + presigned URLs); local-disk fallback when R2 env is unset.
- **Email:** Nodemailer over SMTP (Brevo default).
- **Jobs:** node-cron (chat retention, CSV export cleanup).
- **Observability:** Sentry (enabled when `SENTRY_DSN` set).
- **Frontend:** separate repo — Next.js 16 + React 19 (`C:\Users\hp\Desktop\gaza40plus`).

## Backend structure

- `src/app.ts` — middleware chain + route mounting (the API map).
- `src/server.ts` — starts HTTP server, initializes Socket.IO, starts cron, recovers stuck CSV jobs, registers notification listeners.
- `src/config/env.ts` — zod-validated environment config (`env`).
- `src/db/prisma.ts` — Prisma client singleton.
- `src/middleware/` — auth, CSRF, rate-limit, error handling.
- `src/modules/<feature>/` — feature modules (`routes` → `controller` → `service` → `validation`).
- `src/shared/` — cross-module utilities (http/ApiError, auth-scope, audit, storage, events, email, csv).

## Modules

`auth`, `health`, `config`, `documents`, `student-profile`, `offers` (student/mentor/admin + university),
`queries`, `announcements`, `dashboard`, `notifications`, `chat`, `csv-generator`, and
`admin/{student-profiles, students, volunteers, regional-admins, offers, audit-logs}`.

See `CLAUDE.md` §4 for the full mount table.

## API coverage

- Auth: login, logout, `me`, refresh, password reset, email verification.
- Student profile: draft/update/submit; admin/reviewer profile review.
- Documents: private upload/download via protected, audit-logged routes with presigned URLs.
- Offers: student CRUD + submit, admin/regional review, approved-offer revisions, financial summaries.
- Config/master-data: regions, universities, dropdown (`ConfigOption`) values, `AppConfig` financial rules.
- Queries (ticketing): student/admin/regional/mentor flows, assignment, escalation, messaging.
- Announcements: global + regional.
- Admin grids: students, volunteers, offers — filtering, summaries, CSV export (background jobs).
- Notifications: in-app + realtime (event-driven).
- Chat: conversations REST + Socket.IO realtime.
- Dashboards: role-specific (student/mentor/admin, regional-scoped).
- Audit logs: master-admin browsing.

## Realtime & background systems

See `documentation/async-and-realtime.md`. In short: an in-process `EventEmitter` decouples domain
actions from notification creation; Socket.IO pushes live updates; CSV exports run as `CsvJob`
background jobs to R2; cron handles chat retention and CSV cleanup.

## Security posture

- **CSRF is enforced** globally (`requireCsrfHeader`): mutating requests need `x-requested-with: XMLHttpRequest`.
- RBAC + regional scoping enforced server-side in services (JWT roles are hints; sensitive actions use DB-backed checks).
- Private documents only; never expose public object URLs; downloads are audited.
- Rate limiting on `/api`, stricter on `/api/auth`, separate upload limit on `/api/documents`.

## Principles

- Feature-focused modules; business rules in services; thin controllers; validate at the boundary.
- Enforce sensitive authorization on the server. Don't over-engineer; stay close to `vision/requirements.md`.

## Known limits

- Local uploads are dev/demo only (R2 in production).
- Account lockout & email-change verification deferred.
- Distributed/Redis rate limiting deferred (in-memory today).
