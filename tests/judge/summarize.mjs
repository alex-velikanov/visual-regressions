// summarize.mjs <out dir>: per-case severities across the runs kept by repeat.sh.
import fs from 'fs';
import { ORDERED } from './cases.mjs';

const out = process.argv[2];
const runs = fs.readdirSync(out).filter(d => /^run\d+$/.test(d)).sort((a, b) => a.slice(3) - b.slice(3));
// judge-only severity: what the model said before the blank-page guard overrode it
const reports = runs.map(r => {
  try { return new Map(JSON.parse(fs.readFileSync(`${out}/${r}/vr/report.json`)).map(x => [x.file, x.judge_severity === undefined ? (x.severity ?? 0) : (x.judge_severity ?? 0)])); } catch { return null; }
});
const warned = runs.map(r => {
  try { return new Set(JSON.parse(fs.readFileSync(`${out}/${r}/vr/warnings.json`)).map(x => x.file)); } catch { return new Set(); }
});
const finalSev = runs.map(r => {
  try { return new Map(JSON.parse(fs.readFileSync(`${out}/${r}/vr/report.json`)).map(x => [x.file, x.severity ?? 0])); } catch { return new Map(); }
});
const failed = runs.filter((_, i) => !reports[i]);
console.log(`${runs.length} runs, ${failed.length} without a report${failed.length ? ' (' + failed.join(', ') + ')' : ''}`);
for (const r of failed) {
  const raw = `${out}/${r}/vr/raw_report.txt`;
  console.log(`  ${r}: ${fs.existsSync(raw) ? JSON.stringify(fs.readFileSync(raw, 'utf8').slice(0, 300)) : 'no raw reply (the run died before judging)'}`);
}
console.log('\ncase               expected  judge severity per run               judge flags   with guards+warnings');
const rows = ORDERED.map(c => {
  const sev = reports.map(m => (m ? (m.has(c.file) ? m.get(c.file) : '-') : 'x'));
  const judged = sev.filter(s => s !== 'x');
  const flagged = judged.filter(s => s !== '-' && s >= 3).length;
  // caught overall: final severity >= 3 (judge or blank guard) or a warning on that file
  const caught = runs.filter((_, i) => reports[i] && ((finalSev[i].get(c.file) ?? 0) >= 3 || warned[i].has(c.file))).length;
  return { c, sev, flagged, judged: judged.length, caught };
});
for (const { c, sev, flagged, judged, caught } of rows.sort((a, b) => b.c.gate - a.c.gate || a.c.id.localeCompare(b.c.id))) {
  const wrong = c.gate ? judged - flagged : flagged;
  const wrongAll = c.gate ? judged - caught : caught;
  console.log(`${c.id.padEnd(18)} ${(c.gate ? 'flag' : 'quiet').padEnd(9)} ${sev.join(' ').padEnd(37)} ${`${flagged}/${judged}`.padEnd(5)}${wrong ? ` <- ${wrong} wrong` : '        '}   ${caught}/${judged}${wrongAll ? ` <- ${wrongAll} wrong` : ''}`);
}
console.log('\n"with guards+warnings" counts a run as caught if the final severity is >= 3 (judge or blank guard) or the page got a warning.');
console.log('x = run had no report, - = case absent from the report (never judged, or dropped as identical)');
