# KickIt Ticket — Technical Spec

Status: Synthesized via `/to-spec` from the agreed design (grilling rounds 1–4). Implementation pending.
Format: Implementation Decisions and Testing Decisions of the to-spec template. Product-facing
sections (Problem, Solution, User Stories, Out of Scope) live in `docs/PRD.md`. Task:
`docs/TAKS_1.md`. Judge checks: `docs/TASK_1_DOD.md`. Published to GitHub Issues with `ready-for-agent`.

## Implementation Decisions

### Architecture & modules
- Three logical tiers: a single-page presentation tier, an application/API tier, and a
  relational persistence tier. The API tier serves the compiled SPA, so presentation and API
  are same-origin (no CORS; cookie auth is trivially same-origin).
- Backend: Node 22 + TypeScript on a Fastify HTTP server. Persistence: PostgreSQL 17 with the
  `citext` extension. ORM/migrations: Drizzle + drizzle-kit (idempotent, fail-fast, run before
  the server listens).
- Frontend: React 18 + Vite + TypeScript, TanStack Query for server-state, react-router for
  navigation, Tailwind + shadcn/ui primitives for UI, `@dnd-kit/core` for drag-and-drop.
- A shared validation module (zod schemas + enums + API types) is consumed as source by both
  tiers, making "backend must validate; client-side alone is insufficient" a single source of truth.
- Mail: Nodemailer against a configurable SMTP transport; Mailpit is the default compose sink.
- Monorepo with npm workspaces (server, web, shared). Runtime container image is Debian-based
  Node 22 slim so Argon2 native prebuilds work without a musl compile step.
- Modules (conceptual, not paths): auth service (signup/login/logout/verify/resend, sessions,
  tokens), team service, epic service, ticket service (diffing update semantics), comment
  service, board query (filtered, ordered), mailer, session store, verification-token store,
  migration runner, health/readiness, SPA static serving + fallback.

### Data model
UUID primary keys. All timestamps are timezone-aware, stored and returned as UTC ISO-8601.
Email and team name are `citext` unique, trimmed before write. Deletion rules are structural:
team/epic references RESTRICT (no cascade); ticket→comments CASCADE.

| Entity | Attributes | Constraints / indexes |
| --- | --- | --- |
| users | id, email, password_hash, email_verified_at, created_at, modified_at | email citext unique |
| sessions | opaque id, user_id, expires_at, created_at | FK user RESTRICT; index user_id |
| verification_tokens | id, user_id, token_hash, expires_at, used_at, created_at | FK user CASCADE; index user_id |
| teams | id, name, created_at, modified_at | name citext unique |
| epics | id, team_id, title, description, created_at, modified_at | FK team RESTRICT; index team_id |
| tickets | id, team_id, type, state, epic_id, title, body, created_by, created_at, modified_at | FK team RESTRICT, epic RESTRICT (nullable), created_by→users RESTRICT; index (team_id, state, modified_at DESC) |
| comments | id, ticket_id, author_id, body, created_at | FK ticket CASCADE, author→users RESTRICT; index (ticket_id, created_at) |

Enums: ticket.type ∈ {bug, feature, fix}; ticket.state ∈ {new, ready_for_implementation,
in_progress, ready_for_acceptance, done}. Enforced by both DB CHECK and shared zod.

### API contract
REST under a common API prefix, JSON. Error envelope `{ error: { code, message } }`; 400 may
add `details: [{ field, message }]` for inline form errors. Status codes: 400 validation,
401 unauthenticated, 403 unverified (`EMAIL_NOT_VERIFIED`), 404 missing, 409 conflict (blocked
deletes, duplicate email/team name). Session cookie required on all business endpoints;
unverified sessions rejected 403. Public: signup, login, verify, resend, health, readiness,
static assets. Identifiers UUID; timestamps UTC ISO-8601; no tokens in URLs except the
single-use verification link.

