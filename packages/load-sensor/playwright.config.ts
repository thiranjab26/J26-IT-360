import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const isCI = Boolean(process.env.CI);

// E2E tests run against the production build (vite preview), because that is
// what ships and what the privacy and offline evidence must describe.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Synthetic camera, so tests never need a real webcam or a permission prompt.
        // A recorded clip is wired in with --use-file-for-fake-video-capture (TODO A7).
        permissions: ['camera'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    command: 'vite build && vite preview',
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
