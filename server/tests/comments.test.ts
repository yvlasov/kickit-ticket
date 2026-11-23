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

describe('Comments API — add comment, immutability, modifiedAt invariance', () => {
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

  // === Test 1: add comment → 201 with authorEmail = session user's email, body trimmed ===
  it('POST /api/tickets/:id/comments adds comment → 201, correct authorEmail, body trimmed', async () => {
    const { cookie, id: userId } = await signupAndVerify(app, pool, 'comment-user1@example.com', 'password123');

    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team A' }, cookie);
    const teamId = teamRes.body.id;

    const ticketRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId, type: 'bug', title: 'Test ticket', body: 'Test body',
    }, cookie);
    const ticketId = ticketRes.body.id;

    const addRes = await apiRequest(app, 'POST', `/api/tickets/${ticketId}/comments`, {
      body: '  Hello comment  ',
    }, cookie);
    expect(addRes.statusCode).toBe(201);
    expect(addRes.body.ticketId).toBe(ticketId);
    expect(addRes.body.body).toBe('Hello comment');
    expect(addRes.body.authorId).toBe(userId);
    expect(addRes.body.authorEmail).toBe('comment-user1@example.com');
    expect(addRes.body).toHaveProperty('createdAt');
  });

  // === Test 2: empty/whitespace body → 400; unknown ticket → 404 ===
  it('POST /api/tickets/:id/comments rejects empty body → 400', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'comment-user2a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team B' }, cookie);
    const ticketRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);

    const empty = await apiRequest(app, 'POST', `/api/tickets/${ticketRes.body.id}/comments`, { body: '' }, cookie);
    expect(empty.statusCode).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const ws = await apiRequest(app, 'POST', `/api/tickets/${ticketRes.body.id}/comments`, { body: '   ' }, cookie);
    expect(ws.statusCode).toBe(400);
    expect(ws.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/tickets/:id/comments unknown ticket → 404', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'comment-user2b@example.com', 'password123');
    const res = await apiRequest(app, 'POST', '/api/tickets/00000000-0000-0000-0000-000000000000/comments', {
      body: 'Hello',
    }, cookie);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // === Test 3: ticket.modifiedAt UNCHANGED after adding a comment; board list order unchanged ===
  it('POST /api/tickets/:id/comments does NOT change ticket.modifiedAt', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'comment-user3a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team C' }, cookie);
    const ticketRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = ticketRes.body.id;
    const originalModifiedAt = ticketRes.body.modifiedAt;

    await apiRequest(app, 'POST', `/api/tickets/${ticketId}/comments`, { body: 'Comment 1' }, cookie);

    const getRes = await apiRequest(app, 'GET', `/api/tickets/${ticketId}`, undefined, cookie);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.ticket.modifiedAt).toBe(originalModifiedAt);
  });

  it('POST /api/tickets/:id/comments does NOT change board list order', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'comment-user3b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team D' }, cookie);
    const teamId = teamRes.body.id;

    const t1 = await apiRequest(app, 'POST', '/api/tickets', {
      teamId, type: 'bug', title: 'First', body: 'Body 1',
    }, cookie);
    const t2 = await apiRequest(app, 'POST', '/api/tickets', {
      teamId, type: 'feature', title: 'Second', body: 'Body 2',
    }, cookie);

    const listBefore = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}`, undefined, cookie);
    expect(listBefore.statusCode).toBe(200);
    const orderBefore = listBefore.body.map((t: { id: string }) => t.id);

    await apiRequest(app, 'POST', `/api/tickets/${t1.body.id}/comments`, { body: 'Comment on first' }, cookie);

    const listAfter = await apiRequest(app, 'GET', `/api/tickets?teamId=${teamId}`, undefined, cookie);
    expect(listAfter.statusCode).toBe(200);
    const orderAfter = listAfter.body.map((t: { id: string }) => t.id);
    expect(orderAfter).toEqual(orderBefore);
  });

  // === Test 4: oldest-first ordering — add 3 comments, GET returns them createdAt ASC ===
  it('GET /api/tickets/:id returns comments oldest-first (createdAt ASC)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'comment-user4@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team E' }, cookie);
    const ticketRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);
    const ticketId = ticketRes.body.id;

    // Add 3 comments with small delays to ensure different timestamps
    await apiRequest(app, 'POST', `/api/tickets/${ticketId}/comments`, { body: 'First comment' }, cookie);
    await new Promise((r) => setTimeout(r, 50));
    await apiRequest(app, 'POST', `/api/tickets/${ticketId}/comments`, { body: 'Second comment' }, cookie);
    await new Promise((r) => setTimeout(r, 50));
    await apiRequest(app, 'POST', `/api/tickets/${ticketId}/comments`, { body: 'Third comment' }, cookie);

    const getRes = await apiRequest(app, 'GET', `/api/tickets/${ticketId}`, undefined, cookie);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body.comments.length).toBe(3);
    expect(getRes.body.comments[0].body).toBe('First comment');
    expect(getRes.body.comments[1].body).toBe('Second comment');
    expect(getRes.body.comments[2].body).toBe('Third comment');
    // Verify authorEmails match the session user
    expect(getRes.body.comments[0].authorEmail).toBe('comment-user4@example.com');
    expect(getRes.body.comments[1].authorEmail).toBe('comment-user4@example.com');
    expect(getRes.body.comments[2].authorEmail).toBe('comment-user4@example.com');
  });

  // === Test 5: no comment edit/delete — PATCH and DELETE /api/tickets/:id/comments/:cid → 404 ===
  it('PATCH /api/tickets/:id/comments/:cid → 404 (route does not exist)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'comment-user5a@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team F' }, cookie);
    const ticketRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);

    const patchRes = await apiRequest(app, 'PATCH', `/api/tickets/${ticketRes.body.id}/comments/00000000-0000-0000-0000-000000000000`, {
      body: 'Edited',
    }, cookie);
    expect(patchRes.statusCode).toBe(404);
  });

  it('DELETE /api/tickets/:id/comments/:cid → 404 (route does not exist)', async () => {
    const { cookie } = await signupAndVerify(app, pool, 'comment-user5b@example.com', 'password123');
    const teamRes = await apiRequest(app, 'POST', '/api/teams', { name: 'Team F' }, cookie);
    const ticketRes = await apiRequest(app, 'POST', '/api/tickets', {
      teamId: teamRes.body.id, type: 'bug', title: 'T', body: 'B',
    }, cookie);

    const delRes = await apiRequest(app, 'DELETE', `/api/tickets/${ticketRes.body.id}/comments/00000000-0000-0000-0000-000000000000`, undefined, cookie);
    expect(delRes.statusCode).toBe(404);
  });

  // === Test 6: add comment without cookie → 401 ===
  it('POST /api/tickets/:id/comments returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'POST', '/api/tickets/00000000-0000-0000-0000-000000000000/comments', { body: 'Hello' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
