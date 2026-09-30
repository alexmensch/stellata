/** Appends one schema.org CreativeWork per citation-index entry to a page's JSON-LD `citation` array. */

import type { IndexEntry } from '../util/citation-index-pure.ts';

export interface CitedWork {
  '@type': 'CreativeWork';
  name: string;
  datePublished: string;
  identifier?: string;
  sameAs?: string[];
}

// A DOI may carry one level of parentheses, which a bare [^)]+ would cut short.
const LINK = /\[[^\]]*\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
const DOI = 'https://doi.org/';
const LABEL_YEAR = / (\d{4})[a-z]?$/;
export const JSON_LD_BLOCK = /(<script\b[^>]*\btype="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g;

export function citedWork(entry: IndexEntry): CitedWork {
  const year = LABEL_YEAR.exec(entry.label)?.[1];
  if (year === undefined) throw new Error(`json-ld citations: ${entry.key}'s label "${entry.label}" carries no year`);
  const links = [...entry.reference.matchAll(LINK)].map((match) => match[1]);
  const doi = links.find((url) => url.startsWith(DOI));
  const others = links.filter((url) => url !== doi);
  return {
    '@type': 'CreativeWork',
    name: entry.title,
    datePublished: year,
    ...(doi !== undefined && { identifier: doi }),
    ...(others.length > 0 && { sameAs: others }),
  };
}

interface JsonLdNode {
  citation?: unknown[];
  '@graph'?: JsonLdNode[];
}

/** A page with no JSON-LD `citation` array comes back unchanged; more than one is an error. */
export function withIndexCitations(html: string, entries: IndexEntry[]): string {
  let citing = 0;
  const out = html.replace(JSON_LD_BLOCK, (block, open: string, body: string, close: string) => {
    const graph = JSON.parse(body) as JsonLdNode;
    const nodes = (graph['@graph'] ?? [graph]).filter((node) => Array.isArray(node.citation));
    if (nodes.length === 0) return block;
    citing += nodes.length;
    nodes[0].citation!.push(...entries.map(citedWork));
    // `<` escaped so no title or DOI can close the script element early.
    return `${open}${JSON.stringify(graph).replace(/</g, '\\u003c')}${close}`;
  });
  if (citing > 1) throw new Error(`json-ld citations: ${citing} citation arrays; expected one`);
  return out;
}
