# Database Schema Reference

The **definitive** schema is `prisma/schema.prisma` (`provider = "mongodb"`). This file is a narrative
reference. `vision/requirements.md` remains the source of truth for product behavior.

> **MongoDB legacy-name gotcha:** several models map to differently-named collections/fields created in
> an earlier "Alert" era. See `CLAUDE.md` §5 — `Query`→collection `Alert`, `QueryMessage`→`AlertMessage`,
> `Query.queryType`→`alertType`, `QueryMessage.queryId`→`alertId`, `QueryStatus`→`AlertStatus`
> (`assigned`→`in_progress`), `Region.code`/`name`→`countryCode`/`countryName`.
>
> **Models added since this narrative was first written** (see `schema.prisma` for fields): `Notification`,
> `Conversation`, `ConversationMember`, `ChatMessage` (realtime chat), and `CsvJob` (background exports).

## Design Decisions

- Keep `Region` as a real configurable master table because it controls universities, offers, regional admins, queries, filtering, and access control.
- Store user roles directly on `User.roles` (an array) because the system has a small fixed set of roles (`student`, `mentor`, `regional_admin`, `master_admin`, `reviewer`) and does not need role records yet.
- Use `RegionalAdminProfile` instead of `AdminRegion` because one regional admin belongs to exactly one region, while one region may have many regional admins.
- Link `Offer` directly to the student `User` through `studentUserId`, not to `StudentProfile`, to reduce nesting.
- Keep `StudentProfile` for student-specific registration and review fields.
- Keep `VolunteerProfile` for volunteer-specific fields.
- Keep one central `Document` table for profile and offer files.
- Keep `OfferRevision` for approved-offer edits.
- Use `ConfigOption` for editable dropdown/master-data values that do not need relationships.
- Use `AppConfig` only for structured settings such as financial calculation rules.
- Use one generic `AuditLog` instead of separate activity-log tables per entity.

## Current Schema Groups

### Identity

#### `User`

Main login identity for students, volunteers, regional admins, mentors, and master admins.

Important fields:
- `id`
- `email`
- `passwordHash`
- `fullName`
- `phone`
- `dateOfBirth`
- `roles`
- `accountStatus`
- `emailVerifiedAt`
- `lastLoginAt`
- `deletedAt`

Relationships:
- one `StudentProfile`
- one `VolunteerProfile`
- one `RegionalAdminProfile`
- many `Offer` records as the student owner
- many `Document`
- many `Query` records as student or assignee
- many `QueryMessage`
- many `Announcement`
- many `AuthToken`
- many `AuditLog`

Role values (`roles` is an array; a user may hold several):
- `student`
- `mentor`
- `regional_admin`
- `master_admin`
- `reviewer`

### Profiles

#### `StudentProfile`

Student registration and profile-review data.

Important fields:
- `userId`
- `fullNameEnglish`
- `sex`
- `dateOfBirth`
- `locationInGaza`
- `locationOther`
- `hasOfferSelfReported`
- `hasVerifiedOffer`
- `passportStatus`
- `passportLocation`
- `passportLocationOther`
- `emergencyContactFirstName`
- `emergencyContactRelation`
- `emergencyContactPhone`
- `englishMoi`
- `bachelorUniGaza`
- `englishWorkplaceCertificatePossible`
- `englishOtherCerts`
- `consentSigned`
- `profileStatus`
- `reviewedBy`
- `reviewedAt`
- `reviewNotes`
- `deletedAt`

Relationships:
- belongs to `User`
- many `Document`

#### `VolunteerProfile`

Volunteer/mentor profile data.

Important fields:
- `userId`
- `universityAffiliation`
- `preferredRegionId`
- `volunteerStatus`
- `reviewedBy`
- `reviewedAt`
- `deletedAt`

Relationships:
- belongs to `User`

#### `RegionalAdminProfile`

Regional-admin-specific profile and region access.

Important fields:
- `userId`
- `regionId`
- `status`
- `assignedByUserId`
- `deletedAt`

Relationships:
- belongs to `User`
- belongs to one `Region`
- optional assigning `User`

Rule:
- One regional admin belongs to one region.
- One region can have many regional admins.

### Region And Master Data

#### `Region`

Configurable country/program area.

Important fields:
- `code`
- `name`
- `isActive`
- `deletedAt`

Relationships:
- many `RegionalAdminProfile`
- many `University`
- many `Offer`
- many `Query`

#### `University`

Searchable university master data.

Important fields:
- `regionId`
- `name`
- `city`
- `isLondon`
- `isActive`
- `deletedAt`

Relationships:
- belongs to `Region`
- many `Offer`

Rule:
- If an offer uses `universityId`, the backend should derive `regionId` from `University.regionId`.
- `Offer.universityName` stays as fallback text for universities not yet in the master list.

#### `ConfigOption`

Simple editable dropdown/master-data values.

Important fields:
- `groupKey`
- `value`
- `labelEn`
- `labelAr`
- `sortOrder`
- `isActive`
- `metadata`
- `deletedAt`

