// Unit tests for vr/auth.mjs: where sessions live and who can read them, how credentials are read, and that errors never
// carry a secret. No browser. Run: node auth.test.mjs <path to vr/>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// auth.mjs keeps sessions next to itself, so test a copy in a temp folder, never the real vr/.auth.
const SRC = path.resolve(process.argv[2]);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-auth-'));
for (const f of ['auth.mjs', 'config.mjs', 'links.mjs', 'paths.mjs']) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
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
for (const exists of [true, false]) {
  test(`saving rejects a .gitignore symlink to ${exists ? 'an existing' : 'a missing'} target without writing it`, () => {
    const ignore = path.join(dir, '.auth', '.gitignore');
    const target = path.join(dir, exists ? 'existing-target' : 'missing-target');
    if (exists) fs.writeFileSync(target, 'keep this content\n');
    fs.unlinkSync(ignore);
    fs.symlinkSync(target, ignore);
    try {
      assert.throws(() => saveSession('symlink', SESSION), { code: 'ELOOP' });
      assert.ok(fs.lstatSync(ignore).isSymbolicLink());
      if (exists) assert.equal(fs.readFileSync(target, 'utf8'), 'keep this content\n');
      else assert.ok(!fs.existsSync(target), 'the symlink target was created');
      assert.ok(!fs.existsSync(statePath('symlink')), 'a session was saved despite the unsafe .gitignore');
    } finally {
      fs.unlinkSync(ignore);
      fs.writeFileSync(ignore, '*\n');
    }
  });
}
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

// Run a snippet that imports a module of the tool with VR_DATA set (it is read when the module loads) and print what it returns.
const withData = (data, module, expression) => {
  const url = pathToFileURL(path.join(dir, module)).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import * as m from '${url}'; console.log(${expression})`],
                      { env: { ...process.env, VR_DATA: data }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
test('without VR_DATA the data folder is the code folder (how the tool has always worked)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import * as m from '${pathToFileURL(path.join(dir, 'paths.mjs')).href}'; console.log(m.TOOL, m.DATA)`],
                      { env: { ...process.env, VR_DATA: '' }, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), `${dir} ${dir}`);
});
test('with VR_DATA the data folder is that folder, relative or not, and the code folder stays where the code is', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-data-'));
  assert.equal(withData(data, 'paths.mjs', 'm.TOOL'), dir);
  assert.equal(withData(data, 'paths.mjs', 'm.DATA'), data);
  assert.equal(withData(data, 'paths.mjs', "m.dataPath('pages.json')"), path.join(data, 'pages.json'));
  assert.equal(withData(path.relative(process.cwd(), data), 'paths.mjs', 'm.DATA'), data);
});
test('with VR_DATA a saved session goes in the data folder\'s .auth, and the code folder gets nothing', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-data-'));
  const saved = withData(data, 'auth.mjs', "m.saveSession('moved', { cookies: [] })");
  assert.equal(saved, path.join(data, '.auth', 'moved.json'));
  assert.equal(fs.statSync(saved).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(path.join(dir, '.auth', 'moved.json')), 'the session was saved next to the code');
  assert.equal(withData(data, 'auth.mjs', "JSON.stringify(m.loadSession('moved', {}))"), '{"cookies":[]}');
});

test('the session folder ignores itself in git, wherever it is, so a live login cannot be committed by accident', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-git-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: data }).status, 0);
  const saved = withData(data, 'auth.mjs', "m.saveSession('gitcase', { cookies: [{ name: 'sid', value: 'secret' }] })");
  assert.equal(fs.readFileSync(path.join(data, '.auth', '.gitignore'), 'utf8'), '*\n');
  assert.equal(spawnSync('git', ['check-ignore', '-q', saved], { cwd: data }).status, 0, 'git would commit the session');
  fs.writeFileSync(path.join(data, 'pages.json'), '[]');
  spawnSync('git', ['add', '-A'], { cwd: data });
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: data, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  assert.deepEqual(staged, ['pages.json']);                       // `git add -A` takes the project's files and leaves the login behind
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
