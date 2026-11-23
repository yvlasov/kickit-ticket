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

    // Parse email from output
    const emailMatch = output.match(/Email:\s+(.+)/);
    const boardUrlMatch = output.match(/Board URL:\s+(.+)/);

    expect(emailMatch).not.toBeNull();
    expect(boardUrlMatch).not.toBeNull();
    const demoBaseUrl = boardUrlMatch![1].trim();

    // Navigate to the board
    await page.goto(demoBaseUrl);
    await page.waitForSelector('[class*="bg-white"]', { timeout: 15000 });

    // Assert ≥100 cards rendered
    const cards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    const cardCount = await cards.count();
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
