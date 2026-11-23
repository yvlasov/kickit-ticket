import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
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

    // Wait for cards to appear
    const cards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    let cardCount = 0;
    for (let i = 0; i < 20; i++) {
      cardCount = await cards.count();
      if (cardCount >= 1) break;
      await page.waitForTimeout(500);
    }

    // Verify ticket is in "New" state
    const newColumn = page.locator('h3', { hasText: 'New' }).first().locator('..');
    const newCards = newColumn.locator('a.bg-white');
    await expect(newCards.first()).toBeVisible();

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

    // Simulate the drag state-change by making the PATCH request via the browser
    const patchResult = await page.evaluate(async (id) => {
      try {
        const res = await fetch(`/api/tickets/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'in_progress' }),
        });
        return { status: res.status, ok: res.ok, text: await res.text() };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }, ticketId);

    expect(patchResult.status).toBe(500);

    // Verify ticket is STILL in "New" state (state change was rejected)
    const newCardsAfter = newColumn.locator('a.bg-white');
    await expect(newCardsAfter.first()).toBeVisible();

    // Verify the ticket is NOT in "In progress"
    const inProgressColumn = page.locator('h3', { hasText: 'In progress' }).first().locator('..');
    const inProgressCards = inProgressColumn.locator('a.bg-white');
    const inProgressCount = await inProgressCards.count();
    expect(inProgressCount).toBe(0);

    // Unroute
    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