| Operation | Input | Success | Notes |
| --- | --- | --- | --- |
| signup | email, password | 201 | sends verification email; no session created |
| login | email, password | 200 + cookie | 401 bad creds; 403 unverified |
| logout | — | 204 | deletes session row, clears cookie |
| verify | token | 200 | status ∈ success/expired/invalid/used |
| resend-verification | email | 202 | always 202; no enumeration; invalidates prior unused |
| me | — | 200 | id, email |
| list teams | — | 200 | includes ticketCount, epicCount |
| create team | name | 201 | 400 empty; 409 duplicate |
| rename team | name | 200 | no-op preserves modifiedAt; 409 duplicate |
| delete team | — | 204 | 409 if tickets/epics exist |
| list epics | team filter | 200 | includes ticketCount |
| create epic | teamId, title, description? | 201 | team immutable after create |
| edit epic | title, description? | 200 | team read-only; no-op preserves modifiedAt |
| delete epic | — | 204 | 409 if tickets reference |
| board tickets | team + type/epic/q filters | 200 | all states; order modifiedAt DESC, id DESC |
| create ticket | teamId, type, state?, epicId?, title, body | 201 | state default new; 400 cross-team epic/enum |
| get ticket | — | 200 | ticket + comments oldest-first |
| edit ticket | type?, teamId?, epicId?, title?, body?, state? | 200 | diff no-op; team-change epic rules |
| delete ticket | — | 204 | cascades comments |
| add comment | body | 201 | does NOT touch ticket modifiedAt |
| health / readiness | — | 200 | public; readiness pings DB |

Board filter semantics: type exact enum; epic sentinel `none` → IS NULL, a UUID → equality,
absent → all; q → escaped case-insensitive substring on title; AND-combined, server-side.

### Auth & verification
- Password: Argon2id (m=64 MiB, t=3, p=1), minimum 8 characters.
- Sessions: opaque random id stored in Postgres; cookie HttpOnly, SameSite=Lax, Secure only
  under HTTPS; 7-day absolute expiry; logout deletes the row. No signing secret needed.
- Verification tokens: 32-byte random, SHA-256-hashed at rest, 24 h expiry, single-use;
  issuing a new token deletes prior unused tokens for that user.
- Email link targets the SPA verification route with the token in the query; the SPA posts the
  token to the verify operation and renders the result state. Signup leads to a check-email
  screen (no auto-login). Unverified login → 403 + resend affordance. Resend always 202.
- A global frontend 401 handler clears the query cache and redirects to login.

### Ticket update semantics
The service loads the current row, normalizes the patch (trim title/body), and diffs
field-by-field. No effective change → skip the UPDATE and return the unchanged row (modifiedAt
preserved). Team change: epic auto-nulled if not supplied; if supplied it must belong to the
new team else 400. Comment inserts never update the ticket row. The same no-op diffing applies
to team and epic edits. Concurrency: last successful write wins; no conflict detection.

### Board & drag-and-drop
Five droppable columns in workflow order; draggable cards show title, type badge, epic title.
A drop issues the same ticket-edit operation used by the form, carrying the new state.
TanStack Query optimistic update snapshots the team-ticket cache and moves the card; on error
it restores the snapshot and shows an error toast; on settled it invalidates. Team selection
and filters persist in the URL. Within-column order: modifiedAt DESC, id DESC. States: loading
skeletons, per-column and board empty, error + retry, and a create-team prompt when no teams.

### Configuration & SMTP
Nodemailer transport with an all-modes env surface; compose defaults point at Mailpit. A
commented relay block documents switching to the corporate relay. No secrets committed; the
real env file is gitignored and an example file is present.

| Variable | Default | Purpose |
| --- | --- | --- |
| DATABASE_URL | postgres on internal network | app DB connection |
| PORT | 3000 | app listen port |
| PUBLIC_BASE_URL | http://localhost:3000 | builds verification links; must match how QA reaches the app |
| SESSION_COOKIE_NAME | kickit_session | cookie name |
| SESSION_TTL_HOURS | 168 | session absolute expiry |
| SMTP_HOST | mailpit | relay switch: relay1.dataart.com |
| SMTP_PORT | 1025 | relay port pending |
| SMTP_USER / SMTP_PASS | empty | relay auth if required |
| SMTP_SECURE | false | implicit TLS |
| SMTP_STARTTLS | false | upgrade to TLS |
| SMTP_FROM | no-reply@kickit.local | sender |
| NODE_ENV | production | runtime mode |

