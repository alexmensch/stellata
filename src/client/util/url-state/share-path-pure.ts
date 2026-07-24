// Build / parse the canonical `/v/<blob>/` share-URL path form (trailing
// slash optional on parse) and pick the blob source from a loaded URL.
// Pure helpers — see README § Transport.

const SHARE_PATH_RE = /^\/v\/([A-Za-z0-9_-]+)\/?$/;

// Legacy query param `?v=<blob>`, decoded forever (README § Transport).
export const SHARE_PARAM = 'v';

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
