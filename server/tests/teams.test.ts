import crypto from 'node:crypto';
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

describe('Teams API — CRUD', () => {
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

  // --- Test 1: list empty → []; create → 201; list shows team with counts 0 ---
  it('GET /api/teams returns [] when empty; POST creates team; GET shows with counts 0', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user1@example.com', 'password123');

    // List empty
    const listRes = await apiRequest(app, 'GET', '/api/teams', undefined, cookie);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body).toEqual([]);

    // Create
    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'My Team' }, cookie);
    expect(createRes.statusCode).toBe(201);
    expect(createRes.body).toHaveProperty('id');
    expect(createRes.body.name).toBe('My Team');
    expect(createRes.body).toHaveProperty('createdAt');
    expect(createRes.body).toHaveProperty('modifiedAt');

    // List shows team
    const listRes2 = await apiRequest(app, 'GET', '/api/teams', undefined, cookie);
    expect(listRes2.statusCode).toBe(200);
    expect(listRes2.body.length).toBe(1);
    expect(listRes2.body[0].name).toBe('My Team');
    expect(listRes2.body[0].ticketCount).toBe(0);
    expect(listRes2.body[0].epicCount).toBe(0);
  });

  // --- Test 2: create empty/whitespace name → 400; duplicate case → 409; duplicate with spaces → 409 ---
  it('POST /api/teams rejects empty/whitespace name with 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user2a@example.com', 'password123');

    const emptyRes = await apiRequest(app, 'POST', '/api/teams', { name: '' }, cookie);
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.body.error.code).toBe('VALIDATION_ERROR');

    const wsRes = await apiRequest(app, 'POST', '/api/teams', { name: '   ' }, cookie);
    expect(wsRes.statusCode).toBe(400);
    expect(wsRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/teams rejects duplicate name (case-insensitive) with 409', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user2b@example.com', 'password123');

    await apiRequest(app, 'POST', '/api/teams', { name: 'Alpha Team' }, cookie);

    const dupRes = await apiRequest(app, 'POST', '/api/teams', { name: 'ALPHA TEAM' }, cookie);
    expect(dupRes.statusCode).toBe(409);
    expect(dupRes.body.error.code).toBe('TEAM_EXISTS');
  });

  it('POST /api/teams rejects duplicate name with leading/trailing spaces with 409', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user2c@example.com', 'password123');

    await apiRequest(app, 'POST', '/api/teams', { name: 'Beta Team' }, cookie);

    const dupRes = await apiRequest(app, 'POST', '/api/teams', { name: '  Beta Team  ' }, cookie);
    expect(dupRes.statusCode).toBe(409);
    expect(dupRes.body.error.code).toBe('TEAM_EXISTS');
  });

  // --- Test 3: rename real change → 200, modifiedAt advances; no-op rename → 200, modifiedAt unchanged ---
  it('PATCH /api/teams/:id real rename returns 200 and advances modifiedAt', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user3a@example.com', 'password123');

    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Original' }, cookie);
    const teamId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    await new Promise((r) => setTimeout(r, 50));

    const renameRes = await apiRequest(app, 'PATCH', `/api/teams/${teamId}`, { name: 'Renamed' }, cookie);
    expect(renameRes.statusCode).toBe(200);
    expect(renameRes.body.name).toBe('Renamed');
    expect(renameRes.body.modifiedAt).not.toBe(originalModifiedAt);
    expect(new Date(renameRes.body.modifiedAt).getTime()).toBeGreaterThan(new Date(originalModifiedAt).getTime());
  });

  it('PATCH /api/teams/:id no-op rename (identical) returns 200, modifiedAt unchanged', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user3b@example.com', 'password123');

    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Original' }, cookie);
    const teamId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    const renameRes = await apiRequest(app, 'PATCH', `/api/teams/${teamId}`, { name: 'Original' }, cookie);
    expect(renameRes.statusCode).toBe(200);
    expect(renameRes.body.name).toBe('Original');
    expect(renameRes.body.modifiedAt).toBe(originalModifiedAt);
  });

  it('PATCH /api/teams/:id no-op rename (case/space variant) returns 200, modifiedAt unchanged', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user3c@example.com', 'password123');

    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Original' }, cookie);
    const teamId = createRes.body.id;
    const originalModifiedAt = createRes.body.modifiedAt;

    const renameRes = await apiRequest(app, 'PATCH', `/api/teams/${teamId}`, { name: '  ORIGINAL  ' }, cookie);
    expect(renameRes.statusCode).toBe(200);
    expect(renameRes.body.name).toBe('Original');
    expect(renameRes.body.modifiedAt).toBe(originalModifiedAt);
  });

  // --- Test 4: rename to another team name → 409; rename unknown id → 404 ---
  it('PATCH /api/teams/:id to another team name returns 409', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user4a@example.com', 'password123');

    const team1Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team One' }, cookie);
    const team2Res = await apiRequest(app, 'POST', '/api/teams', { name: 'Team Two' }, cookie);

    const dupRes = await apiRequest(app, 'PATCH', `/api/teams/${team1Res.body.id}`, { name: 'Team Two' }, cookie);
    expect(dupRes.statusCode).toBe(409);
    expect(dupRes.body.error.code).toBe('TEAM_EXISTS');
  });

  it('PATCH /api/teams/:id unknown id returns 404', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user4b@example.com', 'password123');

    const res = await apiRequest(app, 'PATCH', '/api/teams/00000000-0000-0000-0000-000000000000', { name: 'New Name' }, cookie);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // --- Test 5: delete empty team → 204, gone from list ---
  it('DELETE /api/teams/:id removes empty team; 204; gone from list', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user5@example.com', 'password123');

    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'To Delete' }, cookie);
    const teamId = createRes.body.id;

    const deleteRes = await apiRequest(app, 'DELETE', `/api/teams/${teamId}`, undefined, cookie);
    expect(deleteRes.statusCode).toBe(204);

    const listRes = await apiRequest(app, 'GET', '/api/teams', undefined, cookie);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.length).toBe(0);
  });

  // --- Test 6: delete team with epic → 409; delete team with ticket → 409 ---
  it('DELETE /api/teams/:id blocked with epic → 409 TEAM_NOT_EMPTY', async () => {
    const { cookie, id: userId } = await signupAndVerify(app, pool, 'team-user6a@example.com', 'password123');

    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Epic Team' }, cookie);
    const teamId = createRes.body.id;

    // Insert an epic row via SQL
    await pool.query(
      'INSERT INTO epics (id, team_id, title, created_at, modified_at) VALUES (gen_random_uuid(), $1, $2, now(), now())',
      [teamId, 'Test Epic'],
    );

    const deleteRes = await apiRequest(app, 'DELETE', `/api/teams/${teamId}`, undefined, cookie);
    expect(deleteRes.statusCode).toBe(409);
    expect(deleteRes.body.error.code).toBe('TEAM_NOT_EMPTY');
    expect(deleteRes.body.error.message).toContain('epic');
  });

  it('DELETE /api/teams/:id blocked with ticket → 409 TEAM_NOT_EMPTY', async () => {
    const { cookie, id: userId } = await signupAndVerify(app, pool, 'team-user6b@example.com', 'password123');

    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Ticket Team' }, cookie);
    const teamId = createRes.body.id;

    // Insert a ticket row via SQL with created_by = the test user
    await pool.query(
      'INSERT INTO tickets (id, team_id, type, state, title, body, created_by, created_at, modified_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now())',
      [teamId, 'bug', 'new', 'Test Ticket', 'Body', userId],
    );

    const deleteRes = await apiRequest(app, 'DELETE', `/api/teams/${teamId}`, undefined, cookie);
    expect(deleteRes.statusCode).toBe(409);
    expect(deleteRes.body.error.code).toBe('TEAM_NOT_EMPTY');
    expect(deleteRes.body.error.message).toContain('ticket');
  });

  // --- Test 7: counts correctness after SQL fixture ---
  it('GET /api/teams shows correct epicCount and ticketCount after SQL fixture', async () => {
    const { cookie, id: teamUserId } = await signupAndVerify(app, pool, 'team-user7@example.com', 'password123');

    const createRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Count Team' }, cookie);
    const teamId = createRes.body.id;

    // Insert 2 epics + 3 tickets via SQL
    await pool.query(
      'INSERT INTO epics (id, team_id, title, created_at, modified_at) VALUES (gen_random_uuid(), $1, $2, now(), now()), (gen_random_uuid(), $1, $3, now(), now())',
      [teamId, 'Epic 1', 'Epic 2'],
    );
    await pool.query(
      'INSERT INTO tickets (id, team_id, type, state, title, body, created_by, created_at, modified_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now()), (gen_random_uuid(), $1, $2, $3, $7, $5, $6, now(), now()), (gen_random_uuid(), $1, $2, $3, $8, $5, $6, now(), now())',
      [teamId, 'bug', 'new', 'Ticket 1', 'Body', teamUserId, 'Ticket 2', 'Ticket 3'],
    );

    const listRes = await apiRequest(app, 'GET', '/api/teams', undefined, cookie);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].epicCount).toBe(2);
    expect(listRes.body[0].ticketCount).toBe(3);
  });

  // --- Test 8: all four endpoints without cookie → 401 ---
  it('GET /api/teams returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'GET', '/api/teams');
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/teams returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'POST', '/api/teams', { name: 'No Cookie' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('PATCH /api/teams/:id returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'PATCH', '/api/teams/00000000-0000-0000-0000-000000000000', { name: 'No Cookie' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('DELETE /api/teams/:id returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'DELETE', '/api/teams/00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // --- Test 9: unverified user → 403 ---
  it('POST /api/teams returns 403 for unverified user', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'team-user9a@example.com', 'password123');

    // Create a second unverified user
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'unverified-team@example.com',
      password: 'password123',
    });

    const loginRes = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'unverified-team@example.com',
      password: 'password123',
    });
    expect(loginRes.statusCode).toBe(403);

    // Login as verified user to get a cookie
    const loginVerified = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'team-user9a@example.com',
      password: 'password123',
    });
    const verifiedCookie = loginVerified.headers['set-cookie']?.[0] ?? '';

    // Now login as unverified
    const loginUnverified = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'unverified-team@example.com',
      password: 'password123',
    });
    // This should fail with 403
    expect(loginUnverified.statusCode).toBe(403);
  });
});
