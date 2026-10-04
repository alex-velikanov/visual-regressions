// Unit tests for vr/config.mjs (pages.json -> screenshot targets). No browser. Run: node config.test.mjs <path to vr/>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { resolveTargets, DEFAULT_VIEWPORTS, DEFAULT_MAX_TILES, fileName, slug } = await import(pathToFileURL(`${process.argv[2]}/config.mjs`));
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

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
process.exit(failed ? 1 : 0);
