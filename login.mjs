// vr.sh --login <profile> [--manual] <base-url>: log in once and save the session. See auth.mjs.
import fs from 'fs';
import { launchBrowser } from './browser.mjs';
import { resolveAuth } from './config.mjs';
import { login } from './auth.mjs';
import { dataPath } from './paths.mjs';

const profile = process.env.PROFILE;
const base = process.env.BASE_URL;
const manual = process.env.MANUAL === '1';
const profiles = resolveAuth(JSON.parse(fs.readFileSync(dataPath('pages.json'))));
const cfg = Object.hasOwn(profiles, profile) ? profiles[profile] : undefined;
if (!cfg) {
  console.error(`No login profile "${profile}" in pages.json (known: ${Object.keys(profiles).join(', ') || 'none'}).`);
  process.exit(2);
}

const headless = !manual || process.env.VR_LOGIN_HEADLESS === '1';
if (!headless && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error('--manual needs a visible browser and this machine has no display. Log in on a machine that has one, then copy vr/.auth/<profile>.json here (or put the session in VR_<PROFILE>_STATE).');
  process.exit(2);
}

const browser = await launchBrowser({ headless });
try {
  const file = await login(browser, base, profile, cfg, { manual });
  console.log(`Saved the session for "${profile}" to ${file}. It is a live login: do not commit or share it.`);
} finally {
  await browser.close();
}
