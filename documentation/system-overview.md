# System Overview (both repos)

Gaza40+ is a **two-repo** system. Use this to decide *where a bug or change belongs* before diving in.

```
Browser
  │  same-origin /api/* and /socket.io/*
  ▼
Frontend  ── Next.js 16 rewrites proxy ──►  Backend
(gaza40plus)                                (Gaza40-Student-Portal)
Next.js 16 / React 19                        Express + Prisma + MongoDB
                                             Socket.IO · R2 · SMTP · cron · Sentry
```

| Repo | Local path | Owns |
|------|-----------|------|
| **Frontend** | `C:\Users\hp\Desktop\gaza40plus` | UI, routing, forms, client state, i18n/RTL, field mapping (`lib/apiAdapters.ts`), socket client |
| **Backend** | `C:\Users\hp\Desktop\Gaza40-Student-Portal` | REST API, auth/RBAC, data model, documents/R2, realtime server, notifications, CSV jobs, email, cron |

## Contract between them (must stay in sync)

- **Transport:** frontend calls same-origin `/api/*`; Next rewrites forward to the backend (Render in prod). Socket.IO under `/socket.io/*`, **polling transport** only.
- **Response envelope:** success `{ data: ... }` (frontend axios auto-unwraps `.data`); error `{ error: { message } }` or `{ message }`.
- **CSRF:** every mutating request carries `x-requested-with: XMLHttpRequest` (frontend axios sets it; backend `requireCsrfHeader` enforces it).
- **Auth:** JWT in httpOnly cookie `accessToken`; session via `GET /api/auth/me`; 401 → frontend auto-calls `GET /api/auth/refresh`.
- **Roles (5, shared):** `student · mentor · regional_admin · master_admin · reviewer`. Backend stores an array `User.roles`; frontend collapses to one `role` (priority: master_admin > regional_admin > reviewer > mentor > student).
- **Field shapes differ** and are reconciled in the frontend `lib/apiAdapters.ts`. A "missing/wrong field" bug is usually an adapter mismatch, not a backend bug.
- **Notification deep links** produced by backend `notification.listeners.ts` must resolve to real frontend routes (`/student/*`, `/mentor/*`, `/admin/*`, `/regional-admin/*`, `/reviewer/*`).

## Where to look first (bug triage)

| Symptom | Likely home |
|---------|-------------|
| Field shows blank/wrong but API returns it | Frontend `lib/apiAdapters.ts` normalizer |
| 403 on a POST/PUT/DELETE | Missing CSRF header / not using the `api` axios instance |
| Wrong data visible across regions/roles | Backend service RBAC / `getAdminScope` / regional scoping |
| Realtime not updating | Socket auth, room join, or listener; see `async-and-realtime.md` |
| Notification never arrives | Event not emitted, listener not registered, recipient query filter |
| Query/Alert confusion in DB | Legacy Mongo mapping (`Query`=`Alert`); see `database-schema.md` |
| CSV export stuck/empty | `CsvJob` lifecycle / crash recovery; see `async-and-realtime.md` |

## API reference

The Postman collection `Gaza40+ API.postman_collection.json` (currently in the frontend repo root) is
the endpoint reference. Regenerate it via `scripts/update-postman-collection.ps1` after route/payload
changes (see `CLAUDE.md` §10).
