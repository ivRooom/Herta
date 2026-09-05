import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: 'HERTA_STUDIO_E2E=1 pnpm exec next dev --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000/e2e-test/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
