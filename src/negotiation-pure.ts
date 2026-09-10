// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

/** Which rendition of a page a client asked for. `worker.ts` and
 *  `../vite.site-dev.ts` both decide it here. README.md § Request routing. */

export const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';

/**
 * A page's markdown sibling, or null for a path that has none. The built tree
 * mirrors the URL space, so the rendition sits beside the document it renders
 * and a second page is one more line here plus one input in
 * `vite.site.config.ts`.
 */
export function markdownRendition(pathname: string): string | null {
  return pathname === '/' ? '/index.md' : null;
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
 * Whether a document is the right answer to a request that matched no asset.
 * The deploy serves one whatever the client asked for, so a dev server that
 * checked for `text/html` 404'd the root for every agent and every `curl`.
 * An explicit non-document Accept (`image/png`) still falls through as the
 * asset miss it is.
 */
export function wantsDocument(accept: string | null): boolean {
  return accept === null || quality(accept, 'text/html') !== null || prefersMarkdown(accept);
}
