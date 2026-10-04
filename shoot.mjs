import { chromium } from 'playwright';
import fs from 'fs';
import { resolveTargets, fileName } from './config.mjs';
import { joinUrl } from './links.mjs';

const base  = process.env.BASE_URL;
const out   = process.env.OUT;
const targets = resolveTargets(JSON.parse(fs.readFileSync(new URL('./pages.json', import.meta.url))));

const browser = await chromium.launch();
fs.mkdirSync(out, { recursive: true });

// One browser context per viewport: size, touch and mobile emulation are set per context.
for (const name of new Set(targets.map(t => t.viewport))) {
  const group = targets.filter(t => t.viewport === name);
  const { width, height, mobile } = group[0];
  const ctx = await browser.newContext({
    viewport: { width, height },
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
