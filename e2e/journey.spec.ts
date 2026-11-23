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

test.describe('Drag diagnostics', () => {
  test('check draggable attr and mouse drag behavior', async ({ page }) => {
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

    // Check card DOM attributes
    const cardInfo = await page.evaluate(() => {
      const anchor = document.querySelector('a[href^="/tickets/"]') as HTMLAnchorElement;
      if (!anchor) return { error: 'no anchor' };
      return {
        draggable: anchor.draggable,
        hasTouchAction: !!((anchor as HTMLElement).style?.touchAction),
        touchActionValue: ((anchor as HTMLElement).style?.touchAction) ?? '',
        className: anchor.className,
        outerHTML: anchor.outerHTML.substring(0, 300),
      };
    });
    console.log('Card DOM info:', JSON.stringify(cardInfo, null, 2));

    const cardBox = await card.boundingBox();
    expect(cardBox).toBeTruthy();

    // Add init script to count pointer events
    await page.addInitScript(() => {
      (window as any).__pointerEvents = { down: 0, move: 0, up: 0, cancel: 0 };
      document.addEventListener('pointerdown', () => { (window as any).__pointerEvents.down++; }, { capture: true });
      document.addEventListener('pointermove', () => { (window as any).__pointerEvents.move++; }, { capture: true });
      document.addEventListener('pointerup', () => { (window as any).__pointerEvents.up++; }, { capture: true });
      document.addEventListener('pointercancel', () => { (window as any).__pointerEvents.cancel++; }, { capture: true });
    });

    // Do the drag
    const colBox = await columnLocator(page, 'In progress').boundingBox();
    expect(colBox).toBeTruthy();

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    await page.mouse.up();

    await page.waitForTimeout(2000);

    // Check pointer events
    const events = await page.evaluate(() => ({
      ...((window as any).__pointerEvents ?? {}),
      isDragging: ((document.querySelector('a[href^="/tickets/"]') as HTMLElement | null)?.style?.opacity) ?? 'unknown',
      inProgressCards: document.querySelectorAll('h3:has-text("In progress") a[href^="/tickets/"]').length,
      newCards: document.querySelectorAll('h3:has-text("New") a[href^="/tickets/"]').length,
    }));
    console.log('Pointer events after drag:', JSON.stringify(events, null, 2));

    // Check what columns have cards
    const colState = await page.evaluate(() => {
      const columns = document.querySelectorAll('h3');
      const result: Record<string, number> = {};
      columns.forEach(h3 => {
        const name = h3.textContent?.trim() ?? 'unknown';
        const col = h3.closest('[class*="flex"]') ?? h3.parentElement;
        if (col) {
          result[name] = col.querySelectorAll('a[href^="/tickets/"]').length;
        }
      });
      return result;
    });
    console.log('Cards per column:', JSON.stringify(colState));

    await page.screenshot({ path: '/tmp/drag-diag5.png', fullPage: true });

    expect(true).toBe(true);
  });
});
