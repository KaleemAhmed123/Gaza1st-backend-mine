# Gaza40Plus System Roles

This document defines the system roles and role hierarchies within the Gaza40Plus platform.

---

## 1. Student

### Purpose
The primary beneficiary of the platform. The Student role represents the candidate seeking educational or career placements, resources, and mentorship.

### Primary Responsibilities
* Complete the onboarding profile setup accurately.
* Upload required personal and verification documents (e.g., Passport, National ID, Offer Letters, and Supporting Documents).
* Browse, search, and apply for opportunities/offers.
* Submit and track queries or support tickets.
* Interact with assigned mentors and support administrators via chat.

### Scope of Access
* **Owner-scoped**: Access is strictly limited to the user's own account, profile data, uploaded files, and created queries.
* **Read-only global access**: Can view public announcements and available offers published to students.
* **No peer access**: Cannot view or modify profiles, queries, or documents of other students.

### Typical Workflows
* **Onboarding**: Registering, completing the profile setup, and uploading Passport/National ID documents for identity verification.
* **Application & Verification**: Applying for offers, obtaining placement confirmation, and uploading Offer Letters/Supporting Documents for program approval.
* **Query & Mentorship**: Raising support queries about placements and engaging in discussions with their assigned mentor.

---

## 2. Mentor

### Purpose
An advisor assigned to guide and support students. The Mentor role facilitates academic, professional, and personal growth for a defined group of candidates.

### Primary Responsibilities
* Review and evaluate the progress of assigned students.
* Provide feedback on student offer letters and supporting documents.
* Answer student inquiries and participate in mentoring chat conversations.
* Coordinate with administrators regarding student status and placement reviews.

### Scope of Access
* **Assignment-scoped**: Can only access the profiles, chat history, and non-sensitive documents of students explicitly assigned to them.
* **Document restrictions**: Authorized to view student Offer Letters and general Supporting Documents. Strictly restricted from viewing sensitive identity documents (Passport and National ID).
* **No administrative access**: Cannot perform system-level settings configurations, create offers, or manage user roles.

### Typical Workflows
* **Mentorship & Chat**: Reviewing the assigned students list, reading student profiles, and engaging in support chats.
* **Progress Review**: Inspecting uploaded supporting documents or offer letters for assigned students to check for correctness and readiness, and providing constructive feedback.

---

## 3. Regional Admin

### Purpose
A regional coordinator responsible for supervising mentors, students, and program operations within a specific geographical or administrative region.

### Primary Responsibilities
* Manage and assign mentors to students within their designated region.
* Review, verify, and approve/reject placement documents (Offer Letters, Supporting Documents) submitted by regional students.
* Monitor regional metrics and coordinator/mentor activity.
* Moderate and resolve regional student queries.

### Scope of Access
* **Region-scoped**: Access is restricted to users, mentors, documents, and queries within their designated region.
* **Document restrictions**: Authorized to access and verify Offer Letters and Supporting Documents of regional students. Strictly restricted from viewing sensitive identity documents (Passport and National ID) to preserve candidate privacy.
* **No global settings access**: Cannot perform global platform settings modifications or access data from other regions.

### Typical Workflows
* **Regional Supervision**: Monitoring regional registration queues, assigning mentors to newly onboarded students, and checking regional dashboards.
* **Verification & Moderation**: Reviewing and approving/rejecting submitted Offer Letters or Supporting Documents from regional students, and addressing unresolved regional helpdesk queries.

---

## 4. Master Admin

### Purpose
A global system administrator with full administrative control and oversight over the entire Gaza40Plus platform.

### Primary Responsibilities
* Supervise platform operations globally across all regions.
* Manage global settings, portal variables, and system-wide announcements.
* Configure and assign roles, manage system users, and audit system actions.
* Verify sensitive identity documents globally to finalize candidate eligibility.
* Coordinate system integrations, database seeds, and high-level escalations.

### Scope of Access
* **Global scope**: Complete access to all data, settings, logs, and resources across the entire platform.
* **Unrestricted document access**: Fully authorized to view all document classifications, including sensitive identity credentials (Passport and National ID) for verification and auditing.
* **Full system authority**: Authorized to override status flags, re-assign records, and configure system policies.

### Typical Workflows
* **System Operations**: Creating new regional divisions, updating platform settings, broadcasting portal-wide announcements, and auditing user actions.
* **High-Level Verification**: Accessing and validating sensitive identity files (Passport/ID uploads) to verify student profiles globally and resolving cross-regional escalations.

---

## 5. Reviewer

### Purpose
A dedicated profile reviewer added after the original four roles. The Reviewer focuses on evaluating
and actioning **student profiles** (approve / request changes / reject) without holding full
Master Admin authority over platform settings, users, or regions.

### Scope of Access
* **Review-scoped**: Can list and open submitted student profiles for review and record a decision.
* Resolved by `getAdminScope()` (`src/shared/auth-scope.ts`), which returns `{ role: "reviewer" }`.
* **Not** a settings/user administrator: no global platform configuration, role management, or
  regional-admin management.
* Notification deep links route reviewers to `/reviewer/student-reviews`.

### Notes
* `User.roles` is an array, so a user could in principle hold `reviewer` alongside another role.
* When adding permission logic, treat Reviewer explicitly — do not assume it collapses into
  Master Admin or Regional Admin. Prefer the least-privileged interpretation and confirm against
  `src/shared/auth-scope.ts` and the relevant service.
