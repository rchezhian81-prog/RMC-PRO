import { test, expect, type Page } from '@playwright/test';

/**
 * Visual-regression BASELINE of the current production UI (flag OFF).
 *
 * First run WRITES the reference PNGs (per viewport project × theme); later UI
 * PRs re-run and DIFF against them — that is the regression net. Non-essential
 * animation is disabled and the network is idle before each shot, so a baseline
 * is never an unstable frame.
 *
 * Representative screens cover the owner's protected surfaces: routes, nav,
 * tables, forms, dialogs, an operational screen, a financial screen, the audit
 * trail (permissions), and the offline/sync (devices) screen.
 */

const STABILIZE = `
  *, *::before, *::after { transition: none !important; animation: none !important; }
  html { scroll-behavior: auto !important; }
  * { caret-color: transparent !important; }
`;

async function stabilize(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: STABILIZE });
  await page.waitForLoadState('networkidle');
  // settle late async list/skeleton swaps
  await page.waitForTimeout(400);
}

async function capture(page: Page, name: string, path: string) {
  // Light (default)
  await page.addInitScript(() => window.localStorage.setItem('mn-theme', 'light'));
  await page.goto(path, { waitUntil: 'networkidle' });
  await stabilize(page);
  await expect(page).toHaveScreenshot(`${name}-light.png`, { fullPage: true });

  // Dark (toggle persisted in localStorage, reload so the shell re-reads it)
  await page.evaluate(() => window.localStorage.setItem('mn-theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await stabilize(page);
  await expect(page).toHaveScreenshot(`${name}-dark.png`, { fullPage: true });
}

// Authenticated app surfaces (owner session via storageState).
const SCREENS: Array<{ name: string; path: string }> = [
  { name: 'dashboard', path: '/app/dashboard' },
  { name: 'masters-customers', path: '/app/entity/customers' },
  { name: 'orders', path: '/app/orders' },
  { name: 'production-batch-queue', path: '/app/production/batch-queue' },
  { name: 'billing-invoices', path: '/app/billing/invoices' },
  { name: 'audit-trail', path: '/app/audit' },
  { name: 'devices-sync', path: '/app/devices' },
];

for (const s of SCREENS) {
  test(`baseline: ${s.name}`, async ({ page }) => {
    await capture(page, s.name, s.path);
  });
}

// Login screen — captured unauthenticated (no session).
test.describe('unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('baseline: login', async ({ page }) => {
    await capture(page, 'login', '/login');
  });
});
