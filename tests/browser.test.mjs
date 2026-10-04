// Browser tests for the vr scripts: runs the real shoot.mjs, discover.mjs and vr.sh in headless Chromium against the
// tiny site in site/server.mjs. No model: vr.sh gets the stub `claude`.
//   node browser.test.mjs <path to vr/> <dir holding node_modules (playwright, pixelmatch, pngjs)>
// env: VR_CHROMIUM = path of the Chromium to drive (default: Playwright's own)
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite } from './site/server.mjs';

const [VR, DEPS] = process.argv.slice(2).map(p => path.resolve(p));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-browser-'));
const site = await startSite();

// ---- helpers
function workdir(pages) {
  const d = fs.mkdtempSync(path.join(ROOT, 'w-'));
  for (const f of ['vr.sh', 'filter.mjs', 'config.mjs', 'links.mjs', 'browser.mjs', 'shoot.mjs', 'discover.mjs', 'auth.mjs', 'login.mjs', 'report.py', 'html_report.py', 'rubric.md']) {
    if (fs.existsSync(path.join(VR, f))) fs.copyFileSync(path.join(VR, f), path.join(d, f));
  }
  fs.mkdirSync(path.join(d, 'bin'));
  fs.copyFileSync(path.join(HERE, 'claude'), path.join(d, 'bin', 'claude'));
  fs.chmodSync(path.join(d, 'bin', 'claude'), 0o755);
  fs.symlinkSync(path.join(DEPS, 'node_modules'), path.join(d, 'node_modules'));
  fs.writeFileSync(path.join(d, 'pages.json'), JSON.stringify(pages));
  return d;
}
const run = (cmd, args, cwd, env = {}) => new Promise(resolve => {
  execFile(cmd, args, { cwd, env: { ...process.env, ...env }, timeout: 90000 }, (err, stdout, stderr) =>
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }));
});
const shoot = (d, base = site.main, env = {}) => run('node', ['shoot.mjs'], d, { BASE_URL: base, OUT: 'out', ...env });
const size = file => { const b = fs.readFileSync(file); assert.equal(b.subarray(1, 4).toString(), 'PNG', file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const files = (d, dir = 'out') => (fs.existsSync(path.join(d, dir)) ? fs.readdirSync(path.join(d, dir)).sort() : []);
const bytes = (d, f, dir = 'out') => fs.readFileSync(path.join(d, dir, f));
const ONE = { viewports: { desktop: { width: 800, height: 600 } } };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- shoot.mjs
test('default viewports: desktop 1440 wide, tablet 768, mobile 390, one screenshot per viewport height', async () => {
  const d = workdir(['/ok']);
  const r = await shoot(d);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(d), ['desktop__ok__0.png', 'mobile__ok__0.png', 'tablet__ok__0.png']);
  assert.deepEqual(size(path.join(d, 'out/desktop__ok__0.png')), [1440, 900]);
  assert.deepEqual(size(path.join(d, 'out/tablet__ok__0.png')), [768, 1024]);
  assert.deepEqual(size(path.join(d, 'out/mobile__ok__0.png')), [390, 844]);
});
test('a 3000px page is cut into ceil(3000 / viewport height) tiles per viewport', async () => {
  const d = workdir(['/tall']);
  const r = await shoot(d);
  assert.equal(r.code, 0, r.stderr);
  const count = v => files(d).filter(f => f.startsWith(`${v}__tall__`)).length;
  assert.deepEqual([count('desktop'), count('tablet'), count('mobile')], [4, 3, 4]);
});
test('a page taller than maxTiles is an error that says so; maxTiles raises the limit', async () => {
  let d = workdir({ ...ONE, pages: [{ path: '/tall', maxTiles: 2 }] });
  let r = await shoot(d);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /\/tall \[desktop\] is 3\d\d\dpx tall: it needs 5 screenshots but the limit is 2/);
  d = workdir({ ...ONE, maxTiles: 5, pages: ['/tall'] });
  r = await shoot(d);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(files(d).length, 5);
});
test('HTTP 404 and 500 stop the run; expectStatus allows the expected one', async () => {
  for (const [p, code] of [['/missing', 404], ['/boom', 500]]) {
    const r = await shoot(workdir({ ...ONE, pages: [p] }));
    assert.notEqual(r.code, 0, p);
    assert.match(r.stderr, new RegExp(`${p} \\[desktop\\] returned HTTP ${code}`));
  }
  let d = workdir({ ...ONE, pages: [{ path: '/err404', expectStatus: 404 }] });
  let r = await shoot(d);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(d), ['desktop__err404__0.png']);
  d = workdir({ ...ONE, pages: [{ path: '/ok', expectStatus: 404 }] });     // got 200, wanted 404
  r = await shoot(d);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /returned HTTP 200, expected 404/);
});
test('a server that is not there fails the run', async () => {
  const r = await shoot(workdir({ ...ONE, pages: ['/ok'] }), 'http://127.0.0.1:9');
  assert.notEqual(r.code, 0);
});
test('a base URL ending in a slash works (no double slash)', async () => {
  const d = workdir({ ...ONE, pages: ['/ok'] });
  const r = await shoot(d, site.main + '/');
  assert.equal(r.code, 0, r.stderr);
  assert.ok(site.visited.has('/ok'));
  assert.ok(![...site.visited].some(p => p.startsWith('//')), 'a double-slash path was requested');
});
test('waitFor: the screenshot is taken after the late content appears (and matches a page that had it from the start)', async () => {
  const waited = workdir({ ...ONE, pages: [{ path: '/late', waitFor: '#late' }] });
  const reference = workdir({ ...ONE, pages: ['/late-final'] });
  const early = workdir({ ...ONE, pages: ['/late'] });
  const [a, b, c] = await Promise.all([shoot(waited), shoot(reference), shoot(early)]);
  for (const r of [a, b, c]) assert.equal(r.code, 0, r.stderr);
  assert.ok(bytes(waited, 'desktop__late__0.png').equals(bytes(reference, 'desktop__late_final__0.png')), 'waitFor did not wait');
  assert.ok(!bytes(early, 'desktop__late__0.png').equals(bytes(reference, 'desktop__late_final__0.png')), 'the page was not late: the test proves nothing');
});
test('waitFor with a selector that never appears fails after its timeout', async () => {
  const r = await shoot(workdir({ ...ONE, pages: [{ path: '/ok', waitFor: '#never' }] }));
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Timeout/);
});
test('mask: a changing element no longer changes the screenshot', async () => {
  const masked = workdir({ ...ONE, pages: [{ path: '/clock', mask: ['#ts'] }] });
  const plain = workdir({ ...ONE, pages: ['/clock'] });
  for (const d of [masked, plain]) { assert.equal((await shoot(d)).code, 0); assert.equal((await shoot(d, site.main, { OUT: 'out2' })).code, 0); }
  assert.ok(bytes(masked, 'desktop__clock__0.png').equals(bytes(masked, 'desktop__clock__0.png', 'out2')), 'the masked runs differ');
  assert.ok(!bytes(plain, 'desktop__clock__0.png').equals(bytes(plain, 'desktop__clock__0.png', 'out2')), 'the unmasked runs are equal: the test proves nothing');
});
test('animations are disabled: a finite one is shown at its end, an infinite one at its start', async () => {
  for (const [moving, still, why] of [['/anim-finite', '/anim-done', 'a 20 s fade-in was not fast-forwarded to its end'],
                                      ['/anim-infinite', '/anim-static', 'an infinite animation was not stopped at its start']]) {
    const a = workdir({ ...ONE, pages: [moving] });
    const b = workdir({ ...ONE, pages: [still] });
    const [ra, rb] = await Promise.all([shoot(a), shoot(b)]);
    assert.equal(ra.code, 0, ra.stderr); assert.equal(rb.code, 0, rb.stderr);
    const name = p => `desktop__${p.slice(1).replace(/\W+/g, '_')}__0.png`;
    assert.ok(bytes(a, name(moving)).equals(bytes(b, name(still))), why);
  }
});
test('a bad pages.json is refused before any browser starts', async () => {
  const r = await shoot(workdir({ pages: [{ path: '/ok', viewports: ['watch'] }] }));
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /unknown viewport "watch"/);
});

