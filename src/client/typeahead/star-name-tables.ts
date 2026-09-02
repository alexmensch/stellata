// Per-catalog star label maps derived from the search index: display
// label, spectral designation, Bayer parts. Leaf module — the star kind
// module builds these at load without a cycle through search.ts.

import { type SearchEntry } from '../../../scripts/catalog/catalog-pure';
import {
  displayNamesFromSearchIndex,
  superscript,
} from '../../../scripts/catalog/naming/star-naming-pure';
import type { Catalog } from '../loaders/catalog-loader';

/** Display label per star, composed by the SAME pure ladder the record
 *  build used — `catalog.bin`'s name table carries the NAME tiers, and
 *  every designation below them is composed here from the structured wire
 *  (docs/star-naming.md § 6). Two of the ladder's rules are relational (a
 *  component borrows its system's base; a letter is appended only where the
 *  designation fails to single the star out), which is why one pass over
 *  the whole corpus replaces the old per-entry fallback chain.
 *
 *  Records the search index does not carry — no identifier a user could
 *  type — keep the name table's entry where they have one and otherwise
 *  fall to `resolveStarName`'s `Gaia DR3` / `SID #` last resort. */
export function buildStarLabels(
  catalog: Catalog,
  raw: SearchEntry[],
): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [idx, name] of catalog.names) labels.set(idx, name);
  for (const [idx, composed] of displayNamesFromSearchIndex(raw, catalog.constellations)) {
    if (!labels.has(idx)) labels.set(idx, composed.label);
  }
  return labels;
}

// Map of star index → spectral designation string ("G2 V", "M1.5Iab-b",
// "K0III+K7V", etc.), as carried from the source catalog via search-index.
// Used by the hover tooltip to show full classification info.
export function buildSpectralMap(raw: SearchEntry[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const entry of raw) {
    if (entry.s) out.set(entry.i, entry.s);
  }
  return out;
}

export interface BayerInfo {
  /** Bayer letter glyph, e.g. "α". */
  greek: string;
  /** Optional unicode-superscript index, e.g. "¹". */
  suffix: string;
}

// Map star idx → its Bayer designation parts. Used by chart mode to render
// the letter glyph + optional superscript alongside proper names. The wire
// carries the glyph itself, so there is nothing to parse.
export function buildBayerMap(raw: SearchEntry[]): Map<number, BayerInfo> {
  const out = new Map<number, BayerInfo>();
  for (const entry of raw) {
    if (entry.b === undefined) continue;
    out.set(entry.i, {
      greek: entry.b,
      suffix: entry.bx === undefined ? '' : superscript(entry.bx),
    });
  }
  return out;
}
