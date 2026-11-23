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

test.describe('Drag rollback', () => {
  test('route abort shows snap-back + error toast', async ({ page }) => {
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
    const epicId = await createEpicViaApi(page, teamId, 'Rollback Epic');
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Rollback Ticket', 'Test body', 'new', epicId);

    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const newCol = columnLocator(page, 'New');
    const inProgressCol = columnLocator(page, 'In progress');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Route PATCH requests to return 500
    await page.route(`**/api/tickets/${ticketId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ error: { message: 'Server error' } }),
        });
      } else {
        await route.continue();
      }
    });

    // Intercept navigation
    const navigationPromise = page.waitForEvent('request', {
      predicate: req => req.url().includes('/tickets/') && !req.url().includes('/api/'),
      timeout: 3000,
    });

    const cardBox = await card.boundingBox();
    const colBox = await inProgressCol.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    // Get the card's exact href and dispatch pointer events on THAT anchor
    const cardHref = await card.getAttribute('href');
    const dragResult = await page.evaluate(
      ({ cx, cy, tx, ty, href }: { cx: number; cy: number; tx: number; ty: number; href: string }) => {
        const events: string[] = [];
        const anchor = document.querySelector(`a[href="${href}"]`) as HTMLAnchorElement;
        const target = document.elementFromPoint(tx, ty);

        if (!anchor) return ['no anchor found for ' + href];

        const dispatch = (type: string, x: number, y: number, onEl: Element | null) => {
          const opts: PointerEventInit = {
            bubbles: true, cancelable: true,
            clientX: x, clientY: y,
            button: 0,
            buttons: type === 'pointerup' ? 1 : 0,
            pointerType: 'mouse', pointerId: 1,
          };
          (onEl || anchor).dispatchEvent(new PointerEvent(type, opts));
          events.push(`${type} on ${(onEl || anchor).tagName}.${(onEl || anchor).className.split(' ')[0] || ''} at (${x},${y})`);
        };

        dispatch('pointerdown', cx, cy, anchor);
        dispatch('pointermove', cx + 10, cy + 10, anchor);
        dispatch('pointermove', tx, ty, target);
        dispatch('pointerup', tx, ty, target);
        return events;
      },
      {
        cx: cardBox.x + cardBox.width / 2,
        cy: cardBox.y + cardBox.height / 2,
        tx: colBox.x + colBox.width / 2,
        ty: colBox.y + colBox.height / 2,
        href: cardHref,
      },
    );

    console.log('Pointer events:', JSON.stringify(dragResult));

    // Wait for potential navigation
    try {
      await navigationPromise;
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
      await page.goBack();
      await page.waitForTimeout(1000);
    } catch {
      // No navigation
    }

    // (a) Optimistic update: card appears in target column
    const inProgressCardsAfterDrag = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressCardsAfterDrag.first()).toBeVisible({ timeout: 3000 });

    // (b) After failed request settles, card snaps back
    await page.waitForTimeout(2000);

    const newColCardsAfterRollback = newCol.locator('a[href^="/tickets/"]');
    await expect(newColCardsAfterRollback.first()).toBeVisible();

    // (c) Error toast visible
    await expect(page.getByText(/Could not move ticket/i)).toBeVisible({ timeout: 5000 });

    // (d) Target column has no card
    const inProgressCardsAfterRollback = inProgressCol.locator('a[href^="/tickets/"]');
    expect(await inProgressCardsAfterRollback.count()).toBe(0);

    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
