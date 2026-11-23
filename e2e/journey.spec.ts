import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

// Column locator: find h3 heading, get its ancestor container
function columnLocator(page: any, heading: string) {
  return page.locator('h3', { hasText: heading }).first().locator('..');
}

test.describe('Drag diagnostics', () => {
  test('check if dragTo works', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'E2Etest123';
    const teamName = uniqueTeamName();

    await page.request.post('/api/auth/signup', { data: { email, password } });
    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    const teamId = await createTeamViaApi(page, teamName);
    const epicId = await createEpicViaApi(page, teamId, 'Diag Epic');
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Diag Ticket', 'body', 'new', epicId);

    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const newCol = columnLocator(page, 'New');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cardBox = await card.boundingBox();
    expect(cardBox).toBeTruthy();

    // Check draggable attribute
    const draggable = await card.getAttribute('draggable');
    console.log('Card draggable attr:', draggable);

    // Check touch-action style
    const touchAction = await card.evaluate((el: HTMLElement) => (el as HTMLElement).style?.touchAction ?? '');
    console.log('Card touchAction:', touchAction);

    // Check the pointer sensor distance
    const sensorDistance = await page.evaluate(() => {
      // Check if dnd-kit is available
      return typeof (window as any).__dndKit !== 'undefined';
    });
    console.log('dnd-kit available:', sensorDistance);

    // Try dragTo
    const inProgressCol = columnLocator(page, 'In progress');
    try {
      await card.dragTo(inProgressCol, { timeout: 5000 });
      console.log('dragTo succeeded');
    } catch (e) {
      console.log('dragTo failed:', String(e));
    }

    await page.waitForTimeout(2000);

    // Check card positions
    const newCards = await newCol.locator('a[href^="/tickets/"]').count();
    const ipCards = await inProgressCol.locator('a[href^="/tickets/"]').count();
    console.log(`After dragTo — New: ${newCards}, In progress: ${ipCards}`);

    await page.screenshot({ path: '/tmp/drag-diag6.png', fullPage: true });

    expect(true).toBe(true);
  });
});
