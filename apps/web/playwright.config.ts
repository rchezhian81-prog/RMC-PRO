import { defineConfig } from '@playwright/test';

/**
 * Visual-regression baseline for the Mix Nova web app (PR-UI0).
 *
 * This is the safety net the UI migration is gated on: it captures the CURRENT
 * production UI (flag OFF) as the reference, so any later UI PR can be diffed
 * against it. It renders the REAL app against a REAL local API + Postgres (see
 * `visual/serve-stack.mjs`) — no mock data, no prototype routing.
 *
 * The pre-installed Chromium is used (PLAYWRIGHT_BROWSERS_PATH); browsers are
 * never downloaded. Non-essential animations are disabled at capture time so a
 * baseline is never an unstable animation frame.
 *
 * Requires the stack already running on http://localhost:3000 (web) + :4000
 * (api). `pnpm --filter @rmc/web test:visual` boots it via serve-stack first.
 */
const BASE_URL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const CHROME = process.env.PW_CHROME_PATH; // optional explicit executablePath

export default defineConfig({
  testDir: './visual',
  outputDir: './visual/.output',
  snapshotDir: './visual/__screenshots__',
  globalSetup: './visual/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: './visual/.report', open: 'never' }]],
  timeout: 60_000,
  expect: {
    // Sub-pixel AA differences across runs are not regressions; a real visual
    // change moves far more than this. Kept tight so genuine drift still fails.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: BASE_URL,
    storageState: 'visual/.auth/state.json',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      // --no-sandbox: the sandbox capture runs as root; Chromium refuses the
      // sandbox as root. Deterministic, headless, capture-only — safe here.
      args: ['--no-sandbox'],
      ...(CHROME ? { executablePath: CHROME } : {}),
    },
  },
  // One project per approved viewport (owner-specified sizes). All on Chromium
  // (the pre-installed engine); viewport width drives the responsive layout, so
  // the device chrome is stripped for deterministic, engine-consistent shots.
  // Owner-specified verification widths: 375 mobile · 768 tablet · 1024 compact
  // desktop / tablet-landscape (the shell's sidebar-collapse breakpoint) · 1440
  // desktop. Touch is emulated at the two hand-held widths for touch-target checks.
  projects: [
    { name: 'desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'laptop-1024', use: { browserName: 'chromium', viewport: { width: 1024, height: 768 } } },
    { name: 'tablet-768', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'mobile-375', use: { browserName: 'chromium', viewport: { width: 375, height: 812 }, hasTouch: true } },
  ],
});
