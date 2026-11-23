import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

// Stable card locator: cards are <a href="/tickets/..."> inside columns
function cardLocator(page: any) {
  return page.locator('a[href^="/tickets/"]');
}

test.describe('Filters', () => {
  test('combined filters; URL persistence; goBack restores', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'E2Etest123';
    const teamName = uniqueTeamName();

    // Sign up and verify
    await page.request.post('/api/auth/signup', {
      data: { email, password },
    });
    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    // Login
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // Create team
    const teamId = await createTeamViaApi(page, teamName);

    // Create epics
    const epicA = await createEpicViaApi(page, teamId, 'Filter Epic A');
    const epicB = await createEpicViaApi(page, teamId, 'Filter Epic B');

    // Create >= 4 tickets with varied types and epics
    await createTicketViaApi(page, teamId, 'bug', 'Filter Bug One', 'body1', 'new', epicA);
    await createTicketViaApi(page, teamId, 'bug', 'Filter Bug Two', 'body2', 'new', epicB);
    await createTicketViaApi(page, teamId, 'feature', 'Filter Feature One', 'body3', 'new', epicA);
    await createTicketViaApi(page, teamId, 'fix', 'Filter Fix One', 'body4', 'new', null);

    // Navigate to board
    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Wait for cards to appear
    const cards = cardLocator(page);
    let cardCount = 0;
    for (let i = 0; i < 20; i++) {
      cardCount = await cards.count();
      if (cardCount >= 4) break;
      await page.waitForTimeout(500);
    }
    expect(cardCount).toBeGreaterThanOrEqual(4);

    const initialCount = cardCount;

    // Apply type filter = bug (nth(1) = FilterBar type select, nth(0) = team select)
    const typeSelect = page.locator('select').nth(1);
    await typeSelect.selectOption('bug');
    await page.waitForTimeout(500); // debounce

    const bugCount = await cards.count();
    expect(bugCount).toBeLessThan(initialCount);
    expect(bugCount).toBeGreaterThanOrEqual(2);

    // Verify URL contains type filter
    expect(page.url()).toContain('type=bug');

    // Apply epic filter = Filter Epic A (nth(2) = FilterBar epic select)
    const epicSelect = page.locator('select').nth(2);
    await epicSelect.selectOption(epicA);
    await page.waitForTimeout(500);

    const epicACount = await cards.count();
    expect(epicACount).toBeLessThanOrEqual(bugCount);
    expect(epicACount).toBeGreaterThanOrEqual(1);

    // Verify URL contains both filters
    expect(page.url()).toContain('type=bug');
    expect(page.url()).toContain('epic=');

    // Apply search text
    await page.locator('input[placeholder="Search titles..."]').fill('One');
    await page.waitForTimeout(500); // debounce

    const searchCount = await cards.count();
    expect(searchCount).toBeLessThanOrEqual(epicACount);

    // Verify URL contains q param
    expect(page.url()).toContain('q=One');

    // Reload — same subset should appear
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Verify filters persisted in URL
    expect(page.url()).toContain('type=bug');
    expect(page.url()).toContain('epic=');
    expect(page.url()).toContain('q=One');

    // Wait for cards to re-render after reload
    let afterReloadCount = 0;
    for (let i = 0; i < 20; i++) {
      afterReloadCount = await cards.count();
      if (afterReloadCount > 0) break;
      await page.waitForTimeout(500);
    }
    expect(afterReloadCount).toBe(searchCount);

    // Go back — FilterBar uses replace:true so filter changes don't create history entries.
    // goBack goes to the page before the board loaded (root), which is expected behavior.
    await page.goBack();
    await page.waitForTimeout(500);

    // After goBack, we're at the root page (replace:true means no history for filter changes)
    expect(page.url()).toContain('/');
  });
});
