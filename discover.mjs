// vr.sh --discover <url>: crawl same-origin links (and /sitemap.xml) starting from the pages in pages.json and
// print the paths that are NOT listed there, so you can add the ones that matter. It never changes pages.json and
// never takes screenshots: what vr compares stays exactly what you listed.
//   DISCOVER_DEPTH=2   link hops from the listed pages        DISCOVER_MAX=50   pages to visit at most
import { chromium } from 'playwright';
import fs from 'fs';
import { resolveTargets } from './config.mjs';
import { normalizeLink, shouldSkip, parseSitemap, newPaths, joinUrl } from './links.mjs';

const base = process.env.BASE_URL.replace(/\/+$/, '');   // links are normalised against it, so no trailing slash
const maxDepth = Number(process.env.DISCOVER_DEPTH ?? 2);
const maxPages = Number(process.env.DISCOVER_MAX ?? 50);
const raw = JSON.parse(fs.readFileSync(new URL('./pages.json', import.meta.url)));
const ignore = (Array.isArray(raw) ? [] : raw.discover?.ignore) ?? [];
const listed = [...new Set(resolveTargets(raw).map(t => t.path))];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const depthOf = new Map(listed.map(p => [p, 0]));     // every path we know about -> link hops from a listed page
const linkedFrom = new Map();
try {
  const res = await ctx.request.get(new URL('/sitemap.xml', base).href);
  if (res.ok()) for (const p of parseSitemap(await res.text(), base)) if (!depthOf.has(p) && !shouldSkip(p, ignore)) depthOf.set(p, 1);
} catch { /* no sitemap: fine */ }

const queue = [...depthOf.keys()];
const visited = new Set();
const broken = [];
const redirected = [];
while (queue.length && visited.size < maxPages) {
  const path = queue.shift();
  if (visited.has(path)) continue;
  visited.add(path);
  const res = await page.goto(joinUrl(base, path), { waitUntil: 'networkidle' }).catch(() => null);
  if (!res || res.status() >= 400) { broken.push(`${path} (${res ? res.status() : 'no response'}) linked from ${linkedFrom.get(path) ?? 'pages.json'}`); continue; }
  // a page that redirects outside the site (other origin, or outside the base path) is not a page of the site: drop it
  if (!normalizeLink(page.url(), base)) { depthOf.delete(path); redirected.push(`${path} -> ${page.url()}`); continue; }
  if (depthOf.get(path) >= maxDepth) continue;
  const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
  for (const h of hrefs) {
    const p = normalizeLink(h, base, page.url());
    if (!p || shouldSkip(p, ignore) || depthOf.has(p)) continue;
    depthOf.set(p, depthOf.get(path) + 1);
    linkedFrom.set(p, path);
    queue.push(p);
  }
}
await browser.close();

const fresh = newPaths(depthOf.keys(), listed);
for (const p of fresh) console.log(p);
console.error(`${visited.size} pages visited, ${fresh.length} not in pages.json${fresh.length ? ' (listed above)' : ''}`);
if (queue.length) console.error(`stopped at DISCOVER_MAX=${maxPages}; ${queue.length} more to visit. Raise DISCOVER_MAX or lower DISCOVER_DEPTH.`);
for (const b of broken) console.error(`broken link: ${b}`);
for (const r of redirected) console.error(`left out, redirects off the site: ${r}`);
