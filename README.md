# visual-regressions

Visual regression testing for a website, before and after a deploy. It shoots every page you list at desktop, tablet and mobile
sizes with Playwright, drops the screenshots that did not change by a pixel check, and has a model (`claude -p`) judge the rest against
a rubric, scoring each change from 0 to 5. The run fails at severity 3 or above. Everything is written to a self-contained HTML report.

```bash
npm install                      # once, in this folder: Playwright, pixelmatch, pngjs (and `npx playwright install chromium`)
export VR_DATA=~/projects/shop/vr   # where your project's pages.json, baseline/ and report/ live (default: this folder)
./vr.sh --record https://staging.example.com   # before the deploy: record the known-good build
./vr.sh https://staging.example.com            # after: compare, judge, report; exit 1 if something is wrong
./vr.sh --discover https://staging.example.com # list pages that are linked but not in pages.json
```

Needs `node` (any recent LTS), `python3`, a Chromium for Playwright, and the `claude` CLI for the judge. It is meant to be run
against local or staging with test data.

Create a `pages.json` with your real paths. Every page is shot at three viewports by default:
desktop 1440×900, tablet 768×1024 and mobile 390×844 (tablet and mobile emulate a touch device).

```json
{
  "viewports": {
    "desktop": { "width": 1440, "height": 900 },
    "tablet": { "width": 768, "height": 1024, "mobile": true },
    "mobile": { "width": 390, "height": 844, "mobile": true }
  },
  "pages": ["/", "/cart", { "path": "/checkout", "viewports": ["mobile"] }]
}
```

A plain list such as `["/", "/cart"]` still works and uses the default viewports. A page object
can limit itself to some viewports. Screenshots are named `<viewport>__<page>__<tile>.png`, so each
viewport has its own baseline.

Per-page options for content that would otherwise cause false alarms or missed pages:

| Option | Effect |
|---|---|
| `"waitFor": ".ready"` | wait for that selector before shooting (content that loads after the network is idle) |
| `"mask": [".timestamp", "#ad"]` | paint over those elements in every screenshot |
| `"expectStatus": 404` | the status the page should return; by default any status of 400 or above fails the run |
| `"auth": "customer"` | shoot this page logged in, as that login profile (see **Pages behind a login** below) |
| `"name": "cart-open"` | a name for this screenshot, used in its file name (default: made from the path). The same path can be listed more than once under different names |
| `"steps": [...]` | actions to run before the screenshot, to reach a state (see **States** below) |
| `"maxTiles": 8` | allow a taller page. Pages need one screenshot per viewport-height, and more than 6 is an error, not a silent truncation. Set `"maxTiles"` at the top level to change it for every page |

**Pages behind a login.** Define a login profile at the top level of `pages.json`, then name it on the pages that need it:

```json
{ "auth": { "customer": { "loginUrl": "/login",
                          "fields": { "#email": "$USER", "#password": "$PASSWORD" },
                          "submit": "button[type=submit]", "loggedIn": "#account-menu" } },
  "pages": ["/", { "path": "/orders", "auth": "customer" }] }
```

- **Log in once:** `VR_CUSTOMER_USER=... VR_CUSTOMER_PASSWORD=... vr.sh --login customer <base-url>` fills the form and saves the
  session to `.auth/customer.json` (readable only by you, and ignored by git: the folder holds its own `.gitignore`, wherever `VR_DATA` is). Credentials are only ever read from the environment: a field
  value must be a `$NAME` reference (`$USER` means `VR_CUSTOMER_USER`), and `pages.json` is rejected if it holds anything else.
  For SSO, MFA or a captcha use `--manual`: a browser window opens, you log in, and the session is saved when `loggedIn` appears
  (it needs a display, so do it on your own machine). In CI, put the session (the JSON, or a path to it) in `VR_CUSTOMER_STATE`.
- **Sessions expire, and that is checked.** Before it shoots a logged-in page, `vr.sh` checks that the page did not redirect to the login
  page and that the `loggedIn` selector (something on every logged-in page, such as an account menu) is there. If not, the run stops
  with "run `vr.sh --login customer` again". Without this, a baseline of the login form compared with another login form would pass.
- **Logged-in pages go to the judge like any other.** Run this against local or staging with a test account that has fake data. If a
  profile must not be seen by the AI judge, add `"judge": false`: its pages are then compared as pixels only, and a changed one fails
  the run (the report says it was not judged), because nothing else can vouch for it. The `baseline/`, `current/` and `report/` folders
  hold logged-in pages: do not publish them.
- **Renaming or removing a page with `"judge": false`:** the old baseline file then belongs to no page in `pages.json`, so the tool can no
  longer tell it was private, and it is shown to the judge as a page that disappeared. When any profile opts out, the run prints a warning
  for each such file (and lists it in the report); re-record the baseline after renaming or removing a page. The warning never changes the
  exit code.
- A session is a live login. Do not commit it, paste it in a ticket, or leave it in a shared CI artifact.

**States.** A page that looks different after an action (a menu open, a dialog, a form with an error, a cart with an item) is its own
screenshot: list the same path again with a `name` and `steps`.

```json
{ "pages": ["/",
            { "path": "/", "name": "menu-open",   "steps": [{ "hover": "#products" }] },
            { "path": "/signup", "name": "signup-error", "steps": [{ "fill": { "selector": "#email", "value": "not-an-email" } },
                                                                 { "click": "button[type=submit]" }, { "waitFor": ".field-error" }] }] }
```

