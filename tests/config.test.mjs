// Unit tests for vr/config.mjs (pages.json -> screenshot targets). No browser. Run: node config.test.mjs <path to vr/>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { describeStep, stepTimeout } = await import(pathToFileURL(`${process.argv[2]}/steps.mjs`));
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
test('a login profile and a page that uses it resolve; the page goes to the judge like any other unless the profile says judge: false', () => {
  const t = resolveTargets({ viewports: { d: { width: 10, height: 10 } }, ...withAuth(PROFILE, ['/', { path: '/orders', auth: 'customer' }]) });
  assert.deepEqual(t.map(x => [x.path, x.auth, x.private]), [['/', undefined, false], ['/orders', 'customer', false]]);
  const closed = resolveTargets({ viewports: { d: { width: 10, height: 10 } }, ...withAuth({ ...PROFILE, judge: false }) });
  assert.deepEqual([closed[0].auth, closed[0].private], ['customer', true]);
  const explicit = resolveTargets({ viewports: { d: { width: 10, height: 10 } }, ...withAuth({ ...PROFILE, judge: true }) });
  assert.equal(explicit[0].private, false);
  const p = resolveAuth(withAuth(PROFILE)).customer;
  assert.deepEqual(p.fields, [['#email', 'USER'], ['#password', 'PASSWORD']]);
  assert.deepEqual([p.loginUrl, p.submit, p.loggedIn, p.judge], ['/login', 'button[type=submit]', '#account-menu', true]);
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

// ---- page names and steps
const VP = { viewports: { d: { width: 10, height: 10 } } };
const one = page => resolveTargets({ ...VP, pages: [page] })[0];
test('a page name is used in the file name; without one the file name still comes from the path', () => {
  assert.equal(fileName(one({ path: '/orders', name: 'orders-empty' }), 0), 'd__orders-empty__0.png');
  assert.equal(fileName(one({ path: '/orders' }), 0), 'd__orders__0.png');
  assert.equal(one({ path: '/orders' }).name, 'orders');
  assert.equal(one({ path: '/orders', name: 'x_1-Y' }).name, 'x_1-Y');
});
test('the same path can be listed more than once under different names, but two pages cannot share a file name', () => {
  const t = resolveTargets({ ...VP, pages: ['/greeting', { path: '/greeting', name: 'greeting-in' }, { path: '/greeting', name: 'greeting-menu', steps: [{ click: '#m' }] }] });
  assert.deepEqual(t.map(x => x.name), ['greeting', 'greeting-in', 'greeting-menu']);
  assert.throws(() => resolveTargets({ ...VP, pages: ['/a', '/a'] }), /listed twice for viewport "d".*give one of them a "name"/);
  assert.throws(() => resolveTargets({ ...VP, pages: [{ path: '/a', name: 'x' }, { path: '/b', name: 'x' }] }), /listed twice/);
  assert.throws(() => resolveTargets({ ...VP, pages: ['/orders', { path: '/other', name: 'orders' }] }), /listed twice/);   // a name can collide with another page's path
});
test('a page name must be safe in a file name', () => {
  for (const name of ['', ' ', 'a b', 'a/b', '../x', '-x', '_x', 'a.png', 5, null, ['a']]) {
    assert.throws(() => one({ path: '/', name }), /name must be letters, digits, "-" or "_"/, String(name));
  }
});
test('steps are carried on the target; a page without steps has none', () => {
  assert.deepEqual(one('/').steps, []);
  const steps = [{ click: '#cart' }, { fill: { selector: '#q', value: 'shoes' } }, { press: 'Enter' }, { waitFor: '.done' }, { hover: '#m' },
                 { select: { selector: '#s', value: 'L' } }, { wait: 500 }];
  assert.deepEqual(one({ path: '/', steps }).steps, steps);
});
test('every kind of step is checked: one action per step, and the right shape for it', () => {
  const bad = (steps, re) => assert.throws(() => one({ path: '/', steps }), re, JSON.stringify(steps));
  bad([], /steps must be a list of 1 to 20 actions/);
  bad('click', /steps must be a list of 1 to 20 actions/);
  bad(Array.from({ length: 21 }, () => ({ press: 'a' })), /steps must be a list of 1 to 20 actions/);
  bad([null], /step 1 must be an object with exactly one of: click, hover, fill, select, press, waitFor, wait/);
  bad([{}], /step 1 must be an object with exactly one of/);
  bad([{ click: '#a', hover: '#b' }], /step 1 must be an object with exactly one of/);
  bad([{ drag: '#a' }], /step 1 must be an object with exactly one of/);
  bad([['click', '#a']], /step 1 must be an object with exactly one of/);
  for (const action of ['click', 'hover', 'waitFor']) { bad([{ [action]: '' }], /must be a CSS selector string/); bad([{ [action]: 5 }], /must be a CSS selector string/); }
  bad([{ press: '' }], /press must be a key name/);
  bad([{ press: 13 }], /press must be a key name/);
  for (const wait of [-1, 10001, 1.5, '500', null]) bad([{ wait }], /wait must be a whole number of milliseconds, 0 to 10000/);
  for (const action of ['fill', 'select']) {
    bad([{ [action]: '#q' }], /must be \{ "selector": "<css>", "value": "<text>" \}/);
    bad([{ [action]: { selector: '#q' } }], /must be \{ "selector"/);
    bad([{ [action]: { selector: '', value: 'x' } }], /must be \{ "selector"/);
    bad([{ [action]: { selector: '#q', value: 5 } }], /must be \{ "selector"/);
    bad([{ [action]: { selector: '#q', value: 'x', extra: 1 } }], /must be \{ "selector"/);
  }
  bad([{ select: { selector: '#s', value: '' } }], /must be \{ "selector"/);       // an empty option makes no sense, an empty fill clears a field
  assert.doesNotThrow(() => one({ path: '/', steps: [{ fill: { selector: '#q', value: '' } }, { wait: 0 }, { wait: 10000 }] }));
});
test('a step error names the page, its name and the step number', () => {
  assert.throws(() => one({ path: '/cart', name: 'cart-open', steps: [{ click: '#a' }, { click: '' }] }), /page "\/cart" \(cart-open\): step 2: click must be a CSS selector string/);
  assert.throws(() => one({ path: '/cart', steps: [{ nope: 1 }] }), /page "\/cart": step 1 must be an object/);
});
test('steps and names work together with a login profile, and a page with steps stays private only if its profile says judge: false', () => {
  const profile = { loginUrl: '/login', fields: { '#e': '$USER' }, loggedIn: '#m' };
  const t = resolveTargets({ ...VP, auth: { customer: { ...profile, judge: false } }, pages: [{ path: '/orders', name: 'orders-in', auth: 'customer', steps: [{ click: '#x' }] }] });
  assert.deepEqual([t[0].name, t[0].auth, t[0].private, t[0].steps.length], ['orders-in', 'customer', true, 1]);
});

test('VR_STEP_TIMEOUT_MS is used only as a positive whole number of milliseconds; anything else is 10 seconds, never "no timeout"', () => {
  for (const [value, expected] of [['1500', 1500], [' 2000 ', 2000], ['1e3', 1000], ['1', 1],
                                   [undefined, 10000], ['', 10000], ['  ', 10000], ['0', 10000], ['-5', 10000], ['1.5', 10000],
                                   ['abc', 10000], ['Infinity', 10000], ['NaN', 10000], ['10s', 10000]]) {
    assert.equal(stepTimeout(value), expected, JSON.stringify(value));
  }
});
test('a step is described by its action and selector, never by the value that was typed or chosen', () => {
  assert.equal(describeStep({ click: '#cart' }), 'click "#cart"');
  assert.equal(describeStep({ hover: '#menu' }), 'hover "#menu"');
  assert.equal(describeStep({ waitFor: '.done' }), 'waitFor ".done"');
  assert.equal(describeStep({ press: 'Enter' }), 'press "Enter"');
  assert.equal(describeStep({ wait: 500 }), 'wait 500ms');
  assert.equal(describeStep({ fill: { selector: '#password', value: 'hunter2-secret' } }), 'fill "#password"');
  assert.equal(describeStep({ select: { selector: '#size', value: 'secret-size' } }), 'select "#size"');
  for (const step of [{ fill: { selector: '#p', value: 'hunter2-secret' } }, { select: { selector: '#p', value: 'hunter2-secret' } }]) {
    assert.ok(!describeStep(step).includes('hunter2-secret'));
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
process.exit(failed ? 1 : 0);
