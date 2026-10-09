import { expect, test } from '@playwright/test';
import { ADMIN, API, apiLogin, login, openApp, tab, text } from './helpers';

// "Navigate Safely" on the real web app and the isolated backend: destination picked on the map, candidate routes from the
// real routing service, hazard checks, then a verified flooded-road report on the chosen route must take it out of the
// recommendation and be drawn. Uses the real OSRM service (network needed); no routing or hazard data is mocked.
const RIDER = { name: 'E2E Rider', email: `e2e-rider-${Date.now()}@test.local`, password: 'E2e-rider-pass-1' };

test('navigate safely: map pick, ranking, hazard overlay and reassessment', async ({ page }) => {
  const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...RIDER, confirm_password: RIDER.password }) });
  expect(reg.status).toBeLessThan(300);
  await openApp(page);
  await login(page, RIDER);
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await tab(page, 'Map').click();

  // satellite flood layer card: either a real analysis (dated, NOT LIVE) or an honest "none yet"
  await expect(text(page, 'Satellite flood detection (Sentinel-1 radar)')).toBeVisible();
  await expect(page.locator('body')).toContainText(/NOT LIVE|No satellite flood analysis has completed yet|No completed analysis yet/);

  await page.getByRole('button', { name: 'Navigate safely' }).and(page.locator(':visible')).click();
  await expect(text(page, 'Find a lower-risk route')).toBeVisible();
  await expect(text(page, 'My location')).toBeVisible();
  await page.getByRole('button', { name: 'Choose the destination on the map' }).and(page.locator(':visible')).click();
  await expect(text(page, 'Tap the map to choose your destination')).toBeVisible();
  const map = page.locator('.leaflet-container').and(page.locator(':visible')).first();
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.82, y: box.height * 0.35 } });
  await expect(text(page, /^Map point \d+\.\d{4}, \d+\.\d{4}$/)).toBeVisible();

  await text(page, 'Calculate route').click();
  await expect(text(page, /Recommended route found|Every route crosses a known flood hazard|Route could not be fully checked/)).toBeVisible({ timeout: 60_000 });
  await expect(text(page, /^ROUTES \(\d\) · TAP TO COMPARE$/)).toBeVisible();
  await expect(text(page, 'HAZARD DATA USED')).toBeVisible();
  await expect(page.locator('body')).toContainText('RiskN ResQ cannot guarantee any route');
  await expect(page.locator('body')).not.toContainText(/guaranteed safe|safe route|this route is safe/i);
  await expect(page.locator('.leaflet-tooltip').filter({ hasText: /^Destination: Map point/ })).toHaveCount(1);

  // put a verified flooded-road report in the middle of the recommended route (through the admin API), then recalculate
  const token = await apiLogin(ADMIN);
  const dest = await page.evaluate(() => document.body.innerText.match(/Map point (\d+\.\d+), (\d+\.\d+)/)!.slice(1).map(Number));
  const plan = await (await fetch(`${API}/routes/safe-route`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ origin: { latitude: 12.9716, longitude: 77.5946 }, destination: { latitude: dest[0], longitude: dest[1] } }) })).json();
  const rec = plan.routes.find((r: any) => r.recommended) || plan.routes[0];
  const mid = rec.geometry[Math.floor(rec.geometry.length / 2)];
  const inc = await (await fetch(`${API}/incidents`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: 'FLOODED_ROAD', latitude: mid[0], longitude: mid[1], description: 'E2E test report' }) })).json();
  expect((await fetch(`${API}/incidents/${inc.id || inc.incident.id}/verify`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

  await text(page, 'Check for new hazards').click();
  await expect(text(page, 'Your route may be affected')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('body')).toContainText(/Flooded Road report \(verified\)/);
  await text(page, /View new route|Keep current route/).click();
  await text(page, 'Recalculate route').click();
  await expect(text(page, 'Crosses a flood hazard')).toBeVisible({ timeout: 60_000 });
  // the hazard is drawn (verified report colour) and the affected route is a red dashed option
  await expect(page.locator('.leaflet-overlay-pane path[stroke="#B91C1C"]').first()).toBeAttached();
  await page.getByRole('radio').filter({ hasText: 'Crosses a flood hazard' }).first().click();
  await expect(text(page, /Flooded Road report \(verified\): \d+ m of this route/)).toBeVisible();
  await expect(text(page, 'Not recommended')).toBeVisible();
});
