// Turns pages.json into the list of (viewport, page) screenshots to take. No browser needed.
//
// pages.json is either a plain list of paths, which uses the default viewports:
//   ["/", "/pricing"]
// or an object with your own viewports and per-page options:
//   { "viewports": { "desktop": { "width": 1440, "height": 900 }, "phone": { "width": 390, "height": 844, "mobile": true } },
//     "pages": ["/", { "path": "/checkout", "viewports": ["phone"] }] }
// "mobile": true emulates a touch device (mobile viewport meta handling, touch events).
//
// Per-page options (object form of a page):
//   "waitFor": "<css selector>"   wait for it to appear before shooting (content that loads after the network is idle)
//   "mask":    ["<css>", ...]     paint over these elements (timestamps, ads, random content) in every screenshot
//   "expectStatus": 404           the HTTP status the page should return (default: any status below 400)
//   "maxTiles": 8                 allow a taller page (default 6 screenshots per page and viewport; more is an error)
// Top level: "maxTiles" sets that default for every page.
// "discover": { "ignore": ["^/admin"] } lists extra path patterns for `vr.sh --discover` to skip.

export const DEFAULT_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024, mobile: true },
  mobile: { width: 390, height: 844, mobile: true },
};

export function slug(path) {
  return path.replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'home';
}

export function fileName(target, tile) {
  return `${target.viewport}__${slug(target.path)}__${tile}.png`;
}

export const DEFAULT_MAX_TILES = 6;

function checkOptions(p) {
  if (p.waitFor !== undefined && (typeof p.waitFor !== 'string' || !p.waitFor)) throw new Error(`page "${p.path}": waitFor must be a CSS selector string`);
  if (p.mask !== undefined && (!Array.isArray(p.mask) || p.mask.some(m => typeof m !== 'string' || !m))) throw new Error(`page "${p.path}": mask must be a list of CSS selectors`);
  if (p.expectStatus !== undefined && (!Number.isInteger(p.expectStatus) || p.expectStatus < 100 || p.expectStatus > 599)) throw new Error(`page "${p.path}": expectStatus must be an HTTP status code`);
  if (p.maxTiles !== undefined && (!Number.isInteger(p.maxTiles) || p.maxTiles < 1)) throw new Error(`page "${p.path}": maxTiles must be a positive integer`);
}

export function resolveTargets(raw) {
  const cfg = Array.isArray(raw) ? { pages: raw } : raw;
  if (!cfg || !Array.isArray(cfg.pages) || cfg.pages.length === 0) {
    throw new Error('pages.json needs a non-empty list of pages');
  }
  checkOptions({ path: '(top level)', maxTiles: cfg.maxTiles });
  const viewports = cfg.viewports ?? DEFAULT_VIEWPORTS;
  const names = Object.keys(viewports);
  if (names.length === 0) throw new Error('"viewports" must not be empty');
  for (const n of names) {
    const v = viewports[n];
    if (!/^[a-z0-9-]+$/i.test(n)) throw new Error(`viewport name "${n}" must be letters, digits or "-"`);
    if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width <= 0 || v.height <= 0) {
      throw new Error(`viewport "${n}" needs integer width and height`);
    }
  }

  const targets = [];
  const seen = new Set();
  for (const page of cfg.pages) {
    const p = typeof page === 'string' ? { path: page } : page;
    if (typeof p.path !== 'string' || !p.path.startsWith('/')) {
      throw new Error(`page path must be a string starting with "/": ${JSON.stringify(page)}`);
    }
    checkOptions(p);
    if (p.viewports !== undefined && (!Array.isArray(p.viewports) || p.viewports.length === 0)) {
      throw new Error(`page "${p.path}": viewports must be a non-empty array`);
    }
    for (const name of p.viewports ?? names) {
      if (!viewports[name]) throw new Error(`page "${p.path}" uses unknown viewport "${name}" (known: ${names.join(', ')})`);
      const key = `${name}__${slug(p.path)}`;
      if (seen.has(key)) throw new Error(`page "${p.path}" is listed twice for viewport "${name}" (or its name collides with another path)`);
      seen.add(key);
      targets.push({
        path: p.path, viewport: name, ...viewports[name],
        waitFor: p.waitFor, mask: p.mask ?? [], expectStatus: p.expectStatus,
        maxTiles: p.maxTiles ?? cfg.maxTiles ?? DEFAULT_MAX_TILES,
      });
    }
  }
  return targets;
}
