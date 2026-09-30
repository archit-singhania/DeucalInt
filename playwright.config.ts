import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/end-to-end',
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8100',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python apps/local-api/server.py',
    url: 'http://127.0.0.1:8100/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  reporter: 'list',
});
