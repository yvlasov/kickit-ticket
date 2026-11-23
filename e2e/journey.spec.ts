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

    const resp = await page.request.post('/api/auth/signup', {
      data: { email, password },
    });
    await expect(resp.ok()).toBe(true);

    await page.goto('/check-email');
    await expect(page.getByText('Check your email')).toBeVisible();

    const token = await pollVerificationToken(page, email);
    expect(token).not.toBeNull();

    await page.goto(`/verify?token=${token}`);
    await expect(page.getByText('Email verified!')).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(teamName)).toBeVisible();

    const teamsResp = await page.request.get('/api/teams');
    const teams = await teamsResp.json() as Array<{ id: string; name: string }>;
    const teamId = teams.find((t) => t.name === teamName)?.id;
    expect(teamId).toBeDefined();

    const epicTitle = 'E2E Epic';
    const epicId = await createEpicViaApi(page, teamId!, epicTitle);
    expect(epicId).toBeDefined();

    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

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

    await page.getByRole('link', { name: 'New Ticket' }).click();
    await expect(page.getByPlaceholder('Ticket title')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('Ticket title').fill('E2E Journey Ticket');
    await page.getByPlaceholder('Ticket description').fill('Body of the journey ticket');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    const ticketId = page.url().split('/').pop() ?? '';
    expect(ticketId).toBeTruthy();

    // REAL DRAG
    await page.goto(`/board?teamId=${teamId}`);
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const newCol = columnLocator(page, 'New');
    const inProgressCol = columnLocator(page, 'In progress');
    const card = newCol.locator('a[href^="/tickets/"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cardBox = await card.boundingBox();
    const colBox = await inProgressCol.boundingBox();
    expect(cardBox).toBeTruthy();
    expect(colBox).toBeTruthy();

    // Intercept navigation
    const navigationPromise = page.waitForEvent('request', {
      predicate: req => req.url().includes('/tickets/') && !req.url().includes('/api/'),
      timeout: 3000,
    });

    // Get the card's href and dispatch pointer events on THAT specific anchor
    const cardHref = await card.getAttribute('href');
    const dragResult = await page.evaluate(
      ({ cx, cy, tx, ty, href }: { cx: number; cy: number; tx: number; ty: number; href: string }) => {
        const events: string[] = [];
        // Select by exact href to get the card, not the "New Ticket" link
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

    // Wait for optimistic update + PATCH request to settle
    await page.waitForTimeout(2000);

    // Assert the card now appears in the In-progress column
    const inProgressCards = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressCards.first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();

    // Page reload — card should STILL be in In progress (persisted)
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 10000 });

    const inProgressAfterReload = inProgressCol.locator('a[href^="/tickets/"]');
    await expect(inProgressAfterReload.first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('E2E Journey Ticket')).toBeVisible();
  });
});
