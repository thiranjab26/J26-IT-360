import { defineConfig, devices } from '@playwright/test';
import { FAKE_CAMERA_ARGS } from './tests/e2e/fake-camera.js';

// Study-mode e2e (TODO B1): the study page exists only in `--mode study`
// builds, so it gets its own build, port and test folder. Same browser setup
// as playwright.config.ts.
const PORT = 4175;

export default defineConfig({
  testDir: 'tests/e2e-study',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: { args: [...FAKE_CAMERA_ARGS] },
      },
    },
  ],
  webServer: {
    command: `vite build --mode study --outDir dist-study && vite preview --outDir dist-study --port ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}/study.html`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
