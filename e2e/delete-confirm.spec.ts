import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createTicketViaApi,
} from './helpers';

test.describe('Delete confirmation', () => {
  test('dismiss keeps ticket; accept navigates to 404', async ({ page }) => {
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
    await expect(page.getByText('Teams')).toBeVisible({ timeout: 15000 });

    // Create team + ticket via API
    const teamId = await createTeamViaApi(page, teamName);
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Delete Me Ticket', 'Will be deleted');

    // Navigate to ticket detail
    await page.goto(`/tickets/${ticketId}`);
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Click Delete — expect a dialog
    let dialogDismissed = false;
    page.on('dialog', async (dialog) => {
      dialogDismissed = true;
      await dialog.dismiss();
    });

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();
    expect(dialogDismissed).toBe(true);

    // Ticket still present after dismiss
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Click Delete again — accept this time
    let dialogAccepted = false;
    page.on('dialog', async (dialog) => {
      dialogAccepted = true;
      await dialog.accept();
    });

    await page.getByRole('button', { name: 'Delete' }).click();

    // After accept, should navigate away
    await page.waitForTimeout(1000);

    // Direct URL should now show empty state or 404
    await page.goto(`/tickets/${ticketId}`);
    // Either 404 page or empty state
    const isNotFound = await page.locator('[class*="bg-red-50"]', { hasText: 'Not found' }).isVisible().catch(() => false);
    const isEmptyState = await page.getByText('No teams yet').isVisible().catch(() => false) ||
      await page.getByText('Select a team').isVisible().catch(() => false);
    expect(isNotFound || isEmptyState).toBe(true);
  });
});