- **Steps** run after the page loads and before the screenshot, in order. One action each: `click`, `hover`, `waitFor` (a selector),
  `press` (a key such as `"Enter"`, sent to the focused element), `wait` (milliseconds, at most 10000; prefer `waitFor`), `fill` and
  `select` (`{ "selector": "...", "value": "..." }`). At most 20 per page. `mask` and the page's own `waitFor` still apply afterwards.
- **A state that cannot be reached is a failure**, not a screenshot of the wrong thing: if a step cannot run (the button is gone), the run
  stops and says which step (`step 2 (click "#cart") failed`). It never prints what you typed. `VR_STEP_TIMEOUT_MS` (default 10000) sets
  how long a step waits.
- **Each page with steps gets a fresh browser**, so what its steps change (a cart, a dismissed banner) cannot leak into the next page.
- **Names** become part of the file name (`desktop__menu-open__0.png`), so use letters, digits, `-` and `_`. Two pages cannot share a
  name for the same viewport. This is also how you shoot one path both logged out and logged in: list it twice, the second with
  `"auth": "customer"` and its own `name`.

The list is the test, not a crawl: only the pages you list are compared, so a broken nav link cannot make a page
quietly drop out of the check. To find pages you forgot, run `vr.sh --discover http://localhost:5173`. It follows
same-origin links (2 hops, 50 pages; `DISCOVER_DEPTH` and `DISCOVER_MAX` change that) and reads `/sitemap.xml`, then
prints the paths that are not in `pages.json`, plus any broken links. It skips logout links and files, and
`"discover": { "ignore": ["^/admin"] }` adds your own skip patterns. It changes nothing: copy over the ones that matter.
Pages built from route parameters (`/invoices/123`) are found only if something links to them; list an example by hand.

How the judge is kept honest: it is shown 6 screenshot pairs per call (`VR_BATCH`) and must say in one sentence what each
page shows (`seen`). Any file it skipped, did not describe, or passed while 5% or more of its pixels changed
(`VR_RECHECK_DIFF_PCT`) is judged again on its own, and the second opinion can only raise a severity. At most 12 files are
re-checked per run (`VR_RECHECK_MAX`); the rest get a warning. Independently of the judge, a page that went blank always
fails, and a page it passed while 50% or more of the pixels changed (`VR_WARN_DIFF_PCT`) gets a `WARNING` line and an
entry in `warnings.json`; warnings never change the exit code. An actual HTTP 4xx/5xx stops the run at capture time, so the
judge only has to catch pages that answer 200 but look wrong (a styled "not found", a maintenance page, a sign-in gate).

**Reading a result.** Every compare run writes `report/index.html`. Open it in a browser: the failed screenshots come
first, then the ones that need a look (a warning, or no verdict from the judge), then the other changes. Each card shows
baseline, current and a pixel diff side by side, with the judge's severity, what it says it saw, its findings, and any
re-check or warning. The folder is self-contained (it copies the images it shows into `report/img/`), so you can zip it or
upload it as a CI artifact; it is about 0.5 MB per changed screenshot at desktop size. The page uses no JavaScript, and
everything the judge wrote is escaped, because the judge reads untrusted pages. A report is written whatever the verdict,
including when the judge's reply cannot be read at all: the run still exits 1, and the report says NO VERDICT and shows the reply.

Then:

```bash
vr.sh --record https://staging.example.com   # before deploy: record the known-good build as the baseline
# ...deploy...
vr.sh https://staging.example.com            # after: compare against the baseline
```

The baseline only changes when you run `--record`, so re-running the check never turns a broken
deploy into the new normal. Without a baseline, `vr.sh` stops and tells you to record one. Run
`--record` again after each deploy you have checked and accept.

Unchanged pages are dropped by a pixel check first (a screenshot only on one side counts as changed), so the model only judges pages that
changed. It exits non-zero at severity 3 or above. Calibrate `rubric.md` against about 20
labelled before/after pairs before you trust it, and re-run them when you switch models.

**Code and data in separate folders.** By default the tool and a project's data share the `vr/` folder, and you set nothing. Set
`VR_DATA` to a folder and `vr.sh` keeps everything of the project there: `pages.json`, `baseline/`, the saved logins (`.auth/`), the run's
files and `report/`, and an optional `rubric.md` of your own (otherwise the tool's is used). The tool's folder is then only code, and is
never written to, so it can be fetched, updated or shared by several projects without touching a project's baselines. `VR_DATA` can be
relative or absolute, and `vr.sh` runs the same from any folder. The tool's `npm install` (Playwright, pixelmatch, pngjs) is done once, in the
tool's folder.

If Playwright cannot find its Chromium (a corporate machine, or a different Playwright version), set `VR_CHROMIUM` to a Chrome or Chromium binary and `vr.sh` uses that.

## Tests

```bash
./test.sh            # fast tier, seconds, no browser and no model (runs in CI)
./test.sh browser    # the scripts in a real headless Chromium against a local test site, ~90 s, no model (runs in CI)
./test.sh judge      # the real judge over 27 labelled before/after pages; uses plan tokens, run it by hand
```

`tests/judge/repeat.sh` repeats the judge calibration and keeps every reply, for comparing models or rubric changes.

## Using it from another project

Fetch a tagged release and point `VR_DATA` at the project's own folder. The tool's folder is only code and is never written to, so one
copy can serve several projects without touching their baselines.

## License

MIT
