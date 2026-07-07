# Developer Documentation

This folder is for practical developer-facing documentation. Keep `plans/` for planning, audits, and decision history. Keep `vision/` for product source documents.

> Start with `../CLAUDE.md` (the authoritative agent guide). This folder expands specific topics.

## Recommended Reading Order

1. `../CLAUDE.md` - authoritative overview, folder structure, MongoDB gotchas, conventions.
2. `../vision/requirements.md` - source of truth for MVP behavior.
3. `../ENGINEERING.md` - coding and simplicity rules.
4. `system-overview.md` - both repos, the frontend↔backend contract, and bug-triage map.
5. `setup.md` - local setup and commands.
6. `architecture.md` - current backend architecture (Express + Prisma + MongoDB).
7. `async-and-realtime.md` - events/notifications, Socket.IO chat, CSV background jobs, cron (high-priority).
8. `api.md` - API routes and request/response notes.
9. `database-schema.md` - schema narrative (definitive schema is `prisma/schema.prisma`).
10. `database-erd.svg` - visual relationship diagram.
11. `models.md` - database models and important enums.
12. `flows.md` - user and system flows.
13. `auth-rbac.md` - authentication and access control rules (incl. `reviewer`, enforced CSRF).
14. `file-uploads.md` - private upload behavior (R2 + local fallback).
15. `testing.md` - manual and automated test checklist.
16. `deployment.md` - demo/staging deployment notes.
17. `mvp-gaps.md` - known MVP gaps and production-readiness checklist.

## Documentation Rules

- Keep docs short and accurate.
- Update docs in the same PR/turn as code changes.
- Do not copy full code into docs.
- Prefer route names, model names, field names, behavior, and examples.
- If a doc becomes large, split by feature instead of making one giant file.
