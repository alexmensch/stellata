// Build / parse the canonical `/v/<blob>/` share-URL path form (trailing
// slash optional on parse). Pure helpers — see README § Transport.

const SHARE_PATH_RE = /^\/v\/([A-Za-z0-9_-]+)\/?$/;

export function buildSharePath(blob: string): string {
  return `/v/${blob}/`;
}

export function parseSharePath(pathname: string): string | null {
  const m = SHARE_PATH_RE.exec(pathname);
  return m ? m[1] : null;
}
