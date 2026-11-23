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
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // Create team + ticket via API
    const teamId = await createTeamViaApi(page, teamName);
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Delete Me Ticket', 'Will be deleted');

    // Navigate to ticket detail
    await page.goto(`/tickets/${ticketId}`);
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Click Delete — expect a dialog
    let dialogAction: 'dismiss' | 'accept' | null = null;
    page.on('dialog', async (dialog) => {
      if (!dialogAction) {
        dialogAction = 'dismiss';
      }
      if (dialogAction === 'dismiss') {
        await dialog.dismiss();
      } else {
        await dialog.accept();
      }
    });

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Ticket still present after dismiss
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Click Delete again — accept this time
    dialogAction = 'accept';
    await page.getByRole('button', { name: 'Delete' }).click();

    // After accept, should navigate away (to tickets list)
    await page.waitForTimeout(1000);

    // Navigate to the deleted ticket URL — should redirect to home (404 handler)
    await page.goto(`/tickets/${ticketId}`);
    // After 404, the component navigates to '/' (Teams page)
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 10000 });
  });
});
