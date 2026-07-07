---
name: gaza40plus-rbac
description: The Role-Based Access Control (RBAC) model for the Gaza40+ platform. Use when implementing, debugging, reviewing, or modifying authentication, authorization, ownership validation, document access, approval workflows, mentor assignment, regional access, dashboard visibility, or any permission-dependent feature.
---

# Gaza40Plus RBAC Skill

## Purpose

This skill defines the authorization model of Gaza40Plus.

It is the single source of truth for role permissions, ownership rules,
document access, and authorization principles.

Business rules documented here take precedence over assumptions derived from code.

---

## Development Rules

When a request involves permissions:

1. Determine the acting user.
2. Determine the resource being accessed.
3. Determine ownership.
4. Determine assignment.
5. Determine regional scope.
6. Apply role permissions.
7. Verify backend enforcement.
8. Verify frontend visibility.
9. Identify regression risks.

Never infer permissions that are not documented.

Always prefer the least-privileged interpretation.

---

## Scope

This skill covers:

* Roles
* Permissions
* Ownership
* Assignment
* Regional scope
* Document permissions
* Authorization workflow

This skill does not define:

* Database schema
* API implementation
* Frontend architecture
* Storage implementation

Refer to dedicated skills for those topics.

---

## Available Documents

### Core RBAC

* rbac/roles.md
* rbac/permission-model.md
* rbac/ownership-rules.md

### Documents

* rbac/document-access.md

### Engineering

* rbac/implementation-guidelines.md
* rbac/security-principles.md

### Review

* rbac/common-scenarios.md
* rbac/regression-checklist.md



## Authorization Evaluation Order

Whenever an access-control question is asked, evaluate permissions in this exact order:

1. Authentication
   - Is the user authenticated?

2. Acting Role
   - Student
   - Mentor
   - Regional Admin
   - Master Admin

3. Ownership
   - Does the resource belong to the user?

4. Assignment
   - Is the resource assigned to the mentor?

5. Regional Scope
   - Is the resource inside the admin's region?

6. Resource Type
   - Student
   - Offer
   - Query
   - Document
   - Chat
   - Announcement

7. Requested Action
   - Read
   - Create
   - Update
   - Delete
   - Preview
   - Download
   - Approve

8. Business Rules

8. Backend Enforcement

9. Frontend Visibility

## Standard Development Workflow

For every development request:

1.

Identify affected repository.

2.

Locate existing implementation.

3.

Understand architecture.

4.

Reuse existing modules.

5.

Determine regression risk.

6.

Implement incrementally.

7.

Explain modified files.

8.

Suggest regression tests.

Prefer extending existing functionality over introducing duplicate implementations.

Never skip ownership or regional scope checks even for higher privileged roles unless explicitly documented.
