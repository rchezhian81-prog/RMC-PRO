import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Log in ONCE as each persona and persist the authenticated storage, so every
 * viewport project reuses it. Uses the real login form + real API (no injected
 * session), so the auth path itself is part of the baseline:
 *   • owner  → visual/.auth/state.json  (tenant owner; the baseline persona)
 *   • super  → visual/.auth/admin.json  (platform super-admin; /admin/* evidence)
 * The super-admin session is best-effort — if those creds aren't seeded the file
 * is simply absent and evidence.spec skips the admin captures.
 */
const BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const LOGIN = process.env.VISUAL_LOGIN ?? 'owner@visual.test';
const PASSWORD = process.env.VISUAL_PASSWORD ?? 'OwnerVis#12345';
const SU_LOGIN = process.env.VISUAL_SU_LOGIN ?? '';
const SU_PASSWORD = process.env.VISUAL_SU_PASSWORD ?? '';

async function login(
  urlRe: RegExp,
  login: string,
  password: string,
  statePath: string,
): Promise<boolean> {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('#mn-login', login);
    await page.fill('#mn-password', password);
    await Promise.all([
      page.waitForURL(urlRe, { timeout: 45_000 }),
      page.press('#mn-password', 'Enter'),
    ]);
    await page.waitForLoadState('networkidle');
    await page.context().storageState({ path: statePath });
    return true;
  } catch {
    return false;
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(_config: FullConfig) {
  mkdirSync('visual/.auth', { recursive: true });
  await login(/\/app(\/|$)/, LOGIN, PASSWORD, 'visual/.auth/state.json');
  if (SU_LOGIN && SU_PASSWORD) {
    await login(/\/admin(\/|$)/, SU_LOGIN, SU_PASSWORD, 'visual/.auth/admin.json');
  }
}
