# API Documentation

## Conventions

- Base API prefix: `/api`
- Success response shape:

```json
{
  "data": {}
}
```

- Error response shape:

```json
{
  "error": {
    "message": "Error message"
  }
}
```

## Health

### `GET /health`

Checks that the server is running.

### `GET /health/db`

Checks database reachability.

## Auth

### `POST /api/auth/register/student`

Registers a student account and creates an initial student profile.

```powershell
curl.exe -i -c student.cookies -X POST http://localhost:4000/api/auth/register/student `
  -H "Content-Type: application/json" `
  -d '{"email":"student1@example.com","password":"Password123!","fullName":"Student One","hasOfferSelfReported":true}'
```

### `POST /api/auth/register/volunteer`

Registers a volunteer account and creates an initial volunteer profile.

```powershell
curl.exe -i -c volunteer.cookies -X POST http://localhost:4000/api/auth/register/volunteer `
  -H "Content-Type: application/json" `
  -d '{"email":"volunteer1@example.com","password":"Password123!","fullName":"Volunteer One","phone":"+970599000000","universityAffiliation":"Example University"}'
```

### `POST /api/auth/login`

Logs in and sets an httpOnly JWT cookie.

```powershell
curl.exe -i -c student.cookies -X POST http://localhost:4000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"student1@example.com","password":"Password123!"}'
```

Auth responses return `{ data: { user } }`. The user object includes `id`, `email`, `fullName`,
`phone`, `roles`, `accountStatus`, `emailVerifiedAt`, and any role-specific profile summary:
`studentProfile`, `volunteerProfile`, or `regionalAdminProfile`.

### `POST /api/auth/logout`

Clears the auth cookie.

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/auth/logout
```

### `GET /api/auth/me`

Returns the current authenticated user with the same enriched user shape used by login and registration.

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/auth/me
```

### `POST /api/auth/forgot-password`

Sends a password reset email if the account exists. Response is always generic so the API does not reveal registered emails.

```powershell
curl.exe -i -X POST http://localhost:4000/api/auth/forgot-password `
  -H "Content-Type: application/json" `
  -d '{"email":"student@example.com"}'
```

### `POST /api/auth/reset-password`

Resets password using the token from the email link.

```powershell
curl.exe -i -X POST http://localhost:4000/api/auth/reset-password `
  -H "Content-Type: application/json" `
  -d '{"token":"RESET_TOKEN_FROM_EMAIL","password":"NewPassword123!"}'
```

### `POST /api/auth/send-verification-email`

Requires login. Sends an email verification link to the current user.

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/auth/send-verification-email `
  -H "Content-Type: application/json" `
  -d '{"redirectPath":"/verify-email"}'
```

### `POST /api/auth/verify-email`

Verifies email using the token from the email link.

```powershell
curl.exe -i -X POST http://localhost:4000/api/auth/verify-email `
  -H "Content-Type: application/json" `
  -d '{"token":"VERIFY_TOKEN_FROM_EMAIL"}'
```

## Documents

### `POST /api/documents`

Uploads a profile or offer document.

Multipart field:
- `file`

Body:
- `documentType`

Allowed document types:
- `national_id`
- `passport`
- `moi_letter`
- `consent_form`
- `offer_letter`
- `scholarship_letter`

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/documents `
  -F "documentType=consent_form" `
  -F "file=@C:\tmp\consent.pdf"
```

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/documents `
  -F "documentType=national_id" `
  -F "file=@C:\tmp\national-id.jpg"
```

Offer document upload requires `offerId`:

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/documents `
  -F "documentType=offer_letter" `
  -F "offerId=OFFER_ID" `
  -F "file=@C:\tmp\offer-letter.pdf"
```

### `GET /api/documents/:id/download`

Downloads a protected document if the requester is the owner or an active Master Admin.
Successful downloads write a `document_downloaded` audit log.

```powershell
curl.exe -L -b student.cookies http://localhost:4000/api/documents/DOCUMENT_ID/download -o downloaded-document.pdf
```

## Student Profile

### `GET /api/student/profile/me`

