import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
  dragCard,
} from './helpers';

test.describe('Drag rollback', () => {
  test('route abort shows snap-back + error toast', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'E2Etest123';
    const teamName = uniqueTeamName();

    // Sign up and verify via API
    await page.request.post('/api/auth/signup', {
      data: { email, password },
    });

    const token = await pollVerificationToken(email);
    expect(token).not.toBeNull();
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    // Login via UI
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(/\/(board|tickets|\/$)/, { timeout: 10000 });

    // Create team + epic + ticket via API
    const teamId = await createTeamViaApi(page, teamName);
    const epicId = await createEpicViaApi(page, teamId, 'Rollback Epic');
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Rollback Ticket', 'Test body', 'new', epicId);

    // Navigate to board
    await page.goto(`/board?teamId=${teamId}`);
    await page.waitForSelector('[class*="bg-white"]', { timeout: 10000 });

    // Route PATCH requests to abort (simulate server failure)
    await page.route(`**/api/tickets/${ticketId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // Find the card in the "New" column
    const newColumn = page.locator('h3', { hasText: 'New' }).first().locator('..');
    const inProgressColumn = page.locator('h3', { hasText: 'In progress' }).first().locator('..');

    const card = newColumn.locator('a.bg-white').first();
    const cardBox = await card.boundingBox();
    const colBox = await inProgressColumn.boundingBox();

    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    // Drag the card
    if (cardBox && colBox) {
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        colBox.x + colBox.width / 2,
        colBox.y + colBox.height / 2,
        { steps: 12 },
      );
      await page.mouse.up();
    }

    // Wait for the error toast to appear
    await expect(page.locator('[class*="bg-red-600"]')).toBeVisible({ timeout: 5000 });

    // Verify card snapped back to original column (still in "New")
    await expect(card).toBeVisible();

    // Unroute
    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
