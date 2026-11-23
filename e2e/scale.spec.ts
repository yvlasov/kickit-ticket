import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { uniqueEmail, uniqueTeamName } from './helpers';

test.describe('Scale', () => {
  test('demo script creates 100+ tickets; filter subset; page responsive', async () => {
    const email = uniqueEmail();
    const teamName = uniqueTeamName();
    const baseUrl = process.env.BASE_URL ?? 'http://app:3000';
    const mailpitUrl = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

    // Run demo script in-container via execSync
    const output = execSync(
      `docker exec -e BASE_URL=${baseUrl} -e MAILPIT_URL=${mailpitUrl} $(docker ps --filter "name=kickit-ticket-tests-e2e" --format '{{.ID}}' | head -1) npx tsx scripts/demo-data.ts`,
      { encoding: 'utf-8', timeout: 120_000 },
    );

    console.log('Demo script output:', output);

    // Parse email and team from output
    const emailMatch = output.match(/Email:\s+(.+)/);
    const boardUrlMatch = output.match(/Board URL:\s+(.+)/);

    expect(emailMatch).not.toBeNull();
    const demoEmail = emailMatch![1].trim();
    expect(boardUrlMatch).not.toBeNull();
    const demoBaseUrl = boardUrlMatch![1].trim();

    // Navigate to board in browser
    const { chromium } = require('@playwright/test');
    // We already have page from the test context — but scale test is a standalone exec
    // Instead, open a new browser context
    const browser = await chromium.launch();
    const scalePage = await browser.newPage();

    try {
      // Navigate to the board
      await scalePage.goto(demoBaseUrl);
      await scalePage.waitForSelector('[class*="bg-white"]', { timeout: 15000 });

      // Assert ≥100 cards rendered
      const cards = scalePage.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
      const cardCount = await cards.count();
      expect(cardCount).toBeGreaterThanOrEqual(100);

      // Apply a type filter via UI
      await scalePage.locator('select.border-gray-300').first().selectOption('bug');
      await scalePage.waitForTimeout(1000);

      // Assert subset renders
      const filteredCards = scalePage.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
      const filteredCount = await filteredCards.count();
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThan(cardCount);

      // Assert page stays responsive (can interact)
      await scalePage.locator('select.border-gray-300').first().selectOption('all');
      await scalePage.waitForTimeout(500);

      const allCards = scalePage.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
      const allCount = await allCards.count();
      expect(allCount).toBeGreaterThanOrEqual(100);
    } finally {
      await browser.close();
    }
  });
});
