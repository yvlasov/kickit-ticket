# KickIt Ticket — Product Spec

Status: Synthesized via `/to-spec` from the agreed design (grilling rounds 1–4). Implementation pending.
Format: product-facing sections of the to-spec template. Implementation Decisions and Testing
Decisions live in `docs/SPEC.md`. Task: `docs/TAKS_1.md`. Judge checks: `docs/TASK_1_DOD.md`.
Tracker: GitHub Issues (`yvlasov/kickit-ticket`); this spec is published there with `ready-for-agent`.

## Problem Statement

Teams need a lightweight, shared place to capture work as tickets and move it through a
fixed Kanban workflow. Existing tools are either too heavy (sprints, roles, dashboards) or
too ephemeral (whiteboards, spreadsheets) for a small team that just wants verified accounts,
teams, epics, tickets, comments, and a draggable board that persists. The product must be a
complete, working three-tier application — not a prototype — that anyone can run on a clean
Windows/macOS/Linux laptop with only Docker, and that a judge can verify end to end.

## Solution

A single-page web application backed by an HTTP API and a relational database. A person signs
up with email and password, verifies the address through a configurable SMTP service, and logs
in. All verified users share one workspace: they create teams, group work under epics, raise
tickets classified as bug/feature/fix, and drag ticket cards across five fixed columns
(new → ready for implementation → in progress → ready for acceptance → done). They comment on
tickets, filter the board by type/epic/title, and trust that everything persists across refresh
and restart. The whole system starts with one command (`docker compose up --build`) and ships
with automated tests and a README. Deleted-but-referenced records are protected, recency
ordering reflects real changes only, and no secrets or seed data ship in the repo.

## User Stories

