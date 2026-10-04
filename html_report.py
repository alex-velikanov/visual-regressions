#!/usr/bin/env python3
"""Writes report/index.html: every changed screenshot with baseline, current and diff side by side, the judge's
verdict, and the warnings, worst first. Called by vr.sh after report.py. Reads (in the current directory)
changed.json, report.json, warnings.json, diffs.json, baseline/, current/, diff/; copies the images it shows into
report/img/, so the report folder is self-contained (zip it, or upload it as a CI artifact).

Everything the judge wrote, and every file name, is escaped: the judge reads untrusted pages, so its text is untrusted.
The page uses no JavaScript. Environment: VR_REPORT_URL (shown in the header), VR_BATCH etc. are not needed."""
import datetime
import html
import json
import os
import re
import shutil
import sys
from urllib.parse import quote
from report import severity as sev_of, severity_ok

OUT = 'report'
MAX_TEXT = 2000
# A screenshot name is a plain file name made of word characters, dots and hyphens (viewport__page__tile.png).
# Anything else (a path, "..", a leading dot) is never used to read or copy a file.
SAFE_NAME = re.compile(r'^\w[\w.\-]*$')


def safe_name(name):
    return isinstance(name, str) and bool(SAFE_NAME.match(name)) and os.path.basename(name) == name


def load(path, default):
    """The JSON in path, or default if it is missing, unreadable, or not the same kind of value as default."""
    try:
        value = json.load(open(path))
    except (OSError, ValueError):
        return default
    if default is not None and not isinstance(value, type(default)):
        return default
    return value


def e(value):
    return html.escape(str(value)[:MAX_TEXT], quote=True)


def usable(entry):
    """True if the judge gave this file a verdict that can be relied on (not missing, not an unreadable severity)."""
    return bool(entry) and not entry.get('judge_incomplete') and severity_ok(entry)


def label(filename):
    """mobile__pricing__1.png -> 'mobile · pricing · screen 2' (falls back to the file name)."""
    parts = filename.rsplit('.', 1)[0].split('__')
    if len(parts) == 3 and parts[2].isdigit():
        return f'{parts[0]} · {parts[1]} · screen {int(parts[2]) + 1}'
    return filename


def band(severity):
    return 'fail' if severity >= 3 else 'minor' if severity >= 1 else 'ok'


def copy_images(filename):
    """Copy the images that exist for this file into report/img; return {kind: relative url}."""
    found = {}
    if not safe_name(filename):
        return found
    for kind in ('baseline', 'current', 'diff'):
        src = os.path.join(kind, filename)
        if os.path.isfile(src):
            dest_dir = os.path.join(OUT, 'img', kind)
            os.makedirs(dest_dir, exist_ok=True)
            shutil.copy2(src, os.path.join(dest_dir, filename))
            found[kind] = f'img/{kind}/{quote(filename)}'
    return found


def figure(caption, url, alt):
    if not url:
        return f'<figure class="missing"><figcaption>{e(caption)}</figcaption><p>none</p></figure>'
    return (f'<figure><figcaption>{e(caption)}</figcaption>'
            f'<a href="{e(url)}"><img loading="lazy" src="{e(url)}" alt="{e(alt)}"></a></figure>')


def findings_html(findings):
    if not isinstance(findings, list) or not findings:
        return ''
    items = []
    for f in findings:
        if isinstance(f, dict):
            what, where, conf = f.get('what', ''), f.get('where', ''), f.get('confidence', '')
            items.append(f'<li><strong>{e(what)}</strong>'
                         + (f' <span class="where">{e(where)}</span>' if where else '')
                         + (f' <em>({e(conf)} confidence)</em>' if conf else '') + '</li>')
        else:
            items.append(f'<li>{e(f)}</li>')
    return '<ul class="findings">' + ''.join(items) + '</ul>'


