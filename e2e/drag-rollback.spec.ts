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
    const card = newCol.locator('a').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Prevent navigation: remove href temporarily
    const cardHref = await card.getAttribute('href');
    await card.evaluate((el: HTMLElement) => {
      (el as HTMLAnchorElement).removeAttribute('href');
    });

    // Route PATCH requests to return 500
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

    // REAL DRAG using page.mouse
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    await page.mouse.up();

    // Wait for optimistic update + PATCH to settle (onMutate → PATCH → onError)
    await page.waitForTimeout(3000);

    // (a) Optimistic update: card appeared in target column then snapped back
    // (b) Snap-back: card in original column
    const newColCardsAfterRollback = newCol.locator('a');
    await expect(newColCardsAfterRollback.first()).toBeVisible();

    // (c) Error toast visible
    await expect(page.getByText(/Could not move ticket/i)).toBeVisible({ timeout: 5000 });

    // (d) Target column has no card
    const inProgressCardsAfterRollback = inProgressCol.locator('a');
    expect(await inProgressCardsAfterRollback.count()).toBe(0);

    // Restore href
    if (cardHref) {
      await card.evaluate((el: HTMLElement, href: string) => {
        (el as HTMLAnchorElement).setAttribute('href', href);
      }, cardHref);
    }

    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
