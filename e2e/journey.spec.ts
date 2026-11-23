import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

function columnLocator(page: any, heading: string) {
  return page.locator('h3', { hasText: heading }).first().locator('..');
}

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

    // 2. Check-email screen
    await page.goto('/check-email');
    await expect(page.getByText('Check your email')).toBeVisible();

    // 3. Poll for verification token
    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();

    // 4. Verify via URL
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    // 5. Login
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // 6. Create team via UI
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

    // 9. Create ticket via UI
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
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    // 10. Get ticket ID from URL
    const ticketId = page.url().split('/').pop() ?? '';
    expect(ticketId).toBeTruthy();

    // 11. REAL DRAG: card from New to In progress via page.mouse
    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Wait for cards to appear
    const newCol = columnLocator(page, 'New');
    const inProgressCol = columnLocator(page, 'In progress');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cardBox = await card.boundingBox();
    const colBox = await inProgressCol.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    // Remove href to prevent <a> click from navigating during drag
    const cardHref = await card.getAttribute('href');
    await card.evaluate((el: HTMLElement) => {
      (el as HTMLAnchorElement).removeAttribute('href');
    });

    // REAL DRAG using page.mouse (CDP Input.dispatchMouseEvent fires trusted pointer events)
    // Step 1: move to card center
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    // Step 2: press down
    await page.mouse.down();
    // Step 3: move slightly to exceed PointerSensor activationConstraint distance=6
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    // Step 4: drag to target column center
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    // Step 5: release
    await page.mouse.up();

    // Wait for optimistic update + PATCH request to settle
    await page.waitForTimeout(2000);

    // 12. Assert the card now appears in the In-progress column
    const inProgressCards = inProgressCol.locator('a');
    await expect(inProgressCards.first()).toBeVisible({ timeout: 5000 });

    // Verify the card title is visible
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    // Restore href
    if (cardHref) {
      await card.evaluate((el: HTMLElement, href: string) => {
        (el as HTMLAnchorElement).setAttribute('href', href);
      }, cardHref);
    }

    // 13. Page reload — card should STILL be in In progress (persisted)
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const inProgressAfterReload = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressAfterReload.first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();
  });
});
