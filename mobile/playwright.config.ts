import { defineConfig } from '@playwright/test';

// The isolated backend and the web app under test can run beside your own servers:
//   E2E_PORT=8001 E2E_WEB_PORT=8092 (backend/scripts/e2e_backend.sh start with the same E2E_PORT), then npx playwright test
const API_PORT = process.env.E2E_PORT || '8000';
const WEB_PORT = process.env.E2E_WEB_PORT || '8082';

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
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 430, height: 900 },
    geolocation: { latitude: 12.9716, longitude: 77.5946 },
    permissions: ['geolocation'],
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: {
    // a web app that talks to the isolated backend (EXPO_PUBLIC_API_URL), never to the normal one
    command: `npx expo start --web --port ${WEB_PORT}`,
    env: { ...process.env, CI: '1', EXPO_PUBLIC_API_URL: `http://localhost:${API_PORT}` } as Record<string, string>,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
