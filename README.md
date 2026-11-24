# KickIt Ticket

A hackathon-grade Kanban ticket tracker: a single-page React frontend, a Fastify HTTP API, and PostgreSQL persistence. Teams contain epics; epics group tickets; tickets move through a five-column Kanban board via drag-and-drop. Users register with email + password, verify via a confirmation email sent through SMTP, and authenticate with cookie-based sessions.

> **Manual testing?** See the [Manual Testing Guide](e2e/manual-testing-guide.md) — seeded test accounts, registration **without an external SMTP server** (via the bundled Mailpit), and the stop-backend-and-drag check.

## Stack

| Tier | Technology |
| --- | --- |
| Frontend | React 18 + Vite + TypeScript, TanStack Query, react-router, Tailwind CSS, @dnd-kit |
| Backend | Node 22 + TypeScript, Fastify, Drizzle ORM, PostgreSQL 17 |
| Mail | Nodemailer → configurable SMTP (Mailpit by default) |
| Auth | Argon2id passwords, opaque DB sessions, hashed single-use verification tokens |
| Infra | Docker Compose (cross-platform: Windows / macOS / Linux) |

## Prerequisites

- **Docker** and **Docker Compose** (the only host-side requirement). No Node.js, no database, no separate runtime needed.

## Startup

```bash
docker compose up --build
```

- App: **http://localhost:3000**
- Mailpit UI: **http://localhost:8025**
- The first build takes a few minutes (compiles TypeScript, installs dependencies, builds the SPA).

After the stack is up, open the app in a browser. The database starts empty — no seed data is loaded.

### Port overrides

Override the default host ports via environment variables:

```bash
APP_PORT=3014 MAILPIT_UI_PORT=8039 docker compose up --build
```

Then the app is at `http://localhost:3014` and Mailpit UI at `http://localhost:8039`.

## Configuration

Copy `.env.example` to `.env` and adjust values as needed:

```bash
cp .env.example .env
```

> `.env` is gitignored — never commit secrets.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://kickit:kickit@postgres:5432/kickit` | PostgreSQL connection string (internal Docker network) |
| `PORT` | `3000` | App listen port |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Base URL used to build verification email links. **Must match how users reach the app** (e.g. if behind a reverse proxy or using a custom port, set this accordingly) |
| `SESSION_COOKIE_NAME` | `kickit_session` | Name of the session cookie |
| `SESSION_TTL_HOURS` | `168` | Session absolute expiry (7 days) |
| `SMTP_HOST` | `mailpit` | SMTP relay hostname. Switch to `relay1.dataart.com` for corporate mail |
| `SMTP_PORT` | `1025` | SMTP relay port |
| `SMTP_USER` | *(empty)* | SMTP auth username (if required) |
| `SMTP_PASS` | *(empty)* | SMTP auth password (if required) |
| `SMTP_SECURE` | `false` | Use implicit TLS (SMTPS) |
| `SMTP_STARTTLS` | `false` | Upgrade connection to TLS via STARTTLS |
| `SMTP_FROM` | `no-reply@kickit.local` | Sender address for verification emails |
| `NODE_ENV` | `production` | Runtime mode |

### Switching to the corporate SMTP relay

The `.env.example` file includes a commented-out block that documents the relay switch:

```env
# SMTP relay (uncomment to switch from Mailpit)
# SMTP_HOST=relay1.dataart.com
# SMTP_PORT=587
# SMTP_USER=your-username
# SMTP_PASS=your-password
# SMTP_SECURE=false
# SMTP_STARTTLS=true
```

Uncomment the block above in `.env` to route emails through `relay1.dataart.com`. Connection facts (port, auth, TLS) are pending from the product owner; the config supports no-auth, AUTH, and TLS variants.

## Tests

The test profile spins up an ephemeral test database alongside the main stack. **No host ports are bound** for test services — they communicate over the internal Docker network.

```bash
# API integration tests (118 tests)
docker compose --profile test run --rm tests-api

# Browser E2E tests (6 specs — Playwright)
docker compose --profile test run --rm tests-e2e
```

Both suites must pass before merging.

## Demo data (opt-in)

The demo script creates a verified user, a team, 3 epics, and **120 tickets** through the public HTTP API. It **never runs at startup** — invoke it only when needed.

```bash
# Requires host Node 22 (or run against the composed stack from a container)
BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 npm run demo:data
```

The script prints the generated email, password, team name, and board URL so you can log in and verify the board at scale.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Port conflict (3000 or 8025 already in use) | Set `APP_PORT` / `MAILPIT_UI_PORT` (see Port overrides above) |
| Stale containers / unexpected errors | `docker compose --profile test down -v` then `docker compose up --build` |
| Code changed but containers didn't rebuild | `docker compose up --build` — `docker compose run` does **not** rebuild dependencies |
| Verification email not arriving | Check Mailpit UI at http://localhost:8025; verify `SMTP_*` env vars match your relay |
| "Session required" on authenticated endpoints | Ensure cookies are enabled in the browser; session cookie is HttpOnly + SameSite=Lax |
| Windows: line-ending issues after clone | Run `git config --global core.autocrlf input` before cloning, or `git checkout -- .` after |

## Manual DoD verification

One Definition-of-Done check is intentionally manual: **stop the backend and drag**. This verifies that the UI handles a real server failure during drag-and-drop — the card snaps back to its original column and shows an error toast. The deterministic equivalent (route abort in Playwright) is covered by the `drag-rollback` E2E spec; the live-container stop is the documented manual judge step.
