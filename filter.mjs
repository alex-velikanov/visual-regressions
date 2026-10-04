import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'fs';
import { resolveTargets, slug } from './config.mjs';

// A screenshot is "changed" if it exists on only one side, its size differs, or more than
// MIN_DIFF_PX pixels differ. An absolute pixel count (not a % of the image) so a small but
// real change, like a missing button, is not lost on a tall page.
const MIN_DIFF_PX = Number(process.env.VR_MIN_DIFF_PX ?? 50);
if (!Number.isFinite(MIN_DIFF_PX) || MIN_DIFF_PX < 0) {
  throw new Error('VR_MIN_DIFF_PX must be finite and non-negative');
}

// A screenshot that is (almost) one flat colour where the baseline was not is a blank page: the judge is not
// trusted with that alone, because it has been seen to skim past it. vr.sh forces these to severity 5.
const BLANK_SHARE = 0.995;
function isBlank(png) {
  const counts = new Map();
  const px = new Uint32Array(png.data.buffer, png.data.byteOffset, png.data.length >> 2);
  let top = 0;
  for (const v of px) { const n = (counts.get(v) ?? 0) + 1; counts.set(v, n); if (n > top) top = n; }
  return top / px.length >= BLANK_SHARE;
}

// Pages behind a login whose profile does not allow the judge ("judge": true): their screenshots are never sent to the
// model. vr.sh leaves them out of the judge's list and report.py fails the run if one of them changed.
const privateTargets = resolveTargets(JSON.parse(fs.readFileSync(new URL('./pages.json', import.meta.url)))).filter(t => t.private);
const isPrivate = f => privateTargets.some(t => {
  const prefix = `${t.viewport}__${slug(t.path)}__`;
  return f.startsWith(prefix) && /^\d+\.png$/.test(f.slice(prefix.length));
});

// diff/<file>: where the two screenshots differ, for each same-size changed pair (the HTML report shows it).
fs.rmSync('diff', { recursive: true, force: true });
fs.mkdirSync('diff');

const base = fs.readdirSync('baseline');
const cur = fs.readdirSync('current');
const all = [...new Set([...base, ...cur])].sort();
const changed = [];
const blank = [];
const diffPct = {};   // % of pixels that differ, for screenshots of the same size (the others have no meaningful figure)

for (const f of all) {
  if (!fs.existsSync(`baseline/${f}`) || !fs.existsSync(`current/${f}`)) { changed.push(f); continue; }
  const a = PNG.sync.read(fs.readFileSync(`baseline/${f}`));
  const b = PNG.sync.read(fs.readFileSync(`current/${f}`));
  if (a.width !== b.width || a.height !== b.height) { changed.push(f); if (isBlank(b) && !isBlank(a)) blank.push(f); continue; }
  const diffImage = new PNG({ width: a.width, height: a.height });
  const d = pixelmatch(a.data, b.data, diffImage.data, a.width, a.height, { threshold: 0.1 });
  diffPct[f] = Math.round((d / (a.width * a.height)) * 1000) / 10;
  const wentBlank = isBlank(b) && !isBlank(a);
  if (wentBlank) blank.push(f);
  if (wentBlank || d > MIN_DIFF_PX) {
    changed.push(f);
    fs.writeFileSync(`diff/${f}`, PNG.sync.write(diffImage));
  }
}

fs.writeFileSync('changed.json', JSON.stringify(changed, null, 2));
fs.writeFileSync('blank.json', JSON.stringify(blank, null, 2));
fs.writeFileSync('private.json', JSON.stringify(changed.filter(isPrivate), null, 2));
fs.writeFileSync('diffs.json', JSON.stringify(diffPct, null, 2));
console.log(`${changed.length} changed of ${all.length}${blank.length ? `, ${blank.length} gone blank` : ''}`);
