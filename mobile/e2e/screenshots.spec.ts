import { test } from '@playwright/test';
import { ADMIN, API, USER, VOLUNTEER, apiLogin, login, openApp, tab, text } from './helpers';

// Not part of the pass/fail suite: run with  SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
// Captures every screen of the running app (real data from the isolated backend) into docs/screenshots/.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture screens');
const OUT = '../docs/screenshots';

test('capture all screens', async ({ browser }) => {
  const admin = await apiLogin(ADMIN);
  const post = (path: string, body: object) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${admin}` }, body: JSON.stringify(body) });
  await post('/volunteers', { name: VOLUNTEER.name, email: VOLUNTEER.email, password: VOLUNTEER.password, skill: 'Medicine', latitude: 12.9716, longitude: 77.5946, phone: VOLUNTEER.phone }).catch(() => {});
  await post('/auth/register', { name: USER.name, email: USER.email, password: USER.password, confirm_password: USER.password });
  await post('/admin/places', { kind: 'SHELTER', name: 'Community Hall (sample fixture)', latitude: 12.976, longitude: 77.599 });

  const shot = async (page, name: string) => { await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/${name}.png` }); };
  const phone = { viewport: { width: 430, height: 900 }, geolocation: { latitude: 12.9716, longitude: 77.5946 }, permissions: ['geolocation'] };

  // user
  let ctx = await browser.newContext(phone); let page = await ctx.newPage();
  await openApp(page); await shot(page, '01-login');
  await login(page, USER); await text(page, 'FLOOD RISK ASSESSMENT').waitFor({ timeout: 90_000 });
  await shot(page, '02-user-home');
  await text(page, 'Why this risk? ▼').click(); await shot(page, '03-user-home-why');
  for (const [name, n] of [['04-user-map', 'Map'], ['06-user-report', 'Report'], ['07-user-help', 'Help'], ['08-user-alerts', 'Alerts'], ['09-user-account', 'Account']]) {
    await tab(page, n).click(); await shot(page, name);
  }
  await tab(page, 'Map').click(); await page.getByText('Nearest evacuation point').click(); await page.waitForTimeout(4000);
  await page.mouse.wheel(0, 700); await shot(page, '05-user-map-layers-evacuation');
  await ctx.close();
  // volunteer
  ctx = await browser.newContext(phone); page = await ctx.newPage();
  await openApp(page); await login(page, VOLUNTEER); await tab(page, 'Requests').waitFor({ timeout: 60_000 });
  await shot(page, '10-volunteer-home');
  for (const [name, n] of [['11-volunteer-requests', 'Requests'], ['12-volunteer-nearby', 'Nearby'], ['13-volunteer-map', 'Map']]) { await tab(page, n).click(); await shot(page, name); }
  await ctx.close();
  // admin (phone) and admin + map on a desktop-width window
  ctx = await browser.newContext(phone); page = await ctx.newPage();
  await openApp(page); await login(page, ADMIN); await tab(page, 'Dashboard').waitFor({ timeout: 60_000 });
  await shot(page, '14-admin-dashboard');
  for (const [name, n] of [['15-admin-people', 'People'], ['16-admin-incidents', 'Incidents'], ['17-admin-control', 'Control'], ['18-admin-requests', 'Requests'], ['19-admin-intelligence', 'Intelligence'], ['20-admin-insights', 'Insights']]) { await tab(page, n).click(); await shot(page, name); }
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, geolocation: { latitude: 12.9716, longitude: 77.5946 }, permissions: ['geolocation'] }); page = await ctx.newPage();
  await openApp(page); await login(page, USER); await text(page, 'CURRENT WEATHER').waitFor({ timeout: 90_000 });
  await shot(page, '21-desktop-home'); await tab(page, 'Map').click(); await page.waitForTimeout(3000); await shot(page, '22-desktop-map');
  await ctx.close();
});
