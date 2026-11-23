import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

async function fetchMailpitMessage(): Promise<{ HTML?: string; Text?: string } | null> {
  const resp = await fetch(`${MAILPIT_URL}/api/v1/message/latest`);
  const data = await resp.json();
  return { HTML: data.HTML, Text: data.Text };
}

function extractTokenFromHtml(html: string): string | null {
  const match = html.match(/https?:\/\/[^"]*verify[^"]*/);
  if (!match) return null;
  return new URL(match[0]).searchParams.get('token');
}

async function jsonInject(app: Awaited<ReturnType<typeof buildApp>>, method: string, url: string, body?: Record<string, unknown>) {
  const res = await app.inject({
    method,
    url,
    payload: body,
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body),
  };
}

describe('Auth API — Signup, Verify, Resend', () => {
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

  // Test 1: signup 201; password_hash in DB starts with $argon2id$
  it('POST /api/auth/signup returns 201 and hashes password with Argon2id', async () => {
    const res = await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'signup1@example.com',
      password: 'password123',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('message');

    const user = await pool.query(
      'SELECT password_hash FROM users WHERE email = $1',
      ['signup1@example.com'],
    );
    expect(user.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  // Test 2: password < 8 → 400
  it('POST /api/auth/signup rejects password < 8 with 400', async () => {
    const res = await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'weak@example.com',
      password: 'short',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Test 2b: invalid email → 400
  it('POST /api/auth/signup rejects invalid email with 400', async () => {
    const res = await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'not-an-email',
      password: 'password123',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Test 3: duplicate email with different case → 409
  it('POST /api/auth/signup rejects duplicate email (case-insensitive) with 409', async () => {
    await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'duplicate@example.com',
      password: 'password123',
    });

    const res = await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'DUPLICATE@EXAMPLE.COM',
      password: 'password123',
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  // Test 3b: duplicate email with leading/trailing spaces → 409
  it('POST /api/auth/signup rejects duplicate email with leading/trailing spaces with 409', async () => {
    await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'spaces@example.com',
      password: 'password123',
    });

    const res = await jsonInject(app, 'POST', '/api/auth/signup', {
      email: '  spaces@example.com  ',
      password: 'password123',
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  // Test 4: verification email arrives in Mailpit
  it('POST /api/auth/signup sends verification email to Mailpit', async () => {
    await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'mailpit@example.com',
      password: 'password123',
    });

    // Wait for email to arrive
    await new Promise((r) => setTimeout(r, 500));

    const msg = await fetchMailpitMessage();
    expect(msg).not.toBeNull();
    const body = msg!.HTML ?? msg!.Text ?? '';
    expect(body).toContain('/verify?token=');
  });

  // Test 5: verify with token → success; email_verified_at set; reuse → used
  it('POST /api/auth/verify returns success for valid token and marks used', async () => {
    // Signup
    await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'verify1@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Get token from Mailpit
    const msg = await fetchMailpitMessage();
    expect(msg).not.toBeNull();
    const token = extractTokenFromHtml(msg!.HTML ?? '');
    expect(token).not.toBeNull();

    // Verify
    const res = await jsonInject(app, 'POST', '/api/auth/verify', { token });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'success' });

    // Check email_verified_at is set
    const user = await pool.query(
      'SELECT email_verified_at FROM users WHERE email = $1',
      ['verify1@example.com'],
    );
    expect(user.rows[0].email_verified_at).not.toBeNull();

    // Reuse token → used
    const res2 = await jsonInject(app, 'POST', '/api/auth/verify', { token });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ status: 'used' });
  });

  // Test 6: expired token → expired
  it('POST /api/auth/verify returns expired for expired token (fixture)', async () => {
    // Signup a user
    await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'expired-token@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Get the token from Mailpit
    const msg = await fetchMailpitMessage();
    expect(msg).not.toBeNull();
    const token = extractTokenFromHtml(msg!.HTML ?? '');
    expect(token).not.toBeNull();

    // Expire the token via SQL
    const tokenHash = crypto.createHash('sha256').update(token!).digest('hex');
    await pool.query(
      'UPDATE verification_tokens SET expires_at = now() - interval \'1 hour\' WHERE token_hash = $1',
      [tokenHash],
    );

    const res = await jsonInject(app, 'POST', '/api/auth/verify', { token });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'expired' });
  });

  // Test 7: garbage token → invalid
  it('POST /api/auth/verify returns invalid for garbage token', async () => {
    const res = await jsonInject(app, 'POST', '/api/auth/verify', {
      token: 'this-is-not-a-real-token-abcdef123456',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'invalid' });
  });

  // Test 8: resend for the user → 202; old token invalid; new token works
  it('POST /api/auth/resend-verification invalidates old token and issues new one', async () => {
    // Signup first user
    await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'resend-user@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Signup resend test user
    await jsonInject(app, 'POST', '/api/auth/signup', {
      email: 'resend-test@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Get first token for resend user (most recent email)
    const msg = await fetchMailpitMessage();
    expect(msg).not.toBeNull();
    const firstToken = extractTokenFromHtml(msg!.HTML ?? '');
    expect(firstToken).not.toBeNull();

    // Resend
    const resResend = await jsonInject(app, 'POST', '/api/auth/resend-verification', {
      email: '  resend-test@example.com  ',
    });
    expect(resResend.statusCode).toBe(202);

    // Old token should now be invalid
    const resOldAfter = await jsonInject(app, 'POST', '/api/auth/verify', {
      token: firstToken,
    });
    expect(resOldAfter.statusCode).toBe(200);
    expect(resOldAfter.body.status).toBe('invalid');

    // New token from latest Mailpit message should work
    await new Promise((r) => setTimeout(r, 500));
    const msg2 = await fetchMailpitMessage();
    expect(msg2).not.toBeNull();
    const newToken = extractTokenFromHtml(msg2!.HTML ?? '');
    expect(newToken).not.toBeNull();

    const resNew = await jsonInject(app, 'POST', '/api/auth/verify', {
      token: newToken,
    });
    expect(resNew.statusCode).toBe(200);
    expect(resNew.body).toEqual({ status: 'success' });
  });

  // Test 9: resend for unknown email → 202 (no enumeration)
  it('POST /api/auth/resend-verification returns 202 for unknown email', async () => {
    const res = await jsonInject(app, 'POST', '/api/auth/resend-verification', {
      email: 'unknown-nobody@example.com',
    });

    expect(res.statusCode).toBe(202);
    expect(res.body).toHaveProperty('message');
  });
});
