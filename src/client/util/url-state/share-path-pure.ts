// Build / parse the canonical `/app/v/<blob>/` share-URL path form, pick the
// blob source from a loaded URL, and map both legacy transports onto the
// canonical one. Pure helpers — see README.md#transport--canonical-path-vs-legacy-query.

/**
 * The application document's own path. Everything the app owns sits under
 * it; `/` is the public homepage (`src/site/README.md`). `src/worker.ts`
 * imports this rather than restating it — a drift between the two silently
 * breaks every share link.
 */
export const APP_PATH = '/app';

/** Legacy query param `?v=<blob>`, decoded forever (README.md#transport--canonical-path-vs-legacy-query). */
export const SHARE_PARAM = 'v';

// Resolves a pasted relative path and is never read back, so any host parses.
const SHARE_BASE = 'https://stellata.xyz';

// Built from APP_PATH so the two cannot disagree. base64url's alphabet
// (`A-Za-z0-9-_`) has no `/`, so the blob drops into one segment with no
// escaping; the trailing slash is optional on parse.
const SHARE_PATH_RE = new RegExp(`^${APP_PATH}/v/([A-Za-z0-9_-]+)/?$`);

// The path form shared before the application moved to /app, when the app
// was the site root.
const LEGACY_SHARE_PATH_RE = /^\/v\/([A-Za-z0-9_-]+)\/?$/;

export interface ShareBlobSource {
  blob: string | null;
  // The blob arrived on a transport that is no longer canonical — a `?v=`
  // query, or a root-relative `/v/` path. applyFromUrl uses this to force a
  // rewrite to the canonical form even when the bytes wouldn't change.
  legacyTransport: boolean;
}

export function buildSharePath(blob: string): string {
  return `${APP_PATH}/v/${blob}/`;
}

export function parseSharePath(pathname: string): string | null {
  const m = SHARE_PATH_RE.exec(pathname);
  return m ? m[1] : null;
}

export function parseLegacySharePath(pathname: string): string | null {
  const m = LEGACY_SHARE_PATH_RE.exec(pathname);
  return m ? m[1] : null;
}

// Canonical path wins, then the legacy root-relative path, then the legacy
// `?v=` query. Returns a null blob when none carries one.
export function pickShareBlob(pathname: string, search: string): ShareBlobSource {
  const fromPath = parseSharePath(pathname);
  if (fromPath !== null) return { blob: fromPath, legacyTransport: false };
  const fromLegacyPath = parseLegacySharePath(pathname);
  if (fromLegacyPath !== null) return { blob: fromLegacyPath, legacyTransport: true };
  const fromQuery = new URLSearchParams(search).get(SHARE_PARAM);
  return { blob: fromQuery, legacyTransport: fromQuery !== null };
}

/**
 * The blob inside anything a human pastes into the dev console: a whole
 * share URL on any of the three transports, a bare `v=<blob>` fragment, or
 * the blob itself. Null when the text carries no blob at all.
 */
export function shareBlobFrom(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  if (text.includes('/')) {
    // `new URL` raises on a scheme with no host; that is junk, not an error.
    let url: URL;
    try {
      url = new URL(text, SHARE_BASE);
    } catch {
      return null;
    }
    return pickShareBlob(url.pathname, url.search).blob;
  }
  const afterParam = text.includes('=') ? text.slice(text.lastIndexOf('=') + 1) : text;
  return /^[A-Za-z0-9_-]+$/.test(afterParam) ? afterParam : null;
}

/**
 * Where a request carrying a legacy transport belongs, or null when it
 * carries none. The Worker answers with a 301 so the canonical form is what
 * gets bookmarked and re-shared; the client's own rewrite then handles a
 * legacy link that reached it some other way.
 *
 * The blob is not parsed out and rebuilt — an undecodable one still has to
 * land on the app, which strips the bar itself (README.md#transport--canonical-path-vs-legacy-query).
 */
export function legacyShareRedirect(pathname: string, search: string): string | null {
  if (pathname === '/v' || pathname.startsWith('/v/')) {
    return APP_PATH + pathname + search;
  }
  if (pathname === '/' && new URLSearchParams(search).has(SHARE_PARAM)) {
    return `${APP_PATH}/${search}`;
  }
  return null;
}