Returns the current student's profile.

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/student/profile/me
```

### `PATCH /api/student/profile/me`

Updates the current student's draft profile.

```powershell
curl.exe -i -b student.cookies -X PATCH http://localhost:4000/api/student/profile/me `
  -H "Content-Type: application/json" `
  -d '{"fullNameEnglish":"Student One","sex":"male","dateOfBirth":"2000-01-15","locationInGaza":"gaza_city","hasOfferSelfReported":true,"passportStatus":"invalid_lost_never_had_one","emergencyContactFirstName":"Emergency","emergencyContactRelation":"Parent","emergencyContactPhone":"+970599111111","englishMoi":false,"englishWorkplaceCertificatePossible":false,"englishOtherCerts":"IELTS planned"}'
```

### `POST /api/student/profile/me/submit`

Submits the current student's profile for Master Admin review. The API requires all mandatory
profile fields plus active `national_id` and `consent_form` documents. It also requires a
`moi_letter` when `englishMoi=true`, and a `passport` document when the passport status is
`valid` or `valid_expires_within_year`.

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/student/profile/me/submit
```

## Config / Master Data

Public read routes for frontend dropdowns and autocomplete.

### `GET /api/config/regions`

```powershell
curl.exe -i http://localhost:4000/api/config/regions
```

### `GET /api/config/options?groupKey=...`

Seeded groups include:
- `course_field`
- `course_level`
- `offer_type`
- `query_type`
- `announcement_category`

```powershell
curl.exe -i "http://localhost:4000/api/config/options?groupKey=course_field"
curl.exe -i "http://localhost:4000/api/config/options?groupKey=course_level"
curl.exe -i "http://localhost:4000/api/config/options?groupKey=offer_type"
curl.exe -i "http://localhost:4000/api/config/options?groupKey=query_type"
```

### `GET /api/config/universities`

Optional query:
- `regionId`
- `search`

```powershell
curl.exe -i "http://localhost:4000/api/config/universities?search=manchester"
curl.exe -i "http://localhost:4000/api/config/universities?regionId=REGION_ID"
```

## Announcements

Announcements are global. All authenticated users can read published announcements.

### `GET /api/announcements`

Optional query:
- `category`

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/announcements
curl.exe -i -b student.cookies "http://localhost:4000/api/announcements?category=scholarships"
```

### `GET /api/announcements/:id`

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/announcements/ANNOUNCEMENT_ID
```

## Dashboards

Dashboard APIs return lightweight role-specific summaries and recent items. Detailed filtering and aggregation still belongs to the existing grid APIs.

### `GET /api/student/dashboard`

Returns student profile status, offer counts, query counts, recent offers, recent queries, and latest published announcements.

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/student/dashboard
```

### `GET /api/admin/dashboard`

Returns Master Admin or Regional Admin dashboard counts. Regional Admin results are scoped to their assigned offer/university region.

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/dashboard
```

```powershell
curl.exe -i -b regional.cookies http://localhost:4000/api/admin/dashboard
```

### `GET /api/mentor/dashboard`

Returns assigned query counts and recent assigned queries.

```powershell
curl.exe -i -b volunteer.cookies http://localhost:4000/api/mentor/dashboard
```

## Master Admin Config Management

Requires a user whose `roles` includes `master_admin`.

### Config Options

```powershell
curl.exe -i -b admin.cookies -X POST http://localhost:4000/api/admin/config/options `
  -H "Content-Type: application/json" `
  -d '{"groupKey":"course_field","value":"business","labelEn":"Business","sortOrder":50}'
```

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/config/options/OPTION_ID `
  -H "Content-Type: application/json" `
  -d '{"labelEn":"Business and Management","sortOrder":55}'
```

```powershell
curl.exe -i -b admin.cookies -X DELETE http://localhost:4000/api/admin/config/options/OPTION_ID
```

### Regions

Regions are configurable master data, but they remain real records because offers, universities, queries, and regional admins relate to them.

```powershell
curl.exe -i -b admin.cookies -X POST http://localhost:4000/api/admin/config/regions `
  -H "Content-Type: application/json" `
  -d '{"code":"FR","name":"France"}'
```

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/config/regions/REGION_ID `
  -H "Content-Type: application/json" `
  -d '{"name":"France","isActive":true}'
```

```powershell
curl.exe -i -b admin.cookies -X DELETE http://localhost:4000/api/admin/config/regions/REGION_ID
```

### Universities

```powershell
curl.exe -i -b admin.cookies -X POST http://localhost:4000/api/admin/config/universities `
  -H "Content-Type: application/json" `
  -d '{"regionId":"REGION_ID","name":"Example University","city":"London","isLondon":true}'
```

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/config/universities/UNIVERSITY_ID `
  -H "Content-Type: application/json" `
  -d '{"city":"Manchester","isLondon":false}'
