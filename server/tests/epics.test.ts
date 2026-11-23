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

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

async function fetchMailpitMessages(): Promise<Array<{ ID: string; To?: Array<{ Address?: string; Name?: string }> }>> {
  const resp = await fetch(`${MAILPIT_URL}/api/v1/messages?latest=100`);
  const data = await resp.json();
  const arr = Array.isArray(data) ? data : (data.messages ?? []);
  return arr;
}

async function fetchMailpitMessageById(id: string): Promise<{ HTML?: string; Text?: string } | null> {
  const resp = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  const data = await resp.json();
  return { HTML: data.HTML, Text: data.Text };
}

async function fetchLatestMailpitMessageFor(email: string): Promise<{ HTML?: string; Text?: string } | null> {
  const msgs = await fetchMailpitMessages();
  const matching = msgs.filter((m) => m.To?.some((t) => (t.Address ?? t.Name ?? '').toLowerCase() === email.toLowerCase()));
  if (matching.length === 0) return null;
  const full = await fetchMailpitMessageById(matching[0].ID);
  return full;
}

function extractTokenFromHtml(html: string): string | null {
  const match = html.match(/https?:\/\/[^"]*verify[^"]*/);
  if (!match) return null;
  return new URL(match[0]).searchParams.get('token');
}

async function apiRequest(app: Awaited<ReturnType<typeof buildApp>>, method: string, url: string, body?: Record<string, unknown>, cookies?: string) {
  const req = (request(app.server) as any)[method.toLowerCase()](url);
  if (cookies) {
    req.set('Cookie', cookies);
  }
  if (body) {
    req.send(body);
  }
  const res = await req;
  return {
    statusCode: res.statusCode,
    body: res.body,
    headers: res.headers,
    raw: res,
  };
}

async function signupAndVerify(app: Awaited<ReturnType<typeof buildApp>>, p: Pool, email: string, password: string): Promise<{ id: string; cookie: string }> {
  await apiRequest(app, 'POST', '/api/auth/signup', { email, password });
  await new Promise((r) => setTimeout(r, 500));
  const msg = await fetchLatestMailpitMessageFor(email);
  expect(msg).not.toBeNull();
  const token = extractTokenFromHtml(msg!.HTML ?? '');
  expect(token).not.toBeNull();
  const res = await apiRequest(app, 'POST', '/api/auth/verify', { token });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ status: 'success' });
  const loginRes = await apiRequest(app, 'POST', '/api/auth/login', {
    email: email.toLowerCase(),
    password,
  });
  expect(loginRes.statusCode).toBe(200);
  const cookie = loginRes.headers['set-cookie']?.[0] ?? '';
  const user = await p.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  return { id: user.rows[0].id, cookie };
}

