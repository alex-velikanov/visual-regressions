// Test stand-in for shoot.mjs: no browser. Copies the PNGs in $SHOTS into $OUT, as a run would produce them.
import fs from 'fs';
fs.mkdirSync(process.env.OUT, { recursive: true });
for (const f of fs.readdirSync(process.env.SHOTS)) {
  fs.copyFileSync(`${process.env.SHOTS}/${f}`, `${process.env.OUT}/${f}`);
}
