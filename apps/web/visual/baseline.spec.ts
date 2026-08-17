import { test, expect, type Page } from '@playwright/test';
import { SCREENS } from './screens';

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

// VISUAL_MODE selects the snapshot set: 'off' compares against the flag-OFF
// baselines (proving the default UI did NOT move); 'v2' is the flag-ON Deep
// Violet Matte set (its own '-v2' baselines).
const MODE = process.env.VISUAL_MODE === 'v2' ? 'v2' : 'off';
const SUFX = MODE === 'v2' ? '-v2' : '';

async function capture(page: Page, name: string, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });

  // Light (default). Set data-theme explicitly — the attribute the CSS keys off —
  // so a shot never depends on the ThemeToggle mount effect or a persisted choice.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await stabilize(page);
  await expect(page).toHaveScreenshot(`${name}-light${SUFX}.png`, { fullPage: true });

  // Dark — flip the same attribute in place. The previous approach set
  // localStorage + reload(), but an addInitScript re-forced 'light' on every
  // reload, so every "dark" shot silently rendered light. Toggling data-theme
  // directly (no reload) is deterministic and matches the ui-kit harness.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await stabilize(page);
  await expect(page).toHaveScreenshot(`${name}-dark${SUFX}.png`, { fullPage: true });
}

// Authenticated tenant-owner routes (shared list in ./screens.ts), rendered
// against the seeded VISUAL tenant. Non-deterministic / persona / detail routes
// are handled in evidence.spec.ts, not here.
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
