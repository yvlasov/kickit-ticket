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
  test('check card draggable attr and mouse drag behavior', async ({ page }) => {
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

    // Check card DOM attributes specifically
    const cardInfo = await card.evaluate((el: HTMLElement) => {
      const anchor = el.closest('a') || el.tagName === 'A' ? el : null;
      if (!anchor) return { error: 'not anchor' };
      return {
        draggable: (anchor as HTMLAnchorElement).draggable,
        hasTouchAction: !!(anchor as HTMLElement).style?.touchAction,
        touchActionValue: (anchor as HTMLElement).style?.touchAction ?? '',
        className: (anchor as HTMLElement).className,
        href: (anchor as HTMLAnchorElement).href,
        outerHTML: anchor.outerHTML.substring(0, 400),
      };
    });
    console.log('Card DOM info:', JSON.stringify(cardInfo, null, 2));

    // Add init script to count pointer events
    await page.addInitScript(() => {
      (window as any).__pointerEvents = { down: 0, move: 0, up: 0, cancel: 0 };
      document.addEventListener('pointerdown', () => { (window as any).__pointerEvents.down++; }, { capture: true });
      document.addEventListener('pointermove', () => { (window as any).__pointerEvents.move++; }, { capture: true });
      document.addEventListener('pointerup', () => { (window as any).__pointerEvents.up++; }, { capture: true });
      document.addEventListener('pointercancel', () => { (window as any).__pointerEvents.cancel++; }, { capture: true });
    });

    const cardBox = await card.boundingBox();
    expect(cardBox).toBeTruthy();

    const colBox = await columnLocator(page, 'In progress').boundingBox();
    expect(colBox).toBeTruthy();

    console.log('Card box:', JSON.stringify(cardBox));
    console.log('Target column box:', JSON.stringify(colBox));

    // Do the drag
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    await page.mouse.up();

    await page.waitForTimeout(2000);

    // Check pointer events
    const events = await page.evaluate(() => ({
      ...((window as any).__pointerEvents ?? {}),
    }));
    console.log('Pointer events after drag:', JSON.stringify(events, null, 2));

    // Check what columns have cards
    const colState = await page.evaluate(() => {
      const headings = document.querySelectorAll('h3');
      const result: Record<string, number> = {};
      headings.forEach(h3 => {
        const name = h3.textContent?.trim() ?? 'unknown';
        // Find the column container (parent with flex layout)
        let col = h3.parentElement;
        if (col) {
          result[name] = col.querySelectorAll('a[href^="/tickets/"]').length;
        }
      });
      return result;
    });
    console.log('Cards per column:', JSON.stringify(colState));

    // Check if the card moved
    const newColCards = await newCol.locator('a[href^="/tickets/"]').count();
    const inProgressColCards = await columnLocator(page, 'In progress').locator('a[href^="/tickets/"]').count();
    console.log(`New column cards: ${newColCards}, In progress cards: ${inProgressColCards}`);

    await page.screenshot({ path: '/tmp/drag-diag5.png', fullPage: true });

    expect(true).toBe(true);
  });
});
