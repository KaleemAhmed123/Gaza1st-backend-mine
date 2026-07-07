# CLAUDE.md — Gaza40+ Backend

Authoritative entry point for AI agents working in this repository. Read this first, then load the
narrower doc/skill relevant to your task. When code and docs disagree, **code wins** — fix the doc.

---

## 1. What this is

Gaza40+ is a humanitarian platform that helps students in Gaza get their university offers and
scholarships processed, reviewed, and funded by a network of mentors and regional/master admins.

**This repository is the backend API only.** It is one half of a two-repo system:

| Repo | Path (local) | Stack | Role |
|------|--------------|-------|------|
| **Backend (this repo)** | `C:\Users\hp\Desktop\Gaza40-Student-Portal` | Express + Prisma + MongoDB | REST API, auth, files, realtime, jobs |
| **Frontend** | `C:\Users\hp\Desktop\gaza40plus` | Next.js 16 + React 19 | Web UI (all roles) |

The frontend talks to this API over `/api/*` and `/socket.io/*` (proxied by Next rewrites). Deployed
backend: `https://gaza40-student-portal.onrender.com`. See §12 for the cross-repo contract.

- **Product source of truth:** `vision/requirements.md` (MVP scope + behavior). `vision/problem_statement.md` is context only and must not expand scope.
- **Deeper docs:** `documentation/` (architecture, RBAC, DB, flows, async). **Skills:** `skills/` (architecture, RBAC).
- **Engineering rules:** `ENGINEERING.md` — read before writing code.

---

## 2. Tech stack (verified against code)

- **Runtime:** Node 22.x, TypeScript 5.8, ESM-style `tsx` in dev, `tsc` build to `dist/`.
- **Web:** Express 4, `helmet`, `cors` (credentials), `compression`, `cookie-parser`, `morgan`.
- **DB:** **MongoDB** via Prisma (`provider = "mongodb"`). NOT Postgres/Supabase — older docs saying otherwise are stale.
- **ORM:** Prisma 6 (`@prisma/client`). Client generated on `postinstall`.
- **Auth:** JWT (`jsonwebtoken`) in an **httpOnly cookie** named `accessToken`. Passwords hashed with `bcryptjs`.
- **Realtime:** Socket.IO 4 (chat + live notifications).
- **Files:** Cloudflare **R2** via the AWS S3 SDK (`@aws-sdk/client-s3` + presigner). Falls back to local disk when R2 env is unset.
- **Email:** `nodemailer` over SMTP (Brevo by default). Note: `.env.example` still mentions `RESEND_API_KEY`, but the code uses `SMTP_*`.
- **Jobs/schedule:** `node-cron` (chat retention, CSV cleanup).
- **Validation:** `zod` at controller boundaries.
- **Observability:** Sentry (`@sentry/node` + profiling), enabled only when `SENTRY_DSN` is set.
- **Package manager:** **pnpm** (`pnpm@10.18.0`).

---

## 3. Run / build / DB commands

```bash
pnpm install              # also runs prisma generate (postinstall)
pnpm dev                  # tsx watch src/server.ts  (dev server, port 4000)
pnpm build                # tsc -> dist/
pnpm start                # node dist/server.js
pnpm lint                 # tsc --noEmit (this is the "lint")

pnpm prisma:generate      # regenerate client after schema changes
pnpm prisma:push          # push schema to MongoDB (no SQL migrations — see §5)
pnpm prisma:studio        # Prisma Studio
pnpm prisma:seed          # base seed
pnpm prisma:seed:admin    # seed a master admin
pnpm prisma:seed:regional-admin
```

There is no automated test runner configured. "Lint" == typecheck. Always run `pnpm lint` after code changes.

---

## 4. Architecture & folder structure

Feature-modular Express app. Each module owns its full vertical slice.

```
src/
├── app.ts                 # middleware chain + route mounting (the API map)
├── server.ts              # http.listen, Socket.IO init, cron start, stuck-job recovery, Sentry
├── config/env.ts          # zod-validated process.env -> `env` object (single source for config)
├── db/prisma.ts           # PrismaClient singleton
├── middleware/
│   ├── auth.middleware.ts     # requireAuth, requireRole, requireActiveDbRole, requireAnyActiveDbRole, requireActiveMentor
│   ├── csrf.middleware.ts     # requireCsrfHeader (ENFORCED globally — see §8)
│   ├── rate-limit.middleware.ts
│   └── error.middleware.ts    # notFoundHandler + errorHandler (ApiError -> JSON envelope)
├── modules/<feature>/
│   ├── <feature>.routes.ts      # express.Router, applies middleware, maps to controller
│   ├── <feature>.controller.ts  # thin: parse/validate req -> call service -> shape response
│   ├── <feature>.service.ts     # business rules, Prisma access, authorization decisions
│   └── <feature>.validation.ts  # zod schemas
└── shared/                # cross-module utilities (see §7)
```

