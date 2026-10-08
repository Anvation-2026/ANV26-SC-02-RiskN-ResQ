import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real web app against an ISOLATED backend (backend/scripts/e2e_backend.sh start),
// never against production data. Real weather/satellite providers are used; nothing is mocked.
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8082',
    viewport: { width: 430, height: 900 },
    geolocation: { latitude: 12.9716, longitude: 77.5946 },
    permissions: ['geolocation'],
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: {
    command: 'npx expo start --web --port 8082',
    url: 'http://localhost:8082',
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
