#!/usr/bin/env python3
"""Turns the judge's raw replies into report.json and warnings.json. Called by vr.sh in three steps:
  report.py merge     read raw_report.N.txt (first pass), add a failing entry for each changed page the judge may not see
                      (private.json), apply the blank-page guard, write first.json and suspects.json.
                      If a reply holds no JSON array it writes judge_errors.json instead and exits 1
  report.py suspects  print the files that deserve an independent second look, one per line
  report.py final     fold in recheck.N.txt (one per suspect, same order), write report.json and warnings.json, exit 1 at severity >= 3

A file is a suspect when the judge gave no verdict for it, did not say what it saw ("seen"), or passed it
(severity < 3) while VR_RECHECK_DIFF_PCT (default 5) % or more of its pixels differ. At most VR_RECHECK_MAX (default 12)
are re-judged, to bound the cost; the rest get a warning. The second opinion can only raise a severity, never lower it.
Separately, a page that went blank always fails, and a page still passed with VR_WARN_DIFF_PCT (default 50) % or more
of its pixels differing gets a warning. Warnings never change the exit code.
"""
import glob, json, os, re, sys

DEC = json.JSONDecoder()
MAX_REPLY = 20000        # how much of an unreadable judge reply is kept for the HTML report
PRIVATE_NOTE = {'what': 'This page is behind a login and is not sent to the judge, so nothing has checked what changed. Compare the images yourself, then re-record if the change is intended.',
                'where': 'entire page', 'confidence': 'high'}
FIRST_NOTE = {'what': 'The page is blank (one flat colour) where the baseline was not.', 'where': 'entire page', 'confidence': 'high'}


def num(name, default):
    return float(os.environ.get(name, default))


def parse(text):
    """The first JSON array of objects in text, or None. Prose may hold brackets ("[2 pages]"), so try each "[" in turn."""
    found = None
    for m in re.finditer(r'\[', text):
        try:
            obj, _ = DEC.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(obj, list) and all(isinstance(r, dict) for r in obj):
            if obj or found is None:
                found = obj
            if obj:
                break
    return found


def numbered(pattern, rx):
    return sorted(glob.glob(pattern), key=lambda p: int(re.search(rx, p).group(1)))


def load(path, default=None):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return default