**Layering rule:** `routes → controller → service`. Controllers stay thin; business rules and DB
access live in services; validation happens at the route/controller boundary. Enforce sensitive
authorization **server-side in the service**, never trust JWT role claims alone for high-risk actions.

### Modules (mounted in `app.ts`)

| Mount | Module | Notes |
|-------|--------|-------|
| `/health` | health | liveness |
| `/api/auth` | auth | login, logout, me, refresh, password reset, email verification (stricter rate limit) |
| `/api/documents` | documents | private upload/download, presigned URLs, audit-logged (upload rate limit) |
| `/api/config`, `/api/admin/config` | config | regions, universities, dropdowns (`ConfigOption`), `AppConfig` (financial rules) |
| `/api/notifications` | notifications | in-app notifications + **event listeners** (§6) |
| `/api/chat` | chat | conversations REST; realtime via Socket.IO (§6) |
| `/api/announcements`, `/api/admin/announcements` | announcements | global + regional announcements |
| `/api/student/*` | dashboard, student-profile, offers | student-scoped |
| `/api/queries`, `/api/admin/queries`, `/api/mentor/queries` | queries | ticketing (stored as `Alert` — §5) |
| `/api/admin/*` | admin/{student-profiles,students,volunteers,regional-admins,offers,audit-logs} | admin grids, reviews, CSV |
| `/api/mentor/*` | dashboard, offers, students, queries | mentor-scoped |
| `/api/universities` | offers/university | university master list |
| `/api/csv-generator` | csv-generator | **background** CSV export jobs to R2 (§6) |

---

## 5. Data model & MongoDB gotchas (read before touching the DB)

Schema: `prisma/schema.prisma` (definitive). Full narrative: `documentation/database-schema.md`.

**Critical: legacy collection/field mappings.** The DB was seeded under older names; Prisma remaps them.
The model name and the actual MongoDB collection/field differ. This bites anyone writing raw queries,
reading Mongo directly, or debugging data:

| Prisma model / value | Actual MongoDB name | 
|----------------------|---------------------|
| `Query` model | collection **`Alert`** |
| `QueryMessage` model | collection **`AlertMessage`** |
| `Query.queryType` | field **`alertType`** |
| `QueryMessage.queryId` | field **`alertId`** |
| `QueryStatus` enum | **`AlertStatus`** |
| `QueryStatus.assigned` | value **`in_progress`** |
| `Region.code` / `Region.name` | fields **`countryCode`** / **`countryName`** |

So "Query" and "Alert" are the same thing; the app-facing language is **Query** (student ticketing).

**Other notes:**
- MongoDB provider ⇒ **no SQL migrations**; schema syncs via `prisma db push`. (`prisma/migrations.postgres/` is dead history from the pre-Mongo era — ignore it.)
- IDs are Mongo `ObjectId` strings (`@db.ObjectId`).
- **Soft deletes:** most models have `deletedAt`. Queries must filter `deletedAt: null` for "active" rows; RBAC/scope helpers already do this.
- **Roles are an array** on `User.roles` (`RoleCode[]`). A user can hold multiple roles.

### Roles (`RoleCode` enum — FIVE, not four)

`student`, `mentor`, `regional_admin`, `master_admin`, **`reviewer`**. The `reviewer` role is newer;
older docs that say "four fixed roles" are stale. Reviewer ≈ read/review student profiles without
full master-admin power (see `shared/auth-scope.ts` and `skills/gaza40plus-rbac/`).

### Key models

Identity/profiles: `User`, `StudentProfile`, `VolunteerProfile`, `RegionalAdminProfile`.
Master data: `Region`, `University`, `ConfigOption`, `AppConfig`.
Core domain: `Offer`, `OfferRevision`, `Document`, `Query`(=Alert), `QueryMessage`, `Announcement`.
Platform: `AuthToken`, `AuditLog`, `Notification`.
Realtime chat: `Conversation`, `ConversationMember`, `ChatMessage`.
Jobs: `CsvJob`.