```

```powershell
curl.exe -i -b admin.cookies -X DELETE http://localhost:4000/api/admin/config/universities/UNIVERSITY_ID
```

## Master Admin Announcements

Requires an active Master Admin. Categories should use the `announcement_category` config group.

### `GET /api/admin/announcements`

Optional query:
- `category`
- `isPublished`: `true` or `false`

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/announcements
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/announcements?isPublished=true"
```

### `POST /api/admin/announcements`

```powershell
curl.exe -i -b admin.cookies -X POST http://localhost:4000/api/admin/announcements `
  -H "Content-Type: application/json" `
  -d '{"title":"Scholarship deadline","body":"Submit scholarship documents before the end of the week.","category":"scholarships","isPublished":true}'
```

### `GET /api/admin/announcements/:id`

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/announcements/ANNOUNCEMENT_ID
```

### `PATCH /api/admin/announcements/:id`

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/announcements/ANNOUNCEMENT_ID `
  -H "Content-Type: application/json" `
  -d '{"title":"Updated scholarship deadline","isPublished":true}'
```

Unpublish:

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/announcements/ANNOUNCEMENT_ID `
  -H "Content-Type: application/json" `
  -d '{"isPublished":false}'
```

### `DELETE /api/admin/announcements/:id`

Soft-deletes and unpublishes the announcement.

```powershell
curl.exe -i -b admin.cookies -X DELETE http://localhost:4000/api/admin/announcements/ANNOUNCEMENT_ID
```

## Master Admin Audit Logs

Requires an active Master Admin. Regional Admins, mentors, and students cannot access audit logs in the MVP.

### `GET /api/admin/audit-logs`

Optional query:
- `action`
- `entityType`
- `entityId`
- `actorUserId`
- `from`
- `to`
- `page`
- `pageSize`

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/audit-logs
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/audit-logs?action=offers_exported&page=1&pageSize=25"
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/audit-logs?entityType=offer&from=2026-05-01&to=2026-05-18"
```

### `GET /api/admin/audit-logs/:id`

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/audit-logs/AUDIT_LOG_ID
```

## Student Offers

Student offer APIs require an approved student profile.

### `GET /api/student/offers`

Lists the current student's offers with calculated funding summary.

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/student/offers
```

### `POST /api/student/offers`

Creates a draft offer. Use either `universityId`, `regionId`, or `universityCountry`.

For now, `universityCountry` is the easiest manual-test option and matches seeded regions such as `UK`, `Ireland`, `Italy`, `Spain`, `Egypt`, `US`, `Bosnia`, or `Turkey`. When `universityId` is used later, the backend derives the offer region from the selected university.

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/student/offers `
  -H "Content-Type: application/json" `
  -d '{"universityCountry":"UK","universityName":"Example University","courseName":"MSc Public Health","courseField":"Public Health","courseLevel":"Masters","durationYears":2.5,"programmeStartDate":"2026-09-01","offerType":"Conditional","conditions":"Final transcript required","tuitionFeePerYear":12000,"courseFeeSourceUrl":"https://example.edu/fees","hasScholarship":true,"scholarshipName":"Example Scholarship","scholarshipAmountPerYear":10000,"scholarshipCoversLivingCost":false,"privateFundingAmount":3000,"privateFundingSource":"Family support","livingCostLocationKey":"outside_london"}'
```

### `GET /api/student/offers/:id`

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/student/offers/OFFER_ID
```

### `PATCH /api/student/offers/:id`

Updates a draft or changes-requested offer. Editing an approved offer creates a revision and moves it back to `under_review`.

```powershell
curl.exe -i -b student.cookies -X PATCH http://localhost:4000/api/student/offers/OFFER_ID `
  -H "Content-Type: application/json" `
  -d '{"universityCountry":"UK","universityName":"Example University","courseName":"MSc Public Health","courseField":"Public Health","courseLevel":"Masters","durationYears":2.5,"programmeStartDate":"2026-09-01","offerType":"Unconditional","tuitionFeePerYear":12000,"courseFeeSourceUrl":"https://example.edu/fees","hasScholarship":true,"scholarshipName":"Example Scholarship","scholarshipAmountPerYear":10000,"scholarshipCoversLivingCost":false,"privateFundingAmount":3000,"privateFundingSource":"Family support","livingCostLocationKey":"outside_london"}'
```

