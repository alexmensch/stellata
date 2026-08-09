// Per-catalog star label maps derived from the search index: display
// label, spectral designation, Bayer parts. Leaf module — the star kind
// module builds these at load without a cycle through search.ts.

import {
  designationConIndex,
  NO_CONSTELLATION_INDEX,
  type SearchEntry,
} from '../../../scripts/catalog/catalog-pure';
import type { Catalog } from '../loaders/catalog-loader';
import {
  BAYER_GREEK,
  formatBayerDisplay,
  formatGcvsDesignation,
  splitBayer,
  superscript,
} from './star-designations';

// Best human-readable label for a star, falling back through identifier
// tiers: proper name → Bayer → Flamsteed → GCVS designation → HIP → HD →
// HR → Gl. For use in the focus display, meta bar, tooltip, and the
// search-box value when a star is picked.
export function buildStarLabels(
  catalog: Catalog,
  raw: SearchEntry[],
): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [idx, name] of catalog.names) labels.set(idx, name);

  for (const entry of raw) {
    if (labels.has(entry.i)) continue;
    const conIdx = designationConIndex(entry.dc, entry.c);
    const con = conIdx !== NO_CONSTELLATION_INDEX ? catalog.constellations[conIdx] : null;
    const conCode = con?.code ?? '';
    if (entry.b && conCode) {
      labels.set(entry.i, formatBayerDisplay(entry.b, conCode));
    } else if (entry.f !== undefined && conCode) {
      labels.set(entry.i, `${entry.f} ${conCode}`);
    } else if (entry.g) {
      labels.set(entry.i, formatGcvsDesignation(entry.g));
    } else if (entry.hip !== undefined) {
      labels.set(entry.i, `HIP ${entry.hip}`);
    } else if (entry.hd !== undefined) {
      labels.set(entry.i, `HD ${entry.hd}`);
    } else if (entry.hr !== undefined) {
      labels.set(entry.i, `HR ${entry.hr}`);
    } else if (entry.gl) {
      labels.set(entry.i, entry.gl);
    }
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
  /** Greek letter glyph, e.g. "α". */
  greek: string;
  /** Optional unicode-superscript suffix for A/B components, e.g. "¹". */
  suffix: string;
}

// Map star idx → its Bayer designation parts. Used by chart mode to render
// Greek-letter labels alongside proper names. Entries without a parseable
// Bayer string or a designation constellation are skipped — a Bayer letter
// only means anything paired with one.
export function buildBayerMap(raw: SearchEntry[]): Map<number, BayerInfo> {
  const out = new Map<number, BayerInfo>();
  for (const entry of raw) {
    if (!entry.b) continue;
    if (designationConIndex(entry.dc, entry.c) === NO_CONSTELLATION_INDEX) continue;
    const split = splitBayer(entry.b);
    if (!split) continue;
    const greek = BAYER_GREEK[split.letter3];
    const suffix = split.suffix ? superscript(split.suffix.slice(1)) : '';
    out.set(entry.i, { greek, suffix });
  }
  return out;
}
