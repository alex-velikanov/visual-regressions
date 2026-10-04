// score.mjs <vr dir> [--min-recall 0.85] [--max-fpr 0.15]: compare a vr run's report.json with the labelled cases.
// A case is "flagged" when its report entry has severity >= 3 (what makes vr.sh fail). Exits 1 if the judge
// misses too many broken pages (recall) or flags too many fine ones (false-positive rate).
import fs from 'fs';
import { pathToFileURL } from 'node:url';

export function score(cases, report, changed) {
  const byFile = new Map((Array.isArray(report) ? report : []).map(r => [r.file, r]));
  const rows = cases.map(c => {
    const file = c.file;
    const r = byFile.get(file);
    const flagged = !!r && (r.severity ?? 0) >= 3;
    const reached = changed.includes(file);
    return {
      id: c.id, expected: c.gate, flagged, severity: r?.severity ?? null,
      ok: flagged === c.gate,
      note: !reached ? 'dropped by the pixel filter, never judged' : !r ? 'judged but missing from the report' : '',
      findings: r?.findings ?? [],
    };
  });
  const bad = rows.filter(r => r.expected), fine = rows.filter(r => !r.expected);
  return {
    rows,
    recall: bad.length ? bad.filter(r => r.flagged).length / bad.length : 1,
    fpr: fine.length ? fine.filter(r => r.flagged).length / fine.length : 0,
    missed: bad.filter(r => !r.flagged).map(r => r.id),
    falseAlarms: fine.filter(r => r.flagged).map(r => r.id),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
  const { ORDERED: CASES } = await import('./cases.mjs');
  if (!fs.existsSync(`${dir}/report.json`)) { console.error('no report.json: the vr run failed before judging'); process.exit(1); }
  const report = JSON.parse(fs.readFileSync(`${dir}/report.json`));
  const changed = fs.existsSync(`${dir}/changed.json`) ? JSON.parse(fs.readFileSync(`${dir}/changed.json`)) : [];
  const s = score(CASES, report, changed);
  for (const r of s.rows) {
    console.log(`${r.ok ? 'ok  ' : 'WRONG'} ${r.id.padEnd(18)} expected ${r.expected ? 'flag' : 'quiet'}, got ${r.flagged ? 'flag' : 'quiet'} (severity ${r.severity ?? '-'})${r.note ? '  [' + r.note + ']' : ''}`);
    if (!r.ok) for (const f of r.findings.slice(0, 2)) console.log(`       ${f.what ?? JSON.stringify(f)}`);
  }
  const minRecall = arg('--min-recall', 0.85), maxFpr = arg('--max-fpr', 0.15);
  console.log(`\nrecall ${(s.recall * 100).toFixed(0)}% (broken pages caught; need >= ${minRecall * 100}%)   false alarms ${(s.fpr * 100).toFixed(0)}% (fine pages flagged; need <= ${maxFpr * 100}%)`);
  if (s.missed.length) console.log(`missed: ${s.missed.join(', ')}`);
  if (s.falseAlarms.length) console.log(`false alarms: ${s.falseAlarms.join(', ')}`);
  process.exit(s.recall >= minRecall && s.fpr <= maxFpr ? 0 : 1);
}
