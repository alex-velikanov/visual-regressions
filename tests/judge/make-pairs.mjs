// make-pairs.mjs <baseline dir> <current dir>: render every calibration case to <dir>/<id>__0.png at 1440x900.
// Needs playwright and a Chromium (CHROMIUM_PATH overrides the one Playwright installed).
import { chromium } from 'playwright';
import fs from 'fs';
import { ORDERED, beforeHtml, afterHtml } from './cases.mjs';

const [baseDir, curDir] = process.argv.slice(2);
fs.mkdirSync(baseDir, { recursive: true });
fs.mkdirSync(curDir, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
for (const c of ORDERED) {
  await page.setContent(beforeHtml(c));
  await page.screenshot({ path: `${baseDir}/${c.file}` });
  await page.setContent(afterHtml(c));
  await page.screenshot({ path: `${curDir}/${c.file}` });
}
await browser.close();
console.log(`${ORDERED.length} pairs rendered`);
