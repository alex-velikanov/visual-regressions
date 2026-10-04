#!/usr/bin/env bash
# vr.sh --record <base-url>   capture the known-good build as the baseline
# vr.sh --discover <base-url> list linked and sitemap pages that are not in pages.json (changes nothing)
# vr.sh <base-url>            capture the build under test and compare it to the baseline
# The baseline only changes when you --record, so a bad deploy cannot become the new normal.
set -e
cd "$(dirname "$0")"

RECORD=0; DISCOVER=0
if [ "$1" = "--record" ]; then RECORD=1; shift; elif [ "$1" = "--discover" ]; then DISCOVER=1; shift; fi
if [ -z "$1" ]; then
  echo "usage: vr.sh [--record | --discover] <base-url>" >&2
  exit 2
fi
URL=$1

if [ "$DISCOVER" = 1 ]; then
  BASE_URL=$URL exec node discover.mjs
fi

if [ "$RECORD" = 1 ]; then
  trap 'rm -rf baseline.new' EXIT
  rm -rf baseline.new
  OUT=baseline.new BASE_URL=$URL node shoot.mjs
  rm -rf baseline && mv baseline.new baseline
  echo "baseline recorded: $(ls baseline | wc -l | tr -d ' ') screenshots"
  exit 0
fi

if [ -z "$(ls -A baseline 2>/dev/null)" ]; then
  echo "No baseline. Run 'vr.sh --record <base-url>' against the known-good build first." >&2
  exit 2
fi

rm -rf current changed.json blank.json diffs.json report.json warnings.json raw_report.txt raw_report.*.txt recheck.*.txt first.json suspects.json judge.tmp
OUT=current BASE_URL=$URL node shoot.mjs
node filter.mjs

if [ "$(tr -d ' \n' < changed.json)" = "[]" ]; then
  echo "[]" > report.json
  echo "[]" > warnings.json
  echo "0 pages compared, nothing changed"
  exit 0
fi

# Pass 1: the judge gets a few screenshot pairs per call (VR_BATCH, default 6), because on long lists it has been seen
# to skim past obviously broken pages. --tools Read leaves the judge no tool but Read (--allowedTools would only pre-approve
# it), so text inside a screenshot cannot make it run anything. VR_MODEL pins the model.
BATCH=${VR_BATCH:-6}
mkdir judge.tmp
node -e "console.log(require('./changed.json').join('\n'))" | split -l "$BATCH" - judge.tmp/files_
: > raw_report.txt
n=0
for f in judge.tmp/files_*; do
  n=$((n+1))
  list=$(paste -sd' ' "$f")
  claude -p "Read rubric.md. For each of these files: $list -- compare \
baseline/<file> against current/<file> and apply the rubric. Print ONLY a \
JSON array as [{file, verdict, severity, seen, findings}] to stdout — no prose, \
no markdown fences. seen is one short sentence saying what the current page \
shows; write it before you decide the severity. A file present in only one of \
the two folders means a page or section was added or removed: report it." \
    --tools Read ${VR_MODEL:+--model "$VR_MODEL"} > "raw_report.$n.txt"
  { echo "--- batch $n: $list"; cat "raw_report.$n.txt"; } >> raw_report.txt
done
rm -rf judge.tmp

# Pass 2: a file the judge skipped, did not describe, or passed while a good share of its pixels changed is judged
# again on its own, independently. The second opinion can only raise a severity. See report.py for the rules and caps.
python3 report.py merge
n=0
for file in $(python3 report.py suspects); do
  n=$((n+1))
  claude -p "Read rubric.md. Compare baseline/$file against current/$file and apply the rubric. \
Look at both images closely; this is an independent second look. Print ONLY a JSON array with one object \
[{file, verdict, severity, seen, findings}] — no prose, no markdown fences. seen is one short sentence \
saying what the current page shows." \
    --tools Read ${VR_MODEL:+--model "$VR_MODEL"} > "recheck.$n.txt"
done

# Final report: the blank-page guard and warnings (see report.py) are applied here. Exit 1 at severity 3 or above.
python3 report.py final
