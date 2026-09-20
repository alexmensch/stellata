// Per-catalog star label maps derived from the search index: display
// label, spectral designation, Bayer parts. Leaf module — the star kind
// module builds these at load without a cycle through search.ts.

import { type SearchEntry } from '../../../scripts/catalog/record/catalog-pure';
import {
  displayNamesFromSearchIndex,
  superscript,
} from '../../../scripts/catalog/naming/star-naming-pure';
import type { Catalog } from '../loaders/catalog-loader';

/** Display label per star, composed by the SAME pure ladder the record
 *  build used — `catalog.bin`'s name table carries the NAME tiers, and
 *  every designation below them is composed here from the structured wire
 *  (docs/star-naming.md § 6).
 *
 *  Records the search index does not carry — no identifier a user could
 *  type — keep the name table's entry where they have one and otherwise
 *  fall to `resolveStarName`'s `Gaia DR3` / `SID #` last resort. */
export function buildStarLabels(
  catalog: Catalog,
  raw: SearchEntry[],
  into: Map<number, string> = new Map(),
): Map<number, string> {
  seedStarLabelsFromNames(catalog, into);
  for (const [idx, composed] of displayNamesFromSearchIndex(raw, catalog.constellations)) {
    if (!into.has(idx)) into.set(idx, composed.label);
  }
  return into;
}

/** The name-table half of the label ladder, which is available from the
 *  catalogue's FIRST chunk — the table precedes the records on the wire for
 *  exactly this reason (`scripts/catalog/record/README.md` § Record order).
 *  Seeded per landing chunk so a named star carries its name the moment it
 *  is drawn, rather than showing a bare SID until the search index lands
 *  and supplies the composed-designation half. */
export function seedStarLabelsFromNames(
  catalog: Catalog,
  into: Map<number, string>,
): Map<number, string> {
  for (const [idx, name] of catalog.names) into.set(idx, name);
  return into;
}

// Map of star index → spectral designation string ("G2 V", "M1.5Iab-b",
// "K0III+K7V", etc.), as carried from the source catalog via search-index.
// Used by the hover tooltip to show full classification info.
export function buildSpectralMap(
  raw: SearchEntry[],
  into: Map<number, string> = new Map(),
): Map<number, string> {
  for (const entry of raw) {
    if (entry.s) into.set(entry.i, entry.s);
  }
  return into;
}

export interface BayerInfo {
  /** Bayer letter glyph, e.g. "α". */
  greek: string;
  /** Optional unicode-superscript index, e.g. "¹". */
  suffix: string;
}

// Used by chart mode to render the letter glyph + optional superscript
// alongside proper names. The wire carries the glyph itself, so there is
// nothing to parse.
export function buildBayerMap(
  raw: SearchEntry[],
  out: Map<number, BayerInfo> = new Map(),
): Map<number, BayerInfo> {
  for (const entry of raw) {
    if (entry.b === undefined) continue;
    out.set(entry.i, {
      greek: entry.b,
      suffix: entry.bx === undefined ? '' : superscript(entry.bx),
    });
  }
  return out;
}
