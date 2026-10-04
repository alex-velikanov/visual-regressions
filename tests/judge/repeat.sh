#!/usr/bin/env bash
# repeat.sh <runs> <out dir>: run the judge calibration several times and keep everything: each run's raw model reply
# (runN/vr/raw_report.txt), report.json, changed.json and score.txt, then print how often each case is flagged.
# Uses plan tokens: about 1.5 minutes and one `claude -p` call per run. env: VR_MODEL, CHROMIUM_PATH as for run.sh.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; VRSRC="$HERE/../../../modules/web/root/vr"
N="${1:?usage: repeat.sh <runs> <out dir>}"; OUT="$(mkdir -p "${2:?usage: repeat.sh <runs> <out dir>}" && cd "$2" && pwd)"
mkdir -p "$OUT/deps"; cp "$VRSRC/package.json" "$OUT/deps/"
(cd "$OUT/deps" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund >/dev/null 2>&1)
for i in $(seq 1 "$N"); do
  W="$OUT/run$i"; mkdir -p "$W"; ln -sfn "$OUT/deps/node_modules" "$W/node_modules"
  "$HERE/run.sh" "$W" >"$W/score.txt" 2>&1 || true
  echo "run $i: $(grep -E '^recall' "$W/score.txt" || echo 'no score (see run'"$i"'/score.txt)')"
done
echo; (cd "$HERE" && node summarize.mjs "$OUT")
