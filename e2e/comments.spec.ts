import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

test.describe('Comments', () => {
  test('add comments; author/time/oldest-first; modifiedAt unchanged', async ({ page }) => {
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
    await page.waitForURL(/\/(board|tickets|\/$)/, { timeout: 10000 });

    // Create team + ticket via API
    const teamId = await createTeamViaApi(page, teamName);
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Comment Ticket', 'Test body');

    // Navigate to ticket detail
    await page.goto(`/tickets/${ticketId}`);
    await expect(page.getByText('Comment Ticket')).toBeVisible();

    // Capture modifiedAt display value before adding comments
    const modifiedAtBefore = page.locator('span.text-sm.text-gray-500', { hasText: 'Modified at' }).locator('..').locator('p.text-sm.font-medium, p.text-sm').first();
    const modifiedAtTextBefore = await modifiedAtBefore.textContent();
    expect(modifiedAtTextBefore).toBeTruthy();

    // Add first comment
    await page.getByPlaceholder('Add a comment...').fill('First comment body');
    await page.getByRole('button', { name: 'Add comment' }).click();
    await page.waitForTimeout(500);

    // Verify first comment rendered
    await expect(page.getByText('First comment body')).toBeVisible();

    // Add second comment
    await page.getByPlaceholder('Add a comment...').fill('Second comment body');
    await page.getByRole('button', { name: 'Add comment' }).click();
    await page.waitForTimeout(500);

    // Verify both comments rendered
    await expect(page.getByText('Second comment body')).toBeVisible();

    // Assert oldest-first: "First comment" should appear before "Second comment" in DOM
    const comments = page.locator('.space-y-3 > div.border-b');
    await expect(comments).toHaveCount(2);
    const firstCommentText = await comments.nth(0).textContent();
    const secondCommentText = await comments.nth(1).textContent();
    expect(firstCommentText).toContain('First comment body');
    expect(secondCommentText).toContain('Second comment body');

    // Assert author email is shown
    await expect(comments.nth(0)).toContainText(email);
    await expect(comments.nth(1)).toContainText(email);

    // Assert timestamp is shown (both comments have a time element)
    const timeElements = page.locator('.space-y-3 > div.border-b div.text-sm.text-gray-500');
    await expect(timeElements).toHaveCount(2);

    // Assert modifiedAt display unchanged
    const modifiedAtAfter = page.locator('span.text-sm.text-gray-500', { hasText: 'Modified at' }).locator('..').locator('p.text-sm.font-medium, p.text-sm').first();
    const modifiedAtTextAfter = await modifiedAtAfter.textContent();
    expect(modifiedAtTextAfter).toBe(modifiedAtTextBefore);
  });
});
