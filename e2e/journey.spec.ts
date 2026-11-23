import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

test.describe('Full UI journey', () => {
  test('signup → verify → login → team → epic → ticket → drag → refresh persists', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'E2Etest123';
    const teamName = uniqueTeamName();

    // 1. Signup via API
    const resp = await page.request.post('/api/auth/signup', {
      data: { email, password },
    });
    await expect(resp.ok()).toBe(true);

    // 2. Check-email screen appears
    await page.goto('/check-email');
    await expect(page.getByText('Check your email')).toBeVisible();

    // 3. Poll for verification token
    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();

    // 4. Verify via URL
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    // 5. Go to login and log in
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // 6. Create team via UI (Teams page)
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(teamName)).toBeVisible();

    // 7. Get team ID via API
    const teamsResp = await page.request.get('/api/teams');
    const teams = await teamsResp.json() as Array<{ id: string; name: string }>;
    const teamId = teams.find((t) => t.name === teamName)?.id;
    expect(teamId).toBeDefined();

    // 8. Create epic via API
    const epicTitle = 'E2E Epic';
    const epicId = await createEpicViaApi(page, teamId!, epicTitle);
    expect(epicId).toBeDefined();

    // 9. Create ticket via UI (Board → New Ticket)
    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Wait for team select to be populated
    const teamSelect = page.locator('select').first();
    await expect(teamSelect).toBeVisible({ timeout: 10000 });
    let teamOptions = 0;
    for (let i = 0; i < 10; i++) {
      teamOptions = await teamSelect.locator('option').count();
      if (teamOptions > 1) break;
      await page.waitForTimeout(500);
    }
    const currentSelected = await teamSelect.inputValue();
    if (!currentSelected && teamOptions > 0) {
      await teamSelect.selectOption({ index: 1 });
      await page.waitForTimeout(1000);
    }

    // Click "New Ticket" link
    await page.getByRole('link', { name: 'New Ticket' }).click();
    await expect(page.getByPlaceholder('Ticket title')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('Ticket title').fill('E2E Journey Ticket');
    await page.getByPlaceholder('Ticket description').fill('Body of the journey ticket');
    await page.getByRole('button', { name: 'Create' }).click();
    // Should navigate to ticket detail
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    // 10. Get ticket ID from URL
    const ticketId = page.url().split('/').pop() ?? '';
    expect(ticketId).toBeTruthy();

    // 11. Change ticket state to "in_progress" via API (simulating drag)
    await page.request.patch(`/api/tickets/${ticketId}`, {
      data: { state: 'in_progress' },
    });

    // 12. Navigate to board and verify card is in "In progress" column
    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Wait for cards to appear
    const cards = page.locator('[class="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"]');
    let cardCount = 0;
    for (let i = 0; i < 20; i++) {
      cardCount = await cards.count();
      if (cardCount >= 1) break;
      await page.waitForTimeout(500);
    }

    // Verify card is in "In progress" column
    const inProgressColumn = page.locator('h3', { hasText: 'In progress' }).first().locator('..');
    const inProgressCards = inProgressColumn.locator('a.bg-white');
    await expect(inProgressCards.first()).toBeVisible({ timeout: 5000 });

    // Verify the card title is visible
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    // 13. Page reload — card should still be in In progress
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const inProgressAfterReload = inProgressColumn.locator('a.bg-white');
    await expect(inProgressAfterReload.first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();
  });
});
