---
name: gaza40plus-architecture
description: Architectural context, repository organization, engineering conventions, and development workflow for the Gaza40+ platform (backend and frontend). Use when implementing features, debugging, reviewing, refactoring, or navigating the repos.
---

# Gaza40Plus Architecture Skill

## Purpose

This skill helps the AI understand how the Gaza40Plus platform is organized and how
new changes should be implemented without breaking existing functionality.

It is the primary architectural guide for all development tasks.

---

# How to use this skill

Before proposing any code changes:

1. Identify whether the request affects the frontend, backend, or both.
2. Read the relevant architecture document(s).
3. Understand the existing module before proposing changes.
4. Search for existing implementations before creating new code.
5. Prefer extending existing functionality over introducing duplicate logic.
6. Keep architectural changes incremental and easy to review.
7. Preserve backward compatibility unless explicitly instructed otherwise.
8. Explain the architectural impact before suggesting major refactors.
9. Do not invent architecture that is not documented.
10. When business rules or permissions are involved, defer to dedicated skills such as RBAC instead of making assumptions.

---

# Scope

This skill provides architectural guidance only.

Use it for:

* Repository structure
* Frontend organization
* Backend organization
* Development conventions
* Project layout
* Engineering principles

Do not use this skill for:

* RBAC permissions
* Database schema
* API contracts
* Document workflows
* Business rules
* Testing strategy

Dedicated skills should be used for those topics.

---

# Available Documents

* architecture/project-structure.md
* architecture/frontend.md
* architecture/backend.md
* architecture/development-principles.md


## Standard Development Workflow

For every development request:

Step 1

Determine the affected repositories.

Step 2

Locate the existing implementation.

Step 3

Understand existing architecture.

Step 4

Identify reusable utilities.

Step 5

Determine affected modules.

Step 6

Evaluate regression risks.

Step 7

Propose minimal architectural changes.

Step 8

Implement incrementally.

Step 9

Explain every modified file.

Step 10

Suggest regression tests.

## Things to Avoid
Never duplicate existing utilities.

Never create new hooks if an existing one can be extended.

Never duplicate service logic.

Never move files without explaining why.

Never rewrite entire modules for small feature requests.

Never bypass backend authorization.

Never introduce breaking API changes unless requested.

Never modify shared modules without considering regression impact.

## Response Style
When answering:

Explain the existing architecture first.

Explain why changes are needed.

Prefer minimal modifications.

Reference existing modules.

Call out potential regressions.

Highlight architectural trade-offs.

Avoid unnecessary rewrites.