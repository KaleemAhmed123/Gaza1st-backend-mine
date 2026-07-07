# Auth And RBAC

## Auth Strategy

- JWT access token stored in httpOnly cookie.
- Do not store JWTs in localStorage.
- JWT role claims are convenience hints only.
- Sensitive routes must check the current `User.roles` value and any required profile scope from the database.

## Current Roles

- `student`
- `mentor`
- `regional_admin`
- `master_admin`
- `reviewer` — reviews student profiles without full master-admin authority. Resolved by
  `getAdminScope()` in `src/shared/auth-scope.ts` (returns `{ role: "reviewer" }`). Notification
  deep links route reviewers to `/reviewer/student-reviews`.

Note: `User.roles` is an **array** — a user may hold multiple roles.

## Current Middleware

- `requireAuth`
  - Verifies JWT cookie and attaches `authUser`.

- `requireRole`
  - Checks roles from JWT payload.
  - Acceptable for low-risk route gating.

- `requireActiveDbRole`
  - Reads the current user from the database and verifies `deletedAt`, `accountStatus`, and `User.roles`.
  - Use this for sensitive Master Admin-only routes where JWT role claims are not enough.

- Rate limiting
  - General `/api` requests are rate-limited.
  - Auth routes have a stricter limit.
  - Document upload routes have a separate upload limit.

## Current Sensitive Actions

- Password reset and email verification use hashed, single-use auth tokens with expiry.
- Master Admin student profile review uses DB-backed role checks.
- Document download allows owner or active Master Admin.
- Offer admin list/detail/review checks the database:
  - Master Admin can access all offers.
  - Regional Admin can access only offers in their `RegionalAdminProfile.regionId`.
- CSV exports use the same server-side scoping as their grids and write audit logs.
- Protected document downloads write audit logs.
- Volunteer assignment:
  - Master Admin can update volunteer status, preferred region, and enable mentor role.
  - Regional Admin can only update volunteers already assigned to their own region.
  - Regional Admin cannot assign `master_admin`, `regional_admin`, or remove mentor role.
- Audit log viewing is Master Admin only in the MVP.
- Dashboard access is role-specific:
  - Student can access only `/api/student/dashboard`.
  - Mentor can access only `/api/mentor/dashboard`.
  - Master Admin and Regional Admin can access `/api/admin/dashboard`, with regional scoping applied in the service.
- Mentor query access:
  - Mentor can list, view, accept, reply to, and resolve only queries assigned to them.

## Logging Rules

- Morgan is allowed for method, path, status, and timing.
- Do not log request bodies.
- Do not log passwords, JWTs, auth cookies, uploaded file contents, document filenames, or sensitive profile details.
- If a future feature needs structured logging, add explicit redaction first.

## CSRF (ENFORCED)

- CSRF protection **is enforced** globally by `requireCsrfHeader` in `src/app.ts` (older docs calling it
  "deferred" are stale). Every non-GET/HEAD/OPTIONS request must send header
  `x-requested-with: XMLHttpRequest`, else it is rejected with 403. The frontend axios instance sets
  this header on all requests.

## Deferred Security Work

- Account lockout and email-change verification are deferred.
- Redis-backed/distributed rate limiting is deferred until deployment needs it.

## Future RBAC Work

- Mentor assigned-student access.
- File access audit hardening.
