import request, { type Test as SupertestTest, type Response as SupertestResponse } from 'supertest';
import { buildApp } from '../src/app';
import { Pool } from 'pg';

export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

export async function fetchMailpitMessages(): Promise<Array<{ ID: string; To?: Array<{ Address?: string; Name?: string }> }>> {
  const resp = await fetch(`${MAILPIT_URL}/api/v1/messages?latest=100`);
  const data = await resp.json();
  const arr = Array.isArray(data) ? data : (data.messages ?? []);
  return arr;
}

export async function fetchMailpitMessageById(id: string): Promise<{ HTML?: string; Text?: string } | null> {
  const resp = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  const data = await resp.json();
  return { HTML: data.HTML, Text: data.Text };
}

export async function fetchLatestMailpitMessageFor(email: string): Promise<{ HTML?: string; Text?: string } | null> {
  const msgs = await fetchMailpitMessages();
  const matching = msgs.filter((m) => m.To?.some((t) => (t.Address ?? t.Name ?? '').toLowerCase() === email.toLowerCase()));
  if (matching.length === 0) return null;
  const full = await fetchMailpitMessageById(matching[0].ID);
  return full;
}

export function extractTokenFromHtml(html: string): string | null {
  const match = html.match(/https?:\/\/[^"]*verify[^"]*/);
  if (!match) return null;
  return new URL(match[0]).searchParams.get('token');
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiResult {
  statusCode: number;
  body: unknown;
  headers: Record<string, string | string[]>;
  raw: SupertestResponse;
}

export async function apiRequest(
  app: Awaited<ReturnType<typeof buildApp>>,
  method: HttpMethod,
  url: string,
  body?: Record<string, unknown>,
  cookies?: string,
): Promise<ApiResult> {
  const agent = request(app.server);
  const req: SupertestTest = method === 'GET'
    ? agent.get(url)
    : method === 'POST'
      ? agent.post(url)
      : method === 'PATCH'
        ? agent.patch(url)
        : agent.delete(url);
  if (cookies) {
    req.set('Cookie', cookies);
  }
  if (body) {
    req.send(body);
  }
  const res: SupertestResponse = await req;
  return {
    statusCode: res.statusCode,
    body: res.body,
    headers: res.headers,
    raw: res,
  };
}

export async function signupAndVerify(
  app: Awaited<ReturnType<typeof buildApp>>,
  p: Pool,
  email: string,
  password: string,
): Promise<{ id: string; cookie: string }> {
  await apiRequest(app, 'POST', '/api/auth/signup', { email, password });

  // Poll Mailpit instead of fixed sleep — wait up to 10s for the verification email
  const startTime = Date.now();
  const timeoutMs = 10_000;
  while (Date.now() - startTime < timeoutMs) {
    const msg = await fetchLatestMailpitMessageFor(email);
    if (msg) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const msg = await fetchLatestMailpitMessageFor(email);
  if (!msg) throw new Error(`No verification email found for ${email}`);

  const token = extractTokenFromHtml(msg.HTML ?? '');
  if (!token) throw new Error(`No token extracted from verification email for ${email}`);

  const res = await apiRequest(app, 'POST', '/api/auth/verify', { token });
  if (res.statusCode !== 200) throw new Error(`Verify failed: ${JSON.stringify(res.body)}`);
  if (res.body.status !== 'success') throw new Error(`Verify returned ${res.body.status}`);

  const loginRes = await apiRequest(app, 'POST', '/api/auth/login', {
    email: email.toLowerCase(),
    password,
  });
  if (loginRes.statusCode !== 200) throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);

  const cookie = loginRes.headers['set-cookie']?.[0] ?? '';
  const user = await p.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  return { id: user.rows[0].id, cookie };
}

export async function cleanupTables(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM comments');
  await pool.query('DELETE FROM tickets');
  await pool.query('DELETE FROM epics');
  await pool.query('DELETE FROM teams');
  await pool.query('DELETE FROM verification_tokens');
  await pool.query('DELETE FROM sessions');
  await pool.query('DELETE FROM users');
}
