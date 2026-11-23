import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test.describe('Scale', () => {
  test('demo script creates 100+ tickets; filter subset; page responsive', async ({ page }) => {
    const baseUrl = process.env.BASE_URL ?? 'http://app:3000';
    const mailpitUrl = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

    // Run demo script directly inside the container
    const output = execSync('npx tsx scripts/demo-data.ts', {
      encoding: 'utf-8',
      timeout: 120_000,
      env: { ...process.env, BASE_URL: baseUrl, MAILPIT_URL: mailpitUrl },
    });

    console.log('Demo script output:', output);

    // Parse credentials from output
    const emailMatch = output.match(/Email:\s+(.+)/);
    const passwordMatch = output.match(/Password:\s+(.+)/);

    expect(emailMatch).not.toBeNull();
    expect(passwordMatch).not.toBeNull();

    const demoEmail = emailMatch![1].trim();
    const demoPassword = passwordMatch![1].trim();

    // Log in via browser
    await page.goto('/login');
    await page.getByLabel('Email').fill(demoEmail);
    await page.getByLabel('Password').fill(demoPassword);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // Navigate to board (auto-selects first team via setSearchParams)
    await page.getByRole('navigation').getByRole('link', { name: 'Board' }).click();
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 15000 });

    // Wait for the team select to be populated
    const teamSelect = page.locator('select').first();
    await expect(teamSelect).toBeVisible({ timeout: 10000 });

    // Wait for team options to appear (always has "Select a team" empty option + teams)
    let teamOptions = 0;
    for (let i = 0; i < 10; i++) {
      teamOptions = await teamSelect.locator('option').count();
      if (teamOptions > 1) break; // >1 because there's always a "Select a team" empty option
      await page.waitForTimeout(1000);
    }

    // If no team selected yet, select the first team
    const currentSelected = await teamSelect.inputValue();
    if (!currentSelected && teamOptions > 0) {
      await teamSelect.selectOption({ index: 1 }); // skip empty option
      await page.waitForTimeout(2000);
    }

    // Wait for cards to render
    const cards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    let cardCount = 0;
    for (let i = 0; i < 20; i++) {
      cardCount = await cards.count();
      if (cardCount >= 100) break;
      await page.waitForTimeout(500);
    }
    expect(cardCount).toBeGreaterThanOrEqual(100);

    // Apply a type filter via UI (nth(1) = FilterBar type select)
    await page.locator('select').nth(1).selectOption('bug');
    await page.waitForTimeout(1000);

    // Assert subset renders
    const filteredCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const filteredCount = await filteredCards.count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(cardCount);

    // Assert page stays responsive
    await page.locator('select').nth(1).selectOption('all');
    await page.waitForTimeout(500);

    const allCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const allCount = await allCards.count();
    expect(allCount).toBeGreaterThanOrEqual(100);
  });
});
