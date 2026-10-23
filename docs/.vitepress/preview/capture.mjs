// Maintainer tool; Playwright is optional and is not shipped in the initializer.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
import { responseFor, updates } from './fixtures.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.OTA_PREVIEW_URL || 'http://localhost:3100';
const env = parseEnv(await fs.readFile(process.env.OTA_PREVIEW_ENV || '.env.ota-test', 'utf8'));
const output = fileURLToPath(new URL('../../public/screenshots/', import.meta.url));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.OTA_PREVIEW_BROWSER ? { executablePath: process.env.OTA_PREVIEW_BROWSER } : {}) });
try {
  const ctx = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark', viewport: { width: 1680, height: 1200 }, deviceScaleFactor: 1.5, reducedMotion: 'reduce' });
  const login = await ctx.request.post(`${base}/api/admin/login`, { data: { username: env.OTA_TEST_ADMIN_USER, password: env.OTA_TEST_ADMIN_PASSWORD } });
  assert.equal(login.status(), 200, 'Test admin login failed');
  await ctx.addInitScript(() => { localStorage.setItem('ota-console-theme', 'dark'); });
  await ctx.addCookies([{ name: 'ota-locale', value: 'en', url: base }]);
  const unexpected = [];
  await ctx.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    const body = req.method() === 'GET' ? responseFor(url) : undefined;
    if (!body) { unexpected.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 418, json: { error: 'Preview blocks unmocked requests' } }); }
    return route.fulfill({ status: 200, json: body });
  });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  async function capture(name) {
    // The authenticated SSR shell contains the test operator's name. Replace only
    // its visible name/avatar with a synthetic label before capturing any image.
    await page.locator('[data-sidebar="footer"] p').first().evaluate((el) => { el.textContent = 'demo.operator'; });
    await page.locator('[data-sidebar="footer"] span.uppercase').evaluate((el) => { el.textContent = 'DO'; });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, `${name}.jpg`), type: 'jpeg', quality: 88, animations: 'disabled' });
  }
  await page.goto(`${base}/updates/devices`);
  await page.getByText('Active installations by version', { exact: true }).waitFor();
  await page.getByLabel('Platform', { exact: true }).selectOption('android');
  await page.getByLabel('Channel', { exact: true }).selectOption('production');
  await page.getByLabel('Runtime', { exact: true }).selectOption('2.4.0');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  await capture('admin-versions');
  await page.getByText('Installation activity', { exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-slot="card-title"]')].find((e) => e.textContent === 'Installation activity');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
  });
  await capture('admin-cohorts');
  await page.goto(`${base}/updates`);
  await page.getByText('Checkout polish · smoke test', { exact: true }).first().waitFor();
  await capture('admin-updates');
  await page.goto(`${base}/updates/${updates[0].encodedKey}`);
  await page.getByText('Release owner · Pixel 9', { exact: true }).waitFor();
  await page.getByText('Update audience', { exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-slot="card-title"]')].find((e) => e.textContent === 'Update audience');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 30);
  });
  await capture('admin-targeting');
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log('Captured four admin screenshots with synthetic API data; no business writes.');
} finally { await browser.close(); }
