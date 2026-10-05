#!/usr/bin/env bash
# Tests for vr.
#
#   ./test.sh            fast tier: seconds, no browser, no model. The pixel filter, baseline rotation, report parsing and exit
#                        code, pages.json rules, logins, --discover link rules and the whole pipeline with shoot.mjs and claude
#                        stubbed. Runs in CI on every push.
#   ./test.sh browser    the vr scripts in a real headless Chromium against a tiny local site: screenshot sizes and tiles, HTTP
#                        errors, tile limit, waitFor, mask, animations, logins, interaction states, --discover, and vr.sh end to
#                        end (stub judge, no model). Needs node and a Chromium (set VR_CHROMIUM, or npx playwright install
#                        chromium); skips itself with a message if there is none. ~90 seconds. Runs in CI.
#   ./test.sh judge      calibrate the judge: the real `claude -p` over labelled before/after pages (needs claude, node and a
#                        Chromium; ~2 minutes; uses plan tokens). Fails if it misses broken pages or flags fine ones.
#   Flags: --keep        keep the temp directory
set -uo pipefail
unset VR_DATA      # a caller's VR_DATA may be a real project's data folder, and the fixtures' --record would replace its baseline
ROOT="$(cd "$(dirname "$0")" && pwd)"
TIER=fast; KEEP=0
for a in "$@"; do case "$a" in
  fast|judge|browser) TIER="$a" ;; --keep) KEEP=1 ;;
  *) echo "unknown argument: $a" >&2; exit 2 ;; esac; done