// ---- discover.mjs
const discover = (d, pages, env = {}) => { fs.writeFileSync(path.join(d, 'pages.json'), JSON.stringify(pages)); return run('node', ['discover.mjs'], d, { BASE_URL: site.main + '/', ...env }); };
test('discover: finds linked and sitemap pages, skips logout, files, off-site and mail links, reports broken links and off-site redirects', async () => {
  site.visited.clear();
  const d = workdir(['/']);
  const r = await discover(d, ['/']);
  assert.equal(r.code, 0, r.stderr);
  const found = r.stdout.split('\n').filter(Boolean);
  for (const p of ['/about', '/old', '/ok', '/tall', '/sitemap-only', '/missing']) assert.ok(found.includes(p), `${p} not proposed: ${found}`);
  for (const p of ['/logout', '/file.pdf', '/gone', '/']) assert.ok(!found.includes(p), `${p} should not be proposed`);
  assert.ok(!site.visited.has('/logout') && !site.visited.has('/file.pdf'), 'a skipped link was visited');
  assert.match(r.stderr, /broken link: \/missing \(404\)/);
  assert.match(r.stderr, /left out, redirects off the site: \/gone -> http:\/\/127\.0\.0\.1:\d+\/landing/);
  assert.ok(!/\/\/(about|ok)/.test([...site.visited].join('')), 'double slash requested');
});
test('discover: pages already in pages.json are not proposed again', async () => {
  const d = workdir(['/']);
  const r = await discover(d, ['/', '/about', '/ok']);
  const found = r.stdout.split('\n').filter(Boolean);
  assert.ok(!found.includes('/about') && !found.includes('/ok'), found.join());
  assert.ok(found.includes('/tall'));
});
test('discover: DISCOVER_MAX stops the crawl and says so', async () => {
  const r = await discover(workdir(['/']), ['/'], { DISCOVER_MAX: '1' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /stopped at DISCOVER_MAX=1/);
});

// ---- vr.sh end to end (real shoot.mjs and filter.mjs, stub claude)
test('vr.sh: record, an unchanged compare, then a broken page fails the gate', async () => {
  await site.setMode('normal');
  const d = workdir({ ...ONE, pages: ['/shop'] });
  const vr = (args, env = {}) => run('bash', ['vr.sh', ...args], d, { PATH: `${path.join(d, 'bin')}:${process.env.PATH}`, CLAUDE_STUB_LOG: path.join(d, 'claude.log'), CLAUDE_STUB_OUT: path.join(d, 'claude.out'), ...env });
  let r = await vr(['--record', site.main]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.deepEqual(files(d, 'baseline'), ['desktop__shop__0.png']);
  r = await vr([site.main]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /nothing changed/);
  assert.ok(!fs.existsSync(path.join(d, 'claude.log')), 'the judge was called although nothing changed');
  await site.setMode('broken');
  fs.writeFileSync(path.join(d, 'claude.out'), JSON.stringify([{ file: 'desktop__shop__0.png', verdict: 'fail', severity: 4, seen: 'the shop page without its navigation', findings: [{ what: 'navigation is missing' }] }]));
  r = await vr([site.main]);
  assert.equal(r.code, 1, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'changed.json'))), ['desktop__shop__0.png']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'report.json')))[0].severity, 4);
  assert.deepEqual(files(d, 'baseline'), ['desktop__shop__0.png']);        // the compare did not touch the baseline
  await site.setMode('normal');
  r = await vr([site.main]);
  assert.equal(r.code, 0, r.stderr + r.stdout);                            // the site is back to the baseline
  assert.match(r.stdout, /nothing changed/);
});
test('vr.sh: a page that errors stops the compare run and leaves the baseline alone', async () => {
  const d = workdir({ ...ONE, pages: ['/shop'] });
  const vr = args => run('bash', ['vr.sh', ...args], d, { PATH: `${path.join(d, 'bin')}:${process.env.PATH}` });
  assert.equal((await vr(['--record', site.main])).code, 0);
  fs.writeFileSync(path.join(d, 'pages.json'), JSON.stringify({ ...ONE, pages: ['/boom'] }));
  const r = await vr([site.main]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /returned HTTP 500/);
  assert.deepEqual(files(d, 'baseline'), ['desktop__shop__0.png']);
  const rec = await vr(['--record', site.main]);                           // a failed --record keeps the old baseline
  assert.notEqual(rec.code, 0);
  assert.deepEqual(files(d, 'baseline'), ['desktop__shop__0.png']);
  assert.ok(!fs.existsSync(path.join(d, 'baseline.new')));
});

