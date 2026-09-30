/** The Vite plugin that gives a page's JSON-LD citation array every citation-index work. */

import type { Plugin } from 'vite';

import type { IndexEntry } from '../util/citation-index-pure.ts';
import { withIndexCitations } from './json-ld-citations-pure.ts';
import { citationEntries } from './site-metrics.ts';

export function indexCitations(root: string): Plugin {
  let entries: IndexEntry[] | null = null;
  return {
    name: 'stellata:index-citations',
    transformIndexHtml: (html) => withIndexCitations(html, (entries ??= citationEntries(root))),
  };
}
