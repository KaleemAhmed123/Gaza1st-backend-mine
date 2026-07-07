# Flows

## Student Profile Flow

1. Student registers.
2. System creates a draft student profile.
3. Student uploads required profile documents.
4. Student fills profile fields.
5. Student submits profile.
6. System validates required fields and required documents.
7. Profile moves to `under_review`.
8. Master Admin **or Reviewer** approves, requests changes, or rejects.
9. On submit, an in-app notification (via the event system) is sent to the student and to all active
   Master Admins and Reviewers; a best-effort email may also be sent if configured.
   See `documentation/async-and-realtime.md`.

## Profile Statuses

- `draft`
- `under_review`
- `approved`
- `changes_requested`
- `rejected`

## Document Flow

1. Student uploads a profile document.
2. System validates file type, extension, and size.
3. System stores file in local private storage for development.
4. System stores metadata in `Document`.
5. Re-uploading the same document type supersedes the previous active document.
6. Protected downloads write an audit log.

## Admin Review Flow

1. Master Admin lists profiles under review.
2. Master Admin opens profile detail.
3. Master Admin reviews profile fields and documents.
4. Master Admin approves, requests changes, or rejects.
5. System writes an audit log.

## Auth Recovery Flow

1. User requests a password reset with their email.
2. System returns a generic response whether or not the email exists.
3. If the user exists and email is configured, system creates a hashed, single-use password reset token and sends a best-effort email.
4. User submits the token and new password.
5. System consumes the token, updates the password, and writes an audit log.
6. Authenticated users can request an email verification link.
7. System creates a hashed, single-use email verification token and sends a best-effort email.
8. User submits the token and system sets `emailVerifiedAt`.
9. Email verification exists, but it does not currently block login or profile submission.

## Offer Flow

1. Student must have an `approved` profile before managing offers.
2. Student creates a draft offer with university, course, funding, and visa/living-cost information from `vision/requirements.md`.
3. Student uploads an `offer_letter` for that offer.
4. If scholarship is selected, student also uploads a `scholarship_letter`.
5. Student submits the offer.
6. System validates required documents and moves the offer to `under_review`.
7. Master Admin can review all offers; Regional Admin can review only assigned countries.
8. Approval sets the offer to `approved` and marks the student profile as having a verified offer.
9. Request changes unlocks the offer for student edits.
10. Editing an approved offer creates an `OfferRevision`, locks the offer again, and sends it back to `under_review`.
11. If email is configured, Regional Admins for the offer region receive best-effort review notifications for submitted or edited approved offers. Master Admins are notified only if no matching Regional Admin exists.

## Offer Statuses

- `draft`
- `under_review`
- `approved`
- `changes_requested`
- `rejected`
- `removed`

## Query Flow

1. Student raises a query from the Queries tab.
2. System validates the configured query category.
3. Region is required only for categories that need regional routing.
4. WhatsApp/university queries use `offerId` so the backend can derive the region.
5. Query starts as `open`.
6. Master Admin can see all queries; Regional Admin can see only regional queries for their country.
7. Admin assigns the query to an active mentor.
8. Assigned mentor accepts the query before working on it.
9. Assigned mentor and student exchange chronological messages under the same ticket.
10. Admin or assigned mentor resolves the query.
11. Resolved queries are read-only in MVP.
12. Queries can be **escalated** (`isEscalated`) to master or regional admins; escalation fires the
    `QUERY_ESCALATED` event, notifying the target admins (`documentation/async-and-realtime.md`).

## Query Statuses

- `open`
- `assigned`
- `resolved`

## Announcement Flow

1. Master Admin creates a draft or published global announcement.
2. Category is validated against `announcement_category`.
3. Published announcements are visible to all authenticated roles.
4. Master Admin can edit, publish, unpublish, or soft-delete announcements.
5. Deleted announcements are hidden from all announcement lists.

## Dashboard Flow

1. Student dashboard summarizes the student's profile status, offer statuses, query statuses, and latest announcements.
2. Master Admin dashboard summarizes students, offers, volunteers, queries, announcements, recent offers, recent queries, and recent audit logs.
3. Regional Admin dashboard uses the same endpoint as Master Admin but scopes offer, student, volunteer, and query counts to the admin's assigned offer/university region.
4. Mentor dashboard summarizes assigned queries and recent assigned query work.
5. Detailed filtering and exports remain in the grid APIs.

## Admin Students Grid Flow

1. Master Admin opens the students grid and sees all registered students.
2. Master Admin can filter by profile status, passport status, Gaza location, consent, verified offer, and search text.
3. Regional Admin opens the same endpoint but sees only students with offers in the admin's assigned offer/university region.
4. Regional Admin access is never based on `locationInGaza`; that field remains a student profile filter/display field only.
5. Master Admin student grid response includes summary counts for the filtered result set.
6. Regional Admin student grid response includes only the scoped total summary.

## Admin Volunteers Grid Flow

1. Master Admin opens the volunteers grid and sees all registered volunteers.
2. Master Admin can filter by volunteer status, role, preferred region, and search text.
3. Regional Admin opens the same endpoint but sees only volunteers whose `preferredRegionId` matches the admin's assigned offer/university region.
4. This is the simple MVP volunteer-region rule until explicit volunteer assignment rules are added.
5. Master Admin can assign a volunteer to a preferred region, update volunteer status, and ensure mentor role is enabled.
6. Regional Admin can update status and enable mentor role only for volunteers already assigned to their region.
7. Volunteer grid response includes summary counts by volunteer status, role, and preferred region.

## Admin Offers Grid Flow

1. Master Admin lists offers across all offer/university regions.
2. Regional Admin lists only offers in their assigned offer/university region.
3. Admins can filter by region, review status, offer type, university, course field, course level, scholarship flag, funding type, and search text.
4. The same endpoint returns simple summary counts for offer type, university, funding type, and review status.
5. Admins can export the same filtered result set as CSV.
6. If an approved offer is edited, admin offer detail exposes revision changes for field-level highlighting.

## CSV Export Flow (background jobs)

1. Admin applies filters on students, mentors, or regional admins.
2. Admin submits an export request, which creates a `CsvJob` (`status: pending`).
3. The job is processed **asynchronously** (`generating → completed`); it is not returned inline.
4. The same server-side RBAC and regional isolation as the grid endpoint is applied.
5. The result CSV is stored in R2 and served via a signed URL (expires after `CSV_SIGNED_URL_TTL_DAYS`).
6. Jobs stuck in `generating` after a crash are reset to `failed` on boot; a cron cleans up expired jobs.
7. An audit log records actor, scope, filters, and row count.

See `documentation/async-and-realtime.md` for the full job lifecycle.

## Audit Log Flow

1. Master Admin opens the audit log view.
2. Master Admin filters by action, entity type, actor, entity id, or date range.
3. System returns paginated audit logs with actor identity.
4. Master Admin can open one audit log for metadata details.
5. Regional Admin audit access is deferred until safe entity-level scoping is designed.

## Future Flows To Document

- Offer-review alert workflow.
