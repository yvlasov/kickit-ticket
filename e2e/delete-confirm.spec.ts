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
    let dialog1Resolved: any = null;
    const dialogPromise1 = new Promise<void>((resolve) => {
      const handler = (d: any) => {
        dialog1Resolved = d;
        resolve();
      };
      page.on('dialog', handler);
    });
    await page.getByRole('button', { name: 'Delete' }).click();
    await dialogPromise1;
    await dialog1Resolved.dismiss();

    // Ticket still present after dismiss
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Second delete click — accept
    let dialog2Resolved: any = null;
    const dialogPromise2 = new Promise<void>((resolve) => {
      const handler = (d: any) => {
        dialog2Resolved = d;
        resolve();
      };
      page.on('dialog', handler);
    });
    await page.getByRole('button', { name: 'Delete' }).click();
    await dialogPromise2;
    await dialog2Resolved.accept();

    // After accept, deleteMutation.onSuccess navigates to /tickets?teamId=...
    await expect(page).toHaveURL(/\/tickets\?teamId=/, { timeout: 10000 });

    // Verify deleted ticket is not in the list
    const isDeleted = await page.getByText('Delete Me Ticket').isVisible().catch(() => false);
    expect(isDeleted).toBe(false);
  });
});
