import { pgTable, uuid, text, timestamp, foreignKey } from 'drizzle-orm/pg-core';
import { citext } from './citext-column';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  fkSessionsUser: foreignKey({
    name: 'fk_sessions_user',
    columns: [table.userId],
    foreignColumns: [users.id],
  }),
}));

export const verificationTokens = pgTable('verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  fkTokensUser: foreignKey({
    name: 'fk_verification_tokens_user',
    columns: [table.userId],
    foreignColumns: [users.id],
  }),
}));

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: citext('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
});

export const epics = pgTable('epics', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  fkEpicsTeam: foreignKey({
    name: 'fk_epics_team',
    columns: [table.teamId],
    foreignColumns: [teams.id],
  }),
}));

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull(),
  type: text('type').notNull().$type<'bug' | 'feature' | 'fix'>(),
  state: text('state', { enum: ['new', 'ready_for_implementation', 'in_progress', 'ready_for_acceptance', 'done'] }).notNull().default('new'),
  epicId: uuid('epic_id'),
  title: text('title').notNull(),
  body: text('body'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  modifiedAt: timestamp('modified_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  fkTicketsTeam: foreignKey({
    name: 'fk_tickets_team',
    columns: [table.teamId],
    foreignColumns: [teams.id],
  }),
  fkTicketsEpic: foreignKey({
    name: 'fk_tickets_epic',
    columns: [table.epicId],
    foreignColumns: [epics.id],
  }),
  fkTicketsCreatedBy: foreignKey({
    name: 'fk_tickets_created_by',
    columns: [table.createdBy],
    foreignColumns: [users.id],
  }),
}));

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  fkCommentsTicket: foreignKey({
    name: 'fk_comments_ticket',
    columns: [table.ticketId],
    foreignColumns: [tickets.id],
  }),
  fkCommentsAuthor: foreignKey({
    name: 'fk_comments_author',
    columns: [table.authorId],
    foreignColumns: [users.id],
  }),
}));
