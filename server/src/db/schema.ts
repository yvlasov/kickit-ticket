import { pgTable, uuid, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql';
import { customType } from 'drizzle-orm/pg-core';

export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxSessionsUser: index('idx_sessions_user_id').on(table.userId),
  }),
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxTokensUser: index('idx_verification_tokens_user_id').on(table.userId),
  }),
);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
});

export const epics = pgTable(
  'epics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxEpicsTeam: index('idx_epics_team_id').on(table.teamId),
  }),
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    state: text('state', {
      enum: ['new', 'ready_for_implementation', 'in_progress', 'ready_for_acceptance', 'done'],
    })
      .notNull()
      .default('new'),
    epicId: uuid('epic_id').references(() => epics.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeCheck: check('tickets_type_check', sql`"type" IN ('bug', 'feature', 'fix')`),
    stateCheck: check('tickets_state_check', sql`"state" IN ('new', 'ready_for_implementation', 'in_progress', 'ready_for_acceptance', 'done')`),
    idxTicketsTeamState: index('idx_tickets_team_state_modified').on(
      table.teamId,
      table.state,
      sql`"modified_at" DESC`,
    ),
  }),
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxCommentsTicket: index('idx_comments_ticket_created').on(table.ticketId, table.createdAt),
  }),
);
