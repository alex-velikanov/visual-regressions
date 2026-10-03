import { chromium } from 'playwright';
import fs from 'fs';

const base  = process.env.BASE_URL;
const out   = process.env.OUT;
const pages = JSON.parse(fs.readFileSync(new URL('./pages.json', import.meta.url)));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
fs.mkdirSync(out, { recursive: true });

for (const p of pages) {
  await page.goto(base + p, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const slug  = p.replace(/\W+/g, '_') || 'home';
  const h     = await page.evaluate(() => document.body.scrollHeight);
  const tiles = Math.min(Math.ceil(h / 900), 6);

  for (let i = 0; i < tiles; i++) {
    await page.evaluate(y => window.scrollTo(0, y), i * 900);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${slug}__${i}.png` });
  }
}
await browser.close();
