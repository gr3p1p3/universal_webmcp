import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e/live',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: 'list',
  timeout: 45_000,
  use: {
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'live-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'live-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'live-webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
