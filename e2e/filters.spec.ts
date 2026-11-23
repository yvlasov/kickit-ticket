import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

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
    await expect(page.getByText('Board')).toBeVisible({ timeout: 10000 });

    // Count initial cards
    const initialCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const initialCount = await initialCards.count();
    expect(initialCount).toBeGreaterThanOrEqual(4);

    // Apply type filter = bug
    await page.locator('select.border-gray-300').first().selectOption('bug');
    await page.waitForTimeout(500); // debounce

    const bugCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const bugCount = await bugCards.count();
    expect(bugCount).toBeLessThan(initialCount);
    expect(bugCount).toBeGreaterThanOrEqual(2);

    // Verify URL contains type filter
    const url = page.url();
    expect(url).toContain('type=bug');

    // Apply epic filter = Filter Epic A
    const epicSelect = page.locator('select.border-gray-300').nth(1);
    await epicSelect.selectOption('Filter Epic A');
    await page.waitForTimeout(500);

    const epicACards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const epicACount = await epicACards.count();
    expect(epicACount).toBeLessThanOrEqual(bugCount);
    expect(epicACount).toBeGreaterThanOrEqual(1);

    // Verify URL contains both filters
    expect(page.url()).toContain('type=bug');
    expect(page.url()).toContain('epic=');

    // Apply search text
    await page.locator('input[placeholder="Search titles..."]').fill('One');
    await page.waitForTimeout(500); // debounce

    const searchCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const searchCount = await searchCards.count();
    expect(searchCount).toBeLessThanOrEqual(epicACount);

    // Verify URL contains q param
    expect(page.url()).toContain('q=One');

    // Reload — same subset should appear
    await page.reload();
    await expect(page.getByText('Board')).toBeVisible({ timeout: 10000 });

    // Verify filters persisted
    expect(page.url()).toContain('type=bug');
    expect(page.url()).toContain('epic=');
    expect(page.url()).toContain('q=One');

    const afterReloadCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const afterReloadCount = await afterReloadCards.count();
    expect(afterReloadCount).toBe(searchCount);

    // Go back — previous filter state should be restored
    await page.goBack();
    await page.waitForTimeout(500);

    // Should be back to epic filter state (type=bug, epic=A, no q)
    expect(page.url()).toContain('type=bug');
    expect(page.url()).toContain('epic=');
  });
});
