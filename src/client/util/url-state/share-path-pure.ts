// Build / parse the canonical `/app/v/<blob>/` share-URL path form, pick the
// blob source from a loaded URL, and map both legacy transports onto the
// canonical one. Pure helpers — see README § Transport.

/**
 * The application document's own path. Everything the app owns sits under
 * it; `/` is the public homepage (`src/site/README.md`). `src/worker.ts`
 * imports this rather than restating it — a drift between the two silently
 * breaks every share link.
 */
export const APP_PATH = '/app';

/** Legacy query param `?v=<blob>`, decoded forever (README § Transport). */
export const SHARE_PARAM = 'v';

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
 * Where a request carrying a legacy transport belongs, or null when it
 * carries none. The Worker answers with a 301 so the canonical form is what
 * gets bookmarked and re-shared; the client's own rewrite then handles a
 * legacy link that reached it some other way.
 *
 * The blob is not parsed out and rebuilt — an undecodable one still has to
 * land on the app, which strips the bar itself (README § Transport).
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
