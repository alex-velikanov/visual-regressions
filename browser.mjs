// Which Chromium the vr scripts drive: Playwright's own by default, or the one named in VR_CHROMIUM
// (a system Chrome, or a browser installed somewhere Playwright does not look). options: Playwright launch options.
import { chromium } from 'playwright';

export function launchBrowser(options = {}) {
  return chromium.launch({ ...(process.env.VR_CHROMIUM ? { executablePath: process.env.VR_CHROMIUM } : {}), ...options });
}
