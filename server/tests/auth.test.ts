import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { fetchMailpitMessages, fetchMailpitMessageById, fetchLatestMailpitMessageFor, extractTokenFromHtml, apiRequest, cleanupTables } from './helpers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, '../drizzle');

async function fetchMailpitMessagesFor(email: string): Promise<Array<{ HTML?: string; Text?: string }>> {
  const msgs = await fetchMailpitMessages();
  const matching = msgs.filter((m) => m.To?.some((t) => (t.Address ?? t.Name ?? '').toLowerCase() === email.toLowerCase()));
  const results: Array<{ HTML?: string; Text?: string }> = [];
  for (const m of matching) {
    const full = await fetchMailpitMessageById(m.ID);
    if (full) results.push(full);
  }
  return results;
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
    await cleanupTables(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  // Test 1: signup 201; password_hash in DB starts with $argon2id$
  it('POST /api/auth/signup returns 201 and hashes password with Argon2id', async () => {
    const res = await apiRequest(app, 'POST', '/api/auth/signup', {
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
    const res = await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'weak@example.com',
      password: 'short',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Test 2b: invalid email → 400
  it('POST /api/auth/signup rejects invalid email with 400', async () => {
    const res = await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'not-an-email',
      password: 'password123',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Test 3: duplicate email with different case → 409
  it('POST /api/auth/signup rejects duplicate email (case-insensitive) with 409', async () => {
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'duplicate@example.com',
      password: 'password123',
    });

    const res = await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'DUPLICATE@EXAMPLE.COM',
      password: 'password123',
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  // Test 3b: duplicate email with leading/trailing spaces → 409
  it('POST /api/auth/signup rejects duplicate email with leading/trailing spaces with 409', async () => {
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'spaces@example.com',
      password: 'password123',
    });

    const res = await apiRequest(app, 'POST', '/api/auth/signup', {
      email: '  spaces@example.com  ',
      password: 'password123',
    });

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  // Test 4: verification email arrives in Mailpit
  it('POST /api/auth/signup sends verification email to Mailpit', async () => {
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'mailpit@example.com',
      password: 'password123',
    });

    // Wait for email to arrive
    await new Promise((r) => setTimeout(r, 500));

    const msg = await fetchLatestMailpitMessageFor('mailpit@example.com');
    expect(msg).not.toBeNull();
    const body = msg!.HTML ?? msg!.Text ?? '';
    expect(body).toContain('/verify?token=');
  });

  // Test 5: verify with token → success; email_verified_at set; reuse → used
  it('POST /api/auth/verify returns success for valid token and marks used', async () => {
    // Signup
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'verify1@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Get token from Mailpit
    const msg = await fetchLatestMailpitMessageFor('verify1@example.com');
    expect(msg).not.toBeNull();
    const token = extractTokenFromHtml(msg!.HTML ?? '');
    expect(token).not.toBeNull();

    // Verify
    const res = await apiRequest(app, 'POST', '/api/auth/verify', { token });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'success' });

    // Check email_verified_at is set
    const user = await pool.query(
      'SELECT email_verified_at FROM users WHERE email = $1',
      ['verify1@example.com'],
    );
    expect(user.rows[0].email_verified_at).not.toBeNull();

    // Reuse token → used
    const res2 = await apiRequest(app, 'POST', '/api/auth/verify', { token });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ status: 'used' });
  });

  // Test 6: expired token → expired
  it('POST /api/auth/verify returns expired for expired token (fixture)', async () => {
    // Signup a user
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'expired-token@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Get the token from Mailpit
    const msg = await fetchLatestMailpitMessageFor('expired-token@example.com');
    expect(msg).not.toBeNull();
    const token = extractTokenFromHtml(msg!.HTML ?? '');
    expect(token).not.toBeNull();

    // Expire the token via SQL
    const tokenHash = crypto.createHash('sha256').update(token!).digest('hex');
    await pool.query(
      'UPDATE verification_tokens SET expires_at = now() - interval \'1 hour\' WHERE token_hash = $1',
      [tokenHash],
    );

    const res = await apiRequest(app, 'POST', '/api/auth/verify', { token });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'expired' });
  });

  // Test 7: garbage token → invalid
  it('POST /api/auth/verify returns invalid for garbage token', async () => {
    const res = await apiRequest(app, 'POST', '/api/auth/verify', {
      token: 'this-is-not-a-real-token-abcdef123456',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'invalid' });
  });

  // Test 8: resend for the user → 202; old token invalid; new token works
  it('POST /api/auth/resend-verification invalidates old token and issues new one', async () => {
    // Signup first user
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'resend-user@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Signup resend test user
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'resend-test@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Get first token for resend user (most recent email before resend)
    const msgsBefore = await fetchMailpitMessagesFor('resend-test@example.com');
    expect(msgsBefore.length).toBeGreaterThanOrEqual(1);
    const firstToken = extractTokenFromHtml(msgsBefore[0]!.HTML ?? '');
    expect(firstToken).not.toBeNull();

    // Resend
    const resResend = await apiRequest(app, 'POST', '/api/auth/resend-verification', {
      email: '  resend-test@example.com  ',
    });
    expect(resResend.statusCode).toBe(202);

    // Old token should now be invalid
    const resOldAfter = await apiRequest(app, 'POST', '/api/auth/verify', {
      token: firstToken,
    });
    expect(resOldAfter.statusCode).toBe(200);
    expect(resOldAfter.body.status).toBe('invalid');

    // New token from latest Mailpit message should work
    await new Promise((r) => setTimeout(r, 500));
    const msgsAfter = await fetchMailpitMessagesFor('resend-test@example.com');
    expect(msgsAfter.length).toBeGreaterThanOrEqual(2);
    const newToken = extractTokenFromHtml(msgsAfter[0]!.HTML ?? '');
    expect(newToken).not.toBeNull();

    const resNew = await apiRequest(app, 'POST', '/api/auth/verify', {
      token: newToken,
    });
    expect(resNew.statusCode).toBe(200);
    expect(resNew.body).toEqual({ status: 'success' });
  });

  // Test 9: resend for unknown email → 202 (no enumeration)
  it('POST /api/auth/resend-verification returns 202 for unknown email', async () => {
    const res = await apiRequest(app, 'POST', '/api/auth/resend-verification', {
      email: 'unknown-nobody@example.com',
    });

    expect(res.statusCode).toBe(202);
    expect(res.body).toHaveProperty('message');
  });

  // Test 10: used token remains 'used' after resend (not 'invalid')
  it('POST /api/auth/verify returns used for token used before resend', async () => {
    // Signup
    await apiRequest(app, 'POST', '/api/auth/signup', {
      email: 'used-before@example.com',
      password: 'password123',
    });

    await new Promise((r) => setTimeout(r, 500));

    // Get token from Mailpit
    const msgsBefore = await fetchMailpitMessagesFor('used-before@example.com');
    expect(msgsBefore.length).toBeGreaterThanOrEqual(1);
    const token = extractTokenFromHtml(msgsBefore[0]!.HTML ?? '');
    expect(token).not.toBeNull();

    // Verify → success (marks token as used)
    const resVerify = await apiRequest(app, 'POST', '/api/auth/verify', { token });
    expect(resVerify.statusCode).toBe(200);
    expect(resVerify.body).toEqual({ status: 'success' });

    // Resend → issues new token, old token should stay 'used'
    const resResend = await apiRequest(app, 'POST', '/api/auth/resend-verification', {
      email: 'used-before@example.com',
    });
    expect(resResend.statusCode).toBe(202);

    // Old token should still be 'used', not 'invalid'
    const resOld = await apiRequest(app, 'POST', '/api/auth/verify', { token });
    expect(resOld.statusCode).toBe(200);
    expect(resOld.body).toEqual({ status: 'used' });

    // New token from Mailpit should work
    await new Promise((r) => setTimeout(r, 500));
    const msgsAfter = await fetchMailpitMessagesFor('used-before@example.com');
    expect(msgsAfter.length).toBeGreaterThanOrEqual(2);
    const newToken = extractTokenFromHtml(msgsAfter[0]!.HTML ?? '');
    expect(newToken).not.toBeNull();

    const resNew = await apiRequest(app, 'POST', '/api/auth/verify', {
      token: newToken,
    });
    expect(resNew.statusCode).toBe(200);
    expect(resNew.body).toEqual({ status: 'success' });
  });
});