WORK="$(mktemp -d)"
FAILS=0; PASSES=0
pass() { printf '  PASS  %s\n' "$1"; PASSES=$((PASSES+1)); }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS+1)); }
skip() { printf '  SKIP  %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
check() { local name="$1"; shift; if "$@" >"$WORK/last.log" 2>&1; then pass "$name"; else fail "$name"; tail -15 "$WORK/last.log" | sed 's/^/        /'; fi; }
free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

cleanup() { if [ "$KEEP" = 1 ]; then echo "kept: $WORK"; else rm -rf "$WORK"; fi; }
trap cleanup EXIT

# ============================================================ FAST TIER
echo "== fast: syntax =="
for f in "$ROOT/vr.sh" "$ROOT/test.sh" "$ROOT/tests/judge/run.sh" "$ROOT/tests/judge/repeat.sh"; do
  check "bash -n ${f#$ROOT/}" bash -n "$f"
done
if have node; then
  for f in "$ROOT"/*.mjs "$ROOT"/tests/*.mjs "$ROOT"/tests/site/*.mjs; do check "node --check ${f#$ROOT/}" node --check "$f"; done
else skip "node not installed: .mjs syntax checks"; fi

echo; echo "== fast: the tool =="
VRSRC="$ROOT"; VRT="$ROOT/tests"
check "judge severity normalization in merge and re-check" python3 "$VRT/report.test.py" "$VRSRC"
check "html_report.py: sections, images, escaping, odd input, re-runs" python3 "$VRT/html_report.test.py" "$VRSRC"
for f in report.py html_report.py; do check "python syntax: $f" python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$VRSRC/$f"; done
if ! have node || ! have npm; then skip "node/npm not installed: vr tests"
else
  check "pages.json: viewports, per-page options, file names, validation (config.mjs)" node "$VRT/config.test.mjs" "$VRSRC"
  check "logins: sessions, their permissions, credentials from the environment, no secret in errors (auth.mjs)" node "$VRT/auth.test.mjs" "$VRSRC"
  check "judge calibration: scoring and case labels (judge/score.mjs)" node "$VRT/judge/score.test.mjs"
  check "--discover link rules: normalising, skips, sitemap, new paths (links.mjs)"      node "$VRT/links.test.mjs" "$VRSRC"
  check "the shipped pages.json resolves to desktop, tablet and mobile for /" bash -c "cd '$VRSRC' && node -e \"import('./config.mjs').then(m=>{const t=m.resolveTargets(JSON.parse(require('fs').readFileSync('pages.json')));if(t.map(x=>x.viewport).join()!=='desktop,tablet,mobile')process.exit(1)})\""
  VRDEPS="$WORK/vr-deps"; mkdir -p "$VRDEPS"; cp "$VRSRC/package.json" "$VRDEPS/"
  if (cd "$VRDEPS" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund >"$WORK/npm.log" 2>&1); then
    pass "vr dependencies install (playwright, pixelmatch, pngjs)"
    check "vr dependencies import" bash -c "cd '$VRDEPS' && node -e \"import('pngjs').then(()=>import('pixelmatch')).then(()=>import('playwright'))\""

    vrdir() {  # vrdir <name>: a fresh copy of the vr tool with shoot.mjs and claude stubbed; prints its path
      local d="$WORK/vr-$1"; mkdir -p "$d/shots" "$d/bin"
      cp "$VRSRC"/{vr.sh,filter.mjs,config.mjs,links.mjs,paths.mjs,report.py,html_report.py,rubric.md,pages.json} "$d/"; cp "$VRT/stub-shoot.mjs" "$d/shoot.mjs"; cp "$VRT/png.mjs" "$d/"
      cp "$VRT/claude" "$d/bin/"; ln -s "$VRDEPS/node_modules" "$d/node_modules"; echo '[]' > "$d/claude.out"
      echo "$d"
    }
    png() { (cd "$1" && node png.mjs "${@:2}"); }   # png <dir> <out> <w> <h> [x,y,w,h]
    changed_of() { (cd "$1" && node filter.mjs >/dev/null 2>&1 && python3 -c "import json; print(' '.join(sorted(json.load(open('changed.json')))))"); }
    vrrun() { (cd "$1" && SHOTS="$1/shots" CLAUDE_STUB_LOG="$1/claude.log" CLAUDE_STUB_OUT="$1/claude.out" PATH="$1/bin:$PATH" ./vr.sh http://stub); }

    echo "-- filter.mjs: which screenshots count as changed (threshold: more than 50 differing pixels)"
    F="$(vrdir filter)"; mkdir -p "$F/baseline" "$F/current"
    for n in same noise tiny big gone resized; do png "$F" "baseline/$n.png" 1000 1000; done
    png "$F" current/same.png    1000 1000
    png "$F" current/noise.png   1000 1000 10,10,5,8        # 40 px differ: under the threshold
    png "$F" current/tiny.png    1000 1000 10,10,10,10      # 100 px differ: a small element gone, on a 1,000,000 px image
    png "$F" current/big.png     1000 1000 100,100,100,100  # 10,000 px differ
    png "$F" current/resized.png 1000 1200                  # page got taller
    png "$F" current/extra.png   1000 1000                  # exists only in current/ (new page or new tile)
    png "$F" baseline/wentblank.png 1000 1000 100,100,300,300; png "$F" current/wentblank.png 1000 1000      # real page -> flat white
    png "$F" baseline/stillblank.png 1000 1000;                png "$F" current/stillblank.png 1000 1000 10,10,12,12   # was already blank
    png "$F" baseline/huge.png 1000 1000;                      png "$F" current/huge.png 1000 1000 0,0,1000,600       # 60% of the page differs
    CH=" $(changed_of "$F") "
    check "identical image is unchanged"                     bash -c "! echo '$CH' | grep -q ' same.png '"
    check "a difference of 40 px is ignored as noise"        bash -c "! echo '$CH' | grep -q ' noise.png '"
    check "a small real change (100 px) is caught"           bash -c "echo '$CH' | grep -q ' tiny.png '"
    check "a large difference is changed"                    bash -c "echo '$CH' | grep -q ' big.png '"
    check "an image missing from current/ is changed"        bash -c "echo '$CH' | grep -q ' gone.png '"
    check "an image only in current/ is changed (new page or tile)" bash -c "echo '$CH' | grep -q ' extra.png '"
    check "a size mismatch is changed"                       bash -c "echo '$CH' | grep -q ' resized.png '"
    check "a page that went flat/blank is listed in blank.json" bash -c "python3 -c \"import json; assert json.load(open('$F/blank.json'))==['wentblank.png'], open('$F/blank.json').read()\""
    check "a page that was already blank, or just changed a lot, is not" bash -c "echo '$CH' | grep -q ' stillblank.png ' && ! grep -q 'stillblank\|big.png' '$F/blank.json'"
    check "diffs.json gives the % of pixels that differ (huge ~60, big ~1, same 0)" bash -c "python3 -c \"import json; d=json.load(open('$F/diffs.json')); assert abs(d['huge.png']-60)<0.2 and abs(d['big.png']-1)<0.2 and d['same.png']==0, d\""
    check "diffs.json has no figure for size mismatches or one-sided files" bash -c "python3 -c \"import json; d=json.load(open('$F/diffs.json')); assert 'resized.png' not in d and 'extra.png' not in d and 'gone.png' not in d, d\""
    check "VR_MIN_DIFF_PX overrides the threshold"           bash -c "cd '$F' && VR_MIN_DIFF_PX=10 node filter.mjs >/dev/null && grep -q noise.png changed.json"

    pngdims() { python3 -c "import struct,sys; d=open(sys.argv[1],'rb').read(); assert d[:8]==b'\\x89PNG\\r\\n\\x1a\\n'; print(*struct.unpack('>II', d[16:24]))" "$1"; }
    red_pixels() { (cd "$F" && node -e "const {PNG}=require('pngjs'); const p=PNG.sync.read(require('fs').readFileSync('diff/'+process.argv[1])); let n=0; for(let i=0;i<p.data.length;i+=4) if(p.data[i]===255&&p.data[i+1]===0&&p.data[i+2]===0) n++; console.log(n)" "$1"); }
    mkdir -p "$F/diff"; echo stale > "$F/diff/stale.png"; (cd "$F" && node filter.mjs >/dev/null)
    check "diff/ holds a valid PNG of the same size for each changed same-size pair" bash -c "[ \"\$($(declare -f pngdims) ; pngdims '$F/diff/big.png')\" = '1000 1000' ] && [ \"\$($(declare -f pngdims) ; pngdims '$F/diff/huge.png')\" = '1000 1000' ]"
    check "the diff image marks the differing pixels (big: about 10,000)" bash -c "n=\$($(declare -f red_pixels); F='$F'; red_pixels big.png); [ \"\$n\" -gt 5000 ] && [ \"\$n\" -lt 15000 ]"
    check "no diff image for unchanged, noise-level, resized or one-sided files" bash -c "cd '$F/diff' && [ ! -e same.png ] && [ ! -e noise.png ] && [ ! -e resized.png ] && [ ! -e gone.png ] && [ ! -e extra.png ]"
    check "diff/ is rebuilt on every run (stale files are removed)" test ! -e "$F/diff/stale.png"

    invalid_threshold() {
      local value
      for value in nonsense NaN Infinity -Infinity -1; do
        if (cd "$F" && VR_MIN_DIFF_PX="$value" node filter.mjs >"$WORK/filter.out" 2>&1); then return 1; fi
        grep -q 'VR_MIN_DIFF_PX must be finite and non-negative' "$WORK/filter.out" || return 1
      done
    }
    check "invalid pixel thresholds fail with a clear error" invalid_threshold
    check "zero is a valid pixel threshold" bash -c "cd '$F' && VR_MIN_DIFF_PX=0 node filter.mjs >/dev/null && grep -q noise.png changed.json"
    check "blank pages bypass even a threshold above the whole image size" bash -c "cd '$F' && VR_MIN_DIFF_PX=1000001 node filter.mjs >/dev/null && python3 -c \"import json; assert 'wentblank.png' in json.load(open('changed.json')); assert json.load(open('blank.json'))==['wentblank.png']; assert 'big.png' not in json.load(open('changed.json'))\""

    echo "-- vr.sh: record, compare, baseline safety, report parsing, exit code"
    R="$(vrdir run)"
    reset() { rm -rf "$R/diff" "$R/report" "$R/baseline" "$R/current" "$R/baseline.new" "$R/baseline.copy" "$R/changed.json" "$R/report.json" "$R/raw_report.txt" "$R/claude.log" "$R/claude.log.calls" "$R/claude.out".[0-9]* "$R/blank.json" "$R/diffs.json" "$R/warnings.json" "$R/raw_report".*.txt "$R/shots"/*; }
    reset; png "$R" shots/home__0.png 1000 1000
    (cd "$R" && SHOTS="$R/shots" PATH="$R/bin:$PATH" ./vr.sh --record http://stub >"$WORK/vr.out" 2>&1)
    check "--record writes the baseline"                     bash -c "test -f '$R/baseline/home__0.png' && grep -q 'baseline recorded: 1' '$WORK/vr.out'"
    check "--record leaves no temp folder behind"            test ! -e "$R/baseline.new"
    check "--record does not call the model"                 test ! -e "$R/claude.log"

    bad_shots() { png "$R" shots/home__0.png 1000 1000 100,100,100,100; }   # the "broken deploy"
    reset; png "$R" shots/home__0.png 1000 1000; (cd "$R" && SHOTS="$R/shots" ./vr.sh --record http://stub >/dev/null 2>&1)
    cp "$R/baseline/home__0.png" "$R/baseline.copy"
    bad_shots; echo '[{"file":"home__0.png","severity":4}]' > "$R/claude.out"
    vrrun "$R" >/dev/null 2>&1; first=$?; vrrun "$R" >/dev/null 2>&1; second=$?
    check "a broken build fails the compare"                 test "$first" = 1
    check "re-running does NOT make the broken build the baseline" test "$second" = 1
    check "the baseline is untouched by compare runs"        bash -c "cmp -s '$R/baseline/home__0.png' '$R/baseline.copy' && ! cmp -s '$R/baseline/home__0.png' '$R/current/home__0.png'"
    check "--record again accepts the new build"             bash -c "cd '$R' && SHOTS='$R/shots' ./vr.sh --record http://stub >/dev/null 2>&1 && cmp -s baseline/home__0.png shots/home__0.png"

    reset
    rc=0; (cd "$R" && SHOTS="$R/shots" PATH="$R/bin:$PATH" ./vr.sh http://stub >"$WORK/vr.out" 2>&1) || rc=$?
    check "with no baseline it exits 2 and says to --record" bash -c "[ $rc = 2 ] && grep -q 'vr.sh --record' '$WORK/vr.out'"
    rc=0; (cd "$R" && ./vr.sh >"$WORK/vr.out" 2>&1) || rc=$?
    check "with no URL it prints usage and exits 2"          bash -c "[ $rc = 2 ] && grep -q usage '$WORK/vr.out'"
    rc=0; (cd "$R" && ./vr.sh --discover >"$WORK/vr.out" 2>&1) || rc=$?
    check "--discover with no URL prints usage and exits 2"  bash -c "[ $rc = 2 ] && grep -q 'discover' '$WORK/vr.out'"

    reset; png "$R" shots/home__0.png 1000 1000; (cd "$R" && SHOTS="$R/shots" ./vr.sh --record http://stub >/dev/null 2>&1)
    rc=0; (cd "$R" && SHOTS="$R/nonexistent" ./vr.sh --record http://stub >/dev/null 2>&1) || rc=$?
    check "a failed --record keeps the old baseline"         bash -c "[ $rc != 0 ] && test -f '$R/baseline/home__0.png' && test ! -e '$R/baseline.new'"

    # a baseline exists (home__0 plain); the build under test is given by shots/
    prep() { reset; mkdir -p "$R/baseline"; png "$R" baseline/home__0.png 1000 1000; png "$R" shots/home__0.png 1000 1000 100,100,100,100; }
    run_with() { prep; printf '%s' "$1" > "$R/claude.out"; vrrun "$R" >"$WORK/vr.out" 2>&1; echo $?; }
    sev() { printf '[{"file":"home__0.png","verdict":"x","severity":%s,"seen":"s","findings":[]}]' "$1"; }
    nothing_changed() {
      reset; mkdir -p "$R/baseline"; png "$R" baseline/home__0.png 1000 1000; png "$R" shots/home__0.png 1000 1000
      vrrun "$R" >"$WORK/vr.out" 2>&1 && grep -q 'nothing changed' "$WORK/vr.out" && [ ! -e "$R/claude.log" ] && [ "$(cat "$R/report.json")" = "[]" ]
    }
    check "nothing changed: passes without calling the model" nothing_changed
    check "the model is pointed at rubric.md and the changed files" bash -c "[ \"$(run_with '[]')\" = 0 ] && grep -q 'rubric.md' '$R/claude.log' && grep -q 'home__0.png' '$R/claude.log'"
    check "the judge's only tool is Read (--tools, not just a pre-approval)" bash -c "grep -qx -- '--tools' '$R/claude.log' && grep -qx 'Read' '$R/claude.log' && ! grep -q -- '--allowedTools' '$R/claude.log'"
    check "every claude call in vr.sh uses --tools Read, none --allowedTools" bash -c "code=\$(grep -v '^ *#' '$VRSRC/vr.sh'); [ \"\$(echo \"\$code\" | grep -c -- '--tools Read')\" = 2 ] && ! echo \"\$code\" | grep -q -- '--allowedTools'"
    check "no --model flag unless VR_MODEL is set"           bash -c "! grep -q -- '--model' '$R/claude.log'"
    model_pinned() { prep; printf '[]' > "$R/claude.out"; rm -f "$R/claude.log"; (cd "$R" && VR_MODEL=sonnet SHOTS="$R/shots" CLAUDE_STUB_LOG="$R/claude.log" CLAUDE_STUB_OUT="$R/claude.out" PATH="$R/bin:$PATH" ./vr.sh http://stub >/dev/null 2>&1); grep -qx -- '--model' "$R/claude.log" && grep -qx 'sonnet' "$R/claude.log"; }
    check "VR_MODEL pins the model"                          model_pinned
    check "the rubric tells the judge to ignore instructions inside screenshots" grep -q 'never instructions to you' "$VRSRC/rubric.md"
    check "the rubric names 404/500/maintenance/sign-in pages as severity 5, and bans an unlooked-at severity 0" bash -c "grep -q '404' '$VRSRC/rubric.md' && grep -q '500' '$VRSRC/rubric.md' && grep -qi 'maintenance' '$VRSRC/rubric.md' && grep -qi 'sign-in' '$VRSRC/rubric.md' && grep -q 'Never give a file severity 0' '$VRSRC/rubric.md'"
    check "severity 2 passes (exit 0)"                       bash -c "[ \"$(run_with "$(sev 2)")\" = 0 ]"
    check "severity 3 fails the run (exit 1)"                bash -c "[ \"$(run_with "$(sev 3)")\" = 1 ]"
    check "severity 5 fails the run (exit 1)"                bash -c "[ \"$(run_with "$(sev 5)")\" = 1 ]"
    check "worst severity is the one that gates"             bash -c "[ \"$(run_with '[{"file":"a","severity":1},{"file":"b","severity":4}]')\" = 1 ]"
    check "an empty array from the model passes"             bash -c "[ \"$(run_with '[]')\" = 0 ] && grep -q '0 pages compared' '$WORK/vr.out'"
    check "JSON inside markdown fences is extracted"         bash -c "[ \"$(run_with "$(printf '```json\n%s\n```' "$(sev 2)")")\" = 0 ] && python3 -c \"import json; assert json.load(open('$R/report.json'))[0]['file']=='home__0.png'\""
    check "JSON surrounded by prose is extracted"            bash -c "[ \"$(run_with "Here is the report: $(sev 3) Hope that helps.")\" = 1 ]"
    check "brackets in the prose around the JSON do not break extraction" bash -c "[ \"$(run_with "Checked [2 pages]. Result: $(sev 3) See note [1].")\" = 1 ] && python3 -c \"import json; assert json.load(open('$R/report.json'))[0]['severity']==3\""
    check "brackets with no report inside fail cleanly, without a traceback" bash -c "[ \"$(run_with 'Checked [2 pages], see [1].')\" = 1 ] && grep -q 'No JSON array found' '$WORK/vr.out' && ! grep -q Traceback '$WORK/vr.out'"
    check "output with no JSON array fails and shows the text" bash -c "[ \"$(run_with 'I could not open the images.')\" = 1 ] && grep -q 'No JSON array found' '$WORK/vr.out' && grep -q 'could not open' '$WORK/vr.out'"
    check "a record with no severity counts as 0"            bash -c "[ \"$(run_with '[{"file":"a","verdict":"pass"}]')\" = 0 ]"
    blank_case() {  # blank_case <canned model reply>: baseline is a real page, the build under test is flat white
      reset; mkdir -p "$R/baseline"; png "$R" baseline/home__0.png 1000 1000 100,100,300,300; png "$R" shots/home__0.png 1000 1000
      printf '%s' "$1" > "$R/claude.out"; vrrun "$R" >"$WORK/vr.out" 2>&1; echo $?
    }
    check "a blank page fails even if the judge says severity 0" bash -c "[ \"$(blank_case '[{"file":"home__0.png","verdict":"pass","severity":0,"seen":"s","findings":[]}]')\" = 1 ] && python3 -c \"import json; r=json.load(open('$R/report.json'))[0]; assert r['severity']==5 and r['verdict']=='fail' and len(r['findings'])==1\""
    check "a blank page fails even if the judge leaves it out"   bash -c "[ \"$(blank_case '[]')\" = 1 ] && python3 -c \"import json; r=json.load(open('$R/report.json')); assert r[0]['file']=='home__0.png' and r[0]['severity']==5\""
    check "a judge verdict already at severity 5 is kept as is"   bash -c "[ \"$(blank_case '[{"file":"home__0.png","verdict":"fail","severity":5,"seen":"s","findings":[{"what":"x"}]}]')\" = 1 ] && python3 -c \"import json; r=json.load(open('$R/report.json'))[0]; assert len(r['findings'])==1\""
    echo "-- vr.sh: big-diff warnings, unjudged files, batching"
    big_diff() {  # big_diff <canned reply> [extra env]: 51% of the pixels differ (not blank)
      reset; mkdir -p "$R/baseline"; png "$R" baseline/home__0.png 1000 1000 100,100,300,300; png "$R" shots/home__0.png 1000 1000 0,0,1000,600
      printf '%s' "$1" > "$R/claude.out"; env ${2:-X=1} bash -c "cd '$R' && SHOTS='$R/shots' CLAUDE_STUB_LOG='$R/claude.log' CLAUDE_STUB_OUT='$R/claude.out' PATH='$R/bin:'\$PATH ./vr.sh http://stub" >"$WORK/vr.out" 2>&1; echo $?
    }
    warned() { python3 -c "import json; w=json.load(open('$R/warnings.json')); assert [x['file'] for x in w]==['home__0.png'], w"; }
    check "judge says 0 but 51% of the pixels differ: warns, exit code unchanged" bash -c "$(declare -f warned); R='$R'; [ \"$(big_diff '[{"file":"home__0.png","verdict":"pass","severity":0,"seen":"s","findings":[]}]')\" = 0 ] && grep -q '^WARNING home__0.png: 51% of pixels differ' '$WORK/vr.out' && warned"
    check "no warning when the judge already fails the page"                 bash -c "[ \"$(big_diff '[{"file":"home__0.png","verdict":"fail","severity":4,"seen":"s","findings":[]}]')\" = 1 ] && [ \"\$(cat '$R/warnings.json' | tr -d ' \n')\" = '[]' ]"
    check "no warning below the threshold (VR_WARN_DIFF_PCT=70)"              bash -c "[ \"$(big_diff '[{"file":"home__0.png","verdict":"pass","severity":0,"seen":"s","findings":[]}]' VR_WARN_DIFF_PCT=70)\" = 0 ] && [ \"\$(cat '$R/warnings.json' | tr -d ' \n')\" = '[]' ]"
    check "a lower threshold warns on a smaller diff (VR_WARN_DIFF_PCT=1)"     bash -c "$(declare -f warned); R='$R'; [ \"$(big_diff '[{"file":"home__0.png","verdict":"pass","severity":2,"seen":"s","findings":[]}]' VR_WARN_DIFF_PCT=1)\" = 0 ] && warned"
    check "a changed file the judge never mentions is warned about"            bash -c "[ \"$(run_with '[]')\" = 0 ] && grep -q 'no verdict' '$R/warnings.json'"

    multi() {  # multi <n> <batch size> [reply for call 1] [reply for call 2] ...: n changed files, judged <batch> at a time
      local n=$1 b=$2; shift 2; reset
      mkdir -p "$R/baseline"; for i in $(seq 1 "$n"); do png "$R" "baseline/f$i.png" 1000 1000; png "$R" "shots/f$i.png" 1000 1000 10,10,$((10+i*5)),40; done
      echo '[]' > "$R/claude.out"; local k=1; for r in "$@"; do printf '%s' "$r" > "$R/claude.out.$k"; k=$((k+1)); done
      VR_BATCH=$b vrrun "$R" >"$WORK/vr.out" 2>&1; echo $?
    }
    calls() { wc -l < "$R/claude.log.calls" | tr -d ' '; }
    ok() { printf '[{"file":"f%s.png","verdict":"pass","severity":0,"seen":"s","findings":[]}]' "$1"; }
    rep() { local out="" ; for i in "$@"; do out="$out${out:+,}{\"file\":\"f$i.png\",\"verdict\":\"pass\",\"severity\":${SEV:-0},\"seen\":\"s\",\"findings\":[]}"; done; printf '[%s]' "$out"; }
    check "5 files, batch 2: three judge calls"                                bash -c "multi_out=\"$(multi 5 2 "$(rep 1 2)" "$(rep 3 4)" "$(rep 5)")\"; [ \"\$multi_out\" = 0 ] && [ \"$(calls)\" = 3 ]"
    check "each call is asked about only its own files"                         bash -c "grep -c 'f1.png f2.png' '$R/claude.log' | grep -q 1 && ! grep 'f1.png f2.png' '$R/claude.log' | grep -q 'f3.png' && grep -q 'f5.png' '$R/claude.log'"
    check "the batches' reports are merged into one report.json"               bash -c "python3 -c \"import json; r=json.load(open('$R/report.json')); assert sorted(x['file'] for x in r)==['f1.png','f2.png','f3.png','f4.png','f5.png'], r\""
    check "the default batch size is 6: 5 files go in one call"                bash -c "[ \"$(multi 5 6 "$(rep 1 2 3 4 5)")\" = 0 ] && [ \"$(calls)\" = 1 ]"
    check "a finding in a later batch still fails the run"                      bash -c "[ \"$(SEV=4 multi 5 2 "$(SEV=0 rep 1 2)" "$(SEV=0 rep 3 4)" "$(SEV=4 rep 5)")\" = 1 ]"
    check "a batch with no JSON fails the run and names its reply file"        bash -c "[ \"$(multi 5 2 "$(rep 1 2)" 'sorry, cannot open images' "$(rep 5)")\" = 1 ] && grep -q 'raw_report.2.txt' '$WORK/vr.out'"
    check "a file the judge dropped from its batch is warned about"            bash -c "[ \"$(multi 3 3 "$(rep 1 2)")\" = 0 ] && python3 -c \"import json; w=json.load(open('$R/warnings.json')); assert [x['file'] for x in w]==['f3.png'], w\""

    echo "-- vr.sh: second look at suspect verdicts"
    F1='[{"file":"home__0.png","verdict":"pass","severity":0,"findings":[]}]'                       # no "seen"
    S0='[{"file":"home__0.png","verdict":"pass","severity":0,"seen":"s","findings":[]}]'
    S4='[{"file":"home__0.png","verdict":"fail","severity":4,"seen":"a broken page","findings":[{"what":"it is broken"}]}]'
    S2='[{"file":"home__0.png","verdict":"fail","severity":2,"findings":[]}]'
    # second <first reply> <second reply> [env assignment]: a 1% diff on home__0.png (under the re-check threshold)
    second() { prep; printf '%s' "$1" > "$R/claude.out"; printf '%s' "$2" > "$R/claude.out.2"; env ${3:-X=1} bash -c "cd '$R' && SHOTS='$R/shots' CLAUDE_STUB_LOG='$R/claude.log' CLAUDE_STUB_OUT='$R/claude.out' PATH='$R/bin:'\$PATH ./vr.sh http://stub" >"$WORK/vr.out" 2>&1; echo $?; }
    json() { python3 -c "import json,sys; d=json.load(open('$R/$1')); $2"; }
    t_no_recheck()   { [ "$(second "$S0" "$S4")" = 0 ] && [ "$(calls)" = 1 ]; }
    t_recheck_raises() { [ "$(second "$F1" "$S4")" = 1 ] && [ "$(calls)" = 2 ] && json report.json "r=d[0]; assert r['severity']==4 and r['first_severity']==0 and 'rechecked' in r, r"; }
    t_recheck_prompt() { second "$F1" "$S0" >/dev/null; grep -q 'independent second look' "$R/claude.log" && [ "$(grep -c 'home__0.png' "$R/claude.log")" -ge 2 ]; }
    t_never_lowers()   { [ "$(second "$S2" "$S0")" = 0 ] && json report.json "r=d[0]; assert r['severity']==2 and r['first_severity']==2, r"; }
    t_bad_recheck()    { [ "$(second "$F1" "I could not open it.")" = 0 ] && json warnings.json "assert any('nothing usable' in w['warning'] for w in d), d" && json report.json "assert d[0]['severity']==0"; }
    t_bad_recheck_keeps_fail() { [ "$(second '[{"file":"home__0.png","verdict":"fail","severity":4,"findings":[]}]' "no json")" = 1 ]; }
    t_big_diff_recheck() { reset; mkdir -p "$R/baseline"; png "$R" baseline/home__0.png 1000 1000 100,100,300,300; png "$R" shots/home__0.png 1000 1000 0,0,1000,600
      printf '%s' "$S0" > "$R/claude.out"; printf '%s' "$S0" > "$R/claude.out.2"; vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?
      [ $rc = 0 ] && [ "$(calls)" = 2 ] && json report.json "assert 'rechecked' in d[0] and '51%' in d[0]['rechecked'], d" && grep -q '^WARNING home__0.png: 51%' "$WORK/vr.out"; }
    t_recheck_threshold() { reset; mkdir -p "$R/baseline"; png "$R" baseline/home__0.png 1000 1000 100,100,300,300; png "$R" shots/home__0.png 1000 1000 0,0,1000,600
      printf '%s' "$S0" > "$R/claude.out"; VR_RECHECK_DIFF_PCT=60 vrrun "$R" >"$WORK/vr.out" 2>&1; [ "$(calls)" = 1 ]; }
    t_blank_not_rechecked() { [ "$(blank_case "$F1")" = 1 ] && [ "$(calls)" = 1 ]; }
    t_missing_rechecked()   { [ "$(second '[]' "$S4")" = 1 ] && [ "$(calls)" = 2 ] && json report.json "assert d[0]['file']=='home__0.png' and d[0]['severity']==4, d"; }
    t_cap() { multi 3 3 '[{"file":"f1.png","severity":0},{"file":"f2.png","severity":0},{"file":"f3.png","severity":0}]' >/dev/null; rm -f "$R/claude.log.calls"
      VR_RECHECK_MAX=1 multi 3 3 '[{"file":"f1.png","severity":0},{"file":"f2.png","severity":0},{"file":"f3.png","severity":0}]' >/dev/null
      [ "$(calls)" = 2 ] && json warnings.json "assert sum('Not re-checked' in w['warning'] for w in d)==2, d"; }
    t_rechecked_all_when_under_cap() { multi 3 3 '[{"file":"f1.png","severity":0},{"file":"f2.png","severity":0},{"file":"f3.png","severity":0}]' >/dev/null; [ "$(calls)" = 4 ]; }
    check "a described, passed page with a small diff is not re-checked"        t_no_recheck
    check "no description: re-checked, and a higher second severity fails the run" t_recheck_raises
    check "the re-check prompt is for one file and asks for an independent look"  t_recheck_prompt
    t_unreadable_first() { [ "$(second '[{"file":"home__0.png","verdict":"pass","severity":"high","seen":"s","findings":[]}]' "$S4")" = 1 ] && [ "$(calls)" = 2 ] && json report.json "r=d[0]; assert r['severity']==4 and r['first_severity'] is None and r['severity_raw']=='high', r"; }
    t_unreadable_unusable() { [ "$(second '[{"file":"home__0.png","verdict":"pass","severity":"high","seen":"s","findings":[]}]' "no json")" = 0 ] && [ "$(calls)" = 2 ] && json warnings.json "assert any('nothing usable' in w['warning'] and 'unreadable severity' in w['warning'] for w in d), d" && json report.json "assert d[0]['judge_incomplete'] is True, d" && grep -q 'INCOMPLETE' "$R/report/index.html" && ! grep -q 'PASS' "$R/report/index.html"; }
    check "an unreadable severity (\"high\") is re-judged, not taken as 0"        t_unreadable_first
    check "an unreadable severity with no usable re-check is warned about and the report says INCOMPLETE" t_unreadable_unusable
    check "a second opinion never lowers a severity"                              t_never_lowers
    check "an unusable re-check keeps the first verdict and warns"                t_bad_recheck
    check "an unusable re-check does not hide a first-pass failure"               t_bad_recheck_keeps_fail
    check "judge said 0 with 51% of pixels changed: re-checked, and still warned" t_big_diff_recheck
    check "VR_RECHECK_DIFF_PCT sets that threshold (60: no re-check at 51%)"      t_recheck_threshold
    check "a page forced to severity 5 as blank is not re-checked"                t_blank_not_rechecked
    check "a file the judge left out is re-checked"                               t_missing_rechecked
    check "undescribed verdicts for 3 files: 3 re-checks (1 batch call + 3)"      t_rechecked_all_when_under_cap
    check "VR_RECHECK_MAX caps the re-checks and warns about the rest"            t_cap

    echo "-- vr.sh: the HTML report"
    t_report_on_fail()  { [ "$(run_with "$(sev 4)")" = 1 ] && [ -f "$R/report/index.html" ] && grep -q 'home__0.png' "$R/report/index.html" && grep -q 'FAIL' "$R/report/index.html" && grep -q 'http://stub' "$R/report/index.html" && [ -f "$R/report/img/diff/home__0.png" ]; }
    t_report_on_pass()  { [ "$(run_with "$(sev 0)")" = 0 ] && grep -q 'PASS' "$R/report/index.html"; }
    t_report_unchanged() { nothing_changed >/dev/null; grep -q 'Nothing changed' "$R/report/index.html"; }
    t_report_prints_path() { run_with "$(sev 4)" >/dev/null; grep -q '^report: report/index.html' "$WORK/vr.out"; }
    t_no_report_on_record() { reset; png "$R" shots/home__0.png 1000 1000; (cd "$R" && SHOTS="$R/shots" ./vr.sh --record http://stub >/dev/null 2>&1); [ ! -e "$R/report" ] && [ ! -e "$R/diff" ]; }
    t_stale_report_removed() { prep; mkdir -p "$R/report"; echo old > "$R/report/stale.txt"; printf 'no json' > "$R/claude.out"; vrrun "$R" >/dev/null 2>&1; [ ! -e "$R/report/stale.txt" ]; }
    t_report_on_unreadable_reply() {
      local rc1 rc2
      prep; printf 'I could not open the images. <b>x</b>' > "$R/claude.out"; vrrun "$R" >"$WORK/vr.out" 2>&1; rc1=$?
      [ $rc1 = 1 ] && [ -f "$R/judge_errors.json" ] && [ ! -e "$R/report.json" ] || return 1
      grep -q 'NO VERDICT' "$R/report/index.html" && grep -q 'could not open the images' "$R/report/index.html" \
        && grep -q '&lt;b&gt;x&lt;/b&gt;' "$R/report/index.html" && grep -q 'home__0.png' "$R/report/index.html" && ! grep -q 'PASS' "$R/report/index.html" || return 1
      # the next run starts clean: a good reply leaves no judge_errors.json and no NO VERDICT banner behind
      prep; printf '%s' "$(sev 0)" > "$R/claude.out"; vrrun "$R" >"$WORK/vr2.out" 2>&1; rc2=$?
      [ $rc2 = 0 ] && [ ! -e "$R/judge_errors.json" ] && ! grep -q 'NO VERDICT' "$R/report/index.html"
    }
    t_report_failure_is_not_fatal() {
      local rc4 rc0
      printf 'import sys\nsys.exit(1)\n' > "$R/html_report.py"
      prep; printf '%s' "$(sev 4)" > "$R/claude.out"; vrrun "$R" >"$WORK/vr.out" 2>&1; rc4=$?
      prep; printf '%s' "$(sev 0)" > "$R/claude.out"; vrrun "$R" >"$WORK/vr2.out" 2>&1; rc0=$?
      cp "$VRSRC/html_report.py" "$R/html_report.py"
      # a failing verdict still exits 1 and a passing one still exits 0, whatever the report generator did
      [ $rc4 = 1 ] && [ $rc0 = 0 ] && grep -q 'could not write the HTML report' "$WORK/vr.out" && grep -q 'could not write the HTML report' "$WORK/vr2.out"
    }
    t_report_incomplete() { printf '[]' > "$R/claude.out"; prep; printf '[]' > "$R/claude.out"; vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?; [ $rc = 0 ] && grep -q 'INCOMPLETE' "$R/report/index.html" && ! grep -q 'PASS' "$R/report/index.html"; }
    check "a failing run writes report/index.html (verdict, URL, diff image)"      t_report_on_fail
    check "a passing run writes one too"                                           t_report_on_pass
    check "a run with nothing changed writes one that says so"                     t_report_unchanged
    check "vr.sh prints where the report is"                                       t_report_prints_path
    check "--record writes no report and no diff folder"                           t_no_report_on_record
    check "a stale report/ is replaced when a run dies after the judge answered"   t_stale_report_removed
    check "an unreadable judge reply still writes a report with the reply, and exits 1" t_report_on_unreadable_reply
    check "a report that cannot be written changes neither a failing nor a passing exit code" t_report_failure_is_not_fatal
    check "a changed file the judge gave no verdict for makes the report INCOMPLETE, not PASS"  t_report_incomplete

    echo "-- vr.sh: pages behind a login stay away from the judge"
    # pages.json with a login profile; the stub shoot.mjs copies whatever PNGs are in shots/, so the file names decide what is "private"
    write_pages() { printf '%s' "{\"viewports\":{\"desktop\":{\"width\":1000,\"height\":1000}},\"auth\":{\"customer\":{\"loginUrl\":\"/login\",\"fields\":{\"#e\":\"\$USER\"},\"loggedIn\":\"#m\"${2:-,\"judge\":false}}},\"pages\":$1}" > "$R/pages.json"; }
    private_prep() {  # a baseline of two pages ("/orders" behind a login, "/shop" public); the build under test changes both
      reset; mkdir -p "$R/baseline"
      png "$R" baseline/desktop__orders__0.png 1000 1000; png "$R" baseline/desktop__shop__0.png 1000 1000
      png "$R" shots/desktop__orders__0.png 1000 1000 100,100,100,100; png "$R" shots/desktop__shop__0.png 1000 1000 100,100,100,100
    }
    t_private_json() {
      private_prep; write_pages '["/shop",{"path":"/orders","auth":"customer"}]'
      printf '[{"file":"desktop__shop__0.png","verdict":"pass","severity":0,"seen":"shop","findings":[]}]' > "$R/claude.out"
      vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?
      [ $rc = 1 ] && [ "$(python3 -c "import json; print(json.load(open('$R/private.json')))")" = "['desktop__orders__0.png']" ]
    }
    t_private_not_named_to_judge() {
      private_prep; write_pages '["/shop",{"path":"/orders","auth":"customer"}]'
      printf '[{"file":"desktop__shop__0.png","verdict":"pass","severity":0,"seen":"shop","findings":[]}]' > "$R/claude.out"
      vrrun "$R" >/dev/null 2>&1
      [ "$(grep -c 'rubric.md' "$R/claude.log")" = 1 ] && grep -q 'desktop__shop__0.png' "$R/claude.log" && ! grep -q 'orders' "$R/claude.log"
    }
    t_private_only_no_judge() {
      private_prep; rm -f "$R/baseline/desktop__shop__0.png" "$R/shots/desktop__shop__0.png"; write_pages '[{"path":"/orders","auth":"customer"}]'
      vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?
      [ $rc = 1 ] && [ ! -e "$R/claude.log" ] && grep -q 'Not sent to the judge' "$R/report/index.html" && grep -q 'FAIL' "$R/report/index.html"
    }
    t_private_unchanged_passes() {
      reset; mkdir -p "$R/baseline"; png "$R" baseline/desktop__orders__0.png 1000 1000; png "$R" shots/desktop__orders__0.png 1000 1000
      write_pages '[{"path":"/orders","auth":"customer"}]'
      vrrun "$R" >"$WORK/vr.out" 2>&1 && grep -q 'nothing changed' "$WORK/vr.out" && [ ! -e "$R/claude.log" ] && [ "$(cat "$R/private.json")" = "[]" ]
    }
    t_default_sends() {
      private_prep; rm -f "$R/baseline/desktop__shop__0.png" "$R/shots/desktop__shop__0.png"; write_pages '[{"path":"/orders","auth":"customer"}]' ' '
      printf '[{"file":"desktop__orders__0.png","verdict":"fail","severity":4,"seen":"orders","findings":[]}]' > "$R/claude.out"
      vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?
      [ $rc = 1 ] && grep -q 'desktop__orders__0.png' "$R/claude.log" && [ "$(cat "$R/private.json")" = "[]" ]
    }
    t_judge_true_sends() {
      private_prep; rm -f "$R/baseline/desktop__shop__0.png" "$R/shots/desktop__shop__0.png"; write_pages '[{"path":"/orders","auth":"customer"}]' ',"judge":true'
      printf '[{"file":"desktop__orders__0.png","verdict":"pass","severity":1,"seen":"orders","findings":[]}]' > "$R/claude.out"
      vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?
      [ $rc = 0 ] && grep -q 'desktop__orders__0.png' "$R/claude.log" && [ "$(cat "$R/private.json")" = "[]" ]
    }
    t_stale_private_removed() {
      private_prep; write_pages '["/shop",{"path":"/orders","auth":"customer"}]'; echo '["stale"]' > "$R/private.json"
      printf '[{"file":"desktop__shop__0.png","verdict":"pass","severity":0,"seen":"shop","findings":[]}]' > "$R/claude.out"
      vrrun "$R" >/dev/null 2>&1; ! grep -q stale "$R/private.json"
    }
    check "filter.mjs lists the changed pages behind a login in private.json"      t_private_json
    check "a page behind a login is never named to the judge; public pages still are" t_private_not_named_to_judge
    check "only private pages changed: no judge call at all, the run fails and the report says why" t_private_only_no_judge
    check "an unchanged private page passes without the judge"                      t_private_unchanged_passes
    check "a page behind a login goes to the judge like any other (the default), and its verdict decides" t_default_sends
    check "a profile with \"judge\": true sends its pages to the judge"             t_judge_true_sends
    check "a stale private.json is cleared at the start of a run"                   t_stale_private_removed
    # A baseline screenshot whose page is gone (renamed, removed) cannot be known to be private, so it goes to the judge even if the
    # page opted out. When a profile opts out (judge: false) the run warns about each such file; it never changes the exit code.
    orphan_prep() {  # baseline: orders (still a page) and oldname (renamed away); the build under test only has orders
      reset; mkdir -p "$R/baseline"; png "$R" baseline/desktop__orders__0.png 1000 1000; png "$R" baseline/desktop__oldname__0.png 1000 1000
      png "$R" shots/desktop__orders__0.png 1000 1000
      printf '[{"file":"desktop__oldname__0.png","verdict":"pass","severity":0,"seen":"the old page","findings":[]}]' > "$R/claude.out"
    }
    t_orphan_warns() {
      orphan_prep; write_pages '[{"path":"/orders","auth":"customer"}]'; echo '["stale.png"]' > "$R/orphans.json"
      vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?
      [ $rc = 0 ] && [ "$(python3 -c "import json; print(json.load(open('$R/orphans.json')))")" = "['desktop__oldname__0.png']" ] \
        && grep -q 'WARNING desktop__oldname__0.png: This baseline screenshot belongs to no page in pages.json any more' "$WORK/vr.out" \
        && grep -q 'belongs to no page in pages.json any more' "$R/report/index.html" \
        && grep -q 'desktop__oldname__0.png' "$R/claude.log"      # it did go to the judge: that is the leak the warning is about
    }
    t_orphan_silent_without_opt_out() {
      orphan_prep; write_pages '[{"path":"/orders","auth":"customer"}]' ' '
      vrrun "$R" >"$WORK/vr.out" 2>&1; local rc=$?
      [ $rc = 0 ] && [ "$(cat "$R/orphans.json")" = "[]" ] && ! grep -q 'belongs to no page' "$WORK/vr.out"
    }
    t_orphan_silent_for_a_current_page() {   # a page that got shorter loses a tile: that tile still belongs to a page
      reset; mkdir -p "$R/baseline"; png "$R" baseline/desktop__orders__0.png 1000 1000; png "$R" baseline/desktop__orders__1.png 1000 1000
      png "$R" shots/desktop__orders__0.png 1000 1000
      printf '[{"file":"desktop__orders__1.png","verdict":"pass","severity":0,"seen":"gone","findings":[]}]' > "$R/claude.out"
      write_pages '[{"path":"/orders","auth":"customer"}]'
      vrrun "$R" >"$WORK/vr.out" 2>&1; [ "$(cat "$R/orphans.json")" = "[]" ] && ! grep -q 'belongs to no page' "$WORK/vr.out"
    }
    t_orphan_silent_with_no_logins() {
      orphan_prep; cp "$VRSRC/pages.json" "$R/pages.json"
      vrrun "$R" >"$WORK/vr.out" 2>&1; [ "$(cat "$R/orphans.json")" = "[]" ] && ! grep -q 'belongs to no page' "$WORK/vr.out"
    }
    check "a baseline screenshot whose page is gone gets a warning when a profile opts out (and the run still passes)" t_orphan_warns
    check "no warning when no profile opts out of the judge"                          t_orphan_silent_without_opt_out
    check "no warning for a tile that still belongs to a current page"               t_orphan_silent_for_a_current_page
    check "no warning in a project with no logins"                                   t_orphan_silent_with_no_logins
    # The tool's code in one folder and a project's data in another (VR_DATA). The code folder holds a pages.json that must never be
    # used and is checked for being left exactly as it was: every file the run makes belongs in the data folder.
    split_setup() {  # sets T (code) and D (data); D's pages.json has a page behind a login whose profile opts out of the judge
      T="$(vrdir split-tool)"; echo '["/from-the-tool-folder"]' > "$T/pages.json"
      D="$WORK/vr-split-data"; rm -rf "$D"; mkdir -p "$D/shots"
      printf '%s' "{\"viewports\":{\"desktop\":{\"width\":1000,\"height\":1000}},\"auth\":{\"customer\":{\"loginUrl\":\"/login\",\"fields\":{\"#e\":\"\$USER\"},\"loggedIn\":\"#m\",\"judge\":false}},\"pages\":[\"/shop\",{\"path\":\"/orders\",\"auth\":\"customer\"}]}" > "$D/pages.json"
      png "$T" "$D/shots/desktop__shop__0.png" 1000 1000; png "$T" "$D/shots/desktop__orders__0.png" 1000 1000
      echo '[]' > "$D/claude.out"
    }
    splitrun() { (cd "$D" && VR_DATA="$D" SHOTS="$D/shots" CLAUDE_STUB_LOG="$D/claude.log" CLAUDE_STUB_OUT="$D/claude.out" PATH="$T/bin:$PATH" "$T/vr.sh" "$@"); }
    tool_listing() { (cd "$T" && ls -A | sort | tr '\n' ' '); }
    t_split_layout() {
      split_setup; local before; before="$(tool_listing)"
      splitrun --record http://stub >"$WORK/vr.out" 2>&1 || return 1
      [ -f "$D/baseline/desktop__orders__0.png" ] && [ ! -e "$T/baseline" ] || return 1
      png "$T" "$D/shots/desktop__orders__0.png" 1000 1000 100,100,100,100; png "$T" "$D/shots/desktop__shop__0.png" 1000 1000 100,100,100,100
      printf '[{"file":"desktop__shop__0.png","verdict":"pass","severity":0,"seen":"shop","findings":[]}]' > "$D/claude.out"
      splitrun http://stub >"$WORK/vr.out" 2>&1; local rc=$?
      # the private page changed (rc 1), and private.json is the one in D's pages.json (the code folder's has no login at all)
      [ $rc = 1 ] && [ "$(python3 -c "import json; print(json.load(open('$D/private.json')))")" = "['desktop__orders__0.png']" ] || return 1
      for f in report/index.html report.json warnings.json changed.json current/desktop__shop__0.png; do [ -e "$D/$f" ] || return 1; done
      [ "$(tool_listing)" = "$before" ]
    }
    t_split_rubric() {
      split_setup; splitrun --record http://stub >/dev/null 2>&1
      png "$T" "$D/shots/desktop__shop__0.png" 1000 1000 100,100,100,100
      printf '[{"file":"desktop__shop__0.png","verdict":"pass","severity":0,"seen":"shop","findings":[]}]' > "$D/claude.out"
      splitrun http://stub >/dev/null 2>&1
      grep -q "Read $T/rubric.md" "$D/claude.log" || return 1                  # no rubric in the data folder: the tool's is used, by its full path
      echo "my own rules" > "$D/rubric.md"; rm -f "$D/claude.log" "$D/claude.log.calls"
      splitrun http://stub >/dev/null 2>&1
      grep -q "Read rubric.md" "$D/claude.log" && ! grep -q "$T/rubric.md" "$D/claude.log"      # the project's own rubric wins
    }
    t_split_errors() {
      split_setup
      local rc1 rc2 rc3 out
      out=$(cd "$D" && VR_DATA="$WORK/no-such-folder" "$T/vr.sh" http://stub 2>&1); rc1=$?
      echo "$out" | grep -q 'VR_DATA is not a folder' || return 1
      rm "$D/pages.json"; out=$(cd "$D" && VR_DATA="$D" "$T/vr.sh" --record http://stub 2>&1); rc2=$?
      echo "$out" | grep -q "No pages.json in $D" || return 1
      out=$(cd "$D" && VR_DATA="$D" "$T/vr.sh" 2>&1); rc3=$?                   # usage still wins over a missing pages.json
      echo "$out" | grep -q 'usage:' && [ $rc1 = 2 ] && [ $rc2 = 2 ] && [ $rc3 = 2 ]
    }
    t_split_relative_data() {   # a relative VR_DATA works from wherever the script is run
      split_setup
      (cd "$WORK" && VR_DATA="vr-split-data" SHOTS="$D/shots" CLAUDE_STUB_LOG="$D/claude.log" CLAUDE_STUB_OUT="$D/claude.out" PATH="$T/bin:$PATH" "$T/vr.sh" --record http://stub >/dev/null 2>&1) \
        && [ -f "$D/baseline/desktop__shop__0.png" ] && [ ! -e "$WORK/baseline" ]
    }
    check "code and data in separate folders: everything the run makes is in the data folder, its pages.json is used, the code folder is untouched" t_split_layout
    check "split folders: the tool's rubric is used by full path unless the project has its own"  t_split_rubric
    check "split folders: a missing VR_DATA folder or pages.json is a clear exit 2, and usage still wins" t_split_errors
    check "split folders: a relative VR_DATA works from any folder"                              t_split_relative_data
    t_login_usage() {
      local a b
      a=$(cd "$R" && ./vr.sh --login 2>&1; echo "rc=$?"); b=$(cd "$R" && ./vr.sh --login customer 2>&1; echo "rc=$?")
      echo "$a" | grep -q 'usage: vr.sh --login <profile> \[--manual\] <base-url>' && echo "$a" | grep -q 'rc=2' && echo "$b" | grep -q 'rc=2'
    }
    check "vr.sh --login with a missing profile or URL prints usage and exits 2"    t_login_usage
    write_pages '["/"]' >/dev/null 2>&1; cp "$VRSRC/pages.json" "$R/pages.json"

    stale_files_removed() { prep; echo stale > "$R/report.json"; echo stale > "$R/raw_report.txt"; printf 'no json' > "$R/claude.out"; vrrun "$R" >/dev/null 2>&1; [ ! -f "$R/report.json" ] && grep -q "no json" "$R/raw_report.txt" && ! grep -q stale "$R/raw_report.txt"; }
    check "a stale report.json is removed when a run fails to parse" stale_files_removed
  else
    fail "vr dependencies install"; tail -8 "$WORK/npm.log" | sed 's/^/        /'
  fi
fi

echo; echo "== fast: docs =="
check "relative markdown links resolve" python3 - "$ROOT" <<'PY'
import os, re, subprocess, sys
root = sys.argv[1]; bad = []
files = subprocess.run(["git", "-C", root, "ls-files", "*.md"], capture_output=True, text=True).stdout.split()
for f in files:
    for m in re.finditer(r"\]\(([^)#\s]+)(#[^)]*)?\)", open(os.path.join(root, f)).read()):
        t = m.group(1)
        if t.startswith(("http", "mailto:")): continue
        if not os.path.exists(os.path.normpath(os.path.join(root, os.path.dirname(f), t))): bad.append(f"{f} -> {t}")
print("\n".join(bad)); sys.exit(1 if bad else 0)
PY
if have gitleaks; then check "no secrets in the repo (gitleaks)" bash -c "cd '$ROOT' && gitleaks detect --no-git -s . --no-banner -l error"; else skip "gitleaks not installed"; fi

# ============================================================ BROWSER TIER
if [ "$TIER" = browser ]; then
  for t in node npm python3; do have "$t" || { echo "browser tier needs '$t' on the host"; exit 2; }; done
  echo; echo "== browser: shoot.mjs, discover.mjs and vr.sh in headless Chromium, against a local test site (no model) =="
  BDEPS="$WORK/browser-deps"; mkdir -p "$BDEPS"; cp "$ROOT/package.json" "$BDEPS/"
  if ! (cd "$BDEPS" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund >"$WORK/npm.log" 2>&1); then
    fail "browser tier: npm install"; tail -8 "$WORK/npm.log" | sed 's/^/        /'
  else
    launches() { (cd "$BDEPS" && node -e "import('./node_modules/playwright/index.mjs').then(p=>p.chromium.launch(process.env.VR_CHROMIUM?{executablePath:process.env.VR_CHROMIUM}:{})).then(b=>b.close())" >/dev/null 2>&1); }
    if ! launches; then
      for c in "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium-*/chrome-linux*/chrome \
               "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium_headless_shell-*/*/headless_shell \
               "$HOME"/Library/Caches/ms-playwright/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium \
               "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
               "$(command -v chromium 2>/dev/null)" "$(command -v chromium-browser 2>/dev/null)" "$(command -v google-chrome 2>/dev/null)"; do
        [ -n "$c" ] && [ -x "$c" ] || continue
        export VR_CHROMIUM="$c"; launches && break
        unset VR_CHROMIUM
      done
    fi
    if ! launches; then
      skip "browser tier: no Chromium that launches (npx playwright install chromium, or set VR_CHROMIUM to a Chrome/Chromium binary)"
    else
      echo "   Chromium: ${VR_CHROMIUM:-the default Playwright browser}"
      if node "$VRT/browser.test.mjs" "$ROOT" "$BDEPS" >"$WORK/browser.out" 2>&1; then
        sed 's/^/  /' "$WORK/browser.out"; pass "browser tests ($(grep -c '^ok ' "$WORK/browser.out") scenarios)"
      else
        sed 's/^/  /' "$WORK/browser.out"; fail "browser tests"
      fi
    fi
  fi
  echo; echo "tier: browser   passed: $PASSES   failed: $FAILS"; [ "$FAILS" -eq 0 ] && exit 0 || exit 1
fi

# ============================================================ JUDGE TIER
if [ "$TIER" = judge ]; then
  for t in node npm claude; do have "$t" || { echo "judge tier needs '$t' on the host"; exit 2; }; done
  echo; echo "== judge: the real vr pipeline (claude -p) over labelled before/after pages =="
  echo "   (set VR_MODEL to pin a model; CHROMIUM_PATH if Playwright has no browser: npx playwright install chromium)"
  if "$VRT/judge/run.sh" "$WORK/judge"; then pass "judge catches broken pages without flagging fine ones"; else fail "judge calibration (see scores above)"; fi
  echo; echo "tier: judge   passed: $PASSES   failed: $FAILS"; [ "$FAILS" -eq 0 ] && exit 0 || exit 1
fi

echo
echo "tier: $TIER   passed: $PASSES   failed: $FAILS"
if [ "$FAILS" -eq 0 ]; then echo "ALL PASSED"; else echo "$FAILS FAILED"; exit 1; fi