### `POST /api/student/offers/:id/submit`

Requires active `offer_letter`. If `hasScholarship=true`, also requires active `scholarship_letter`.

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/student/offers/OFFER_ID/submit
```

### `DELETE /api/student/offers/:id`

Soft-removes an offer.

```powershell
curl.exe -i -b student.cookies -X DELETE http://localhost:4000/api/student/offers/OFFER_ID
```

## Master Admin Student Profile Review

## Admin Students Grid

Master Admin sees all registered students with profile/offer summary fields. Regional Admin sees only students who have at least one offer in the admin's assigned offer/university region.
Response includes `summary` counts for the current filtered result set. Master Admin receives profile/passport/Gaza-location/consent/verified-offer counts. Regional Admin receives the scoped total only to avoid leaking extra student profile details.

Important:
- `locationInGaza` is the student's Gaza location.
- Regional Admin access is based on `Offer.regionId`, not `StudentProfile.locationInGaza`.

### `GET /api/admin/students`

Optional query:
- `search`
- `profileStatus`
- `passportStatus`
- `locationInGaza`
- `hasVerifiedOffer`: `true` or `false`
- `consentSigned`: `true` or `false`
- `page`
- `pageSize`

Master Admin examples:

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/students
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/students?profileStatus=approved&locationInGaza=gaza_city&page=1&pageSize=25"
```

Regional Admin example:

```powershell
curl.exe -i -b regional.cookies http://localhost:4000/api/admin/students
```

### `GET /api/admin/students/export`

Exports the same filtered student grid as CSV. Master Admin exports all matching students. Regional Admin exports only students with offers in their assigned offer/university region.
Sensitive document files are not exported as public URLs. If file references are added to CSV exports, they must use document IDs or protected download paths that still require authentication.

```powershell
curl.exe -L -b admin.cookies "http://localhost:4000/api/admin/students/export?profileStatus=approved&locationInGaza=gaza_city" -o students-export.csv
```

```powershell
curl.exe -L -b regional.cookies "http://localhost:4000/api/admin/students/export" -o regional-students-export.csv
```

## Admin Volunteers Grid

Master Admin sees all registered volunteers with status, roles, and profile fields. Regional Admin sees volunteers whose `preferredRegionId` matches the admin's assigned offer/university region.
Response includes `summary` counts for the current filtered result set by volunteer status, role, and preferred region.

Note:
- Regional volunteer scoping currently uses `VolunteerProfile.preferredRegionId`.
- This is the simple MVP interpretation of "volunteers in that region" until explicit volunteer-region assignment rules are added.

### `GET /api/admin/volunteers`

Optional query:
- `search`
- `volunteerStatus`
- `role`
- `preferredRegionId`
- `page`
- `pageSize`

Master Admin examples:

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/volunteers
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/volunteers?volunteerStatus=pending&page=1&pageSize=25"
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/volunteers?role=mentor&search=volunteer"
```

Regional Admin example:

```powershell
curl.exe -i -b regional.cookies http://localhost:4000/api/admin/volunteers
```

### `PATCH /api/admin/volunteers/:id/assignment`

Updates a volunteer's simple MVP assignment/review state.

Rules:
- Master Admin can set `preferredRegionId`, `volunteerStatus`, and `mentorEnabled`.
- Regional Admin can only manage volunteers already assigned to their own region.
- Regional Admin cannot remove mentor role or assign privileged roles.

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/volunteers/VOLUNTEER_USER_ID/assignment `
  -H "Content-Type: application/json" `
  -d '{"preferredRegionId":"REGION_ID","volunteerStatus":"approved","mentorEnabled":true}'
```

Regional Admin example:

```powershell
curl.exe -i -b regional.cookies -X PATCH http://localhost:4000/api/admin/volunteers/VOLUNTEER_USER_ID/assignment `
  -H "Content-Type: application/json" `
  -d '{"volunteerStatus":"approved","mentorEnabled":true}'
```

### `GET /api/admin/volunteers/export`

Exports the same filtered volunteer grid as CSV.

