# KickIt Ticket — Manual Testing Guide

How to validate the app by hand, including registration **without any external
SMTP server** (Mailpit, bundled in the compose stack, is the local mail sink).

## URLs

| Service | URL |
| --- | --- |
| App | **http://localhost:3000** |
| Mailpit (email inbox) | **http://localhost:8025** |

If you overrode `APP_PORT` / `MAILPIT_UI_PORT`, adjust the ports accordingly
(and set `PUBLIC_BASE_URL` to match — verification links are built from it).

## Getting test accounts

- **Seeder (fastest):** `npm run demo:data` creates a verified user, a team,
  3 epics and 120 tickets through the public API and **prints the generated
  email + password** at the end. Use those credentials to log in. Requires
  host Node 22; the stack must be running.
- **Register your own:** follow the SMTP-free flow below.
- Never commit real credentials; the seeder generates a random password per run.

## How to Register a New User WITHOUT External SMTP

The app uses **Mailpit** as its local SMTP sink. You don't need any real email server.

### UI Method (step-by-step)

1. Open **http://localhost:3000** in your browser.
2. Click **Sign Up**.
3. Enter an email (e.g. `test@example.com`) and a password (8+ characters).
4. Click **Sign Up**. You'll see a "Check your email" screen.
5. Open **http://localhost:8025** (Mailpit UI) in another tab.
6. You'll see the verification email in the inbox — click it.
7. The email body contains a link like:
   ```
   http://localhost:3000/verify?token=abc123...
   ```
8. **Click the link** (or copy-paste it into the same browser).
9. The app verifies your email and shows the success state.
10. Click **Log In**, enter your email and password.
11. You're in!

### Pure-cURL Method (for testing)

```bash
# 1. Sign up (example password — choose your own)
curl -s -X POST http://localhost:3000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"ExamplePass1"}'

# 2. Wait for the email, then list messages via the Mailpit API
sleep 2
curl -s 'http://localhost:8025/api/v1/messages'
# Find the message for your recipient, then fetch its body:
curl -s 'http://localhost:8025/api/v1/message/<ID>'
# Extract the token from the /verify?token=... link in the body.

# 3. Verify
curl -s -X POST http://localhost:3000/api/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"token":"EXTRACTED_TOKEN_HERE"}'

# 4. Login (keeps the session cookie in cookies.txt)
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"ExamplePass1"}'
```

### ⚠️ Local Testing Shortcut: Bypass Email Verification

For quick local testing, you can directly mark a user as verified in the database:

```bash
docker compose exec postgres psql -U kickit -d kickit -c \
  "UPDATE users SET email_verified_at = now() WHERE email = 'someone@example.com';"
```

Then log in normally. **This bypasses the email flow entirely — local testing
only, never for production.**

## Manual Check: Stop Backend and Drag

This verifies that the UI handles a real server failure during drag-and-drop
(the deterministic equivalent is covered by the `drag-rollback` E2E spec):

1. **Note the current column** of a card on the board.
2. Stop the app:
   ```bash
   docker compose stop app
   ```
3. **In your browser**, drag the card to a different column.
4. **Expected behavior:**
   - The card **snaps back** to its original column.
   - An **error toast** appears saying the move failed.
5. Restart the app:
   ```bash
   docker compose start app
   ```
6. **Refresh the page** — the card is still in its original column (the drag
   was not persisted).

## Filter / Search Testing

On a seeded Demo Team (120 tickets across 3 epics):

| Action | How |
| --- | --- |
| View all | Select the demo team in the team dropdown |
| Filter by type | Select `bug` / `feature` / `fix` |
| Search title | Type a substring (case-insensitive), e.g. "demo" |
| AND-combine | Type filter + search → only matching tickets of that type |
| Filter by epic | Select an epic, or "No epic" for unassigned tickets |
| Epic + type | Combine both → intersection only |

Team selection and active filters persist in the URL — refresh, back and
forward restore them.

## Re-run the Demo Seeder

```bash
BASE_URL=http://localhost:3000 MAILPIT_URL=http://localhost:8025 npm run demo:data
```

Creates a **new** verified user + team + 120 tickets (never runs at startup).
The script prints the new credentials. `TICKET_COUNT` is configurable (≥100).

## Board Usability with 100+ Tickets

Open the seeded board and verify:
- Cards render without freezing; drag-and-drop stays responsive
- Filters reduce the board to manageable subsets
- Scrolling is smooth

## Reset Everything

```bash
# Tear down with volumes (destroys ALL data)
docker compose --profile test down -v

# Rebuild and start fresh (empty database, no seed)
docker compose up --build
```

## Stop the Instance

```bash
docker compose stop                        # stop services, keep data
docker compose down                        # remove containers, keep data
docker compose --profile test down -v      # remove everything incl. data
```
