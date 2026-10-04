#!/usr/bin/env bash
# Runs the REAL vr pipeline (pixel filter, claude -p, report parsing) over the labelled calibration cases and scores it.
# Only shoot.mjs is replaced (the pages are rendered from local HTML, no site needed). Uses plan tokens.
#   run.sh <scratch dir>        env: VR_MODEL to pin a model, CHROMIUM_PATH if Playwright has no browser installed
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; VRSRC="$HERE/../../../modules/web/root/vr"
W="$1"; mkdir -p "$W/vr/shots"
if [ ! -d "$W/node_modules" ]; then
  cp "$VRSRC/package.json" "$W/"; (cd "$W" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund >/dev/null 2>&1)
fi
cp "$VRSRC"/{vr.sh,filter.mjs,config.mjs,report.py,rubric.md,pages.json} "$W/vr/"; cp "$HERE/../stub-shoot.mjs" "$W/vr/shoot.mjs"
cp "$HERE"/{pages,cases,make-pairs,score}.mjs "$W/vr/"; ln -sfn "$W/node_modules" "$W/vr/node_modules"
cd "$W/vr"
rm -rf baseline current shots/* changed.json blank.json diffs.json report.json warnings.json raw_report.txt raw_report.*.txt
node make-pairs.mjs baseline shots
SHOTS="$W/vr/shots" ./vr.sh http://stub || true     # exit 1 is expected: the broken pages fail the gate
node score.mjs . "${@:2}"
