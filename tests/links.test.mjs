// Unit tests for vr/links.mjs (what `vr.sh --discover` proposes). No browser. Run: node links.test.mjs <path to vr/>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { normalizeLink, shouldSkip, parseSitemap, newPaths, joinUrl } = await import(pathToFileURL(`${process.argv[2]}/links.mjs`));
const B = 'https://shop.example.com';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('same-origin links become paths; fragments are dropped, queries and trailing slashes are kept', () => {
  assert.equal(normalizeLink('/pricing', B), '/pricing');
  assert.equal(normalizeLink('/pricing/', B), '/pricing/');
  assert.equal(normalizeLink('/pricing#plans', B), '/pricing');
  assert.equal(normalizeLink('/pricing?ref=nav', B), '/pricing?ref=nav');
  assert.equal(normalizeLink('https://shop.example.com/', B), '/');
  assert.equal(normalizeLink('', B), '/');
});
test('relative links resolve against the page they were found on', () => {
  assert.equal(normalizeLink('team', B, `${B}/about/`), '/about/team');
  assert.equal(normalizeLink('../contact', B, `${B}/about/team`), '/contact');
});
test('off-site, other-scheme and malformed links are ignored', () => {
  assert.equal(normalizeLink('https://other.example.com/x', B), null);
  assert.equal(normalizeLink('http://shop.example.com/x', B), null);       // different origin (scheme)
  assert.equal(normalizeLink('mailto:a@b.c', B), null);
  assert.equal(normalizeLink('tel:+123', B), null);
  assert.equal(normalizeLink('javascript:void(0)', B), null);
  assert.equal(normalizeLink('http://[bad', B), null);
});
test('a base URL with a path prefix: paths are relative to it, links outside it are ignored', () => {
  assert.equal(normalizeLink('/app/pricing', `${B}/app`), '/pricing');
  assert.equal(normalizeLink('/app', `${B}/app/`), '/');
  assert.equal(normalizeLink('/app/pricing/?x=1#plans', `${B}/app///`), '/pricing/?x=1');
  assert.equal(normalizeLink('/other', `${B}/app`), null);
  assert.equal(normalizeLink('/application', `${B}/app`), null);
});
test('logout links and files are skipped; extra ignore patterns apply', () => {
  for (const p of ['/logout', '/account/sign-out', '/signout', '/log_out', '/logout?next=/']) assert.ok(shouldSkip(p), p);
  for (const p of ['/a.pdf', '/img/x.PNG', '/app.js', '/feed.xml', '/a.pdf?download=1', '/img/x.PNG?v=2']) assert.ok(shouldSkip(p), p);
  for (const p of ['/pricing', '/blog/logout-tips-2024', '/search?file=a.pdf']) assert.ok(!shouldSkip(p), p);
  assert.ok(shouldSkip('/admin/users', ['^/admin']));
  assert.ok(!shouldSkip('/pricing', ['^/admin']));
});
test('sitemap: <loc> entries become paths, off-site and nested sitemaps are dropped', () => {
  const xml = `<urlset><url><loc>${B}/a</loc></url><url><loc> ${B}/b?x=1&amp;y=2 </loc></url>
    <url><loc>https://elsewhere.com/c</loc></url></urlset>`;
  assert.deepEqual(parseSitemap(xml, B), ['/a', '/b?x=1&y=2']);
  assert.deepEqual(parseSitemap('', B), []);
});
test('newPaths: only what is not already listed, de-duplicated and sorted', () => {
  assert.deepEqual(newPaths(['/b', '/a', '/b', '/c'], ['/c']), ['/a', '/b']);
  assert.deepEqual(newPaths([], ['/']), []);
});
test('joinUrl: never doubles the slash between a base URL and a path', () => {
  assert.equal(joinUrl('https://shop.example.com', '/pricing'), 'https://shop.example.com/pricing');
  assert.equal(joinUrl('https://shop.example.com/', '/pricing'), 'https://shop.example.com/pricing');
  assert.equal(joinUrl('https://shop.example.com///', '/'), 'https://shop.example.com/');
  assert.equal(joinUrl('https://shop.example.com/app/', '/pricing?x=1'), 'https://shop.example.com/app/pricing?x=1');
});
test('a redirect target outside the site (other origin, or outside the base path) is out of scope', () => {
  assert.equal(normalizeLink('https://other.example.com/landing', B), null);
  assert.equal(normalizeLink('https://shop.example.com/login', `${B}/app`), null);
  assert.equal(normalizeLink('https://shop.example.com/app/new-home', `${B}/app`), '/new-home');
  assert.equal(normalizeLink('https://shop.example.com/elsewhere', B), '/elsewhere');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
process.exit(failed ? 1 : 0);
