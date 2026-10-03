#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -d current ] && rm -rf baseline && mv current baseline
OUT=current BASE_URL=$1 node shoot.mjs
node filter.mjs

claude -p "Read rubric.md. For each filename in changed.json, compare \
baseline/<file> against current/<file> and apply the rubric. Print ONLY a \
JSON array as [{file, verdict, severity, findings}] to stdout — no prose, \
no markdown fences." > raw_report.txt

# Model output isn't always fence-free despite instructions — extract the
# JSON array defensively instead of trusting exact compliance.
python3 -c "
import json, re, sys

text = open('raw_report.txt').read()
match = re.search(r'\[.*\]', text, re.DOTALL)
if not match:
    print('No JSON array found in model output:', file=sys.stderr)
    print(text, file=sys.stderr)
    sys.exit(1)

report = json.loads(match.group(0))
json.dump(report, open('report.json', 'w'), indent=2)

worst = max((r.get('severity', 0) for r in report), default=0)
print(f'{len(report)} pages compared, worst severity {worst}')
sys.exit(1 if worst >= 3 else 0)
"