describe('Epics API — CRUD', () => {
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
    await pool.query('DELETE FROM comments');
    await pool.query('DELETE FROM tickets');
    await pool.query('DELETE FROM epics');
    await pool.query('DELETE FROM teams');
    await pool.query('DELETE FROM verification_tokens');
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM users');
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  // --- Test 1: create with description → 201; without → 201 description null; empty title → 400; unknown teamId → 400 ---
  it('POST /api/epics creates epic with description → 201', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user1@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team A' }, cookie);
    const teamId = teamRes.body.id;

    const createRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'My Epic', description: 'An epic description' }, cookie);
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.title).toBe('My Epic');
    expect(createRes.body.description).toBe('An epic description');
    expect(createRes.body.teamId).toBe(teamId);
    expect(createRes.body).toHaveProperty('id');
    expect(createRes.body).toHaveProperty('createdAt');
    expect(createRes.body).toHaveProperty('modifiedAt');
    expect(createRes.body.ticketCount).toBe(0);
  });

  it('POST /api/epics creates epic without description → 201, description null', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user1b@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team B' }, cookie);
    const teamId = teamRes.body.id;

    const createRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'No Desc Epic' }, cookie);
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.description).toBeNull();
  });

  it('POST /api/epics rejects empty title with 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user1c@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team C' }, cookie);
    const teamId = teamRes.body.id;

    const emptyRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: '' }, cookie);
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.body.error.code).toBe('VALIDATION_ERROR');

    const wsRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: '   ' }, cookie);
    expect(wsRes.statusCode).toBe(400);
    expect(wsRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/epics rejects unknown teamId with 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user1d@example.com', 'password123');

    const res = await apiRequest(app, 'POST', '/api/epics', { teamId: '00000000-0000-0000-0000-000000000000', title: 'Unknown Team' }, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // --- Test 2: list all vs ?teamId= filter (two teams, epics in each); malformed teamId → 400 ---
  it('GET /api/epics lists all epics; ?teamId= filters correctly', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user2@example.com', 'password123');

    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 1' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 2' }, cookie);
    const team1Id = team1Res.body.id;
    const team2Id = team2Res.body.id;

    await apiRequest(app, 'POST', '/api/epics', { teamId: team1Id, title: 'Epic 1A' }, cookie);
    await apiRequest(app, 'POST', '/api/epics', { teamId: team1Id, title: 'Epic 1B' }, cookie);
    await apiRequest(app, 'POST', '/api/epics', { teamId: team2Id, title: 'Epic 2A' }, cookie);

    // List all
    const allRes = await apiRequest(app, 'GET', '/api/epics', undefined, cookie);
    expect(allRes.statusCode).toBe(200);
    expect(allRes.body.length).toBe(3);

    // Filter by team1
    const filter1Res = await apiRequest(app, 'GET', `/api/epics?teamId=${team1Id}`, undefined, cookie);
    expect(filter1Res.statusCode).toBe(200);
    expect(filter1Res.body.length).toBe(2);
    expect(filter1Res.body.every((e: { teamId: string }) => e.teamId === team1Id)).toBe(true);

    // Filter by team2
    const filter2Res = await apiRequest(app, 'GET', `/api/epics?teamId=${team2Id}`, undefined, cookie);
    expect(filter2Res.statusCode).toBe(200);
    expect(filter2Res.body.length).toBe(1);
  });

  it('GET /api/epics rejects malformed teamId with 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user2b@example.com', 'password123');

    const res = await apiRequest(app, 'GET', '/api/epics?teamId=not-a-uuid', undefined, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // --- Test 3: ticketCount correctness: SQL INSERT 2 tickets → list shows ticketCount 2 ---
  it('GET /api/epics shows correct ticketCount after SQL fixture', async () => {
    const { cookie, id: userId } = await signupAndVerify(app, pool, 'epic-user3@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Count Team' }, cookie);
    const teamId = teamRes.body.id;

    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Counted Epic' }, cookie);
    const epicId = epicRes.body.id;

    // Insert 2 tickets referencing the epic via SQL
    await pool.query(
      'INSERT INTO tickets (id, team_id, type, state, epic_id, title, body, created_by, created_at, modified_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now()), (gen_random_uuid(), $1, $2, $3, $4, $8, $6, $7, now(), now())',
      [teamId, 'bug', 'new', epicId, 'Ticket 1', 'Body', userId, 'Ticket 2'],
    );

    const listRes = await apiRequest(app, 'GET', '/api/epics', undefined, cookie);
    expect(listRes.statusCode).toBe(200);
    const epic = listRes.body.find((e: { id: string }) => e.id === epicId);
    expect(epic.ticketCount).toBe(2);
  });

  // --- Test 4: edit title+description → 200 modifiedAt advances; no-op edit (identical, whitespace) → 200 modifiedAt unchanged ---
  it('PATCH /api/epics/:id real edit returns 200 and advances modifiedAt', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user4a@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Edit Team A' }, cookie);
    const teamId = teamRes.body.id;

    const createRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Original Title', description: 'Original Desc' }, cookie);
    const epicId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    await new Promise((r) => setTimeout(r, 50));

    const editRes = await apiRequest(app, 'PATCH', `/api/epics/${epicId}`, { title: 'New Title', description: 'New Desc' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.title).toBe('New Title');
    expect(editRes.body.description).toBe('New Desc');
    expect(editRes.body.modifiedAt).not.toBe(originalModifiedAt);
    expect(new Date(editRes.body.modifiedAt).getTime()).toBeGreaterThan(new Date(originalModifiedAt).getTime());
  });

  it('PATCH /api/epics/:id no-op edit (identical values) returns 200, modifiedAt unchanged', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user4b@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Edit Team B' }, cookie);
    const teamId = teamRes.body.id;

    const createRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Same Title', description: 'Same Desc' }, cookie);
    const epicId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    const editRes = await apiRequest(app, 'PATCH', `/api/epics/${epicId}`, { title: 'Same Title', description: 'Same Desc' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.title).toBe('Same Title');
    expect(editRes.body.modifiedAt).toBe(originalModifiedAt);
  });

  it('PATCH /api/epics/:id no-op edit (whitespace variant) returns 200, modifiedAt unchanged', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user4c@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Edit Team C' }, cookie);
    const teamId = teamRes.body.id;

    const createRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Original', description: 'Desc' }, cookie);
    const epicId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    const editRes = await apiRequest(app, 'PATCH', `/api/epics/${epicId}`, { title: '  ORIGINAL  ', description: '  Desc  ' }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.title).toBe('Original');
    expect(editRes.body.modifiedAt).toBe(originalModifiedAt);
  });

  // --- Test 5: edit payload including teamId of another team → 200 but teamId UNCHANGED ---
  it('PATCH /api/epics/:id ignores teamId in edit payload (read-only)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user5@example.com', 'password123');

    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Edit Team 1' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Edit Team 2' }, cookie);
    const team1Id = team1Res.body.id;
    const team2Id = team2Res.body.id;

    const createRes = await apiRequest(app, 'POST', '/api/epics', { teamId: team1Id, title: 'Original' }, cookie);
    const epicId = createRes.body.id;
    expect(createRes.body.teamId).toBe(team1Id);

    const editRes = await apiRequest(app, 'PATCH', `/api/epics/${epicId}`, { title: 'Changed', teamId: team2Id }, cookie);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body.teamId).toBe(team1Id);
    expect(editRes.body.title).toBe('Changed');
  });

  // --- Test 6: edit unknown id → 404; delete unknown id → 404 ---
  it('PATCH /api/epics/:id unknown id returns 404', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user6a@example.com', 'password123');

    const res = await apiRequest(app, 'PATCH', '/api/epics/00000000-0000-0000-0000-000000000000', { title: 'New' }, cookie);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('DELETE /api/epics/:id unknown id returns 404', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user6b@example.com', 'password123');

    const res = await apiRequest(app, 'DELETE', '/api/epics/00000000-0000-0000-0000-000000000000', undefined, cookie);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // --- Test 7: delete epic with tickets → 409 EPIC_NOT_EMPTY; delete empty epic → 204, gone from list ---
  it('DELETE /api/epics/:id blocked with tickets → 409 EPIC_NOT_EMPTY', async () => {
    const { cookie, id: userId } = await signupAndVerify(app, pool, 'epic-user7a@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Delete Team A' }, cookie);
    const teamId = teamRes.body.id;

    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Blocked Epic' }, cookie);
    const epicId = epicRes.body.id;

    await pool.query(
      'INSERT INTO tickets (id, team_id, type, state, epic_id, title, body, created_by, created_at, modified_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now())',
      [teamId, 'bug', 'new', epicId, 'Ticket', 'Body', userId],
    );

    const deleteRes = await apiRequest(app, 'DELETE', `/api/epics/${epicId}`, undefined, cookie);
    expect(deleteRes.statusCode).toBe(409);
    expect(deleteRes.body.error.code).toBe('EPIC_NOT_EMPTY');
    expect(deleteRes.body.error.message).toContain('ticket');
  });

  it('DELETE /api/epics/:id removes empty epic; 204; gone from list', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'epic-user7b@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Delete Team B' }, cookie);
    const teamId = teamRes.body.id;

    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'To Delete' }, cookie);
    const epicId = epicRes.body.id;

    const deleteRes = await apiRequest(app, 'DELETE', `/api/epics/${epicId}`, undefined, cookie);
    expect(deleteRes.statusCode).toBe(204);

    const listRes = await apiRequest(app, 'GET', '/api/epics', undefined, cookie);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.length).toBe(0);
  });

  // --- Test 8: all endpoints without cookie → 401 ---
  it('GET /api/epics returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'GET', '/api/epics');
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/epics returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'POST', '/api/epics', { teamId: '00000000-0000-0000-0000-000000000000', title: 'No Cookie' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('PATCH /api/epics/:id returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'PATCH', '/api/epics/00000000-0000-0000-0000-000000000000', { title: 'No Cookie' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('DELETE /api/epics/:id returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'DELETE', '/api/epics/00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
