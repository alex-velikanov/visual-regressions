// Test helper: png.mjs <out.png> <width> <height> [x,y,w,h]
// Writes a solid white PNG, with an optional black rectangle.
import { PNG } from 'pngjs';
import fs from 'fs';

const [out, w, h, rect] = process.argv.slice(2);
const png = new PNG({ width: +w, height: +h });
png.data.fill(255);
if (rect) {
  const [rx, ry, rw, rh] = rect.split(',').map(Number);
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * +w + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
    }
  }
}
fs.writeFileSync(out, PNG.sync.write(png));