def card(n, filename, entry, warns, pct):
    imgs = copy_images(filename)
    sev = sev_of(entry) if entry else None
    ok = usable(entry)
    badge = (f'<span class="badge {band(sev)}">Severity {sev}</span>' if ok
             else '<span class="badge none">No usable verdict</span>')
    parts = [f'<article class="card {band(sev) if ok else "none"}" id="f{n}">',
             f'<header>{badge}<h3>{e(label(filename))}</h3><code>{e(filename)}</code></header>']
    if entry:
        verdict = entry.get('verdict', '')
        if verdict:
            parts.append(f'<p class="meta">Judge verdict: {e(verdict)}</p>')
        if entry.get('seen'):
            parts.append(f'<p class="seen">Judge saw: {e(entry["seen"])}</p>')
        parts.append(findings_html(entry.get('findings')))
        notes = []
        if 'rechecked' in entry:
            first = entry.get('first_severity')
            notes.append(f'Re-checked on its own ({e(entry["rechecked"])}); first severity: {e("none" if first is None else first)}.')
        if 'severity_raw' in entry:
            notes.append(f'The judge wrote an unreadable severity: {e(json.dumps(entry["severity_raw"]))}.')
        if 'judge_severity' in entry:
            said = 'it gave no verdict' if entry['judge_severity'] is None else f'it said {entry["judge_severity"]}'
            notes.append(f'Forced to severity 5 because the page went blank ({e(said)}).')
        for note in notes:
            parts.append(f'<p class="meta">{note}</p>')
    if not ok:
        parts.append('<p class="meta">The judge returned no usable verdict for this file'
                     + (' (its severity could not be read and the re-check did not settle it).' if entry else '.') + '</p>')
    if warns:
        parts.append('<ul class="warn">' + ''.join(f'<li>{e(w)}</li>' for w in warns) + '</ul>')
    if pct is not None:
        parts.append(f'<p class="meta">{e(pct)}% of pixels differ.</p>')
    only = ''
    if not safe_name(filename):
        only = '<p class="meta">Images not shown: unsafe file name.</p>'
    elif 'baseline' not in imgs and 'current' in imgs:
        only = '<p class="meta">Only in the current run: a new page or section.</p>'
    elif 'current' not in imgs and 'baseline' in imgs:
        only = '<p class="meta">Only in the baseline: a page or section is gone.</p>'
    elif 'diff' not in imgs and imgs:
        only = '<p class="meta">The two screenshots differ in size, so there is no pixel diff.</p>'
    parts.append(only)
    parts.append('<div class="shots">' + figure('Baseline', imgs.get('baseline'), f'baseline {filename}')
                 + figure('Current', imgs.get('current'), f'current {filename}')
                 + figure('Diff', imgs.get('diff'), f'diff {filename}') + '</div></article>')
    return ''.join(parts)


CSS = """
:root{--bg:#f6f7f9;--fg:#1c2330;--muted:#5b6575;--card:#fff;--line:#dde1e7;--fail:#b3261e;--minor:#8a5a00;--ok:#1b6e3c;--none:#5b6575;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--fg:#e6e9ef;--muted:#9aa4b2;--card:#1b2029;--line:#2c3441;--fail:#ff8a80;--minor:#e8b04a;--ok:#6fd49a;--none:#9aa4b2;--warn:#e8b04a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:0 auto;padding:16px}h1{margin:0 0 4px;font-size:22px}h2{margin:28px 0 8px;font-size:17px}
.banner{padding:12px 16px;border-radius:8px;border:2px solid var(--line);background:var(--card);margin:12px 0}
.banner.fail{border-color:var(--fail)}.banner.pass{border-color:var(--ok)}.banner strong{font-size:18px}
.banner.review{border-color:var(--warn)}.banner.fail strong{color:var(--fail)}.banner.pass strong{color:var(--ok)}.banner.review strong{color:var(--warn)}
.card{background:var(--card);border:1px solid var(--line);border-left-width:6px;border-radius:8px;padding:12px 14px;margin:12px 0}
.card.fail{border-left-color:var(--fail)}.card.minor{border-left-color:var(--minor)}.card.ok{border-left-color:var(--ok)}.card.none{border-left-color:var(--none)}
.card header{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.card h3{margin:0;font-size:16px}code{color:var(--muted);font-size:12px}
.badge{padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid currentColor}
.badge.fail{color:var(--fail)}.badge.minor{color:var(--minor)}.badge.ok{color:var(--ok)}.badge.none{color:var(--none)}
.meta,.seen{margin:6px 0;color:var(--muted)}.seen{color:var(--fg)}.findings{margin:6px 0;padding-left:20px}.where{color:var(--muted)}
.warn{margin:6px 0;padding:6px 10px 6px 28px;border:1px solid var(--warn);border-radius:6px;color:var(--warn)}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
figure{margin:0;min-width:0}figcaption{font-size:12px;color:var(--muted);margin-bottom:4px}
img{display:block;max-width:100%;height:auto;border:1px solid var(--line);background:#fff}figure.missing p{color:var(--muted);margin:0}
details summary{cursor:pointer;margin:12px 0;font-weight:600}
@media (max-width:800px){.shots{grid-template-columns:1fr}}
"""


