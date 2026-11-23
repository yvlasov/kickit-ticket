import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

function columnLocator(page: any, heading: string) {
  return page.locator('h3', { hasText: heading }).first().locator('..');
}

test.describe('Drag diagnostics', () => {
  test('mouse drag with nav interceptor + PATCH tracking', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'E2Etest123';
    const teamName = uniqueTeamName();

    await page.request.post('/api/auth/signup', { data: { email, password } });
    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    const teamId = await createTeamViaApi(page, teamName);
    const epicId = await createEpicViaApi(page, teamId, 'Diag Epic');
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Diag Ticket', 'body', 'new', epicId);

    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const newCol = columnLocator(page, 'New');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cardBox = await card.boundingBox();
    expect(cardBox).toBeTruthy();

    const colBox = await columnLocator(page, 'In progress').boundingBox();
    expect(colBox).toBeTruthy();

    // Intercept navigation to ticket detail
    await page.route(`**/tickets/${ticketId}`, async (route) => {
      console.log(`NAV BLOCKED: ${route.request().url()}`);
      await route.abort('cancelled');
    });

    // Track PATCH requests
    let patchUrl = '';
    let patchStatus = 0;
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/tickets/') && resp.request().method() === 'PATCH') {
        patchUrl = resp.url();
        patchStatus = resp.status();
      }
    });

    // Do the drag
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    await page.mouse.up();

    await page.waitForTimeout(2000);

    // Check if PATCH was sent
    console.log(`PATCH sent to: ${patchUrl || 'NONE'}, status: ${patchStatus || 0}`);

    // Check card positions (card may have navigated, stay on board)
    const currentUrl = page.url();
    console.log(`Current URL: ${currentUrl}`);

    const newCards = await newCol.locator('a[href^="/tickets/"]').count().catch(() => 0);
    const ipCards = await columnLocator(page, 'In progress').locator('a[href^="/tickets/"]').count().catch(() => 0);
    console.log(`New: ${newCards}, In progress: ${ipCards}`);

    // Check if the ticket state changed via API
    const ticketResp = await page.request.get(`/api/tickets/${ticketId}`);
    const ticketData = await ticketResp.json() as { state?: string };
    console.log(`Ticket state: ${ticketData.state}`);

    await page.screenshot({ path: '/tmp/drag-diag8.png', fullPage: true });

    expect(true).toBe(true);
  });
});
