// Unit tests for vr/auth.mjs: where sessions live and who can read them, how credentials are read, and that errors never
// carry a secret. No browser. Run: node auth.test.mjs <path to vr/>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// auth.mjs keeps sessions next to itself, so test a copy in a temp folder, never the real vr/.auth.
const SRC = path.resolve(process.argv[2]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-auth-'));
for (const f of ['auth.mjs', 'config.mjs', 'links.mjs']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
const { loadSession, saveSession, statePath, credentials } = await import(pathToFileURL(path.join(dir, 'auth.mjs')));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const SESSION = { cookies: [{ name: 'sid', value: 'abc123-secret' }], origins: [] };
const CFG = { fields: [['#email', 'USER'], ['#password', 'PASSWORD']] };

test('a saved session lives in .auth/<profile>.json, readable and writable only by its owner', () => {
  const file = saveSession('customer', SESSION);
  assert.equal(file, statePath('customer'));
  assert.equal(file, path.join(dir, '.auth', 'customer.json'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepEqual(loadSession('customer', {}), SESSION);
});
test('saving over an existing session keeps it private', () => {
  fs.chmodSync(statePath('customer'), 0o644);
  saveSession('customer', SESSION);
  assert.equal(fs.statSync(statePath('customer')).mode & 0o777, 0o600);
});
test('no session anywhere is null, not an error (shoot.mjs turns it into "run vr.sh --login")', () => {
  assert.equal(loadSession('nobody', {}), null);
});
test('VR_<PROFILE>_STATE wins over the file, as inline JSON or as a path to a file', () => {
  const other = { cookies: [{ name: 'sid', value: 'from-env' }], origins: [] };
  assert.deepEqual(loadSession('customer', { VR_CUSTOMER_STATE: JSON.stringify(other) }), other);
  const file = path.join(dir, 'elsewhere.json');
  fs.writeFileSync(file, JSON.stringify(other));
  assert.deepEqual(loadSession('customer', { VR_CUSTOMER_STATE: file }), other);
  assert.deepEqual(loadSession('customer', { VR_CUSTOMER_STATE: '   ' }), SESSION);      // blank: ignored
});
test('an unreadable session is an error that says how to fix it and never prints the content', () => {
  const secret = 'abc-secret-token';
  for (const env of [{ VR_CUSTOMER_STATE: `{"cookies": ${secret}` }, { VR_CUSTOMER_STATE: path.join(dir, 'missing.json') }]) {
    assert.throws(() => loadSession('customer', env), e => /not readable \(VR_CUSTOMER_STATE must be a session as JSON/.test(e.message) && !e.message.includes(secret));
  }
  fs.writeFileSync(statePath('broken'), `{${secret}`);
  assert.throws(() => loadSession('broken', {}), e => /Run vr\.sh --login broken <base-url> again/.test(e.message) && !e.message.includes(secret));
});
test('credentials come from VR_<PROFILE>_<NAME>; a missing one is an error naming the variable, not a value', () => {
  assert.deepEqual(credentials('customer', CFG, { VR_CUSTOMER_USER: 'a@b.c', VR_CUSTOMER_PASSWORD: 'pw' }), [['#email', 'a@b.c'], ['#password', 'pw']]);
  for (const env of [{ VR_CUSTOMER_USER: 'a@b.c' }, { VR_CUSTOMER_USER: 'a@b.c', VR_CUSTOMER_PASSWORD: '' }]) {
    assert.throws(() => credentials('customer', CFG, env), e => /Set VR_CUSTOMER_PASSWORD \(the "PASSWORD" for the "customer" login\)/.test(e.message) && !e.message.includes('a@b.c'));
  }
  assert.throws(() => credentials('customer', CFG, {}), /Set VR_CUSTOMER_USER/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