```powershell
curl.exe -L -b admin.cookies "http://localhost:4000/api/admin/volunteers/export?volunteerStatus=pending" -o volunteers-export.csv
```

```powershell
curl.exe -L -b regional.cookies "http://localhost:4000/api/admin/volunteers/export" -o regional-volunteers-export.csv
```

### `GET /api/admin/student-profiles`

Lists student profiles. Optional query:
- `status`

Requires a user whose `roles` includes `master_admin`.

For development, create/reset the default Master Admin:

```powershell
corepack pnpm prisma:seed:admin
```

Default credentials:
- Email: `admin@example.com`
- Password: `AdminPassword123!`

```powershell
curl.exe -i -c admin.cookies -X POST http://localhost:4000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"admin@example.com","password":"AdminPassword123!"}'
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/student-profiles?status=under_review"
```

### `GET /api/admin/student-profiles/:id`

Returns one student profile for admin review.

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/student-profiles/STUDENT_PROFILE_ID
```

### `PATCH /api/admin/student-profiles/:id/review`

Reviews a student profile. Allowed status values:
- `approved`
- `changes_requested`
- `rejected`

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/student-profiles/STUDENT_PROFILE_ID/review `
  -H "Content-Type: application/json" `
  -d '{"status":"approved","notes":"Profile reviewed and approved."}'
```

Request changes:

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/student-profiles/STUDENT_PROFILE_ID/review `
  -H "Content-Type: application/json" `
  -d '{"status":"changes_requested","notes":"Please upload a clearer ID document."}'
```

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/student-profiles/STUDENT_PROFILE_ID/review `
  -H "Content-Type: application/json" `
  -d '{"status":"rejected","notes":"Rejected after review."}'
```

## Admin Offer Review

Master Admin can access all offers. Regional Admin can access only the country in their `RegionalAdminProfile`.

Development Regional Admin:

```powershell
corepack pnpm prisma:seed:regional-admin
```

Default credentials:
- Email: `regional.uk@example.com`
- Password: `RegionalPassword123!`

```powershell
curl.exe -i -c regional.cookies -X POST http://localhost:4000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"regional.uk@example.com","password":"RegionalPassword123!"}'
```

### `GET /api/admin/offers`

Optional query:
- `status`
- `regionId`
- `offerType`
- `universityName`
- `courseField`
- `courseLevel`
- `fundingType`: `fully_funded`, `partial_funding`, `private_funding`, `no_funding`
- `hasScholarship`: `true` or `false`
- `search`
- `page`
- `pageSize`

Response includes:
- `offers`
- `summary.total`
- `summary.byOfferType`
- `summary.byUniversity`
- `summary.byFundingType`
- `summary.byReviewStatus`
- `pagination`

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/offers?status=under_review"
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/offers?regionId=REGION_ID&offerType=Conditional&fundingType=partial_funding&page=1&pageSize=25"
```

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/offers?search=public%20health&hasScholarship=true"
```

Regional Admin example:

```powershell
curl.exe -i -b regional.cookies "http://localhost:4000/api/admin/offers?status=under_review"
```

### `GET /api/admin/offers/export`

Exports the same filtered offers grid as CSV, including student contact fields and calculated financial summary columns. Regional Admin exports are scoped to their assigned offer/university region.
Sensitive offer documents are not exported as public URLs. File references must remain protected by API authorization.

```powershell
curl.exe -L -b admin.cookies "http://localhost:4000/api/admin/offers/export?fundingType=partial_funding&hasScholarship=true" -o offers-export.csv
```

```powershell
curl.exe -L -b regional.cookies "http://localhost:4000/api/admin/offers/export?status=under_review" -o regional-offers-export.csv
```

### `GET /api/admin/offers/:id`

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/offers/OFFER_ID
```

Admin offer detail includes `revisions`. When an approved offer is edited by a student, the offer moves back to `under_review`, and each revision includes:
- `changedFields`
- `changes[]`
- `before`
- `after`

### `GET /api/admin/offers/:id/revisions`

Returns only the offer change log for reviewer highlighting.

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/offers/OFFER_ID/revisions
```

### `PATCH /api/admin/offers/:id/review`

Allowed status values:
- `approved`
- `changes_requested`
- `rejected`

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/offers/OFFER_ID/review `
  -H "Content-Type: application/json" `
  -d '{"status":"approved","notes":"Offer verified."}'
