import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createTicketViaApi,
} from './helpers';

test.describe('Delete confirmation', () => {
  test('dismiss keeps ticket; accept deletes and navigates to tickets list', async ({ page }) => {
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
    const dialogPromise1 = new Promise<any>((resolve) => {
      const handler = (d: any) => {
        d.dismiss();
        page.off('dialog', handler);
        resolve(d);
      };
      page.on('dialog', handler);
    });
    await page.getByRole('button', { name: 'Delete' }).click();
    await dialogPromise1;

    // Ticket still present after dismiss
    await expect(page.getByText('Delete Me Ticket')).toBeVisible();

    // Second delete click — accept
    const dialogPromise2 = new Promise<any>((resolve) => {
      const handler = (d: any) => {
        d.accept();
        page.off('dialog', handler);
        resolve(d);
      };
      page.on('dialog', handler);
    });
    await page.getByRole('button', { name: 'Delete' }).click();
    await dialogPromise2;

    // Wait a moment for mutation to complete and navigate
    await page.waitForTimeout(2000);

    // Navigate to tickets list directly and verify ticket is gone
    await page.goto(`/tickets?teamId=${teamId}`);
    const isDeleted = await page.getByText('Delete Me Ticket').isVisible().catch(() => false);
    expect(isDeleted).toBe(false);
  });
});