1. As a new user, I want to sign up with my email and a password, so that I can get an account.
2. As a new user, I want my email trimmed and compared case-insensitively for uniqueness, so that duplicate accounts aren't created.
3. As a new user, I want to be told my password must be at least 8 characters, so that I choose a valid one.
4. As a new user, I want to receive a verification email after signup, so that I can prove I own the address.
5. As a new user, I want a clear "check your email" screen after signup, so that I know what to do next.
6. As an unverified user, I want a verification link that works once within 24 hours, so that I can activate my account.
7. As an unverified user, I want a verification-result screen distinguishing success/expired/invalid/used, so that I understand the outcome.
8. As an unverified user, I want to be led to the login screen after successful verification rather than auto-logged-in, so that I sign in explicitly.
9. As an unverified user, I want to request a new verification email from the login or result screen, so that I can recover from an expired or lost link.
10. As an unverified user, I want a new verification request to invalidate earlier unused links, so that only the latest link works.
11. As an unverified user, I want login refused with a resend option, so that I know I must verify first.
12. As a user, I want to log in with email and password, so that I can access the app.
13. As a user, I want to log out from the header user menu, so that I can end my session on a shared machine.
14. As a user, I want my password stored hashed and never in plain text, so that my credential is protected.
15. As a user, I want resend to not reveal whether an email exists, so that accounts can't be enumerated.
16. As a security-conscious user, I want verification tokens single-use and expiring, so that leaked links can't be reused.
17. As a verified user, I want to see all teams, so that I can pick where to work.
18. As a verified user, I want to create a team with a unique non-empty name, so that I can organize tickets.
19. As a verified user, I want to rename a team, so that I can correct its name.
20. As a verified user, I want to delete an empty team, so that I can remove unused groups.
21. As a verified user, I want team delete blocked with a clear message when it contains tickets or epics, so that I don't lose work accidentally.
22. As a verified user, I want team names unique case-insensitively, so that "Core" and "core" don't collide.
23. As a verified user, I want a team's created and modified timestamps, so that I can see recency.
24. As a verified user, I want a separate epic screen to create, list, edit, and delete epics, so that I can manage larger work items.
25. As a verified user, I want to choose an epic's team at creation and not change it later, so that grouping stays stable.
26. As a verified user, I want an epic title required and description optional, so that I can capture intent.
27. As a verified user, I want epic delete blocked while tickets reference it, with a clear message, so that references stay valid.
28. As a verified user, I want to filter epics by team, so that I can focus on one team's epics.
29. As a verified user, I want to create a ticket with team, type, title, body, and optional epic/state, so that I can capture work.
30. As a verified user, I want ticket type limited to bug/feature/fix, so that classification is consistent.
31. As a verified user, I want ticket state limited to the five canonical values, so that the workflow is fixed.
32. As a verified user, I want to pick an epic only from the ticket's team, so that cross-team references are impossible.
33. As a verified user, I want the backend to reject a cross-team epic even if the UI sends one, so that integrity is enforced server-side.
34. As a verified user, I want to view all ticket fields including created by, created at, and modified at, so that I have full context.
35. As a verified user, I want to edit type, team, epic, title, body, and state, so that I can keep tickets current.
36. As a verified user, I want changing a ticket's team to clear or replace its epic, so that stale cross-team epics don't persist.
37. As a verified user, I want saving unchanged values to NOT advance modified-at, so that recency ordering reflects real changes only.
38. As a verified user, I want to delete a ticket after an explicit confirmation, so that removal is deliberate.
39. As a verified user, I want deleting a ticket to remove its comments, so that no orphans remain.
40. As a verified user, I want invalid enums and references rejected by the backend, so that bad data can't enter.
41. As a verified user, I want to add a non-empty comment to a ticket, so that I can discuss it.
42. As a verified user, I want comments shown oldest-first with author email and time, so that I can follow the conversation.
43. As a verified user, I want adding a comment to NOT change the ticket's modified-at or board order, so that discussion doesn't reshuffle the board.
44. As a verified user, I want comments immutable in the mandatory scope, so that the record is stable.
45. As a verified user, I want a five-column board for a selected team in workflow order, so that I can see status at a glance.
46. As a verified user, I want cards showing title, type, and epic, so that I can identify work quickly.
47. As a verified user, I want to drag a card between any two columns and have it persist immediately, so that status updates are fast.
48. As a verified user, I want a failed drag to snap the card back and show an error, so that I'm not misled about state.
49. As a verified user, I want cards ordered by most-recently-modified within a column, so that fresh work surfaces.
50. As a verified user, I want to create a ticket and open a ticket from the board, so that I can act without losing context.
51. As a verified user, I want to filter by type and epic and search title (case-insensitive substring), combined with AND, so that I can narrow the board.
52. As a verified user, I want the board usable with 100+ tickets, so that scale doesn't break it.
53. As a verified user, I want team selection and filters preserved in the URL across refresh, so that I keep my context.
54. As a verified user, I want loading, empty, and error states (and a create-team prompt when no teams exist), so that I always know what's happening.
55. As a verified user, I want my data to survive browser refresh and application restart, so that nothing is lost.
56. As a judge/QA, I want to start everything with `docker compose up --build` on a clean laptop, so that I can evaluate without other installs.
57. As a judge/QA, I want a fresh empty database with no seed data, so that I create my own test data.
58. As a judge/QA, I want an opt-in demo script that creates 100+ tickets through the API, so that I can check scale quickly.
59. As a judge/QA, I want automated backend and frontend/API tests that pass, so that I can trust the invariants.
60. As an operator, I want SMTP configurable (Mailpit by default, relay switch) with no secrets in the repo, so that email works in any environment safely.
61. As an operator, I want health and readiness endpoints, so that I can monitor startup.
62. As a user, I want the app to work in current desktop Chrome, Edge, and Firefox, so that I'm not browser-locked.

## Out of Scope

- Scrum: sprints, backlogs, story points, velocity, burndown, sprint planning.
- SSO/OAuth/corporate identity/social login.
- Fine-grained roles, admins, team membership, private teams, per-ticket access control.
- Attachments, notifications, mentions, watchers, audit history, real-time multi-user updates.
- Custom workflows/types, subtasks, dependencies, time tracking, reporting dashboards.
- Production deployment, high availability, production-grade mail infrastructure.
- Stretch features are NOT committed: edit/delete own comments, virtualized rendering,
  password reset, ticket activity history. Order if time remains: own-comment edit/delete →
  virtualization → password reset → activity history.

## Further Notes

- All verified users share one workspace; there is no ownership or membership model.
- Email verification must support the corporate relay (relay1.dataart.com); its port/auth/TLS
  facts are pending from the product owner. Configuration already supports all modes.
- The default database is empty (schema + migration metadata only); QA creates data via UI/API.
- An opt-in demo script (never run at startup) supports the 100+ ticket scale check.
- Acceptance scenarios and the judge checklist are in `docs/TASK_1_DOD.md`; technical contracts
  and testing seams are in `docs/SPEC.md`.