```

## Queries / Ticketing

Queries are in-app tickets raised by students. Email notifications use Resend when `RESEND_API_KEY` is configured, but email is best-effort and never blocks query creation or replies.

Profile and offer review notifications also use the same best-effort email service:
- Profile submission notifies active Master Admins.
- Offer submission or approved-offer edits notify active Regional Admins for the offer region.
- If no Regional Admin exists for an offer region, active Master Admins are notified instead.

Seeded query categories:
- `general_issue`
- `visa_offer_issue`
- `whatsapp_group_issue`

### `POST /api/queries`

Creates a student query. For `visa_offer_issue`, send `regionId`. For `whatsapp_group_issue`, send `offerId` so the backend can derive the region.

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/queries `
  -H "Content-Type: application/json" `
  -d '{"queryType":"general_issue","title":"Need help with my dashboard","message":"I cannot find where to update my phone number."}'
```

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/queries `
  -H "Content-Type: application/json" `
  -d '{"queryType":"visa_offer_issue","title":"Visa document issue","message":"I need help checking the visa document requirement.","regionId":"REGION_ID"}'
```

Failure example:

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/queries `
  -H "Content-Type: application/json" `
  -d '{"queryType":"visa_offer_issue","title":"Missing region","message":"This should fail without a region."}'
```

### `GET /api/queries/my`

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/queries/my
```

### `GET /api/queries/:id`

```powershell
curl.exe -i -b student.cookies http://localhost:4000/api/queries/QUERY_ID
```

### `POST /api/queries/:id/messages`

```powershell
curl.exe -i -b student.cookies -X POST http://localhost:4000/api/queries/QUERY_ID/messages `
  -H "Content-Type: application/json" `
  -d '{"message":"Adding more context from my side."}'
```

## Admin Queries

Master Admin can see all queries. Regional Admin can see only queries linked to their region.

### `GET /api/admin/queries`

Optional query:
- `status`: `open`, `assigned`, `resolved`
- `regionId`
- `queryType`

```powershell
curl.exe -i -b admin.cookies "http://localhost:4000/api/admin/queries?status=open"
```

### `GET /api/admin/queries/:id`

```powershell
curl.exe -i -b admin.cookies http://localhost:4000/api/admin/queries/QUERY_ID
```

### `PATCH /api/admin/queries/:id/assign`

Assigns a query to an active mentor/volunteer.

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/queries/QUERY_ID/assign `
  -H "Content-Type: application/json" `
  -d '{"assignedToUserId":"MENTOR_USER_ID"}'
```

### `POST /api/admin/queries/:id/messages`

```powershell
curl.exe -i -b admin.cookies -X POST http://localhost:4000/api/admin/queries/QUERY_ID/messages `
  -H "Content-Type: application/json" `
  -d '{"message":"We are reviewing this and assigning a mentor."}'
```

### `PATCH /api/admin/queries/:id/resolve`

```powershell
curl.exe -i -b admin.cookies -X PATCH http://localhost:4000/api/admin/queries/QUERY_ID/resolve
```

## Mentor Queries

Mentors can access only queries assigned to them.

### `GET /api/mentor/queries`

```powershell
curl.exe -i -b volunteer.cookies http://localhost:4000/api/mentor/queries
```

### `GET /api/mentor/queries/:id`

```powershell
curl.exe -i -b volunteer.cookies http://localhost:4000/api/mentor/queries/QUERY_ID
```

### `PATCH /api/mentor/queries/:id/accept`

Marks an assigned query as accepted by the mentor. This is the simple MVP version of the SRS "accept and work on it" step.

```powershell
curl.exe -i -b volunteer.cookies -X PATCH http://localhost:4000/api/mentor/queries/QUERY_ID/accept
```

### `POST /api/mentor/queries/:id/messages`

```powershell
curl.exe -i -b volunteer.cookies -X POST http://localhost:4000/api/mentor/queries/QUERY_ID/messages `
  -H "Content-Type: application/json" `
  -d '{"message":"I can help with this issue."}'
```

### `PATCH /api/mentor/queries/:id/resolve`

```powershell
curl.exe -i -b volunteer.cookies -X PATCH http://localhost:4000/api/mentor/queries/QUERY_ID/resolve
```
