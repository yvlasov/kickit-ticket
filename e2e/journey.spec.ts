import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  loginViaUi,
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
    // Should redirect to board
    await page.waitForURL(/\/board/, { timeout: 10000 });

    // 6. Create team via UI (Teams page)
    await page.goto('/');
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(teamName)).toBeVisible();

    // 7. Create epic via UI (Epics page)
    const epicTitle = 'E2E Epic';
    await page.goto('/epics');
    await page.getByLabel('Team').selectOption({ label: teamName });
    await page.getByLabel('Title *').fill(epicTitle);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(epicTitle)).toBeVisible();

    // 8. Get team ID and epic ID via API for ticket creation
    const teamsResp = await page.request.get('/api/teams');
    const teams = await teamsResp.json() as Array<{ id: string; name: string }>;
    const teamId = teams.find((t) => t.name === teamName)?.id;
    expect(teamId).toBeDefined();

    const epicsResp = await page.request.get(`/api/epics?teamId=${teamId}`);
    const epics = await epicsResp.json() as Array<{ id: string; title: string }>;
    const epicId = epics.find((e) => e.title === epicTitle)?.id;
    expect(epicId).toBeDefined();

    // 9. Create ticket via UI (Board → New Ticket)
    await page.goto(`/board?teamId=${teamId}`);
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByPlaceholder('Ticket title').fill('E2E Journey Ticket');
    await page.getByPlaceholder('Ticket description').fill('Body of the journey ticket');
    await page.getByRole('button', { name: 'Create' }).click();
    // Should navigate to ticket detail
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    // 10. Get ticket ID from URL
    const ticketId = page.url().split('/').pop() ?? '';
    expect(ticketId).toBeTruthy();

    // 11. Go back to board and drag card
    await page.goto(`/board?teamId=${teamId}`);

    // Wait for board to load
    await page.waitForSelector('[class*="bg-white"]', { timeout: 10000 });

    // Drag from "New" column to "In progress" column using mouse steps
    const newColumn = page.locator('h3', { hasText: 'New' }).first().locator('..');
    const inProgressColumn = page.locator('h3', { hasText: 'In progress' }).first().locator('..');

    const card = newColumn.locator('a.bg-white').first();
    const cardBox = await card.boundingBox();
    const colBox = await inProgressColumn.boundingBox();

    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    if (cardBox && colBox) {
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        colBox.x + colBox.width / 2,
        colBox.y + colBox.height / 2,
        { steps: 12 },
      );
      await page.mouse.up();
    }

    // Wait for optimistic update + API call
    await page.waitForTimeout(2000);

    // 12. Verify card is now in "In progress" column
    const inProgressCards = inProgressColumn.locator('a.bg-white');
    await expect(inProgressCards.first()).toBeVisible();

    // 13. Page reload — card should still be in In progress
    await page.reload();
    await page.waitForSelector('[class*="bg-white"]', { timeout: 10000 });

    // Verify card persisted in In progress
    const inProgressAfterReload = inProgressColumn.locator('a.bg-white');
    await expect(inProgressAfterReload.first()).toBeVisible();

    // Verify the card title is still visible
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();
  });
});
