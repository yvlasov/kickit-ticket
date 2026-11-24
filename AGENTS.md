# KickIt Ticket — Agent Guide

Project description and working contract for agents in this repository.

## What this is
A hackathon three-tier Kanban ticket tracker: single-page React frontend, Fastify HTTP API,
PostgreSQL persistence. Teams → epics → tickets → comments, with a draggable five-column
board per team and email-verified local accounts. The entire system must start from a clean
checkout with `docker compose up --build` on Windows/macOS/Linux with only Docker installed.

## Current state
Design agreed via grilling (rounds 1–4). Documentation exists; **no application code yet**.
`server/`, `web/`, `shared/`, `scripts/`, `compose.yaml`, `.env.example` are planned, not built.
Commands below are the target contract, not yet runnable.

## Source of truth (read in this order)
1. `docs/TAKS_1.md` — the hackathon task (mandatory scope, fields, invariants, out-of-scope).
2. `docs/TASK_1_DOD.md` — judge checks / Definition of Done.
3. `docs/PRD.md` — product requirements and acceptance scenarios.
4. `docs/SPEC.md` — technical contracts: stack, data model, API, auth, config, testing.

When documents and live code disagree, establish which is right before acting. Re-read the
relevant spec section immediately before editing a contract it defines.

## Repo map (target)
```
compose.yaml        app + postgres + mailpit; test profile
.env.example        all env vars + commented relay block (no secrets)
README.md           prerequisites, configuration, startup, tests, troubleshooting
AGENTS.md           this file
docs/               PRD, SPEC, task, DoD
scripts/            demo-data.ts (opt-in, never at startup)
server/             Fastify routes/services, Drizzle schema + migrations
web/                Vite React SPA (TanStack Query, react-router, shadcn/ui, dnd-kit)
shared/             zod schemas + enums + API types (consumed as TS source by both)
```

## Key commands (target)
- Start: `docker compose up --build` → app http://localhost:3000, Mailpit http://localhost:8025.
- Tests: `docker compose --profile test run --rm tests-api` and `… run --rm tests-e2e`.
- Scale demo (opt-in): `scripts/demo-data.ts` creates a verified user + team + epics + 100+ tickets via the public API.

## Guardrails (do not violate)
- Docker-only startup; no host runtime beyond Docker Compose. Cross-platform.
- Fresh DB = schema + migration metadata only. **No seed data** on any default path.
- **No secrets or hard-coded passwords** in source or git history. `.env` gitignored; `.env.example` present.
- All create/update/delete goes through the API into Postgres. localStorage is not the system of record.
- Backend validates every enum/reference with shared zod; client-side validation alone is insufficient.
- `modified_at` advances only on actual ticket field/state change. No-op saves and comments must NOT change it.
- Blocked deletes (team with tickets/epics, epic with tickets) return **409**; UI disables delete with a reason. No cascade delete of teams/epics.
- Email and team names trimmed + case-insensitive unique (citext).
- Ticket epic must belong to the ticket's team; team change clears/replaces epic. Enforced server-side.
- Timestamps UTC ISO-8601. Identifiers UUID. No tokens in URLs except the single-use verification link.
- Verification tokens: hashed at rest, 24 h expiry, single-use; reissue invalidates prior unused.
- Passwords Argon2id, min 8 chars. Sessions opaque DB rows, HttpOnly/SameSite cookie.
- Comments immutable in mandatory scope; oldest-first; show author email + time.

## Working agreement
- Plan → Implement → Validate. Confirm plan before multi-file edits; run the project's
  test/build command and show real output before declaring done.
- Change only what the task names. Adjacent problems go in the report, not the diff.
- Stretch features: **none committed**. Order if time remains: own-comment edit/delete →
  virtualization → password reset → activity history. Do not silently expand scope.
- Keep corporate context isolated; internal hostnames (e.g. the SMTP relay) stay in work files only.

## Open items
- SMTP relay connection facts for relay1.dataart.com (port/auth/TLS) pending from the product
  owner. Config already supports all modes (see docs/SPEC.md → Configuration & SMTP); nothing else blocks implementation.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`yvlasov/kickit-ticket`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/` (created lazily by `/domain-modeling`). See `docs/agents/domain.md`.
