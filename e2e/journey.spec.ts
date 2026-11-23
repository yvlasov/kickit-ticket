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
  test('inline pointer event tracking + mouse drag', async ({ page }) => {
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

    const colBox = await columnLocator(page, 'In progress').boundingBox();
    expect(colBox).toBeTruthy();

    // Add inline pointer event listeners right before drag
    const beforeEvents = await page.evaluate(() => {
      const events: string[] = [];
      const target = document.querySelector('a[href^="/tickets/"]') as HTMLElement;
      if (!target) return events;

      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup'].forEach(type => {
        target.addEventListener(type, (e: Event) => {
          const pe = e as unknown as PointerEvent;
          events.push(`${type} buttons=${pe.buttons} client=(${pe.clientX},${pe.clientY})`);
        }, { capture: true });
      });
      document.addEventListener('pointerdown', (e) => {
        if (target.contains(e.target as Node) || e.target === target) {
          events.push(`doc-pointerdown target=${(e.target as HTMLElement)?.tagName}`);
        }
      }, { capture: true });
      return events;
    });
    console.log('Listeners attached. Before drag events:', beforeEvents);

    // Do the drag
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 20, cardBox.y + cardBox.height / 2, { steps: 5 });
    await page.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2, { steps: 15 });
    await page.mouse.up();

    await page.waitForTimeout(1000);

    // Check events after drag
    const afterEvents = await page.evaluate(() => {
      const events: string[] = [];
      const target = document.querySelector('a[href^="/tickets/"]') as HTMLElement;
      if (!target) return events;

      let captureEvents: string[] = [];
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(type => {
        target.addEventListener(type, (e: Event) => {
          const pe = e as unknown as PointerEvent;
          captureEvents.push(`${type} buttons=${pe.buttons}`);
        }, { capture: true });
      });
      // Flush any pending events
      return captureEvents;
    });
    console.log('After drag events:', afterEvents);

    // Check card opacity (isDragging indicator)
    const opacity = await card.evaluate((el: HTMLElement) => (el as HTMLElement).style?.opacity ?? 'unknown');
    console.log('Card opacity after drag:', opacity);

    // Check card positions
    const newCards = await newCol.locator('a[href^="/tickets/"]').count();
    const ipCards = await columnLocator(page, 'In progress').locator('a[href^="/tickets/"]').count();
    console.log(`New: ${newCards}, In progress: ${ipCards}`);

    // Try using page.dragTo on the card element itself
    const inProgressCol = columnLocator(page, 'In progress');
    await card.dragTo(inProgressCol, { timeout: 5000 });
    await page.waitForTimeout(2000);

    const newCards2 = await newCol.locator('a[href^="/tickets/"]').count();
    const ipCards2 = await inProgressCol.locator('a[href^="/tickets/"]').count();
    console.log(`After dragTo — New: ${newCards2}, In progress: ${ipCards2}`);

    await page.screenshot({ path: '/tmp/drag-diag7.png', fullPage: true });

    expect(true).toBe(true);
  });
});