Relay port/auth/TLS facts are pending from the product owner; config supports no-auth, AUTH,
and TLS variants, so nothing else blocks.

### Bootstrap, deployment & migrations
Compose default profile: app (publishes 3000, serves SPA + API, runs migrations on start),
Postgres 17 (internal, volume-backed, healthcheck), Mailpit (UI 8025, SMTP 1025 internal).
App depends on Postgres healthy. A test profile adds an ephemeral test database and the two
test runners. Migrations are committed SQL, idempotent, fail-fast, run before listen; the
citext extension is created in migration. No seed data on any default path; a fresh DB holds
schema + migration metadata only. SPA fallback serves the index for any non-API GET.

### Security & cross-platform
All business endpoints session-guarded; unverified blocked; input validated by shared zod.
Passwords Argon2id; tokens hashed; cookies HttpOnly/SameSite, Secure under HTTPS. No
credentials or SMTP secrets in source or git history. Docker-only startup; Debian-based Node
image avoids musl native-build issues; cross-platform via compose. Browser support: current
Chrome/Edge/Firefox.

## Testing Decisions

### What makes a good test
Test external behavior only, not implementation details: HTTP status codes, error envelopes,
persisted state, observable invariants, and rendered UI outcomes. Avoid asserting internal
function calls, cache shapes, or DOM structure beyond what the user observes.

### Seams (confirmed)
- Primary / highest seam: the running app's HTTP API, black-box via supertest against a real
  ephemeral Postgres and Mailpit. This single seam satisfies both DoD test bullets (backend
  business-flow and API-flow). The verification link is retrieved through Mailpit's HTTP API,
  proving real SMTP delivery rather than a DB shortcut.
- Secondary seam: the browser via Playwright against the composed app, limited to UI-only
  invariants the API cannot observe — optimistic drag snap-back + error toast, refresh
  persistence, filter UI, and delete confirmation.
- Two seams (not one) because snap-back/toast is observable only in the browser. These are new
  seams proposed at the highest points; no code exists yet.

### Coverage / invariants asserted
API seam: weak/duplicate-email rejection (case/space variants), password < 8 rejected, token
reuse fails, token expiry, reissue invalidates prior unused, unverified login 403 + resend,
cross-team epic 400, invalid enum 400, no-op edit preserves modifiedAt, comment preserves
modifiedAt, state change advances modifiedAt, blocked team/epic deletes 409, ticket delete
cascades comments, logout invalidates session, filters AND-combine, board ordering.
Browser seam: signup→verify→login→team→epic→ticket→drag→refresh persists; drag rollback shows
snap-back + error toast; combined filters; comment author/time/oldest-first; delete confirm.

### Failure simulation & scale
Drag failure is simulated deterministically by aborting the network route in Playwright (no
container-stop race). The literal "stop the backend and drag" DoD check remains a manual step.
An opt-in demo script (never run at startup) signs up a verified user and creates a team,
epics, and 100+ tickets through the public API for the scale check.

### Prior art
Greenfield: no tests exist yet. This spec establishes the prior art — API black-box integration
tests (vitest + supertest) and browser E2E (Playwright), both runnable through the compose test
profile with one command.

## Further Notes

- Product requirements, user stories, and out-of-scope are in `docs/PRD.md`.
- Open item: SMTP relay connection facts (port/auth/TLS) pending; configuration complete.
- Stretch features are not committed; see PRD Out of Scope for the deferred order.
- Traceability: PRD user stories → API contract + semantics above; DoD → testing seams +
  bootstrap; data model encodes the deletion/uniqueness invariants structurally.
