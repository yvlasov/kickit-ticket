import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

// Stable column locator: find column div by its h3 heading text
function columnLocator(page: any, heading: string) {
  return page.locator('h3', { hasText: heading }).first().locator('..');
}

test.describe('Drag rollback', () => {
  test('route abort shows snap-back + error toast', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'E2Etest123';
    const teamName = uniqueTeamName();

    // Sign up and verify via API
    await page.request.post('/api/auth/signup', {
      data: { email, password },
    });

    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    // Login via UI
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // Create team + epic + ticket via API
    const teamId = await createTeamViaApi(page, teamName);
    const epicId = await createEpicViaApi(page, teamId, 'Rollback Epic');
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Rollback Ticket', 'Test body', 'new', epicId);

    // Navigate to board
    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Locate columns and card
    const newCol = columnLocator(page, 'New');
    const inProgressCol = columnLocator(page, 'In progress');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Route PATCH requests to return 500 (simulate server failure during drag)
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

    // REAL DRAG: card from New column to In progress column
    const cardBox = await card.boundingBox();
    const colBox = await inProgressCol.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    if (cardBox && colBox) {
      // Move to card center
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      // Press down
      await page.mouse.down();
      // Move slightly to exceed PointerSensor activationConstraint distance=6
      await page.mouse.move(cardBox.x + cardBox.width / 2 + 15, cardBox.y + cardBox.height / 2 + 15, { steps: 5 });
      // Drag to target column center
      await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
      // Release
      await page.mouse.up();
    }

    // (a) Immediately after mouse.up, the card has optimistically appeared in the target column
    // The optimistic update happens before the PATCH request settles
    const inProgressCardsAfterDrag = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressCardsAfterDrag.first()).toBeVisible({ timeout: 3000 });

    // (b) After the failed request settles (~2s), the card snaps back to the original column
    await page.waitForTimeout(2000);

    const newColCardsAfterRollback = newCol.locator('a[href^="/tickets/"]');
    await expect(newColCardsAfterRollback.first()).toBeVisible();

    // (c) The error TOAST is visible with its message
    await expect(page.getByText(/Could not move ticket/i)).toBeVisible({ timeout: 5000 });

    // (d) The target column contains no card for this ticket afterwards
    const inProgressCardsAfterRollback = inProgressCol.locator('a[href^="/tickets/"]');
    const inProgressCount = await inProgressCardsAfterRollback.count();
    expect(inProgressCount).toBe(0);

    // Unroute
    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
