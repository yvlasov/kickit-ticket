import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  uniqueTeamName,
  pollVerificationToken,
  createTeamViaApi,
  createEpicViaApi,
  createTicketViaApi,
} from './helpers';

// Stable column locator: find column div by its h3 heading text
function columnLocator(page: any, heading: string) {
  return page.locator('h3', { hasText: heading }).first().locator('..');
}

test.describe('Drag rollback', () => {
  test('route abort shows snap-back + error toast', async ({ page }) => {
    const email = uniqueEmail();
    const password = 'E2Etest123';
    const teamName = uniqueTeamName();

    // Sign up and verify via API
    await page.request.post('/api/auth/signup', {
      data: { email, password },
    });

    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    // Login via UI
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    // Create team + epic + ticket via API
    const teamId = await createTeamViaApi(page, teamName);
    const epicId = await createEpicViaApi(page, teamId, 'Rollback Epic');
    const ticketId = await createTicketViaApi(page, teamId, 'bug', 'Rollback Ticket', 'Test body', 'new', epicId);

    // Navigate to board
    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    // Locate columns and card
    const newCol = columnLocator(page, 'New');
    const inProgressCol = columnLocator(page, 'In progress');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    // Route PATCH requests to return 500 (simulate server failure during drag)
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

    // Intercept navigation to ticket detail (the <a> href would navigate on click)
    const navigationPromise = page.waitForEvent('request', {
      predicate: req => req.url().includes('/tickets/') && !req.url().includes('/api/'),
      timeout: 3000,
    });

    const cardBox = await card.boundingBox();
    const colBox = await inProgressCol.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    // Dispatch pointer events manually (page.mouse doesn't fire pointer events)
    const dragResult = await page.evaluate(
      ({ cx, cy, tx, ty }: { cx: number; cy: number; tx: number; ty: number }) => {
        const events: string[] = [];
        const dispatch = (type: string, x: number, y: number) => {
          const opts: PointerEventInit = {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === 'pointerup' ? 1 : 0,
            pointerType: 'mouse',
            pointerId: 1,
          };
          const el = document.elementFromPoint(x, y);
          if (el) {
            el.dispatchEvent(new PointerEvent(type, opts));
            events.push(`${type} on ${el.tagName}`);
          } else {
            events.push(`${type} at (${x},${y}) — no element`);
          }
        };

        dispatch('pointerdown', cx, cy);
        dispatch('pointermove', cx + 10, cy + 10);
        dispatch('pointermove', tx, ty);
        dispatch('pointerup', tx, ty);
        return events;
      },
      {
        cx: cardBox.x + cardBox.width / 2,
        cy: cardBox.y + cardBox.height / 2,
        tx: colBox.x + colBox.width / 2,
        ty: colBox.y + colBox.height / 2,
      },
    );

    console.log('Pointer events dispatched:', JSON.stringify(dragResult));

    // Wait for potential navigation
    try {
      await navigationPromise;
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
      await page.goBack();
      await page.waitForTimeout(1000);
    } catch {
      // No navigation
    }

    // (a) Immediately after pointerup, the card has optimistically appeared in the target column
    const inProgressCardsAfterDrag = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressCardsAfterDrag.first()).toBeVisible({ timeout: 3000 });

    // (b) After the failed request settles (~2s), the card snaps back to the original column
    await page.waitForTimeout(2000);

    const newColCardsAfterRollback = newCol.locator('a[href^="/tickets/"]');
    await expect(newColCardsAfterRollback.first()).toBeVisible();

    // (c) The error TOAST is visible with its message
    await expect(page.getByText(/Could not move ticket/i)).toBeVisible({ timeout: 5000 });

    // (d) The target column contains no card for this ticket afterwards
    const inProgressCardsAfterRollback = inProgressCol.locator('a[href^="/tickets/"]');
    const inProgressCount = await inProgressCardsAfterRollback.count();
    expect(inProgressCount).toBe(0);

    // Unroute
    await page.unroute(`**/api/tickets/${ticketId}`);
  });
});
