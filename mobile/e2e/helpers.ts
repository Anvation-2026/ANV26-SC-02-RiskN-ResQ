import { expect, Page } from '@playwright/test';

// Test-only credentials for the isolated E2E backend (see backend/scripts/e2e_backend.sh). Not production accounts.
export const ADMIN = { email: 'e2e-admin@test.local', password: 'E2e-admin-pass-1' };
export const stamp = Date.now();
export const USER = { name: 'E2E User', email: `e2e-user-${stamp}@test.local`, password: 'E2e-user-pass-1' };
export const VOLUNTEER = { name: 'E2E Volunteer', email: `e2e-vol-${stamp}@test.local`, password: 'E2e-vol-pass-1', phone: '+91 98450 11111' };
export const API = `http://127.0.0.1:${process.env.E2E_PORT || '8000'}`;

export const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
// all tabs stay mounted (hidden) in the app, so only ever match what the user can actually see
export const text = (page: Page, t: string | RegExp) => page.getByText(t).and(page.locator(':visible')).first();

export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible({ timeout: 120_000 });
}

export async function login(page: Page, who: { email: string; password: string }) {
  await page.getByPlaceholder('you@example.com').fill(who.email);
  await page.getByPlaceholder('Your password').fill(who.password);
  await page.getByText('LOGIN', { exact: true }).click();
}

export async function logoutFromAccount(page: Page, accountTab = 'Account') {
  await tab(page, accountTab).click();
  await page.getByText('LOG OUT', { exact: true }).click();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
}

export async function apiLogin(who: { email: string; password: string }): Promise<string> {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who) });
  return (await r.json()).token;
}

// A real (tiny) PNG, written to disk so a file chooser can pick it.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
