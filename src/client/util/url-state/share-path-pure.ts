// Build / parse the canonical `/v/<blob>/` share-URL path form (trailing
// slash optional on parse) and pick the blob source from a loaded URL.
// Pure helpers — see README.md#transport--canonical-path-vs-legacy-query.

const SHARE_PATH_RE = /^\/v\/([A-Za-z0-9_-]+)\/?$/;

// Legacy query param `?v=<blob>`, decoded forever (README.md#transport--canonical-path-vs-legacy-query).
export const SHARE_PARAM = 'v';

// Resolves a pasted relative path and is never read back, so any host parses.
const SHARE_BASE = 'https://stellata.xyz';

export interface ShareBlobSource {
  blob: string | null;
  // The blob arrived in the legacy `?v=` query form — applyFromUrl uses
  // this to force a query→path rewrite even when the bytes wouldn't change.
  legacyQueryForm: boolean;
}

export function buildSharePath(blob: string): string {
  return `/v/${blob}/`;
}

export function parseSharePath(pathname: string): string | null {
  const m = SHARE_PATH_RE.exec(pathname);
  return m ? m[1] : null;
}

// Canonical path wins; a legacy `?v=` query is the fallback. Returns a
// null blob when neither carries one.
export function pickShareBlob(pathname: string, search: string): ShareBlobSource {
  const fromPath = parseSharePath(pathname);
  if (fromPath !== null) return { blob: fromPath, legacyQueryForm: false };
  const fromQuery = new URLSearchParams(search).get(SHARE_PARAM);
  return { blob: fromQuery, legacyQueryForm: fromQuery !== null };
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
