// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

/** Which rendition of a page a client asked for. `worker.ts` and
 *  `../vite.site-dev.ts` both decide it here. README.md § Request routing. */

import { pageAt, renditionPath } from './site/pages';

export const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';

/** A page's markdown sibling, or null for a path that has none. */
export function markdownRendition(pathname: string): string | null {
  const page = pageAt(pathname);
  return page === null ? null : renditionPath(page);
}

export function alternateLink(rendition: string): string {
  return `<${rendition}>; rel="alternate"; type="text/markdown"`;
}

/** A `Vary` value naming `Accept`, keeping whatever the response already varied on. */
export function varyWithAccept(existing: string | null): string {
  const names = (existing ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return names.some((name) => name.toLowerCase() === 'accept')
    ? names.join(', ')
    : [...names, 'Accept'].join(', ');
}

/** The q-value a client gave a type by naming it exactly, or null if it did
 *  not name it. Wildcards do not count: `*` is what every client sends. */
function namedQuality(accept: string, type: string): number | null {
  for (const entry of accept.split(',')) {
    const [name, ...params] = entry.split(';').map((part) => part.trim());
    if (name.toLowerCase() !== type) continue;
    const q = params.find((p) => p.startsWith('q='));
    return q === undefined ? 1 : Number(q.slice(2));
  }
  return null;
}

/** The q-value a type effectively has, wildcards included. */
function quality(accept: string, type: string): number | null {
  const [group] = type.split('/');
  for (const candidate of [type, `${group}/*`, '*/*']) {
    const named = namedQuality(accept, candidate);
    if (named !== null) return named;
  }
  return null;
}

/**
 * Markdown is opt-in: a client gets it only by naming `text/markdown` and not
 * ranking `text/html` above it. A wildcard Accept — curl's default and most
 * agent fetchers' — therefore still gets HTML, which is what the deploy has
 * always answered and what a browser needs.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (accept === null) return false;
  const markdown = namedQuality(accept, 'text/markdown');
  if (markdown === null || markdown === 0) return false;
  const html = quality(accept, 'text/html');
  return html === null || markdown >= html;
}

/**
 * Whether a document is the right answer to a request that matched no asset:
 * yes unless the client named only non-document types (`image/png`), since
 * the deploy serves a document whatever an agent or `curl` sends.
 */
export function wantsDocument(accept: string | null): boolean {
  return accept === null || quality(accept, 'text/html') !== null || prefersMarkdown(accept);
}
