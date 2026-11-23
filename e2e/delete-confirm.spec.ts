import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createTicketViaApi,
} from './helpers';

test.describe('Delete confirmation', () => {
  test('dismiss keeps ticket; accept navigates to tickets list', async ({ page }) => {
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

    // First delete click — dismiss
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog1 = await page.waitForEvent('dialog', { timeout: 5000 });
    await dialog1.dismiss();

    // Ticket still present after dismiss
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Second delete click — accept
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog2 = await page.waitForEvent('dialog', { timeout: 5000 });
    await dialog2.accept();

    // After accept, deleteMutation.onSuccess navigates to /tickets?teamId=...
    // Wait for URL to change away from ticket detail
    await expect(page).toHaveURL(/\/tickets\?teamId=/, { timeout: 10000 });

    // Verify deleted ticket is not in the list
    const isDeleted = await page.getByText('Delete Me Ticket').isVisible().catch(() => false);
    expect(isDeleted).toBe(false);
  });
});
