CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" citext NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "email_verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "modified_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "sessions" (
  "id" text PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" citext NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "modified_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "epics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE RESTRICT,
  "title" text NOT NULL,
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "modified_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE RESTRICT,
  "type" text NOT NULL CHECK ("type" IN ('bug', 'feature', 'fix')),
  "state" text NOT NULL DEFAULT 'new' CHECK ("state" IN ('new', 'ready_for_implementation', 'in_progress', 'ready_for_acceptance', 'done')),
  "epic_id" uuid REFERENCES "epics"("id") ON DELETE RESTRICT,
  "title" text NOT NULL,
  "body" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "modified_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_sessions_user_id" ON "sessions" ("user_id");
CREATE INDEX "idx_verification_tokens_user_id" ON "verification_tokens" ("user_id");
CREATE INDEX "idx_epics_team_id" ON "epics" ("team_id");
CREATE INDEX "idx_tickets_team_state_modified" ON "tickets" ("team_id", "state", "modified_at" DESC);
CREATE INDEX "idx_comments_ticket_created" ON "comments" ("ticket_id", "created_at");
