// Unit tests for vr/config.mjs (pages.json -> screenshot targets). No browser. Run: node config.test.mjs <path to vr/>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { resolveTargets, resolveAuth, envName, DEFAULT_VIEWPORTS, DEFAULT_MAX_TILES, fileName, slug } = await import(pathToFileURL(`${process.argv[2]}/config.mjs`));
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('default viewports are desktop 1440x900, tablet 768x1024, mobile 390x844', () => {
  assert.deepEqual(Object.keys(DEFAULT_VIEWPORTS), ['desktop', 'tablet', 'mobile']);
  assert.deepEqual([DEFAULT_VIEWPORTS.desktop.width, DEFAULT_VIEWPORTS.desktop.height], [1440, 900]);
  assert.deepEqual([DEFAULT_VIEWPORTS.tablet.width, DEFAULT_VIEWPORTS.tablet.height], [768, 1024]);
  assert.deepEqual([DEFAULT_VIEWPORTS.mobile.width, DEFAULT_VIEWPORTS.mobile.height], [390, 844]);
  assert.ok(!DEFAULT_VIEWPORTS.desktop.mobile && DEFAULT_VIEWPORTS.tablet.mobile && DEFAULT_VIEWPORTS.mobile.mobile);
});
test('a plain list of paths still works and gets every default viewport', () => {
  const t = resolveTargets(['/', '/pricing']);
  assert.equal(t.length, 6);
  assert.deepEqual(t.map(x => `${x.viewport}:${x.path}`), [
    'desktop:/', 'tablet:/', 'mobile:/', 'desktop:/pricing', 'tablet:/pricing', 'mobile:/pricing']);
});
test('object form uses its own viewports instead of the defaults', () => {
  const t = resolveTargets({ viewports: { phone: { width: 320, height: 568, mobile: true } }, pages: ['/'] });
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].viewport, t[0].width, t[0].height, t[0].mobile], ['phone', 320, 568, true]);
});
test('a page can be limited to some viewports', () => {
  const t = resolveTargets({ pages: ['/', { path: '/checkout', viewports: ['mobile'] }] });
  assert.deepEqual(t.filter(x => x.path === '/checkout').map(x => x.viewport), ['mobile']);
  assert.equal(t.filter(x => x.path === '/').length, 3);
});
test('file names carry viewport, page and tile, and never collide across viewports', () => {
  const names = resolveTargets(['/', '/a/b']).map(x => fileName(x, 0));
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('mobile__home__0.png') && names.includes('tablet__a_b__0.png'));
  assert.equal(slug('/'), 'home');
});
test('rejects empty and non-array page viewport selections', () => {
  for (const viewports of [[], null, 'desktop', {}, 1, false]) {
    assert.throws(() => resolveTargets({ pages: [{ path: '/', viewports }] }), /viewports must be a non-empty array/);
  }
  assert.equal(resolveTargets({ pages: [{ path: '/' }] }).length, 3);
});
test('rejects unknown viewport names, naming the known ones', () => {
  assert.throws(() => resolveTargets({ pages: [{ path: '/', viewports: ['watch'] }] }), /unknown viewport "watch".*desktop, tablet, mobile/);
});
test('rejects bad paths, empty pages, bad viewport sizes and names', () => {
  assert.throws(() => resolveTargets(['pricing']), /starting with "\/"/);
  assert.throws(() => resolveTargets([]), /non-empty/);
  assert.throws(() => resolveTargets({ pages: ['/'], viewports: { x: { width: 0, height: 10 } } }), /integer width and height/);
  assert.throws(() => resolveTargets({ pages: ['/'], viewports: { 'bad name': { width: 1, height: 1 } } }), /letters, digits/);
  assert.throws(() => resolveTargets({ pages: ['/'], viewports: {} }), /must not be empty/);
});
test('rejects a page listed twice', () => {
  assert.throws(() => resolveTargets(['/', '/']), /listed twice/);
});
test('per-page options reach the target; defaults are empty mask, no wait, 6 tiles', () => {
  const [a, b] = resolveTargets({ pages: ['/', { path: '/x', waitFor: '.ready', mask: ['.ts', '#ad'], expectStatus: 404, maxTiles: 9 }], viewports: { d: { width: 10, height: 10 } } });
  assert.deepEqual([a.waitFor, a.mask, a.expectStatus, a.maxTiles], [undefined, [], undefined, 6]);
  assert.equal(DEFAULT_MAX_TILES, 6);
  assert.deepEqual([b.waitFor, b.mask, b.expectStatus, b.maxTiles], ['.ready', ['.ts', '#ad'], 404, 9]);
});
test('top-level maxTiles is the default for every page, a page can override it', () => {
  const t = resolveTargets({ maxTiles: 10, pages: ['/', { path: '/y', maxTiles: 3 }], viewports: { d: { width: 10, height: 10 } } });
  assert.deepEqual(t.map(x => x.maxTiles), [10, 3]);
});
test('rejects bad per-page options', () => {
  const bad = o => () => resolveTargets({ pages: [{ path: '/', ...o }] });
  assert.throws(bad({ waitFor: '' }), /waitFor/);
  assert.throws(bad({ mask: '.x' }), /mask/);
  assert.throws(bad({ mask: [1] }), /mask/);
  assert.throws(bad({ expectStatus: 'ok' }), /expectStatus/);
  assert.throws(bad({ expectStatus: 99 }), /expectStatus/);
  assert.throws(bad({ maxTiles: 0 }), /maxTiles/);
  assert.throws(() => resolveTargets({ maxTiles: -1, pages: ['/'] }), /maxTiles/);
});

