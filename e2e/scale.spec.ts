import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

// Stable card locator: cards are <a href="/tickets/..."> inside columns
function cardLocator(page: any) {
  return page.locator('a[href^="/tickets/"]');
}

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
    const teamMatch = output.match(/Team:\s+.+\s+\(([0-9a-f-]+)\)/);

    expect(emailMatch).not.toBeNull();
    expect(passwordMatch).not.toBeNull();
    expect(teamMatch).not.toBeNull();

    const demoEmail = emailMatch![1].trim();
    const demoPassword = passwordMatch![1].trim();
    const demoTeamId = teamMatch![1];

    // Log in via browser
    await page.goto('/login');
    await page.getByLabel('Email').fill(demoEmail);
    await page.getByLabel('Password').fill(demoPassword);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // Navigate to board with explicit teamId in URL
    await page.goto(`/board?teamId=${demoTeamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 15000 });

    // Wait for cards to render (poll for up to 20s)
    const cards = cardLocator(page);
    let cardCount = 0;
    for (let i = 0; i < 40; i++) {
      cardCount = await cards.count();
      if (cardCount >= 100) break;
      await page.waitForTimeout(500);
    }
    expect(cardCount).toBeGreaterThanOrEqual(100);

    // Apply a type filter via UI (nth(1) = FilterBar type select)
    await page.locator('select').nth(1).selectOption('bug');
    await page.waitForTimeout(1000);

    // Assert subset renders
    const filteredCards = cardLocator(page);
    const filteredCount = await filteredCards.count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(cardCount);

    // Assert page stays responsive
    await page.locator('select').nth(1).selectOption('all');
    await page.waitForTimeout(500);

    const allCards = cardLocator(page);
    const allCount = await allCards.count();
    expect(allCount).toBeGreaterThanOrEqual(100);
  });
});
