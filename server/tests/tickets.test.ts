import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, '../drizzle');

import { signupAndVerify, apiRequest, cleanupTables } from './helpers.ts';

describe('Tickets API — CRUD & modified-at semantics', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let pool: Pool;

  beforeAll(async () => {
    app = await buildApp();
    pool = new Pool({ connectionString: process.env.DATABASE_URL! });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    await app.ready();
  });

  beforeEach(async () => {
    await cleanupTables(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  // === Test 1: create → 201, state defaults new, createdBy = session user; get → all fields + comments [] ===
  it('POST /api/tickets creates ticket → 201, state defaults new, createdBy = session user', async () => {
    const { cookie, id: userId } = await signupAndVerify(app, pool, 'ticket-user1@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team A' }, cookie);
    const teamId = teamRes.body.id;

    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Epic A1' }, cookie);
    const epicId = epicRes.body.id;

    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId, type: 'bug', state: 'new', epicId, title: 'Login broken', body: 'Cannot login',
    }, cookie);
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.type).toBe('bug');
    expect(createRes.body.state).toBe('new');
    expect(createRes.body.epicId).toBe(epicId);
    expect(createRes.body.epicTitle).toBe('Epic A1');
    expect(createRes.body.title).toBe('Login broken');
    expect(createRes.body.body).toBe('Cannot login');
    expect(createRes.body.createdBy).toBe(userId);
    expect(createRes.body).toHaveProperty('createdByEmail');
    expect(createRes.body).toHaveProperty('createdAt');
    expect(createRes.body).toHaveProperty('modifiedAt');
    expect(createRes.body.teamName).toBe('Team A');

    // GET → all fields + comments []
    const getRes = await apiRequest(app, 'GET', `/api/tickets/${createRes.body.id}`, undefined, cookie);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.ticket.id).toBe(createRes.body.id);
    expect(getRes.body.ticket.type).toBe('bug');
    expect(getRes.body.ticket.state).toBe('new');
    expect(getRes.body.ticket.title).toBe('Login broken');
    expect(getRes.body.ticket.body).toBe('Cannot login');
    expect(getRes.body.ticket.createdBy).toBe(userId);
    expect(getRes.body.ticket.createdByEmail).toBeTruthy();
    expect(getRes.body.ticket.teamName).toBe('Team A');
    expect(getRes.body.comments).toEqual([]);
  });

  // === Test 2: validation errors ===
  it('POST /api/tickets rejects invalid type → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user2a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team B' }, cookie);
    const res = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'invalid', title: 'T', body: 'B',
    }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/tickets rejects invalid state → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user2b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team B' }, cookie);
    const res = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', state: 'invalid', title: 'T', body: 'B',
    }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/tickets rejects empty/whitespace title → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user2c@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team B' }, cookie);
    const empty = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: '', body: 'B',
    }, cookie);
    expect(empty.statusCode).toBe(400);
    const ws = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: '   ', body: 'B',
    }, cookie);
    expect(ws.statusCode).toBe(400);
  });

  it('POST /api/tickets rejects empty/whitespace body → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user2d@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team B' }, cookie);
    const empty = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: '',
    }, cookie);
    expect(empty.statusCode).toBe(400);
    const ws = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: '   ',
    }, cookie);
    expect(ws.statusCode).toBe(400);
  });

  it('POST /api/tickets rejects unknown teamId → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user2e@example.com', 'password123');
    const res = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: '00000000-0000-0000-0000-000000000000', type: 'bug', title: 'T', body: 'B',
    }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/tickets rejects cross-team epic → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user2f@example.com', 'password123');
    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 1' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 2' }, cookie);
    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId: team2Res.body.id, title: 'Epic' }, cookie);
    const res = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: team1Res.body.id, type: 'bug', title: 'T', body: 'B', epicId: epicRes.body.id,
    }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // === Test 3: list ordering (modifiedAt DESC, id DESC) ===
  it('GET /api/tickets orders by modifiedAt DESC then id DESC', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user3@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team C' }, cookie);
    const teamId = teamRes.body.id;

    // Create 3 tickets
    const t1 = await apiRequest(app, 'POST', '/api/tickets', {
      teamId, type: 'bug', title: 'First', body: 'Body 1',
    }, cookie);
    const t2 = await apiRequest(app, 'POST', '/api/tickets', {
      teamId, type: 'feature', title: 'Second', body: 'Body 2',
    }, cookie);
    const t3 = await apiRequest(app, 'POST', '/api/tickets', {
      teamId, type: 'fix', title: 'Third', body: 'Body 3',
    }, cookie);

    // PATCH t1 to move it to front
    await new Promise((r) => setTimeout(r, 50));
    await apiRequest(app, 'PATCH', `/api/tickets/${t1.body.id}`, { title: 'First Updated' }, cookie);

    const listRes = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}`, undefined, cookie);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.length).toBe(3);
    // t1 should be first (modifiedAt advanced by PATCH)
    expect(listRes.body[0].id).toBe(t1.body.id);
    // t3 should be second (created after t2, same modifiedAt → id DESC)
    expect(listRes.body[1].id).toBe(t3.body.id);
    expect(listRes.body[2].id).toBe(t2.body.id);
  });

  it('GET /api/tickets without teamId → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user3b@example.com', 'password123');
    const res = await apiRequest(app, 'GET', '/api/tickets', undefined, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // === Test 4: edit — real change, no-op, case-only change ===
  it('PATCH /api/tickets/:id real title change → modifiedAt advances', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user4a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team D' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'Original', body: 'Body',
    }, cookie);
    const ticketId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    await new Promise((r) => setTimeout(r, 50));

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { title: 'Updated' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.title).toBe('Updated');
    expect(new Date(editRes.body.modifiedAt).getTime()).toBeGreaterThan(new Date(originalModifiedAt).getTime());
  });

  it('PATCH /api/tickets/:id no-op edit (identical) → modifiedAt unchanged', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user4b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team D' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'Same Title', body: 'Same Body',
    }, cookie);
    const ticketId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { title: 'Same Title', body: 'Same Body' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.title).toBe('Same Title');
    expect(editRes.body.modifiedAt).toBe(originalModifiedAt);
  });

  it('PATCH /api/tickets/:id no-op edit (whitespace variant) → modifiedAt unchanged', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user4c@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team D' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'Original', body: 'Body',
    }, cookie);
    const ticketId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { title: '  Original  ', body: '  Body  ' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.title).toBe('Original');
    expect(editRes.body.modifiedAt).toBe(originalModifiedAt);
  });

  it('PATCH /api/tickets/:id case-only change (fix login → Fix login) → modifiedAt ADVANCES', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user4d@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team D' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'fix login', body: 'Body',
    }, cookie);
    const ticketId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    await new Promise((r) => setTimeout(r, 50));

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { title: 'Fix login' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.title).toBe('Fix login');
    expect(new Date(editRes.body.modifiedAt).getTime()).toBeGreaterThan(new Date(originalModifiedAt).getTime());
  });

  // === Test 5: state change → modifiedAt advances; type change → advances ===
  it('PATCH /api/tickets/:id state change → modifiedAt advances', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user5a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team E' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    await new Promise((r) => setTimeout(r, 50));

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { state: 'in_progress' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.state).toBe('in_progress');
    expect(new Date(editRes.body.modifiedAt).getTime()).toBeGreaterThan(new Date(originalModifiedAt).getTime());
  });

  it('PATCH /api/tickets/:id type change → modifiedAt advances', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user5b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team E' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    await new Promise((r) => setTimeout(r, 50));

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { type: 'feature' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.type).toBe('feature');
    expect(new Date(editRes.body.modifiedAt).getTime()).toBeGreaterThan(new Date(originalModifiedAt).getTime());
  });

  // === Test 6: team change, epic rules ===
  it('PATCH /api/tickets/:id team change without epicId → epic becomes null', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user6a@example.com', 'password123');
    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 1' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 2' }, cookie);
    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId: team1Res.body.id, title: 'Epic' }, cookie);

    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: team1Res.body.id, type: 'bug', title: 'T', body: 'B', epicId: epicRes.body.id,
    }, cookie);
    const ticketId = createRes.body.id;

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { teamId: team2Res.body.id }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.teamId).toBe(team2Res.body.id);
    expect(editRes.body.epicId).toBeNull();
  });

  it('PATCH /api/tickets/:id team change with new-team epic → epic replaced', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user6b@example.com', 'password123');
    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 1' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 2' }, cookie);
    const epic1Res = await apiRequest(app, 'POST', '/api/epics', { teamId: team1Res.body.id, title: 'Epic 1' }, cookie);
    const epic2Res = await apiRequest(app, 'POST', '/api/epics', { teamId: team2Res.body.id, title: 'Epic 2' }, cookie);

    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: team1Res.body.id, type: 'bug', title: 'T', body: 'B', epicId: epic1Res.body.id,
    }, cookie);
    const ticketId = createRes.body.id;

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, {
      teamId: team2Res.body.id, epicId: epic2Res.body.id,
    }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.teamId).toBe(team2Res.body.id);
    expect(editRes.body.epicId).toBe(epic2Res.body.id);
    expect(editRes.body.epicTitle).toBe('Epic 2');
  });

  it('PATCH /api/tickets/:id team change with OLD-team epic → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user6c@example.com', 'password123');
    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 1' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 2' }, cookie);
    const epic1Res = await apiRequest(app, 'POST', '/api/epics', { teamId: team1Res.body.id, title: 'Epic 1' }, cookie);

    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: team1Res.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = createRes.body.id;

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, {
      teamId: team2Res.body.id, epicId: epic1Res.body.id,
    }, cookie);
    expect(editRes.statusCode).toBe(400);
    expect(editRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/tickets/:id epicId null clears epic', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user6d@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 3' }, cookie);
    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId: teamRes.body.id, title: 'Epic' }, cookie);

    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B', epicId: epicRes.body.id,
    }, cookie);
    const ticketId = createRes.body.id;

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { epicId: null }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.epicId).toBeNull();
  });

  it('PATCH /api/tickets/:id cross-team epic without team change → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user6e@example.com', 'password123');
    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 1' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team 2' }, cookie);
    const epic2Res = await apiRequest(app, 'POST', '/api/epics', { teamId: team2Res.body.id, title: 'Epic' }, cookie);

    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: team1Res.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = createRes.body.id;

    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, { epicId: epic2Res.body.id }, cookie);
    expect(editRes.statusCode).toBe(400);
    expect(editRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  // === Test 7: delete, cascade, unknown → 404 ===
  it('DELETE /api/tickets/:id → 204; SQL-inserted comment cascades', async () => {
    const { cookie, id: userId } = await signupAndVerify(app, pool, 'ticket-user7a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team F' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = createRes.body.id;

    // Insert a comment via SQL
    await pool.query(
      'INSERT INTO comments (id, ticket_id, author_id, body, created_at) VALUES (gen_random_uuid(), $1, $2, $3, now())',
      [ticketId, userId, 'A comment body'],
    );

    const deleteRes = await apiRequest(app, 'DELETE', `/api/tickets/${ticketId}`, undefined, cookie);
    expect(deleteRes.statusCode).toBe(204);

    // Verify comment is gone
    const commentCount = await pool.query('SELECT COUNT(*) FROM comments WHERE ticket_id = $1', [ticketId]);
    expect(Number(commentCount.rows[0].count)).toBe(0);
  });

  it('DELETE /api/tickets/:id unknown → 404; GET unknown → 404', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-user7b@example.com', 'password123');

    const delRes = await apiRequest(app, 'DELETE', '/api/tickets/00000000-0000-0000-0000-000000000000', undefined, cookie);
    expect(delRes.statusCode).toBe(404);
    expect(delRes.body.error.code).toBe('NOT_FOUND');

    const getRes = await apiRequest(app, 'GET', '/api/tickets/00000000-0000-0000-0000-000000000000', undefined, cookie);
    expect(getRes.statusCode).toBe(404);
    expect(getRes.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/tickets/:id with unknown teamId → 400, ticket unchanged', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'ticket-fix1@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Fix Team' }, cookie);
    const createRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;
    const originalTeamId = createRes.body.teamId;

    // PATCH with random-UUID teamId
    const editRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketId}`, {
      teamId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    }, cookie);
    expect(editRes.statusCode).toBe(400);
    expect(editRes.body.error.code).toBe('VALIDATION_ERROR');

    // Verify ticket unchanged
    const getRes = await apiRequest(app, 'GET', `/api/tickets/${ticketId}`, undefined, cookie);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.ticket.teamId).toBe(originalTeamId);
    expect(getRes.body.ticket.modifiedAt).toBe(originalModifiedAt);
  });

  // === Test 8: all endpoints without cookie → 401 ===
  it('GET /api/tickets returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'GET', '/api/tickets');
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/tickets returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'POST', '/api/tickets', { teamId: '00000000-0000-0000-0000-000000000000', type: 'bug', title: 'T', body: 'B' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/tickets/:id returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'GET', '/api/tickets/00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('PATCH /api/tickets/:id returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'PATCH', '/api/tickets/00000000-0000-0000-0000-000000000000', { title: 'New' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('DELETE /api/tickets/:id returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'DELETE', '/api/tickets/00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
