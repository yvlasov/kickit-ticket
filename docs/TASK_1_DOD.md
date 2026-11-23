## Before you submit
The task's Definition of Done, plus the checks judges are likely to run. Tick them off as you go; the ticks aren't saved.


Fresh git clone into a new folder, then docker compose up --build, starts everything with no other installs.

A fresh database has no users, teams, epics, tickets or comments.

Sign up → verification email arrives through the configured SMTP → link verifies → log in. Unverified login is refused, with a resend option.

Reusing a verification link fails. Duplicate emails with different case or spaces are rejected. Passwords under 8 characters are rejected.

Teams and epics can be managed in the UI. Blocked deletes show a clear message (API returns 409).

Tickets can be created, viewed, edited and deleted. An epic from another team is rejected by the API.

Saving unchanged values or adding a comment does not change "modified at".

Drag a card, refresh, and it's still there. Stop the backend and drag: the card snaps back with an error.

Filters (type, epic, title search) work together. Board is usable with 100+ tickets.

Comments show author and time, oldest first.

No secrets or hard-coded passwords in the repo or its Git history. .env.example is present.

At least one backend business-flow test and one frontend or API-flow test, and they pass.

README covers prerequisites, configuration (incl. SMTP) and startup commands.