`DocumentType` includes `national_id`, `passport`, `moi_letter`, `consent_form`, `offer_letter`,
`scholarship_letter`, `signature`, `english_proficiency`.

---

## 6. Async, realtime & background systems (HIGH-priority to understand)

Full detail: `documentation/async-and-realtime.md`.

### Event-driven notifications
- `src/shared/events.ts` exports a Node `EventEmitter` (`appEmitter`) + an `AppEvents` name registry.
- Services emit domain events (e.g. `appEmitter.emit(AppEvents.OFFER_SUBMITTED, payload)`) instead of calling notification code directly.
- `src/modules/notifications/notification.listeners.ts` subscribes to those events, creates `Notification` rows, and pushes them live via Socket.IO (`emitToUser`). Registered once via `import "./modules/notifications/notification.listeners"` in `server.ts`.
- Listeners resolve role-aware deep links (e.g. `/admin/queries?queryId=…` vs `/regional-admin/…`) — keep those paths in sync with the frontend route structure.
- Dispatch is wrapped in try/catch (`safelyDispatchNotification`) so a notification failure never breaks the request.

### Socket.IO (`src/modules/chat/chat.socket.ts`)
- Initialized on the same HTTP server in `server.ts` via `initSocket(server)`.
- **Auth:** socket middleware reads the JWT from `handshake.auth.token`, `Authorization` header, OR the `accessToken` cookie.
- **Rooms:** every socket joins `user_<id>` (direct notifications) and, on `join_conversations`, `conv_<conversationId>`.
- **Events in:** `join_conversations`, `send_message`, `typing_start`/`typing_stop`, `mark_read`. **Events out:** `new_message`, `notification_new_message`, `user_typing`, `members_read_updated`, `error`.
- Access control on `send_message`: master_admin bypasses; others must be a `ConversationMember`.
- `emitToUser` / `emitToConversation` are the helpers other modules use to push realtime updates.
- Transport note: frontend connects with **polling only** (to preserve httpOnly cookies through the proxy) — do not assume websockets.

### CSV export as background jobs (`src/modules/csv-generator/`)
- Requests create a `CsvJob` (`pending`), processed asynchronously; output stored in **R2** with a signed URL (TTL `CSV_SIGNED_URL_TTL_DAYS`, default 30).
- `server.ts` `resetStuckCsvJobs()` flips any `generating` jobs left over from a crash back to `failed` on boot.
- `csv-generator.cron.ts` cleans up expired jobs; per-dataset builders in `student-export.service.ts`, `mentor-export.service.ts`, `regional-admin-export.service.ts`.

### Cron (`node-cron`, started in `server.ts`)
- `startChatCronJobs()` — chat message retention/cleanup.
- `registerCsvCleanupCron()` — expire/cleanup CSV exports.

---

## 7. Shared utilities (`src/shared/`)

| File | Responsibility |
|------|----------------|
| `http.ts` | `ApiError` class + response envelope helpers (`{ data }` / `{ error: { message } }`) |
| `auth-scope.ts` | `getAdminScope(userId)` → `master_admin` \| `regional_admin` (with `regionId`) \| `reviewer`; the canonical admin-scope resolver |
| `audit.ts` | write `AuditLog` entries for sensitive actions |
| `storage.ts` | R2/S3 upload, presigned URL, delete, stream; local-disk fallback when R2 env unset |
| `events.ts` | `appEmitter` + `AppEvents` registry (see §6) |
| `email.ts`, `email-templates.ts`, `review-email.ts` | transactional email (SMTP) |
| `csv.ts` | CSV serialization helpers |
| `validation.ts` | shared zod helpers |

Prefer feature-level helpers first; only promote to `shared/` when logic genuinely repeats. Don't create large generic `utils` dumps (see `ENGINEERING.md`).

---

## 8. Auth, RBAC & security

Full detail: `documentation/auth-rbac.md` and the `gaza40plus-rbac` skill.

- **Auth:** JWT in httpOnly `accessToken` cookie. `requireAuth` verifies and attaches `req.authUser` (`{ id, email, roles, regionId? }`). There is a `/api/auth/refresh` flow the frontend calls automatically on 401.
- **Role middleware:**
  - `requireRole([...])` / `requireAnyActiveDbRole([...])` — gate by JWT roles (low-risk gating).
  - `requireActiveDbRole(role)` / `getAdminScope()` — **DB-backed** checks (validate `deletedAt`, `accountStatus`, current `roles`, regional-admin status). Use these for sensitive/admin actions — JWT claims are hints, not authority.
