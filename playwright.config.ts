import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: 'list',
  use: {
    actionTimeout: 15000,
    baseURL: process.env.TEST_ORIGIN || 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
