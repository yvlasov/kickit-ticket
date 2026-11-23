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

    // 11. REAL DRAG: card from New to In progress
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

    // Intercept navigation to ticket detail (the <a> href would navigate on click)
    // This prevents the drag from being interrupted by navigation
    const navigationPromise = page.waitForEvent('request', {
      predicate: req => req.url().includes('/tickets/') && !req.url().includes('/api/'),
      timeout: 3000,
    });

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
            events.push(`${type} on ${el.tagName}.${el.className.split(' ')[0] || ''}`);
          } else {
            events.push(`${type} at (${x},${y}) — no element`);
          }
        };

        // pointerdown on card
        dispatch('pointerdown', cx, cy);
        // pointermove to exceed activation distance
        dispatch('pointermove', cx + 10, cy + 10);
        // pointermove toward target
        dispatch('pointermove', tx, ty);
        // pointerup on target column
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

    // Wait for potential navigation (the <a> click that follows pointerup)
    try {
      await navigationPromise;
      // Navigation was intercepted — wait for it to complete
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
      // Go back to board
      await page.goBack();
      await page.waitForTimeout(1000);
    } catch {
      // No navigation — drag completed without triggering click
    }

    // Wait for optimistic update + PATCH request to settle
    await page.waitForTimeout(2000);

    // 12. Assert the card now appears in the In-progress column
    const inProgressCards = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressCards.first()).toBeVisible({ timeout: 5000 });

    // Verify the card title is visible
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    // 13. Page reload — card should STILL be in In progress (persisted)
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const inProgressAfterReload = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressAfterReload.first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();
  });
});
