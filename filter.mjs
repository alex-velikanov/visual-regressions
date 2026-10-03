import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'fs';

const all = fs.readdirSync('baseline');
const changed = [];

for (const f of all) {
  if (!fs.existsSync(`current/${f}`)) { changed.push(f); continue; }
  const a = PNG.sync.read(fs.readFileSync(`baseline/${f}`));
  const b = PNG.sync.read(fs.readFileSync(`current/${f}`));
  if (a.width !== b.width || a.height !== b.height) { changed.push(f); continue; }
  const d = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  if (d > a.width * a.height * 0.001) changed.push(f);
}

fs.writeFileSync('changed.json', JSON.stringify(changed, null, 2));
console.log(`${changed.length} changed of ${all.length}`);
