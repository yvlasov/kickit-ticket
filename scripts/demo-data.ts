#!/usr/bin/env tsx
import { randomBytes } from 'node:crypto';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
let ticketCount = parseInt(process.env.TICKET_COUNT ?? '120', 10);
if (ticketCount < 100) {
  console.warn(`TICKET_COUNT=${ticketCount} < 100, clamping to 100`);
  ticketCount = 100;
}

type Cookie = string;
type TicketType = 'bug' | 'feature' | 'fix';
type TicketState = 'new' | 'ready_for_implementation' | 'in_progress' | 'ready_for_acceptance' | 'done';

const TITLES = [
  'Login fails on mobile', 'Dashboard loads slowly', 'Missing error toast',
  'Email verification broken', 'Duplicate team creation', 'Ticket body truncated',
  'Epic dropdown empty', 'State not persisted', 'Comment timestamp wrong',
  'Board filter ignores case', 'Delete epic shows wrong count', 'Search returns stale results',
  'Drag card snaps back', 'Cookie not HttpOnly', 'Password < 8 chars accepted',
  'Token reuse succeeds', 'Session survives logout', 'Team name case conflict',
  'Cross-team epic allowed', 'modifiedAt unchanged on comment',
];

const BODIES = [
  'Steps to reproduce: navigate to the page, perform the action, observe unexpected behavior.',
  'This issue affects the core workflow and should be prioritized for the next sprint.',
  'Regression from recent changes. Verified on Chrome 130 and Firefox 131.',
  'User reports the feature works intermittently. Need to investigate race conditions.',
  'Edge case: occurs when multiple users edit the same ticket simultaneously.',
];

async function http(method: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`  ${method} ${path} → ${res.status} ${text}`);
    process.exit(1);
  }
  return res;
}

async function pollMailpit(email: string): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    const resp = await fetch(
      `${MAILPIT_URL}/api/v1/messages?latest=100`,
    );
    const data = await resp.json();
    const msgs = Array.isArray(data) ? data : (data.messages ?? []);
    const match = msgs.find((m: { To?: Array<{ Address?: string; Name?: string }> }) =>
      m.To?.some((t: { Address?: string; Name?: string }) => (t.Address ?? t.Name ?? '').toLowerCase() === email.toLowerCase()),
    );
    if (match) return match.ID;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function extractToken(html: string): string | null {
  const m = html.match(/https?:\/\/[^"]*verify[^"]*/);
  if (!m) return null;
  return new URL(m[0]).searchParams.get('token');
}

async function signup(email: string, password: string): Promise<void> {
  console.log('  Signing up …');
  await http('POST', '/api/auth/signup', { email, password });
}

async function verify(email: string): Promise<void> {
  console.log('  Polling for verification email …');
  const id = await pollMailpit(email);
  if (!id) throw new Error(`No verification email for ${email}`);
  const resp = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  const msg = await resp.json();
  const token = extractToken(msg.HTML ?? '');
  if (!token) throw new Error('No token in email');
  console.log('  Verifying …');
  await http('POST', '/api/auth/verify', { token });
}

async function login(email: string, password: string): Promise<Cookie> {
  console.log('  Logging in …');
  const res = await http('POST', '/api/auth/login', { email, password });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('No session cookie');
  return setCookie.split(';')[0];
}

async function createTeam(cookie: Cookie, name: string): Promise<string> {
  console.log(`  Creating team "${name}" …`);
  const res = await http('POST', '/api/teams', { name }, cookie);
  const data = await res.json();
  return data.id;
}

async function createEpic(cookie: Cookie, teamId: string, title: string): Promise<string> {
  const res = await http('POST', '/api/epics', { teamId, title }, cookie);
  const data = await res.json();
  return data.id;
}

async function createTicket(
  cookie: Cookie,
  teamId: string,
  type: TicketType,
  state: TicketState,
  epicId: string | null,
  title: string,
  body: string,
): Promise<void> {
  const payload: Record<string, unknown> = { teamId, type, state, title, body };
  if (epicId) payload.epicId = epicId;
  await http('POST', '/api/tickets', payload, cookie);
}

async function main(): Promise<void> {
  const ts = Date.now();
  const email = `demo-${ts}@kickit.local`;
  const password = randomBytes(12).toString('hex');

  console.log('=== KickIt Demo Data Generator ===');
  console.log(`Target: ${BASE_URL}`);
  console.log('');

  console.log('[1/5] Creating verified user …');
  await signup(email, password);
  await verify(email);
  const cookie = await login(email, password);
  console.log('  User verified and logged in.');
  console.log('');

  console.log('[2/5] Creating team …');
  const teamName = `Demo Team ${ts}`;
  const teamId = await createTeam(cookie, teamName);
  console.log('');

  console.log('[3/5] Creating epics …');
  const epicIds: string[] = [];
  for (const title of ['Backend', 'Frontend', 'Infrastructure']) {
    epicIds.push(await createEpic(cookie, teamId, title));
  }
  console.log('');

  console.log('[4/5] Creating tickets …');
  const types: TicketType[] = ['bug', 'feature', 'fix'];
  const states: TicketState[] = [
    'new', 'ready_for_implementation', 'in_progress', 'ready_for_acceptance', 'done',
  ];
  for (let i = 1; i <= ticketCount; i++) {
    const type = types[i % types.length];
    const state = states[i % states.length];
    const epicId = i % 2 === 0 ? epicIds[i % epicIds.length] : null;
    const title = `Demo ticket #${i} ${TITLES[i % TITLES.length]}`;
    const body = BODIES[i % BODIES.length];
    await createTicket(cookie, teamId, type, state, epicId, title, body);
    if (i % 20 === 0) console.log(`  Created ${i}/${ticketCount} tickets …`);
  }
  console.log(`  All ${ticketCount} tickets created.`);
  console.log('');

  console.log('[5/5] Done.');
  console.log('');
  console.log('=== Summary ===');
  console.log(`Email:       ${email}`);
  console.log(`Password:    ${password}`);
  console.log(`Team:        ${teamName} (${teamId})`);
  console.log(`Epics:       ${epicIds.length}`);
  console.log(`Tickets:     ${ticketCount}`);
  console.log(`Board URL:   ${BASE_URL.replace(/\/$/, '')}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
