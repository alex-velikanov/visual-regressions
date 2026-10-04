// Pure helpers for `vr.sh --discover`: which links are worth proposing as pages. No browser needed.

export const DEFAULT_IGNORE = [
  /\/(log|sign)[-_]?out(\/|$)/i,                                                                 // would end the session
  /\.(pdf|zip|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|mp3|mp4|woff2?)$/i,                // not pages
];

// An href as found on a page -> a path for pages.json, or null if it is off-site, not http(s), or outside the base URL's path.
export function normalizeLink(href, baseUrl, pageUrl = baseUrl) {
  let u;
  try { u = new URL(href, pageUrl); } catch { return null; }
  const base = new URL(baseUrl);
  if (!/^https?:$/.test(u.protocol) || u.origin !== base.origin) return null;
  const prefix = base.pathname.replace(/\/+$/, '');
  if (prefix && u.pathname !== prefix && !u.pathname.startsWith(prefix + '/')) return null;
  const path = u.pathname.slice(prefix.length) || '/';
  return path + u.search;
}

// base + path, without a doubled slash when the base URL ends in one.
export function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + path;
}

export function shouldSkip(path, extraIgnore = []) {
  const pathname = path.split(/[?#]/, 1)[0];
  return DEFAULT_IGNORE.some(r => r.test(pathname)) || extraIgnore.some(p => new RegExp(p).test(path));
}

// <loc> entries of a sitemap.xml. A sitemap index (entries ending in .xml) yields nothing: list those pages by hand.
export function parseSitemap(xml, baseUrl) {
  const out = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const p = normalizeLink(m[1].replace(/&amp;/g, '&'), baseUrl);
    if (p) out.push(p);
  }
  return out;
}

export function newPaths(found, known) {
  const have = new Set(known);
  return [...new Set(found)].filter(p => !have.has(p)).sort();
}
