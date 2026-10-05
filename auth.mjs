// Logged-in sessions for pages behind a login. A session is Playwright's storageState (cookies and localStorage),
// kept in vr/.auth/<profile>.json (gitignored, readable only by you) or given in VR_<PROFILE>_STATE, either as a path
// to such a file or as the JSON itself (for a CI secret). A session is a live login: treat it like a password.
// Nothing here ever prints a credential or a session.
import fs from 'fs';
import path from 'path';
import { envName } from './config.mjs';
import { dataPath } from './paths.mjs';
import { joinUrl } from './links.mjs';

const AUTH_DIR = dataPath('.auth');
export const statePath = profile => path.join(AUTH_DIR, `${profile}.json`);

export function loadSession(profile, env = process.env) {
  const name = envName(profile, 'STATE');
  const given = env[name];
  try {
    if (given && given.trim()) return JSON.parse(given.trim().startsWith('{') ? given : fs.readFileSync(given.trim(), 'utf8'));
    if (fs.existsSync(statePath(profile))) return JSON.parse(fs.readFileSync(statePath(profile), 'utf8'));
  } catch {
    throw new Error(`The saved session for "${profile}" is not readable${given ? ` (${name} must be a session as JSON, or the path of a JSON file)` : ` (${statePath(profile)})`}. Run vr.sh --login ${profile} <base-url> again.`);
  }
  return null;
}

export function saveSession(profile, state) {
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(AUTH_DIR, 0o700);
  const file = statePath(profile);
  fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

// The values for a profile's fields, from the environment. A missing one is an error that names the variable, never a value.
export function credentials(profile, cfg, env = process.env) {
  return cfg.fields.map(([selector, ref]) => {
    const name = envName(profile, ref);
    if (env[name] === undefined || env[name] === '') throw new Error(`Set ${name} (the "${ref}" for the "${profile}" login) in the environment.`);
    return [selector, env[name]];
  });
}

const expired = (where, profile, why) => new Error(
  `${where}: not logged in as "${profile}" (${why}). The session has probably expired: run vr.sh --login ${profile} <base-url> again.`);

// A protected page that redirected to the login form would otherwise be screenshotted as "the page", and a baseline of
// the login form compared against another login form passes. So every logged-in page is checked before it is shot.
export async function assertLoggedIn(page, profile, cfg, where) {
  if (new URL(page.url()).pathname === cfg.loginUrl.split('?')[0]) throw expired(where, profile, 'it was redirected to the login page');
  try { await page.waitForSelector(cfg.loggedIn, { timeout: 5000 }); }
  catch { throw expired(where, profile, `${cfg.loggedIn} is not on the page`); }
}

// vr.sh --login <profile> [--manual] <base-url>: log in once and save the session.
//   scripted: fills the profile's fields (credentials from the environment) and submits.
//   manual:   opens a visible browser for a person to log in (SSO, MFA, captcha) and saves the session when
//             the profile's loggedIn selector appears. VR_LOGIN_HEADLESS=1 runs it without a window (for tests).
export async function login(browser, base, profile, cfg, { manual = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(joinUrl(base, cfg.loginUrl), { waitUntil: 'networkidle' });
  if (manual) {
    console.log(`Log in as "${profile}" in the browser window. Waiting up to 5 minutes for ${cfg.loggedIn} to appear...`);
    try { await page.waitForSelector(cfg.loggedIn, { timeout: 300000 }); }
    catch { throw new Error(`Gave up waiting for ${cfg.loggedIn}: no login within 5 minutes.`); }
  } else {
    for (const [selector, value] of credentials(profile, cfg)) await page.fill(selector, value, { timeout: 10000 });
    if (cfg.submit) await page.click(cfg.submit, { timeout: 10000 }); else await page.keyboard.press('Enter');
    try { await page.waitForSelector(cfg.loggedIn, { timeout: 15000 }); }
    catch { throw new Error(`Login as "${profile}" did not reach a page with ${cfg.loggedIn} within 15 seconds: wrong credentials, a changed form, or a second step (MFA, captcha)? For those use vr.sh --login ${profile} --manual <base-url>.`); }
  }
  const file = saveSession(profile, await ctx.storageState());
  await ctx.close();
  return file;
}
