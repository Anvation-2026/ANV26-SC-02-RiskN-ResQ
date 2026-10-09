import * as fs from 'fs';
import { expect, test } from '@playwright/test';
import { ADMIN, API, PNG, USER, VOLUNTEER, apiLogin, login, logoutFromAccount, openApp, tab, text } from './helpers';

// One serial story across the three roles, using the real UI and the real backend:
// admin creates a volunteer -> user registers, reads risk, uses the map, reports with a photo, asks for help ->
// volunteer accepts and completes -> user sees the result -> admin reviews, simulates a drill, blocks a road, exports, resets.
test.describe.configure({ mode: 'serial' });

test('admin signs in and creates a volunteer', async ({ page }) => {
  await openApp(page);
  await login(page, ADMIN);
  await expect(tab(page, 'Dashboard')).toBeVisible({ timeout: 60_000 });
  await tab(page, 'People').click();
  await page.getByText('+ ADD VOLUNTEER', { exact: true }).click();
  const field = (label: string) => page.locator(`xpath=//*[normalize-space(text())="${label}"]/following::input[1]`).first();
  await field('NAME').fill(VOLUNTEER.name);
  await field('EMAIL').fill(VOLUNTEER.email);
  await field('PHONE').fill(VOLUNTEER.phone);
  await field('PASSWORD (MIN 8)').fill(VOLUNTEER.password);
  await field('LATITUDE').fill('12.9716');
  await field('LONGITUDE').fill('77.5946');
  await page.getByText('Medicine', { exact: true }).first().click();
  await page.getByText('CREATE VOLUNTEER ACCOUNT', { exact: true }).click();
  await expect(text(page, VOLUNTEER.email)).toBeVisible({ timeout: 30_000 });
  // test fixtures in the ISOLATED database only: one designated shelter and hospital near the user (production data comes from OpenStreetMap)
  const token = await apiLogin(ADMIN);
  for (const place of [{ kind: 'SHELTER', name: 'E2E Test Shelter (fixture)', latitude: 12.9760, longitude: 77.5990 }, { kind: 'HOSPITAL', name: 'E2E Test Hospital (fixture)', latitude: 12.9690, longitude: 77.6010 }]) {
    const r = await fetch(`${API}/admin/places`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(place) });
    expect(r.status).toBe(201);
  }
  await tab(page, 'Dashboard').click();
  await page.getByText('Log out', { exact: true }).click();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
});

test('user registers and reads weather, risk, explanation and risk history', async ({ page }) => {
  await openApp(page);
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Your name').fill(USER.name);
  await page.getByPlaceholder('you@example.com').fill(USER.email);
  await page.getByPlaceholder('At least 8 characters').fill(USER.password);
  await page.getByPlaceholder('Repeat your password').fill(USER.password);
  await page.getByText('CREATE ACCOUNT', { exact: true }).click();
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await expect(text(page, 'FLOOD INTELLIGENCE')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, /^LIVE( ±\d+ m)?$/)).toBeVisible();                     // real-time GPS (accuracy shown when the device reports it)
  await expect(text(page, /Probability \d+% \(prototype\)/)).toBeVisible();
  await expect(text(page, /^Confidence: (High|Medium|Low)$/)).toBeVisible();       // data confidence from the backend
  await expect(text(page, 'WHY THIS RISK?')).toBeVisible();
  await expect(text(page, 'RECOMMENDED ACTION')).toBeVisible();
  await text(page, 'Why this risk? See every signal').click();
  await expect(text(page, /IMPACT (NONE|LOW|MEDIUM|HIGH)/)).toBeVisible();          // every signal carries its contribution
  await expect(text(page, /Open-Meteo/)).toBeVisible();
  await expect(text(page, /Prototype flood-risk model/)).toBeVisible();
  // weather is real or honestly unavailable, never a made-up number
  await expect(page.locator('body')).toContainText(/Last updated|Weather data unavailable/);
});