def main():
    changed = [f for f in load('changed.json', []) if isinstance(f, str)]
    report = load('report.json', [])
    has_report = os.path.exists('report.json') and isinstance(load('report.json', None), list)
    warnings = load('warnings.json', [])
    diffs = load('diffs.json', {})
    # The judge's file names are untrusted: keep only verdicts for files that were actually compared.
    compared = set(changed)
    entries = {r['file']: r for r in report
               if isinstance(r, dict) and isinstance(r.get('file'), str) and r['file'] in compared}
    ignored = len(report) - len(entries)
    warn_by_file = {}
    for w in warnings if isinstance(warnings, list) else []:
        if isinstance(w, dict):
            warn_by_file.setdefault(w.get('file'), []).append(w.get('warning', ''))

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)

    files = sorted(compared, key=lambda f: (-sev_of(entries[f]) if f in entries else 0, f))
    failed = [f for f in files if f in entries and sev_of(entries[f]) >= 3]
    look = [f for f in files if f not in failed and (f in warn_by_file or not usable(entries.get(f)))]
    other = [f for f in files if f not in failed and f not in look]

    unjudged = [f for f in files if not usable(entries.get(f))]
    if not has_report:
        banner = '<div class="banner"><strong>No report</strong> The run stopped before the judge\'s verdicts were merged. See raw_report.txt.</div>'
    elif failed:
        worst = max(sev_of(entries[f]) for f in failed)
        more = f' {len(unjudged)} have no usable verdict from the judge.' if unjudged else ''
        banner = f'<div class="banner fail"><strong>FAIL</strong> {len(failed)} of {len(files)} changed screenshots at severity 3 or above (worst: {worst}).{more}</div>'
    elif unjudged:
        banner = (f'<div class="banner review"><strong>INCOMPLETE</strong> {len(unjudged)} of {len(files)} changed screenshots '
                  'have no usable verdict from the judge, so this run cannot be called a pass.</div>')
    elif files:
        banner = f'<div class="banner pass"><strong>PASS</strong> {len(files)} changed screenshots, none at severity 3 or above.</div>'
    else:
        banner = '<div class="banner pass"><strong>PASS</strong> Nothing changed.</div>'

    counter = iter(range(1, 10 ** 6))

    def section(title, names, wrap_details=False):
        if not names:
            return ''
        cards = ''.join(card(next(counter), f, entries.get(f), warn_by_file.get(f, []), diffs.get(f)) for f in names)
        if wrap_details:
            return f'<details><summary>{e(title)} ({len(names)})</summary>{cards}</details>'
        return f'<h2>{e(title)} ({len(names)})</h2>{cards}'

    when = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    url = os.environ.get('VR_REPORT_URL', '')
    body = (f'<h1>Visual regression report</h1><p class="meta">{e(when)}' + (f' · {e(url)}' if url else '') + '</p>'
            + banner
            + (f'<p class="meta">Ignored {ignored} judge entries for files that were not compared.</p>' if ignored and has_report else '')
            + section('Failed', failed)
            + section('Needs a look', look)
            + section('Other changes', other, wrap_details=True))
    page = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>vr report</title><style>{CSS}</style></head><body><main>{body}</main></body></html>')
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as fh:
        fh.write(page)
    print(f'report: {OUT}/index.html ({len(failed)} failed, {len(look)} need a look, {len(other)} other)')


if __name__ == '__main__':
    if len(sys.argv) > 1:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    main()
