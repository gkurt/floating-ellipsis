import { defineConfig, devices } from '@playwright/test';

const PRODUCTION = 'http://localhost:4192';
const DEVELOPMENT = 'http://localhost:4191';

// The built app (`next start`) in three engines, and the dev server (React's
// development build, Strict Mode) in Chromium.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  webServer: [
    { command: 'next start --port 4192', url: PRODUCTION },
    { command: 'next dev --port 4191', url: DEVELOPMENT, timeout: 120_000 },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], baseURL: PRODUCTION } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], baseURL: PRODUCTION } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], baseURL: PRODUCTION } },
    { name: 'dev', use: { ...devices['Desktop Chrome'], baseURL: DEVELOPMENT } },
  ],
});