- **Regional scoping:** regional admins are limited to their `RegionalAdminProfile.regionId`. `getAdminScope` returns the region for scoping list/detail queries. Never skip ownership/region checks even for higher-privileged roles unless explicitly documented.
- **CSRF is ENFORCED** (not deferred — old docs are wrong). `requireCsrfHeader` runs globally in `app.ts` and rejects any non-GET/HEAD/OPTIONS request lacking header `x-requested-with: XMLHttpRequest`. The frontend axios instance sets this header on every request.
- **Rate limiting:** general `/api`, stricter `/api/auth`, separate `/api/documents` upload limit.
- **Documents are private:** never expose public object URLs; downloads go through auth + audit log and use short-lived presigned URLs. Mentors/regional admins must not see sensitive identity docs (passport, national_id) — enforce in service.
- **Logging:** morgan for method/path/status/timing only. **Never** log request bodies, passwords, JWTs, cookies, file contents, filenames, or sensitive profile data.

---

## 9. Conventions

- **TypeScript**, 2-space indent, double quotes, semicolons (match surrounding files).
- Business-focused names; constants/enums for roles, statuses, categories, file limits (avoid `data`/`item`/`temp`).
- Validate at the boundary with zod; return errors via `ApiError` so `errorHandler` shapes them consistently.
- Read config only through `config/env.ts` (`env.*`), never `process.env.*` directly in modules.
- Access DB only through the `prisma` singleton in `db/prisma.ts`.
- Keep controllers thin, services authoritative. New feature → new folder under `src/modules/` following the routes/controller/service/validation shape.

---

## 10. Workflow expectations (from AGENT/ENGINEERING history)

- **Discuss before large decisions.** Surface options + a recommendation for tech/library/architecture/naming choices rather than silently deciding. Use a `tech-lead-pushback` mindset when a choice has real product/security/maintainability/cost impact.
- **Scope discipline.** MVP is the target; don't over-engineer or drift from `vision/requirements.md`. Label anything beyond the SRS as a risk / future / optional item.
- **Change audit.** After changing code, append to `plans/changes_audit.md` in the same turn: files/APIs/functions/middleware/schemas changed and key decisions (names & behavior, not code snippets). Keep it chronological.
- **Postman.** After changing routes/payloads/responses/auth, update `Gaza40+ API.postman_collection.json` — prefer editing `scripts/update-postman-collection.ps1` and regenerating over hand-editing the JSON. (Note: the collection currently lives in the frontend repo root.)
- **Testing focus** (when adding tests): eligibility, consent, review locks, financial calculations, RBAC, regional isolation, uploads. Add regression tests for fixed bugs where practical.

---

## 11. Known limits / deferred (verify before relying on these)

- Local disk uploads are dev/demo only; production uses R2.
- Account lockout and email-change verification are deferred.
- Distributed/Redis rate limiting deferred (in-memory limiter today).
- Some product tabs (University/Scholarship processes) may be intentionally deferred per requirements.

---

## 12. Cross-repo contract (frontend ↔ backend)

- Frontend base URL is empty in prod; Next.js **rewrites** proxy `/api/*` and `/socket.io/*` to this backend. In dev it uses `NEXT_PUBLIC_API_URL`.
- **Response envelope:** success responses are `{ data: ... }`; the frontend axios interceptor unwraps `.data` automatically. Errors are `{ error: { message } }` (or `{ message }`). Keep this shape stable.
- **CSRF:** every mutating request must carry `x-requested-with: XMLHttpRequest` (frontend sets it globally). If you add a client that talks to this API, it must send this header.
- **Auth cookie** is httpOnly; the frontend never reads the JWT. Session is established via `GET /api/auth/me`.
- **Notification deep links** produced by backend listeners must match real frontend routes (`/student/*`, `/mentor/*`, `/admin/*`, `/regional-admin/*`, `/reviewer/*`).
- Roles must stay aligned on both sides: `student | mentor | regional_admin | master_admin | reviewer`.

When you change an API contract, update the frontend (`C:\Users\hp\Desktop\gaza40plus`) in the same effort or flag it.
