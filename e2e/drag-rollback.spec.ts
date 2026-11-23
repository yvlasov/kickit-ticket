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

    // REAL DRAG using page.mouse (CDP Input.dispatchMouseEvent fires trusted pointer events)
    // Step 1: move to card center
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    // Step 2: press down
    await page.mouse.down();
    // Step 3: move slightly to exceed PointerSensor activationConstraint distance=6
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    // Step 4: drag to target column center
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    // Step 5: release
    await page.mouse.up();

    // Wait for optimistic update + PATCH to settle (onMutate → PATCH → onError)
    await page.waitForTimeout(2000);

    // (c) Error toast visible — check BEFORE navigating away (toast is Board component state)
    await expect(page.getByText(/Could not move ticket/i)).toBeVisible({ timeout: 5000 });

    // (a) Optimistic update was applied then reverted: card should be back in New column
    // (b) Snap-back: card in original column
    const newColCardsAfterRollback = newCol.locator('a[href^="/tickets/"]');
    await expect(newColCardsAfterRollback.first()).toBeVisible();

    // (d) Target column has no card
    const inProgressCardsAfterRollback = inProgressCol.locator('a[href^="/tickets/"]');
    expect(await inProgressCardsAfterRollback.count()).toBe(0);

    // Now navigate away and back to verify clean state
    try {
      await page.goBack();
      await page.waitForTimeout(500);
    } catch {
      // Already on board
    }

    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Verify ticket is still in New column after reload
    const newColAfterReload = newCol.locator('a[href^="/tickets/"]');
    await expect(newColAfterReload.first()).toBeVisible();
    const inProgressAfterReload = inProgressCol.locator('a[href^="/tickets/"]');
    expect(await inProgressAfterReload.count()).toBe(0);

    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
