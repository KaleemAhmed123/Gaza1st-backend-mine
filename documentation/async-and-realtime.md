# Async, Realtime & Background Systems

These are the highest-risk parts to change because failures are silent and cross-request. Read this
before touching notifications, chat, CSV export, or cron.

## 1. Event-driven notifications

**Files:** `src/shared/events.ts`, `src/modules/notifications/notification.listeners.ts`,
`src/modules/notifications/notification.service.ts`.

- `shared/events.ts` exposes a singleton Node `EventEmitter` (`appEmitter`) and an `AppEvents` name
  registry (`PROFILE_SUBMITTED`, `OFFER_SUBMITTED`, `OFFER_STATUS_UPDATED`, `OFFER_MENTOR_ASSIGNED`,
  `ANNOUNCEMENT_CREATED`, `QUERY_REPLIED`, `QUERY_ASSIGNED`, `QUERY_ESCALATED`, `CHAT_GROUP_ADDED`, …).
- **Producers:** services emit an event after a state change, e.g.
  `appEmitter.emit(AppEvents.OFFER_SUBMITTED, { studentUserId, studentName, offerId, regionId })`.
  Services do **not** call notification code directly — they emit.
- **Consumer:** `notification.listeners.ts` registers `appEmitter.on(...)` handlers once at boot
  (via `import "./modules/notifications/notification.listeners"` in `server.ts`). Each handler:
  1. computes recipients (often querying `User` by role + region + `deletedAt: null` + `accountStatus: active`),
  2. creates `Notification` rows through `createNotification`,
  3. pushes them live over Socket.IO with `emitToUser(userId, "notification_new_message", notification)`.
- **Safety:** all dispatch goes through `safelyDispatchNotification`, wrapped in try/catch, so a
  notification failure never breaks the originating request.
- **Deep links:** handlers pick role-aware links (e.g. `/admin/queries?queryId=…` vs
  `/regional-admin/queries?queryId=…` vs `/reviewer/student-reviews`). **These must match real
  frontend routes** — update both sides together.

**Gotcha:** this is in-process only. If the API runs as multiple instances, `appEmitter` events do not
cross processes (fine for single-instance Render deploy; revisit if you scale out).

## 2. Realtime chat (Socket.IO)

**Files:** `src/modules/chat/chat.socket.ts` (+ `chat.service.ts`, `chat.controller.ts`,
`chat.permissions.ts`, `chat.cron.ts`, `chat.upload.ts`).

- Initialized on the same HTTP server: `initSocket(server)` in `server.ts`.
- **Auth handshake:** token is read from `handshake.auth.token`, the `Authorization: Bearer` header,
  or the `accessToken` cookie — verified with `verifyAccessToken`. Invalid → connection refused.
- **Rooms:** on connect the socket joins `user_<id>`; on `join_conversations` it joins
  `conv_<conversationId>` for each membership.
- **Inbound events:** `join_conversations`, `send_message`, `typing_start`, `typing_stop`, `mark_read`.
- **Outbound events:** `new_message`, `notification_new_message`, `user_typing`, `members_read_updated`, `error`.
- **Authorization on send:** master_admin may post anywhere; everyone else must be a
  `ConversationMember` of the target conversation.
- **On send_message:** persists a `ChatMessage` (with `clientMessageId` idempotency key), bumps
  `Conversation.lastMessageAt`, broadcasts `new_message` to the room, emits `notification_new_message`
  to other members' `user_` rooms, and bulk-creates `Notification` rows for them.
- **Helpers:** `emitToUser(userId, event, data)` and `emitToConversation(conversationId, event, data)`
  are used by other modules (e.g. notifications) to push realtime updates.
- **Transport:** the frontend connects with **polling only** (to keep the httpOnly cookie flowing
  through the Vercel/Next proxy). Don't assume WebSocket upgrades.

## 3. CSV export as background jobs

**Files:** `src/modules/csv-generator/*`, `src/server.ts` (`resetStuckCsvJobs`).

- A request creates a `CsvJob` row (`status: pending`) and processing happens asynchronously; the
  request does not block until the file is built (contrast with the older synchronous description in
  `flows.md`).
- Datasets: `students`, `mentors`, `regional_admins`. Per-dataset builders:
  `student-export.service.ts`, `mentor-export.service.ts`, `regional-admin-export.service.ts`;
  column defs in `csv-column-definitions.ts`; filtering in `csv-query-builder.ts`; storage in
  `csv-storage.service.ts`.
- Output is written to **R2** and served via a signed URL that expires after
  `CSV_SIGNED_URL_TTL_DAYS` (default 30). Job lifecycle: `pending → generating → completed | failed | expired`.
- **Crash recovery:** on boot, `resetStuckCsvJobs()` flips any `generating` jobs (left over from a
  crash/restart) to `failed` with a "please retry" message.
- **Same RBAC/regional scoping** as the corresponding admin grid applies to exports, and exports are
  audit-logged.

## 4. Cron jobs (`node-cron`)

Started in `server.ts`:
- `startChatCronJobs()` — chat message retention / cleanup (`chat.cron.ts`).
- `registerCsvCleanupCron()` — expire and clean up old CSV exports (`csv-generator.cron.ts`).

Cron runs in-process; a restart re-registers schedules. Keep cron work idempotent and cheap.

## 5. Failure-mode checklist (when debugging these systems)

- Notification didn't arrive → is the event emitted by the service? is the listener registered
  (import present in `server.ts`)? did the recipient query exclude them (role/region/`deletedAt`)?
  is the socket connected (frontend only connects when authenticated)?
- Chat message lost → membership check failed, or `conversationId` not a string, or socket auth failed.
- CSV stuck in `generating` → process crashed mid-job; boot recovery marks it `failed` — user retries.
- Duplicate chat message → check `clientMessageId` idempotency from the client.
