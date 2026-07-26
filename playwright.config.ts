import { defineConfig, devices } from '@playwright/test';

// Deterministic production-UI parity tests (2026-07-24). Drives the REAL production app with real
// clicks + auto-waiting — the reliable replacement for the flaky coordinate-based browser-pane
// checks. Targets production by default (the parity target); override with BASE_URL for a preview.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,            // the app hydrates + a search/LLM turn can run several seconds
  expect: { timeout: 25_000 },
  retries: 2,                 // absorb transient network/CDN blips against live prod
  workers: 1,                 // one search flow at a time — avoid hammering production
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'https://ezhalah-app.vercel.app',
    locale: 'ar',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