test('user signs in with an emailed code; volunteers never receive one', async ({ page }) => {
  // no SMTP on the isolated test backend, so the email lands in its log (the documented development fallback)
  const LOG = '/tmp/riskn_e2e_backend.log';
  const codesFor = (email: string) => (fs.readFileSync(LOG, 'utf8').match(new RegExp(`To: ${email.replace(/[.+]/g, '\\$&')} \\| (\\d{6}) is your RiskN ResQ sign-in code`, 'g')) || []);
  await openApp(page);
  await page.getByRole('tab', { name: 'Email code' }).click();
  await page.getByPlaceholder('you@example.com').fill(USER.email);
  await page.getByText('SEND CODE', { exact: true }).click();
  await expect(text(page, 'Check your email')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => codesFor(USER.email).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const code = codesFor(USER.email).pop()!.match(/(\d{6}) is your/)![1];
  await page.getByLabel('Sign-in code').fill(code === '000000' ? '111111' : '000000');   // a wrong code is refused
  await expect(text(page, 'That code is invalid or has expired.')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Sign-in code').fill(code);                                    // six digits submit on their own
  await expect(text(page, /^Welcome, E2E$/)).toBeVisible({ timeout: 15_000 });         // the sign-in transition
  await expect(text(page, 'FLOOD INTELLIGENCE')).toBeVisible({ timeout: 60_000 });
  await logoutFromAccount(page);
  // a volunteer asking for a code gets the same neutral answer and no email
  const before = fs.readFileSync(LOG, 'utf8').length;
  await page.getByRole('tab', { name: 'Email code' }).click();
  await page.getByPlaceholder('you@example.com').fill(VOLUNTEER.email);
  await page.getByText('SEND CODE', { exact: true }).click();
  await expect(text(page, 'Check your email')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(fs.readFileSync(LOG, 'utf8').slice(before)).not.toContain(VOLUNTEER.email);
});

test('user map: every layer toggles, details open, evacuation route', async ({ page }) => {
  await openApp(page);
  await login(page, USER);
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await tab(page, 'Map').click();
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 60_000 });
  // basemaps: satellite (photo mosaic, labelled not live) and NASA's image of today (dated), with NASA flood detection on
  await page.getByRole('tab', { name: 'Basemap Satellite', exact: true }).click();
  await expect(text(page, 'NOT LIVE')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'NASA flood detection')).toBeVisible();
  await expect(page.locator('img.leaflet-tile[src*="World_Imagery"]').first()).toBeAttached({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Basemap Today (NASA)', exact: true }).click();
  await expect(text(page, /^DAILY · /)).toBeVisible();
  await expect(page.locator('img.leaflet-tile[src*="VIIRS_SNPP_CorrectedReflectance"]').first()).toBeAttached({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Basemap Map', exact: true }).click();
  await expect(page.locator('img.leaflet-tile[src*="tile.openstreetmap.org"]').first()).toBeAttached({ timeout: 30_000 });
  await page.getByRole('switch', { name: 'NASA flood', exact: true }).click();          // flood detection off again
  await expect(text(page, 'MAP LAYERS')).toBeVisible();
  for (const name of ['Flood risk', 'Rainfall', 'Satellite', 'Hotspots', 'Road risk', 'Terrain', 'Incidents', 'Hospitals', 'Shelters', 'Volunteers', 'NASA flood', 'Radar water']) {
    const sw = page.getByRole('switch', { name, exact: true });
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await sw.click(); // back to the original state
    await expect(sw).toHaveAttribute('aria-checked', before ?? 'false');
  }
  await page.getByRole('switch', { name: 'Terrain', exact: true }).click(); // terrain on: layer renders without error
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await page.getByRole('switch', { name: 'Terrain', exact: true }).click();
  // legend carries the documented items
  for (const l of ['Low risk', 'Medium risk', 'High risk', 'Critical risk', 'Satellite water change', 'Blocked Road', 'Your Location']) await expect(text(page, l)).toBeVisible();
  // tap a risk cell: details load from the backend
  await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
  const spot = await page.evaluate(() => {
    const box = document.querySelector('.leaflet-container')!.getBoundingClientRect();
    for (const p of Array.from(document.querySelectorAll('path.leaflet-interactive'))) {
      const r = p.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      // only a point where that map shape is really on top (not under the header or another overlay)
      if (r.width > 20 && r.height > 20 && x > box.x + 5 && x < box.right - 5 && y > box.y + 5 && y < box.bottom - 5 && document.elementFromPoint(x, y) === p) return { x, y };
    }
    return null;
  });
  expect(spot, 'a visible map area to tap').not.toBeNull();
  await page.mouse.click(spot!.x, spot!.y);
  await expect(text(page, /Flood risk estimate for this area|Heavy rainfall|Satellite-detected|Potential flood hotspot|Road status|Incident report|Terrain susceptibility/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Close', exact: true }).click();                  // the details sheet closes
  await expect(page.getByText(/Flood risk estimate for this area/)).toBeHidden({ timeout: 10_000 });
  // evacuation: a designated point and a route, never called "safe"
  await page.getByText('Nearest evacuation point').click();
  await expect(text(page, 'Designated evacuation point')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('body')).toContainText('not verified safe');
  await expect(page.locator('body')).not.toContainText(/guaranteed safe|safe route/i);
});

test('user reports an incident with a real photo', async ({ page }) => {
  await openApp(page);
  await login(page, USER);
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await tab(page, 'Report').click();
  await page.getByText('Flooded Road', { exact: true }).click();
  await page.getByPlaceholder('Describe water depth, obstruction, or damage...').fill('E2E: knee-deep water near the junction');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Choose photo').click();
  (await chooser).setFiles({ name: 'flood.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('img[src^="blob:"], img[src^="data:"]').and(page.locator(':visible')).first()).toBeVisible();   // the chosen photo's preview
  await page.getByText('SUBMIT REPORT', { exact: true }).click();
  await expect(text(page, 'Report submitted')).toBeVisible({ timeout: 60_000 });
  await expect(text(page, /pending administrator review/)).toBeVisible();          // verification status from the backend
  await expect(text(page, 'Photo uploaded with your report.')).toBeVisible();
  await expect(page.locator('body')).toContainText(/one report on its own does not declare a flood/i);
  await expect(text(page, 'MY REPORTS')).toBeVisible();
  await expect(text(page, /^(Under review|Matched existing report #\d+)$/)).toBeVisible({ timeout: 15_000 });   // review status (or the duplicate it was merged into)
});

test('user asks for medicine and the nearby volunteer is matched', async ({ page }) => {
  await openApp(page);
  await login(page, USER);
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await tab(page, 'Help').click();
  await page.getByText('Medicine', { exact: true }).first().click();
  await page.getByText('REQUEST ASSISTANCE', { exact: true }).click();
  await expect(text(page, VOLUNTEER.name)).toBeVisible({ timeout: 60_000 });
  await expect(text(page, /My requests/)).toBeVisible();
});

test('volunteer sees the request, accepts it, completes it', async ({ page }) => {
  await openApp(page);
  await login(page, VOLUNTEER);
  await expect(tab(page, 'Requests')).toBeVisible({ timeout: 60_000 });
  // availability toggles and the GPS location is pushed to the backend
  await page.getByText('GO UNAVAILABLE', { exact: true }).click();
  await expect(text(page, 'GO AVAILABLE')).toBeVisible({ timeout: 30_000 });
  await page.getByText('GO AVAILABLE', { exact: true }).click();
  await expect(text(page, 'GO UNAVAILABLE')).toBeVisible({ timeout: 30_000 });
  const vtoken = await apiLogin(VOLUNTEER);
  const moved = await fetch(`${API}/volunteers/me`, { method: 'PATCH', headers: { 'content-type': 'application/json', Authorization: `Bearer ${vtoken}` }, body: JSON.stringify({ latitude: 12.9, longitude: 77.5 }) });
  expect(moved.status).toBe(200);                                   // move the volunteer away from the browser's GPS position first
  await page.getByText('Update from my GPS').click();
  await expect.poll(async () => {
    const v = (await (await fetch(`${API}/volunteers/me`, { headers: { Authorization: `Bearer ${vtoken}` } })).json()).volunteer;
    return Math.abs(v.latitude - 12.9716) < 0.001 && Math.abs(v.longitude - 77.5946) < 0.001 && v.available === true;
  }, { timeout: 30_000 }).toBe(true);                               // the GPS button put the real position back
  await expect(page.locator('body')).not.toContainText(/Cannot reach|denied|unavailable on this device/i);
  await tab(page, 'Requests').click();
  await page.getByText('VIEW DETAILS', { exact: true }).first().click();
  await page.getByText('ACCEPT ASSIGNMENT', { exact: true }).click();
  await expect(text(page, /ACCEPTED/)).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'SHOW ROUTE ON MAP')).toBeVisible();
  // full lifecycle: accepted -> en route -> arrived -> completed
  await page.getByText('START TRAVEL (EN ROUTE)', { exact: true }).click();
  await page.getByText('I HAVE ARRIVED AT SCENE', { exact: true }).click({ timeout: 30_000 });
  await page.getByText('MARK AS COMPLETED', { exact: true }).click({ timeout: 30_000 });
  await expect(text(page, /completed/i)).toBeVisible({ timeout: 30_000 });
  await tab(page, 'Map').click();
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 60_000 });
  await logoutFromAccount(page);
});

test('user sees the completed request with its timeline', async ({ page }) => {
  await openApp(page);
  await login(page, USER);
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await tab(page, 'Help').click();
  await text(page, 'Tap for progress').click();
  await expect(text(page, 'Volunteer accepted')).toBeVisible({ timeout: 30_000 });
  await expect(text(page, 'Completed')).toBeVisible();
  await tab(page, 'Alerts').click();
  await expect(text(page, 'SAFETY GUIDE')).toBeVisible();
  await expect(text(page, '112')).toBeVisible();
  await logoutFromAccount(page);
});

test('admin: review, drill, road risk, intelligence, insights, export, audit, reset', async ({ page, browser }) => {
  await openApp(page);
  await login(page, ADMIN);
  await expect(tab(page, 'Dashboard')).toBeVisible({ timeout: 60_000 });
  await tab(page, 'People').click();
  await page.getByText('All users', { exact: true }).click();
  await expect(text(page, USER.email)).toBeVisible();
  await tab(page, 'Incidents').click();
  await expect(text(page, /FLOODED ROAD · #\d+/)).toBeVisible();
  await page.getByText('View photo').click();
  await expect(page.locator('img[src^="data:image"]').and(page.locator(':visible')).first()).toBeVisible({ timeout: 30_000 });
  await expect(text(page, /Confidence .* because:/)).toBeVisible();
  await page.getByText('Verify', { exact: true }).first().click();
  await expect(text(page, 'VERIFIED').first()).toBeVisible({ timeout: 30_000 });
  await tab(page, 'Requests').click();
  await expect(text(page, new RegExp(USER.name))).toBeVisible();     // names, not bare ids
  await expect(text(page, new RegExp(VOLUNTEER.name))).toBeVisible();
  await tab(page, 'Control').click();
  await page.getByText(/Heavy rain 80mm/).click();
  await expect(text(page, /SIMULATED DRILL/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('body')).toContainText(/Risk .* →/);
  await page.getByText('Block', { exact: true }).first().click();
  await expect(text(page, 'Block road?').or(text(page, /^Block .*\?$/))).toBeVisible();      // blocking asks first
  await page.getByText('Block road', { exact: true }).click();
  await expect(text(page, 'Unblock').first()).toBeVisible({ timeout: 30_000 });
  // while the drill and the closure are active, an ordinary user sees them clearly labelled as a simulation
  const uctx = await browser.newContext({ viewport: { width: 430, height: 900 }, geolocation: { latitude: 12.9716, longitude: 77.5946 }, permissions: ['geolocation'] });
  const upage = await uctx.newPage();
  await openApp(upage);
  await login(upage, USER);
  await expect(text(upage, 'FLOOD INTELLIGENCE')).toBeVisible({ timeout: 90_000 });
  await expect(text(upage, 'SIMULATED DRILL: not a real warning')).toBeVisible({ timeout: 60_000 });
  await tab(upage, 'Alerts').click();
  await expect(text(upage, 'SIMULATED').first()).toBeVisible({ timeout: 30_000 });
  await expect(upage.locator('body')).toContainText(/SIMULATED DRILL \(not a real warning\)/);
  await tab(upage, 'Map').click();
  await expect(text(upage, /Active Corridor Blockage/)).toBeVisible({ timeout: 60_000 });
  await uctx.close();
  await page.getByText('Unblock', { exact: true }).first().click();
  await expect(page.getByText('Block', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await tab(page, 'Intelligence').click();
  await expect(text(page, 'DATA PROVIDERS')).toBeVisible({ timeout: 30_000 });
  for (const n of ['WEATHER', 'SATELLITE', 'WATER LEVEL']) await expect(text(page, n)).toBeVisible();
  await expect(page.locator('body')).toContainText(/not a gauge reading/);
  await expect(page.locator('body')).toContainText(/Prototype flood-risk model/);
  await tab(page, 'Insights').click();
  await expect(text(page, /INCIDENTS PER DAY/)).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download');
  await page.getByText('incidents', { exact: true }).click();
  expect((await download).suggestedFilename()).toBe('riskn-incidents.csv');
  await expect(text(page, /AUDIT LOG/)).toBeVisible();
  await expect(page.locator('body')).toContainText(/hazard\.simulate/);
  await expect(page.locator('body')).toContainText(/incident\.verified/);
  await tab(page, 'Control').click();
  await page.getByText('RESET DEMO', { exact: true }).last().click();
  await expect(text(page, 'Reset the demo?')).toBeVisible();                                   // resetting asks first
  await page.getByText('Yes, reset', { exact: true }).click();
  await expect(page.locator('body')).not.toContainText(/SIMULATED DRILL/, { timeout: 30_000 });
});

test('role protection: a normal user and a volunteer are refused admin APIs', async () => {
  const userToken = await apiLogin(USER);
  const volToken = await apiLogin(VOLUNTEER);
  for (const token of [userToken, volToken]) {
    for (const path of ['/admin/summary', '/admin/providers', '/admin/audit', '/admin/analytics', '/admin/export/incidents.csv', '/admin/users']) {
      const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
      expect(r.status, path).toBe(403);
    }
  }
  expect((await fetch(API + '/admin/summary')).status).toBe(401);
  expect((await fetch(API + '/admin/summary', { headers: { Authorization: 'Bearer nonsense' } })).status).toBe(401);
  const wrong = await fetch(API + '/volunteers/me', { headers: { Authorization: `Bearer ${userToken}` } });
  expect(wrong.status).toBe(403); // a normal user cannot use the volunteer API
});

test('GPS not allowed: the app explains why, asks only on request, and offers a sample location', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: [], geolocation: undefined, viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  await openApp(page);
  await login(page, USER);
  // no permission yet: the app explains why before anything is asked, and "Not now" leaves a clear way back
  // (a browser that has not been asked shows the explanation first; this headless browser starts out refusing, so the
  // banner appears straight away; either way nothing is asked silently)
  await expect(text(page, /Allow your location|Location not shared/)).toBeVisible({ timeout: 90_000 });
  if (await page.getByText('Allow your location').isVisible()) {
    await expect(text(page, 'Flood risk where you are')).toBeVisible();
    await page.getByText('Not now', { exact: true }).click();
  }
  await expect(text(page, 'Location not shared')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Allow location', { exact: true }).click();                     // the browser still refuses: say how to fix it
  await expect(text(page, 'Location is turned off for RiskN ResQ')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).toContainText('lock icon in the address bar');
  await page.getByText('Not now', { exact: true }).click();
  await page.getByText(/Use a sample location instead/).click();
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await ctx.close();
});

test('offline: the app says it cannot reach the server and labels saved data', async ({ page, context }) => {
  await openApp(page);
  await login(page, USER);
  await expect(text(page, 'CURRENT WEATHER')).toBeVisible({ timeout: 90_000 });
  await context.setOffline(true);
  await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
  await expect(text(page, 'Unable to connect to the server.')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('body')).toContainText(/SAVED DATA \(OFFLINE\)|Reports and requests cannot be sent/i);
  await context.setOffline(false);
});
