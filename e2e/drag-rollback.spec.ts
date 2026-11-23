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

test.describe('Drag rollback diagnostics', () => {
  test('check rollback state after drag', async ({ page }) => {
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

    // Track PATCH
    const patchResponses: Array<{ url: string; status: number }> = [];
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/tickets/') && resp.request().method() === 'PATCH') {
        patchResponses.push({ url: resp.url(), status: resp.status() });
      }
    });

    // Route PATCH to 500
    await page.route(`**/api/tickets/${ticketId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
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

    // REAL DRAG — no href hack
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    await page.mouse.up();

    await page.waitForTimeout(3000);

    console.log('URL:', page.url());
    console.log('PATCH responses:', JSON.stringify(patchResponses));

    // Check card positions
    const newCards = await newCol.locator('a[href^="/tickets/"]').count().catch(() => 0);
    const ipCards = await inProgressCol.locator('a[href^="/tickets/"]').count().catch(() => 0);
    console.log(`New: ${newCards}, In progress: ${ipCards}`);

    // Check all text on page
    const pageText = await page.textContent('body');
    const hasToast = pageText?.includes('Could not move ticket') ?? false;
    console.log(`Toast visible: ${hasToast}`);

    // Check card titles
    const allCardTitles = await page.locator('a[href^="/tickets/"]').allTextContents();
    console.log('All card titles:', allCardTitles);

    await page.screenshot({ path: '/tmp/drag-diag-rollback.png', fullPage: true });

    expect(true).toBe(true);

    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
