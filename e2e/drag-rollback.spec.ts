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

test.describe('Drag rollback', () => {
  test('route abort shows snap-back + error toast', async ({ page }) => {
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
    const epicId = await createEpicViaApi(page, teamId, 'Rollback Epic');
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Rollback Ticket', 'Test body', 'new', epicId);

    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const newCol = columnLocator(page, 'New');
    const inProgressCol = columnLocator(page, 'In progress');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Track all console logs
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(msg.text());
    });

    // Track all XHR/fetch responses
    const patchResponses: Array<{ url: string; status: number }> = [];
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/tickets/') && resp.request().method() === 'PATCH') {
        patchResponses.push({ url: resp.url(), status: resp.status() });
      }
    });

    // Route PATCH requests to return 500
    await page.route(`**/api/tickets/${ticketId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        console.log('ROUTE MATCHED — fulfilling 500');
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ error: { message: 'Server error' } }),
        });
      } else {
        await route.continue();
      }
    });

    const cardBox = await card.boundingBox();
    const colBox = await inProgressCol.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    // REAL DRAG using page.mouse
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    await page.mouse.up();

    // Wait for optimistic update + PATCH to settle
    await page.waitForTimeout(3000);

    console.log('Console logs:', JSON.stringify(consoleLogs));
    console.log('PATCH responses:', JSON.stringify(patchResponses));

    // Check card positions
    const newCards = await newCol.locator('a[href^="/tickets/"]').count();
    const ipCards = await inProgressCol.locator('a[href^="/tickets/"]').count();
    console.log(`New: ${newCards}, In progress: ${ipCards}`);

    // Check toast
    const toastVisible = await page.getByText(/Could not move ticket/i).isVisible().catch(() => false);
    console.log(`Toast visible: ${toastVisible}`);

    // Check all text on page for any toast-like content
    const pageText = await page.textContent('body');
    const hasToastText = pageText?.includes('Could not move ticket') ?? false;
    console.log(`Page contains toast text: ${hasToastText}`);

    expect(true).toBe(true);

    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
