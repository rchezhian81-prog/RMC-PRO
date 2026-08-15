import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Log in ONCE as the seeded tenant owner and persist the authenticated
 * localStorage/session, so every viewport project reuses it. Uses the real
 * login form + real API (no injected session), so the auth path itself is part
 * of the baseline.
 */
const BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const LOGIN = process.env.VISUAL_LOGIN ?? 'owner@visual.test';
const PASSWORD = process.env.VISUAL_PASSWORD ?? 'OwnerVis#12345';

export default async function globalSetup(_config: FullConfig) {
  mkdirSync('visual/.auth', { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROME_PATH || undefined,
  });
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#mn-login', LOGIN);
  await page.fill('#mn-password', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/app(\/|$)/, { timeout: 45_000 }),
    page.press('#mn-password', 'Enter'),
  ]);
  await page.waitForLoadState('networkidle');
  await page.context().storageState({ path: 'visual/.auth/state.json' });
  await browser.close();
}