// ---- login profiles
const PROFILE = { loginUrl: '/login', fields: { '#email': '$USER', '#password': '$PASSWORD' }, submit: 'button[type=submit]', loggedIn: '#account-menu' };
const withAuth = (profile, pages = [{ path: '/orders', auth: 'customer' }]) => ({ auth: { customer: profile }, pages });
test('a login profile and a page that uses it resolve; the page is private (not for the judge) unless the profile says judge: true', () => {
  const t = resolveTargets({ viewports: { d: { width: 10, height: 10 } }, ...withAuth(PROFILE, ['/', { path: '/orders', auth: 'customer' }]) });
  assert.deepEqual(t.map(x => [x.path, x.auth, x.private]), [['/', undefined, false], ['/orders', 'customer', true]]);
  const open = resolveTargets({ viewports: { d: { width: 10, height: 10 } }, ...withAuth({ ...PROFILE, judge: true }) });
  assert.deepEqual([open[0].auth, open[0].private], ['customer', false]);
  const p = resolveAuth(withAuth(PROFILE)).customer;
  assert.deepEqual(p.fields, [['#email', 'USER'], ['#password', 'PASSWORD']]);
  assert.deepEqual([p.loginUrl, p.submit, p.loggedIn, p.judge], ['/login', 'button[type=submit]', '#account-menu', false]);
});
test('no auth is fine: a plain list and an object without "auth" have no profiles', () => {
  assert.deepEqual(resolveAuth(['/']), {});
  assert.deepEqual(resolveAuth({ pages: ['/'] }), {});
});
test('environment variable names: VR_<PROFILE>_<NAME>, with any other character in the profile name turned into _', () => {
  assert.equal(envName('customer', 'USER'), 'VR_CUSTOMER_USER');
  assert.equal(envName('my-shop', 'STATE'), 'VR_MY_SHOP_STATE');
});
test('credentials can never be written into pages.json: a field value must be a $NAME reference', () => {
  for (const value of ['hunter2', '$lower', '$', '', 5, null, '$A B', 'x$USER']) {
    assert.throws(() => resolveAuth(withAuth({ ...PROFILE, fields: { '#password': value } })), /must be a \$NAME reference to an environment variable/, String(value));
  }
  const err = (() => { try { resolveAuth(withAuth({ ...PROFILE, fields: { '#password': 'hunter2-secret' } })); } catch (e) { return e.message; } })();
  assert.ok(!err.includes('hunter2-secret'), 'the rejected value was echoed in the error');
  assert.match(err, /VR_CUSTOMER_NAME/);
});
test('profile validation: name, loginUrl, fields, loggedIn, submit, judge', () => {
  const bad = (patch, re) => assert.throws(() => resolveAuth(withAuth({ ...PROFILE, ...patch })), re);
  bad({ loginUrl: 'login' }, /loginUrl must be a path starting with "\/"/);
  bad({ loginUrl: undefined }, /loginUrl/);
  bad({ fields: {} }, /fields must be an object/);
  bad({ fields: ['#a'] }, /fields must be an object/);
  bad({ fields: { '': '$USER' } }, /selector must not be empty/);
  bad({ loggedIn: undefined }, /loggedIn must be a CSS selector/);
  bad({ loggedIn: '  ' }, /loggedIn must be a CSS selector/);
  bad({ submit: '' }, /submit must be a CSS selector string/);
  bad({ judge: 'yes' }, /judge must be true or false/);
  assert.throws(() => resolveAuth({ auth: { 'bad name': PROFILE }, pages: ['/'] }), /profile name "bad name"/);
  assert.throws(() => resolveAuth({ auth: [PROFILE], pages: ['/'] }), /"auth" must be an object/);
  assert.throws(() => resolveAuth({ auth: { customer: null }, pages: ['/'] }), /must be an object/);
});
test('a page can only use a profile that exists', () => {
  assert.throws(() => resolveTargets(withAuth(PROFILE, [{ path: '/orders', auth: 'nobody' }])), /page "\/orders": auth must name a profile defined under "auth" \(known: customer\)/);
  assert.throws(() => resolveTargets({ pages: [{ path: '/orders', auth: 'customer' }] }), /known: none/);
  assert.throws(() => resolveTargets(withAuth(PROFILE, [{ path: '/orders', auth: 5 }])), /auth must name a profile/);
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {        // names every object has: not profiles
    assert.throws(() => resolveTargets(withAuth(PROFILE, [{ path: '/orders', auth: name }])), /auth must name a profile/, name);
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
process.exit(failed ? 1 : 0);