def parse_severity(value):
    """The judge's severity as a number from 0 to 5 (a numeric string like "3.0" is fine), or None if it is unreadable."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if 0 <= number <= 5 else None


def severity_ok(record):
    return parse_severity(record.get('severity')) is not None


def severity(record):
    number = parse_severity(record.get('severity'))
    return 0 if number is None else int(number)


def merge():
    try:
        os.remove('judge_errors.json')
    except FileNotFoundError:
        pass
    report = []
    errors = []
    for path in numbered('raw_report.*.txt', r'\.(\d+)\.txt$'):
        text = open(path).read()
        part = parse(text)
        if part is None:
            print(f'No JSON array found in model output ({path}):', file=sys.stderr)
            print(text, file=sys.stderr)
            errors.append({'file': path, 'reply': text[:MAX_REPLY]})
            continue
        report += part
    if errors:
        # Nothing usable to merge: keep the replies for the HTML report (which vr.sh still writes) and stop with exit 1.
        json.dump(errors, open('judge_errors.json', 'w'), indent=2)
        sys.exit(1)
    by_file = {}
    for r in report:
        if not severity_ok(r):
            r['severity_raw'] = r.get('severity')   # kept for the report; the file is re-judged below
            r['severity'] = 0
            r['judge_incomplete'] = True            # no usable verdict yet: a usable re-check (or a blank page) clears this
        else:
            r['severity'] = severity(r)
            r['judge_incomplete'] = False
        by_file.setdefault(r.get('file'), r)
    report = list(by_file.values())

    # A changed page the judge may not see (private.json) fails the run: nothing else can vouch for it.
    private = [f for f in load('private.json', []) if isinstance(f, str)]
    report = [r for r in report if r.get('file') not in private]
    for f in private:
        r = {'file': f, 'verdict': 'fail', 'severity': 3, 'findings': [PRIVATE_NOTE], 'judge_skipped': True, 'judge_incomplete': False}
        report.append(r)
        by_file[f] = r

    blank = load('blank.json', [])
    for f in blank:
        r = by_file.get(f)
        if r is None:
            r = {'file': f, 'verdict': 'fail', 'severity': 5, 'findings': [], 'judge_severity': None, 'judge_incomplete': False}
            report.append(r)
            by_file[f] = r
        elif r.get('severity', 0) < 5:
            r['judge_severity'] = r.get('severity', 0)
            r['verdict'], r['severity'] = 'fail', 5
            r['judge_incomplete'] = False             # a blank page fails whatever the judge said
        else:
            continue
        r['findings'] = (r['findings'] if isinstance(r.get('findings'), list) else []) + [FIRST_NOTE]

    diffs = load('diffs.json', {})
    recheck_pct = num('VR_RECHECK_DIFF_PCT', 5)
    suspects = []
    for f in load('changed.json', []):
        if f in blank or f in private:
            continue
        r = by_file.get(f)
        sev = (r or {}).get('severity', 0) or 0
        if r is None:
            reason = 'the judge returned no verdict'
        elif 'severity_raw' in r:
            reason = f"the judge gave an unreadable severity ({json.dumps(r['severity_raw'])})"
        elif not (isinstance(r.get('seen'), str) and r['seen'].strip()):
            reason = 'the judge did not say what it saw'
        elif sev < 3 and diffs.get(f, 0) >= recheck_pct:
            reason = f'{diffs[f]}% of pixels differ but the judge gave severity {sev}'
        else:
            continue
        suspects.append({'file': f, 'reason': reason})
    json.dump(report, open('first.json', 'w'), indent=2)
    json.dump(suspects, open('suspects.json', 'w'), indent=2)


def suspect_files():
    cap = int(num('VR_RECHECK_MAX', 12))
    return [s['file'] for s in load('suspects.json', [])][:cap]


def final():
    report = load('first.json', [])
    by_file = {r.get('file'): r for r in report}
    suspects = load('suspects.json', [])
    cap = int(num('VR_RECHECK_MAX', 12))
    warnings = []

    for i, s in enumerate(suspects):
        f = s['file']
        if i >= cap:
            warnings.append({'file': f, 'warning': f"Not re-checked ({s['reason']}); more than VR_RECHECK_MAX={cap} files needed it."})
            continue
        path = f'recheck.{i + 1}.txt'
        part = parse(open(path).read()) if os.path.exists(path) else None
        second = next((r for r in (part or []) if r.get('file') == f), None)
        if second is None:
            warnings.append({'file': f, 'warning': f"The independent re-check returned nothing usable ({s['reason']})."})
            continue
        first = by_file.get(f)
        second_ok = severity_ok(second)
        if second_ok:
            second['severity'] = sev2 = severity(second)
        else:
            warnings.append({'file': f, 'warning': f"The re-check gave an unreadable severity ({json.dumps(second.get('severity'))}); it was ignored."})
            second['severity'] = sev2 = 0
        if first is None:
            first = {'file': f, 'verdict': second.get('verdict', 'pass'), 'severity': sev2, 'findings': [],
                     'judge_incomplete': not second_ok}
            report.append(first)
            by_file[f] = first
            first['first_severity'] = None
        else:
            first['first_severity'] = None if 'severity_raw' in first else first.get('severity', 0)
        first['rechecked'] = s['reason']
        if second_ok:
            if first.get('judge_incomplete') or sev2 > (first.get('severity', 0) or 0):
                first['severity'], first['verdict'] = sev2, second.get('verdict', 'fail')
            first['judge_incomplete'] = False         # a usable second opinion completes the verdict
        if isinstance(second.get('findings'), list):
            first['findings'] = (first['findings'] if isinstance(first.get('findings'), list) else []) + second['findings']
        if second.get('seen') and not first.get('seen'):
            first['seen'] = second['seen']

    warn_pct = num('VR_WARN_DIFF_PCT', 50)
    diffs = load('diffs.json', {})
    already = {w['file'] for w in warnings}
    for f in load('changed.json', []):
        r = by_file.get(f)
        if f in already:
            continue
        if r is None:
            warnings.append({'file': f, 'warning': 'The judge returned no verdict for this file.'})
        elif (r.get('severity', 0) or 0) < 3 and diffs.get(f, 0) >= warn_pct:
            warnings.append({'file': f, 'warning': f"{diffs[f]}% of pixels differ but the judge gave severity {r.get('severity', 0)}. Look at it yourself."})

    json.dump(report, open('report.json', 'w'), indent=2)
    json.dump(warnings, open('warnings.json', 'w'), indent=2)
    worst = max((r.get('severity', 0) or 0 for r in report), default=0)
    rechecked = sum(1 for r in report if 'rechecked' in r)
    print(f'{len(report)} pages compared, worst severity {worst}' + (f', {rechecked} re-checked' if rechecked else ''))
    for w in warnings:
        print(f"WARNING {w['file']}: {w['warning']}")
    sys.exit(1 if worst >= 3 else 0)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'merge':
        merge()
    elif mode == 'suspects':
        print('\n'.join(suspect_files()))
    elif mode == 'final':
        final()
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
