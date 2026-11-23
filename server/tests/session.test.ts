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

import { signupAndVerify, apiRequest, cleanupTables } from './helpers.ts';

describe('Auth API — Login, Logout, Me', () => {
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

  // Test 1: verified user login → 200 {id,email}; Set-Cookie present with HttpOnly and SameSite=Lax, NO Secure flag; sessions row exists
  it('POST /api/auth/login returns 200 with cookie for verified user', async () => {
    const { id } = await signupAndVerify(app, pool, 'login1@example.com', 'password123');

    const res = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'login1@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('id', id);
    expect(res.body).toHaveProperty('email', 'login1@example.com');

    // Check Set-Cookie header
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie!.length).toBeGreaterThan(0);
    const cookieStr = setCookie![0];
    expect(cookieStr).toContain('HttpOnly');
    expect(cookieStr).toContain('SameSite=Lax');
    expect(cookieStr).not.toContain('Secure');

    // Check sessions row exists
    const sessions = await pool.query('SELECT id, expires_at FROM sessions WHERE id = $1', [
      cookieStr.split(';')[0].split('=')[1],
    ]);
    expect(sessions.rows.length).toBe(1);
    const expiresAt = new Date(sessions.rows[0].expires_at);
    const expectedExpiry = new Date(Date.now() + 168 * 60 * 60 * 1000);
    expect(expiresAt.getTime()).toBeGreaterThan(expectedExpiry.getTime() - 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThan(expectedExpiry.getTime() + 60 * 1000);
  });

  // Test 2: wrong password → 401 INVALID_CREDENTIALS
  it('POST /api/auth/login returns 401 for wrong password', async () => {
    await signupAndVerify(app, pool, 'wrongpass@example.com', 'password123');

    const res = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'wrongpass@example.com',
      password: 'wrongpassword',
    });

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  // Test 2b: unknown email → 401 (identical envelope)
  it('POST /api/auth/login returns 401 for unknown email', async () => {
    const res = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'nonexistent@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  // Test 3: unverified user login → 403 EMAIL_NOT_VERIFIED
  it('POST /api/auth/login returns 403 for unverified user', async () => {
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'unverified@example.com',
      password: 'password123',
    });

    const res = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'unverified@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  // Test 4a: GET me with session cookie → 200 {id,email}
  it('GET /api/auth/me returns user with valid session cookie', async () => {
    const { id } = await signupAndVerify(app, pool, 'me-user@example.com', 'password123');

    const loginRes = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'me-user@example.com',
      password: 'password123',
    });
    const cookie = loginRes.headers['set-cookie']?.[0] ?? '';

    const res = await apiRequest(app, 'GET', '/api/auth/me', undefined, cookie);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('id', id);
    expect(res.body).toHaveProperty('email', 'me-user@example.com');
  });

  // Test 4b: without cookie → 401
  it('GET /api/auth/me returns 401 without cookie', async () => {
    const res = await apiRequest(app, 'GET', '/api/auth/me');

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // Test 4c: garbage cookie → 401
  it('GET /api/auth/me returns 401 with garbage cookie', async () => {
    const res = await apiRequest(app, 'GET', '/api/auth/me', undefined, 'kickit_session=garbage');

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // Test 5: expired session → me 401
  it('GET /api/auth/me returns 401 for expired session', async () => {
    await signupAndVerify(app, pool, 'expired@example.com', 'password123');

    // Login to get a session
    const loginRes = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'expired@example.com',
      password: 'password123',
    });
    const cookie = loginRes.headers['set-cookie']?.[0] ?? '';
    const sessionId = cookie.split(';')[0].split('=')[1];

    // Expire the session via SQL
    await pool.query(
      'UPDATE sessions SET expires_at = now() - interval \'1 hour\' WHERE id = $1',
      [sessionId],
    );

    const res = await apiRequest(app, 'GET', '/api/auth/me', undefined, cookie);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  // Test 6: logout with cookie → 204; session deleted; me afterwards → 401
  it('POST /api/auth/logout deletes session and clears cookie', async () => {
    await signupAndVerify(app, pool, 'logout-user@example.com', 'password123');

    const loginRes = await apiRequest(app, 'POST', '/api/auth/login', {
      email: 'logout-user@example.com',
      password: 'password123',
    });
    const cookie = loginRes.headers['set-cookie']?.[0] ?? '';
    const sessionId = cookie.split(';')[0].split('=')[1];

    // Verify session exists
    const before = await pool.query('SELECT id FROM sessions WHERE id = $1', [sessionId]);
    expect(before.rows.length).toBe(1);

    // Logout
    const logoutRes = await apiRequest(app, 'POST', '/api/auth/logout', undefined, cookie);
    expect(logoutRes.statusCode).toBe(204);

    // Check Set-Cookie clears the session
    const clearCookie = logoutRes.headers['set-cookie'];
    expect(clearCookie).toBeDefined();
    expect(clearCookie![0]).toContain('kickit_session=');
    expect(clearCookie![0]).toContain('Max-Age=0');

    // Session row deleted
    const after = await pool.query('SELECT id FROM sessions WHERE id = $1', [sessionId]);
    expect(after.rows.length).toBe(0);

    // Me with old cookie → 401
    const meRes = await apiRequest(app, 'GET', '/api/auth/me', undefined, cookie);
    expect(meRes.statusCode).toBe(401);
  });

  // Test 7: logout without cookie → 204
  it('POST /api/auth/logout returns 204 without cookie', async () => {
    const res = await apiRequest(app, 'POST', '/api/auth/logout');
    expect(res.statusCode).toBe(204);
  });
});