// ---- logins (auth.mjs, login.mjs; shoot.mjs and vr.sh with a profile)
const NO_JUDGE = { customer: null };
const AUTH = { customer: { loginUrl: '/login', fields: { '#email': '$USER', '#password': '$PASSWORD' }, submit: 'button[type=submit]', loggedIn: '#account-menu' } };
NO_JUDGE.customer = { ...AUTH.customer, judge: false };
const authPages = (extra = {}, profile = AUTH) => ({ ...ONE, auth: profile, pages: [{ path: '/account', auth: 'customer', ...extra }] });
const CREDS = { VR_CUSTOMER_USER: site.user.email, VR_CUSTOMER_PASSWORD: site.user.password };
const vrIn = (d, args, env = {}) => run('bash', ['vr.sh', ...args], d, { PATH: `${path.join(d, 'bin')}:${process.env.PATH}`, CLAUDE_STUB_LOG: path.join(d, 'claude.log'), CLAUDE_STUB_OUT: path.join(d, 'claude.out'), ...env });
const session = d => path.join(d, '.auth', 'customer.json');
const loggedInWorkdir = async (pages = authPages()) => {
  const d = workdir(pages);
  const r = await vrIn(d, ['--login', 'customer', site.main], CREDS);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  return d;
};

test('login: a scripted login saves a session only its owner can read, and prints no credential or cookie', async () => {
  const d = workdir(authPages());
  const r = await vrIn(d, ['--login', 'customer', site.main], CREDS);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Saved the session for "customer"/);
  assert.equal(fs.statSync(session(d)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(session(d))).mode & 0o777, 0o700);
  const saved = JSON.parse(fs.readFileSync(session(d)));
  assert.ok(saved.cookies.some(c => c.name === 'sid'), 'the session has no cookie');
  const sid = saved.cookies.find(c => c.name === 'sid').value;
  for (const secret of [site.user.password, site.user.email, sid]) assert.ok(!(r.stdout + r.stderr).includes(secret), 'a secret was printed');
});
test('login: a page behind a login is shot logged in, with the saved session', async () => {
  const d = await loggedInWorkdir();
  const before = site.authedHits();
  const r = await shoot(d);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(files(d), ['desktop__account__0.png']);
  assert.equal(site.authedHits() - before, 1, 'the page was not served to a logged-in visitor');
});
test('login: with no saved session the run says how to log in, and shoots nothing', async () => {
  const d = workdir(authPages());
  const r = await shoot(d);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /No session for the login profile "customer"\. Run: vr\.sh --login customer/);
  assert.deepEqual(files(d), []);
});
test('login: an expired session is an error, not a screenshot of the login page', async () => {
  const d = await loggedInWorkdir();
  await site.expireSessions();
  const r = await shoot(d);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /\/account \[desktop\]: not logged in as "customer" \(it was redirected to the login page\)/);
  assert.match(r.stderr, /vr\.sh --login customer/);
  assert.deepEqual(files(d), []);
});
test('login: a page without the loggedIn marker is an error too', async () => {
  const d = await loggedInWorkdir();
  fs.writeFileSync(path.join(d, 'pages.json'), JSON.stringify(authPages({}, { customer: { ...AUTH.customer, loggedIn: '#not-on-the-page' } })));
  const r = await shoot(d);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /not logged in as "customer" \(#not-on-the-page is not on the page\)/);
  assert.deepEqual(files(d), []);
});
test('login: a wrong password fails clearly, saves nothing and does not print the password', async () => {
  const d = workdir(authPages());
  const r = await vrIn(d, ['--login', 'customer', site.main], { ...CREDS, VR_CUSTOMER_PASSWORD: 'not-the-password-QQ7' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /did not reach a page with #account-menu within 15 seconds/);
  assert.ok(!(r.stdout + r.stderr).includes('not-the-password-QQ7'));
  assert.ok(!fs.existsSync(session(d)));
});
test('login: a missing credential names the environment variable, never a value', async () => {
  const d = workdir(authPages());
  const r = await vrIn(d, ['--login', 'customer', site.main], { VR_CUSTOMER_USER: site.user.email, VR_CUSTOMER_PASSWORD: '' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Set VR_CUSTOMER_PASSWORD \(the "PASSWORD" for the "customer" login\)/);
  assert.ok(!r.stderr.includes(site.user.email));
  assert.ok(!fs.existsSync(session(d)));
});
test('login: an unknown profile, and a call with missing arguments, are errors that say what is known', async () => {
  const d = workdir(authPages());
  let r = await vrIn(d, ['--login', 'nobody', site.main], CREDS);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /No login profile "nobody" in pages\.json \(known: customer\)/);
  r = await vrIn(d, ['--login', 'constructor', site.main], CREDS);               // a name every object has is still not a profile
  assert.equal(r.code, 2);
  assert.match(r.stderr, /No login profile "constructor"/);
  r = await vrIn(d, ['--login', 'customer'], CREDS);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: vr\.sh --login <profile> \[--manual\] <base-url>/);
});
test('login: VR_<PROFILE>_STATE (the session as JSON, or a path to it) works with no file on disk', async () => {
  const d = await loggedInWorkdir();
  const json = fs.readFileSync(session(d), 'utf8');
  const elsewhere = path.join(ROOT, 'elsewhere-session.json');
  fs.writeFileSync(elsewhere, json);
  fs.rmSync(path.dirname(session(d)), { recursive: true });
  for (const value of [json, elsewhere]) {
    fs.rmSync(path.join(d, 'out'), { recursive: true, force: true });
    const r = await shoot(d, site.main, { VR_CUSTOMER_STATE: value });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(files(d), ['desktop__account__0.png']);
  }
  const bad = await shoot(d, site.main, { VR_CUSTOMER_STATE: '{not json' });
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /saved session for "customer" is not readable \(VR_CUSTOMER_STATE must be a session as JSON/);
  assert.ok(!bad.stderr.includes('not json'));
});
test('login: --manual waits for the loggedIn marker (here a page that signs in by itself) and saves the session', async () => {
  const d = workdir(authPages({}, { customer: { ...AUTH.customer, loginUrl: '/login-manual' } }));
  const r = await vrIn(d, ['--login', 'customer', '--manual', site.main], { VR_LOGIN_HEADLESS: '1' });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Waiting up to 5 minutes for #account-menu/);
  assert.equal(fs.statSync(session(d)).mode & 0o777, 0o600);
  assert.equal((await shoot(d)).code, 0);
  assert.deepEqual(files(d), ['desktop__account__0.png']);
});
if (process.platform === 'linux') test('login: --manual with no display says so instead of failing inside the browser', async () => {
  const d = workdir(authPages());
  const r = await vrIn(d, ['--login', 'customer', '--manual', site.main], { DISPLAY: '', WAYLAND_DISPLAY: '', VR_LOGIN_HEADLESS: '' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--manual needs a visible browser and this machine has no display/);
});

// A changed page behind a login is not sent to the judge: it fails the run (nothing else can vouch for it), unless its profile allows the judge.
const privateRun = async (profile, pages) => {
  await site.setMode('normal');
  const d = workdir({ ...ONE, auth: profile, pages });
  assert.equal((await vrIn(d, ['--login', 'customer', site.main], CREDS)).code, 0);
  assert.equal((await vrIn(d, ['--record', site.main])).code, 0);
  const same = await vrIn(d, [site.main]);
  assert.equal(same.code, 0, same.stderr + same.stdout);
  assert.match(same.stdout, /nothing changed/);
  await site.setMode('broken');
  return d;
};
test('vr.sh: with "judge": false a changed page behind a login is never sent to the judge, and fails the run with a report that says why', async () => {
  const d = await privateRun(NO_JUDGE, [{ path: '/account', auth: 'customer' }]);
  const r = await vrIn(d, [site.main]);
  await site.setMode('normal');
  assert.equal(r.code, 1, r.stderr + r.stdout);
  assert.ok(!fs.existsSync(path.join(d, 'claude.log')), 'the judge was called for a page behind a login');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'private.json'))), ['desktop__account__0.png']);
  const [entry] = JSON.parse(fs.readFileSync(path.join(d, 'report.json')));
  assert.deepEqual([entry.file, entry.severity, entry.verdict, entry.judge_skipped], ['desktop__account__0.png', 3, 'fail', true]);
  const html = fs.readFileSync(path.join(d, 'report', 'index.html'), 'utf8');
  assert.match(html, /FAIL/);
  assert.match(html, /Not sent to the judge: this page is behind a login/);
});
test('vr.sh: a page behind a login goes to the judge like any other, and only "judge": false keeps it away', async () => {
  // default: the judge sees the logged-in page and its verdict decides
  let d = await privateRun(AUTH, [{ path: '/account', auth: 'customer' }]);
  fs.writeFileSync(path.join(d, 'claude.out'), JSON.stringify([{ file: 'desktop__account__0.png', verdict: 'pass', severity: 1, seen: 'the account page', findings: [] }]));
  let r = await vrIn(d, [site.main]);
  await site.setMode('normal');
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(fs.readFileSync(path.join(d, 'claude.log'), 'utf8'), /desktop__account__0\.png/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'private.json'))), []);
  assert.ok(!JSON.parse(fs.readFileSync(path.join(d, 'report.json')))[0].judge_skipped);
  d = await privateRun(AUTH, [{ path: '/account', auth: 'customer' }]);
  fs.writeFileSync(path.join(d, 'claude.out'), JSON.stringify([{ file: 'desktop__account__0.png', verdict: 'fail', severity: 4, seen: 'the account page without its orders', findings: [] }]));
  r = await vrIn(d, [site.main]);
  await site.setMode('normal');
  assert.equal(r.code, 1, r.stderr + r.stdout);                      // a broken logged-in page is caught by the judge, like any page
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'report.json')))[0].severity, 4);

  // judge: false: public pages still go to the judge, the logged-in one does not
  d = await privateRun(NO_JUDGE, ['/shop', { path: '/account', auth: 'customer' }]);
  fs.writeFileSync(path.join(d, 'claude.out'), JSON.stringify([{ file: 'desktop__shop__0.png', verdict: 'pass', severity: 0, seen: 'the shop page', findings: [] }]));
  r = await vrIn(d, [site.main]);
  await site.setMode('normal');
  assert.equal(r.code, 1, r.stderr + r.stdout);                      // the page behind the login changed, and nobody vouches for it
  const prompt = fs.readFileSync(path.join(d, 'claude.log'), 'utf8');
  assert.match(prompt, /desktop__shop__0\.png/);
  assert.ok(!prompt.includes('desktop__account__0.png'), 'a page behind a login was named to the judge');

});

// ---- run them
let failed = 0;
const only = process.env.VR_BROWSER_ONLY;
for (const [name, fn] of tests) {
  if (only && !name.includes(only)) continue;
  const t0 = Date.now();
  try { await fn(); console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`); }
}
await site.close();
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
