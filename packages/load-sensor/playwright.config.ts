import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const isCI = Boolean(process.env.CI);

// E2E tests run against the production build (vite preview), because that is
// what ships and what the privacy and offline evidence must describe.
export default defineConfig({
  testDir: 'tests/e2e',
  // One worker. Each test runs TF.js with a live fake camera; with several in
  // parallel (default 8 workers here), Chromium intermittently reports a page as
  // `hidden`, the camera then pauses for "tab hidden" by design (A2) and timers
  // throttle, so pause/resume, heartbeat and presence checks failed at random
  // (seen 2026-10-10, already on the pre-A5 suite). Serial: 27/27 over 3 repeats.
  // Latency evidence (A7) must run alone anyway.
  workers: 1,
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
