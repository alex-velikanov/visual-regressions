import { launchBrowser } from './browser.mjs';
import { dataPath } from './paths.mjs';
import fs from 'fs';
import { resolveTargets, resolveAuth, fileName } from './config.mjs';
import { joinUrl } from './links.mjs';
import { loadSession, assertLoggedIn } from './auth.mjs';
import { runSteps } from './steps.mjs';

const base  = process.env.BASE_URL;
const out   = process.env.OUT;
const raw = JSON.parse(fs.readFileSync(dataPath('pages.json')));
const targets = resolveTargets(raw);
const profiles = resolveAuth(raw);

// Every login profile in use needs a saved session before anything is shot.
const sessions = {};
for (const name of new Set(targets.map(t => t.auth).filter(Boolean))) {
  sessions[name] = loadSession(name);
  if (!sessions[name]) throw new Error(`No session for the login profile "${name}". Run: vr.sh --login ${name} <base-url>`);
}

const browser = await launchBrowser();
fs.mkdirSync(out, { recursive: true });

// One browser context per viewport and login: size, touch, mobile emulation and the session are set per context.
// A page with steps gets a context of its own, so what its steps change (a cart, a dismissed banner) cannot leak into the next page.
const contextKey = t => `${t.viewport}\n${t.auth ?? ''}\n${t.steps.length ? t.name : ''}`;
for (const key of new Set(targets.map(contextKey))) {
  const group = targets.filter(t => contextKey(t) === key);
  const { width, height, mobile, auth } = group[0];
  const ctx = await browser.newContext({
    viewport: { width, height },
    ...(auth ? { storageState: sessions[auth] } : {}),
    reducedMotion: 'reduce',
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await ctx.newPage();

  for (const t of group) {
    const where = `${t.path} [${t.viewport}]`;
    const res = await page.goto(joinUrl(base, t.path), { waitUntil: 'networkidle' });
    const status = res ? res.status() : 0;
    if (t.expectStatus ? status !== t.expectStatus : status === 0 || status >= 400) {
      throw new Error(`${where} returned HTTP ${status || '(no response)'}${t.expectStatus ? `, expected ${t.expectStatus}` : ''}`);
    }
    if (t.auth) await assertLoggedIn(page, t.auth, profiles[t.auth], where);
    if (t.steps.length) await runSteps(page, t.steps, where);
    if (t.waitFor) await page.waitForSelector(t.waitFor, { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);

    const h     = await page.evaluate(() => document.documentElement.scrollHeight);
    const tiles = Math.ceil(h / height);
    if (tiles > t.maxTiles) {
      throw new Error(`${where} is ${h}px tall: it needs ${tiles} screenshots but the limit is ${t.maxTiles}. Raise "maxTiles" in pages.json (top level or on this page).`);
    }
    const mask  = t.mask.map(sel => page.locator(sel));

    for (let i = 0; i < tiles; i++) {
      await page.evaluate(y => window.scrollTo(0, y), i * height);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${fileName(t, i)}`, mask, animations: 'disabled' });
    }
  }
  await ctx.close();
}
await browser.close();
