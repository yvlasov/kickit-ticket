import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { fetchMailpitMessages, fetchMailpitMessageById, fetchLatestMailpitMessageFor, extractTokenFromHtml, apiRequest, signupAndVerify, cleanupTables } from './helpers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, '../drizzle');

describe('Board filters — type, epic, q (AND-combined, server-side)', () => {
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

  // === Test 1: type filter exact; invalid type → 400 ===
  it('GET /api/tickets?teamId=&type=bug returns only bug tickets', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user1a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 1' }, cookie);
    const teamId = teamRes.body.id;

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Bug one', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'feature', title: 'Feature one', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Bug two', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'fix', title: 'Fix one', body: 'Body' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&type=bug`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every((t: { type: string }) => t.type === 'bug')).toBe(true);
  });

  it('GET /api/tickets?teamId=&type=feature returns only feature tickets', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user1b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 1b' }, cookie);
    const teamId = teamRes.body.id;

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'T1', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'feature', title: 'T2', body: 'Body' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&type=feature`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].type).toBe('feature');
  });

  it('GET /api/tickets?teamId=&type=invalid → 400 VALIDATION_ERROR', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user1c@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 1c' }, cookie);
    const teamId = teamRes.body.id;

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&type=invalid`, undefined, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // === Test 2: epic=none → only null-epic; epic=<uuid> → only that epic; malformed → 400 ===
  it('GET /api/tickets?epic=none returns only tickets without epic', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user2a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 2a' }, cookie);
    const teamId = teamRes.body.id;

    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Epic X' }, cookie);
    const epicId = epicRes.body.id;

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'No epic ticket', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'With epic ticket', body: 'Body', epicId }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'feature', title: 'Another no epic', body: 'Body' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&epic=none`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every((t: { epicId: null }) => t.epicId === null)).toBe(true);
  });

  it('GET /api/tickets?epic=<uuid> returns only tickets of that epic', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user2b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 2b' }, cookie);
    const teamId = teamRes.body.id;

    const epic1Res = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Epic 1' }, cookie);
    const epic2Res = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Epic 2' }, cookie);

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'T1', body: 'Body', epicId: epic1Res.body.id }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'T2', body: 'Body', epicId: epic2Res.body.id }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'T3', body: 'Body', epicId: epic1Res.body.id }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&epic=${epic1Res.body.id}`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every((t: { epicId: string }) => t.epicId === epic1Res.body.id)).toBe(true);
  });

  it('GET /api/tickets?epic=malformed → 400 VALIDATION_ERROR', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user2c@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 2c' }, cookie);
    const teamId = teamRes.body.id;

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&epic=not-a-uuid`, undefined, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/tickets?epic=not-a-uuid-and-not-none → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user2d@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 2d' }, cookie);
    const teamId = teamRes.body.id;

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&epic=partial-uuid-12345`, undefined, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // === Test 3: q case-insensitive substring on title; % and _ match literally; body-only text not matched ===
  it('GET /api/tickets?q=login returns tickets with "login" in title (case-insensitive)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user3a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 3a' }, cookie);
    const teamId = teamRes.body.id;

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Login broken', body: 'Some body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'LOGIN form', body: 'Other body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Signup page', body: 'Login is needed' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&q=login`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every((t: { title: string }) => t.title.toLowerCase().includes('login'))).toBe(true);
  });

  it('GET /api/tickets?q=% returns tickets with literal % in title (escaped)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user3b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 3b' }, cookie);
    const teamId = teamRes.body.id;

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: '100% coverage', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Full coverage', body: 'Body' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&q=%`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe('100% coverage');
  });

  it('GET /api/tickets?q=_ returns tickets with literal _ in title (escaped)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user3c@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 3c' }, cookie);
    const teamId = teamRes.body.id;

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'user_id column', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'user id column', body: 'Body' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&q=_`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe('user_id column');
  });

  it('GET /api/tickets?q=body does NOT match body-only text', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user3d@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 3d' }, cookie);
    const teamId = teamRes.body.id;

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Login broken', body: 'body text here' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Body text', body: 'other body' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&q=body`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe('Body text');
  });

  // === Test 4: AND combination; ordering preserved ===
  it('GET /api/tickets?type=bug&q=login&epic=none AND-combines correctly', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user4a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 4a' }, cookie);
    const teamId = teamRes.body.id;

    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Epic A' }, cookie);
    const epicId = epicRes.body.id;

    // bug + login + no epic → match
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Login bug', body: 'Body', epicId: null }, cookie);
    // bug + login + has epic → no match (epic filter excludes)
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Login bug epic', body: 'Body', epicId }, cookie);
    // feature + login + no epic → no match (type filter excludes)
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'feature', title: 'Login feature', body: 'Body', epicId: null }, cookie);
    // bug + no-login + no epic → no match (q filter excludes)
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Signup bug', body: 'Body', epicId: null }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&type=bug&q=login&epic=none`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe('Login bug');
    expect(res.body[0].type).toBe('bug');
    expect(res.body[0].epicId).toBeNull();
  });

  it('GET /api/tickets with filters preserves modifiedAt DESC, id DESC ordering', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user4b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 4b' }, cookie);
    const teamId = teamRes.body.id;

    // Create 3 bug tickets
    const t1 = await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'First bug', body: 'Body' }, cookie);
    const t2 = await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Second bug', body: 'Body' }, cookie);
    const t3 = await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'Third bug', body: 'Body' }, cookie);

    // Wait and update t1 to push it to front
    await new Promise((r) => setTimeout(r, 50));
    await apiRequest(app, 'PATCH', `/api/tickets/${t1.body.id}`, { title: 'First bug updated' }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}&type=bug`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(3);
    // t1 should be first (modifiedAt advanced)
    expect(res.body[0].id).toBe(t1.body.id);
    // t3 should be second (created after t2, same modifiedAt → id DESC)
    expect(res.body[1].id).toBe(t3.body.id);
    expect(res.body[2].id).toBe(t2.body.id);
  });

  // === Test 5: absent filters → all team tickets (existing behavior unchanged) ===
  it('GET /api/tickets?teamId= without filters returns all team tickets', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user5a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Filter Team 5a' }, cookie);
    const teamId = teamRes.body.id;

    const epicRes = await apiRequest(app, 'POST', '/api/epics', { teamId, title: 'Epic A' }, cookie);

    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'bug', title: 'T1', body: 'Body' }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'feature', title: 'T2', body: 'Body', epicId: epicRes.body.id }, cookie);
    await apiRequest(app, 'POST', '/api/tickets', { teamId, type: 'fix', title: 'T3', body: 'Body', epicId: null }, cookie);

    const res = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}`, undefined, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(3);
  });

  it('GET /api/tickets without any query params → 400 (unchanged)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'filter-user5b@example.com', 'password123');
    const res = await apiRequest(app, 'GET', '/api/tickets', undefined, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