Recommended groups:
- `course_field`
- `course_level`
- `offer_type`
- `query_category`
- `announcement_category`

Rules:
- Use this only for values that do not own relationships.
- Do not use this for `Region` or `University`.

#### `AppConfig`

Structured settings.

Current expected use:
- `offer_financial_rules`

Rule:
- Use this for structured calculation/config policy, not ordinary dropdowns.

### Offers And Files

#### `Offer`

Student university offer and financial review data.

Important fields:
- `studentUserId`
- `regionId`
- `universityId`
- `universityName`
- `courseName`
- `courseField`
- `courseLevel`
- `durationYears`
- `programmeStartDate`
- `offerType`
- `conditions`
- `tuitionFeePerYear`
- `courseFeeSourceUrl`
- `hasScholarship`
- `scholarshipName`
- `scholarshipAmountPerYear`
- `scholarshipCoversLivingCost`
- `privateFundingAmount`
- `privateFundingSource`
- `livingCostLocationKey`
- `livingCostForVisa`
- `boardingFees`
- `reviewStatus`
- `lockedForReview`
- `reviewedBy`
- `reviewedAt`
- `reviewNotes`
- `deletedAt`

Relationships:
- belongs to student `User`
- belongs to `Region`
- optionally belongs to `University`
- many `Document`
- many `OfferRevision`
- many `Query`

#### `Document`

Central private file metadata table.

Important fields:
- `ownerUserId`
- `studentProfileId`
- `offerId`
- `documentType`
- `originalFilename`
- `mimeType`
- `fileSizeBytes`
- `storageBucket`
- `storageKey`
- `status`
- `uploadedBy`
- `deletedAt`

Current document types:
- `national_id`
- `passport`
- `moi_letter`
- `consent_form`
- `offer_letter`
- `scholarship_letter`
- `signature`
- `english_proficiency`

Rules:
- Files live outside the database.
- DB stores metadata and storage keys only.
- A document can attach to a profile or an offer.

#### `OfferRevision`

Tracks approved-offer edits.

Important fields:
- `offerId`
- `editedBy`
- `beforeData`
- `afterData`
- `changedFields`
- `createdAt`

Rule:
- JSON snapshots are acceptable for MVP because the main need is review visibility.

### Queries

#### `Query`

Student query/ticket record.

Important fields:
- `studentUserId`
- `offerId`
- `regionId`
- `queryType`
- `title`
- `message`
- `status`
- `assignedToUserId`
- `assignedByUserId`
- `acceptedAt`
- `resolvedAt`
- `deletedAt`

Relationships:
- belongs to student `User`
- optionally belongs to `Offer`
- optionally belongs to `Region`
- optionally assigned to `User`
- optionally assigned by `User`
- many `QueryMessage`

Suggested status flow:
- `open`
- `assigned`
- `resolved`

Note:
- Prisma maps `Query` to the existing database table created earlier for alerts. The API and code use Query language because this is a student ticketing feature.

#### `QueryMessage`

Conversation/history inside a query.

Important fields:
- `queryId`
- `senderUserId`
- `message`
- `deletedAt`

Relationships:
- belongs to `Query`
- belongs to sender `User`

### Auth Tokens

#### `AuthToken`

Hashed, single-use token table for auth recovery flows.

Important fields:
- `userId`
- `tokenHash`
- `type`
- `expiresAt`
- `usedAt`
- `createdAt`

Relationships:
- belongs to `User`

Current token types:
- `password_reset`
- `email_verification`

Rules:
- Store only token hashes, not raw tokens.
- Mark older active tokens of the same type as used when creating a new token.
- Reject expired or already-used tokens.

### Announcements

#### `Announcement`

Global admin-created announcement.

Important fields:
- `title`
- `body`
- `category`
- `createdByUserId`
- `isPublished`
- `publishedAt`
- `deletedAt`

Relationships:
- belongs to creator `User`

### Audit

#### `AuditLog`

Generic audit trail for sensitive actions.

Important fields:
- `actorUserId`
- `action`
- `entityType`
- `entityId`
- `metadata`
- `ipAddress`
- `userAgent`
- `createdAt`

Rule:
- Use `entityType` and `entityId` instead of creating separate activity-log tables.

## Relationship Summary

```text
User
|-- StudentProfile? 1:1
|-- VolunteerProfile? 1:1
|-- RegionalAdminProfile? 1:1
|-- Offer[] 1:M
|-- Document[] 1:M
|-- Query[] as student 1:M
|-- Query[] as assignee 1:M
|-- QueryMessage[] 1:M
|-- Announcement[] 1:M
|-- AuthToken[] 1:M
`-- AuditLog[] 1:M

Region
|-- RegionalAdminProfile[] 1:M
|-- University[] 1:M
|-- Offer[] 1:M
`-- Query[] 1:M

University
`-- Offer[] 1:M

Offer
|-- Document[] 1:M
|-- OfferRevision[] 1:M
`-- Query[] 1:M

Query
`-- QueryMessage[] 1:M
```

## ERD Image

See [`database-erd.svg`](database-erd.svg).
