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

    // Parse board URL from output
    const boardUrlMatch = output.match(/Board URL:\s+(.+)/);
    expect(boardUrlMatch).not.toBeNull();
    const demoBaseUrl = boardUrlMatch![1].trim();

    // Navigate to the board
    await page.goto(demoBaseUrl);
    await expect(page.getByText('Board')).toBeVisible({ timeout: 15000 });

    // Wait for cards to render (up to 10s)
    const cards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    let cardCount = 0;
    for (let i = 0; i < 20; i++) {
      cardCount = await cards.count();
      if (cardCount >= 100) break;
      await page.waitForTimeout(500);
    }
    expect(cardCount).toBeGreaterThanOrEqual(100);

    // Apply a type filter via UI
    await page.locator('select.border-gray-300').first().selectOption('bug');
    await page.waitForTimeout(1000);

    // Assert subset renders
    const filteredCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const filteredCount = await filteredCards.count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(cardCount);

    // Assert page stays responsive (can interact)
    await page.locator('select.border-gray-300').first().selectOption('all');
    await page.waitForTimeout(500);

    const allCards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const allCount = await allCards.count();
    expect(allCount).toBeGreaterThanOrEqual(100);
  });
});
