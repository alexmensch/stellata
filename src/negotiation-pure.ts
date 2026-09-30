// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

/** Which rendition of a page a client asked for, and the headers that
 *  advertise it. README.md#request-routing. */

export const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';

export function alternateLink(rendition: string): string {
  return `<${rendition}>; rel="alternate"; type="text/markdown"`;
}

export function varyWithAccept(existing: string | null): string {
  const names = (existing ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return names.some((name) => name.toLowerCase() === 'accept')
    ? names.join(', ')
    : [...names, 'Accept'].join(', ');
}

/** Wildcards do not count here: `*` is what every client sends. */
function namedQuality(accept: string, type: string): number | null {
  for (const entry of accept.split(',')) {
    const [name, ...params] = entry.split(';').map((part) => part.trim());
    if (name.toLowerCase() !== type) continue;
    const q = params
      .map((param) => param.split('=').map((part) => part.trim()))
      .find(([key]) => key.toLowerCase() === 'q');
    if (q === undefined) return 1;
    const value = Number(q[1]);
    if (q[1] !== '' && Number.isFinite(value)) return value;
  }
  return null;
}

function quality(accept: string, type: string): number | null {
  const [group] = type.split('/');
  for (const candidate of [type, `${group}/*`, '*/*']) {
    const named = namedQuality(accept, candidate);
    if (named !== null) return named;
  }
  return null;
}

export function prefersMarkdown(accept: string | null): boolean {
  if (accept === null) return false;
  const markdown = namedQuality(accept, 'text/markdown');
  if (markdown === null || markdown === 0) return false;
  const html = quality(accept, 'text/html');
  return html === null || markdown >= html;
}

/** For a request that matched no asset. */
export function wantsDocument(accept: string | null): boolean {
  return accept === null || (quality(accept, 'text/html') ?? 0) > 0 || prefersMarkdown(accept);
}
