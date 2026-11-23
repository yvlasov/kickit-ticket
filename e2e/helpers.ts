import { Page, request } from '@playwright/test';

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kickit.local`;
}

export function uniqueTeamName(): string {
  return `E2E Team ${Date.now()}`;
}

export async function signupViaApi(page: Page, email: string, password: string): Promise<void> {
  const resp = await page.request.post('/api/auth/signup', {
    data: { email, password },
  });
  if (!resp.ok()) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Signup failed: ${JSON.stringify(body)}`);
  }
}

export async function pollVerificationToken(email: string): Promise<string | null> {
  const mailpitUrl = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
  const startTime = Date.now();
  const timeoutMs = 15_000;

  while (Date.now() - startTime < timeoutMs) {
    const resp = await fetch(`${mailpitUrl}/api/v1/messages?latest=100`);
    const data = await resp.json();
    const msgs = Array.isArray(data) ? data : (data.messages ?? []);
    const match = msgs.find(
      (m: { To?: Array<{ Address?: string }> }) =>
        m.To?.some((t) => (t.Address ?? '').toLowerCase() === email.toLowerCase()),
    );
    if (match) {
      const detail = await fetch(`${mailpitUrl}/api/v1/message/${match.ID}`);
      const msg = await detail.json();
      const html = msg.HTML ?? '';
      const m = html.match(/https?:\/\/[^"]*verify[^"]*/);
      if (m) return new URL(m[0]).searchParams.get('token');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export async function verifyEmail(page: Page, token: string): Promise<void> {
  const resp = await page.request.post('/api/auth/verify', {
    data: { token },
  });
  if (!resp.ok()) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Verify failed: ${JSON.stringify(body)}`);
  }
}

export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  // Wait for redirect to home/board
  await page.waitForURL(/\/(board|tickets|\/$)/, { timeout: 10000 });
}

export async function loginViaApi(page: Page, email: string, password: string): Promise<void> {
  const resp = await page.request.post('/api/auth/login', {
    data: { email: email.toLowerCase(), password },
  });
  if (!resp.ok()) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Login failed: ${JSON.stringify(body)}`);
  }
}

export async function createTeamViaApi(page: Page, name: string): Promise<string> {
  const resp = await page.request.post('/api/teams', {
    data: { name },
  });
  if (!resp.ok()) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Create team failed: ${JSON.stringify(body)}`);
  }
  const data = await resp.json() as { id: string };
  return data.id;
}

export async function createEpicViaApi(page: Page, teamId: string, title: string): Promise<string> {
  const resp = await page.request.post('/api/epics', {
    data: { teamId, title },
  });
  if (!resp.ok()) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Create epic failed: ${JSON.stringify(body)}`);
  }
  const data = await resp.json() as { id: string };
  return data.id;
}

export async function createTicketViaApi(
  page: Page,
  teamId: string,
  type: string,
  title: string,
  body: string,
  state?: string,
  epicId?: string | null,
): Promise<string> {
  const payload: Record<string, unknown> = { teamId, type, title, body };
  if (state) payload.state = state;
  if (epicId) payload.epicId = epicId;
  const resp = await page.request.post('/api/tickets', { data: payload });
  if (!resp.ok()) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(`Create ticket failed: ${JSON.stringify(body)}`);
  }
  const data = await resp.json() as { id: string };
  return data.id;
}

export async function fullSignupAndLogin(page: Page, email: string, password: string): Promise<void> {
  // Sign up via API
  await signupViaApi(page, email, password);

  // Poll for verification token
  const token = await pollVerificationToken(email);
  if (!token) throw new Error('No verification token found');

  // Verify via UI (posts token to /api/auth/verify)
  await page.goto('/verify');
  await page.getByLabel('Verification token').fill(token);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL(/\/(login|board|tickets|\/$)/, { timeout: 10000 });

  // Login via UI
  await loginViaUi(page, email, password);
}

// Multi-step drag for dnd-kit PointerSensor with activationConstraint distance=6
export async function dragCard(page: Page, cardSelector: string, columnSelector: string): Promise<void> {
  const card = page.locator(cardSelector).first();
  const column = page.locator(columnSelector).first();

  const cardBox = await card.boundingBox();
  const colBox = await column.boundingBox();

  if (!cardBox || !colBox) throw new Error('Card or column not found');

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = colBox.x + colBox.width / 2;
  const endY = colBox.y + colBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  // Wait for optimistic update + API call
  await page.waitForTimeout(1500);
}
