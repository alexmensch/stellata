// Pure star-designation formatters over the wire's structured designation
// set, plus the tier-ordered designation list. Leaf module — no imports
// from search.ts, so kind-module code can consume it without a cycle.

import {
  designationConIndex,
  NO_CONSTELLATION_INDEX,
  type SearchEntry,
} from '../../../scripts/catalog/catalog-pure';
import { ASCII_GREEK } from '../../../scripts/catalog/naming/greek-forms';
import {
  bayerDesignation,
  designationSetOfEntry,
  formatGcvsDesignation,
  gouldDesignation,
  superscript,
} from '../../../scripts/catalog/naming/star-naming-pure';

export { designationSetOfEntry, formatGcvsDesignation, superscript };

/** Every display designation for one star, tier-ordered: name → Bayer →
 *  Flamsteed → Gould → GCVS → HR → HD → HIP → Gliese → Gaia DR3. The focus
 *  card's identity line renders this set (minus the display label, which
 *  already heads the card). Gaia rides in from the catalog because
 *  search-index entries don't carry the source_id. A GCVS designation in
 *  Bayer form ("bet Per" for Algol) is skipped — the real Bayer display
 *  ("β Per") already covers it, and the Latinised abbreviation is a search
 *  alias, not a display name. */
export function starDesignations(
  entry: SearchEntry,
  constellations: { code: string }[],
  gaiaSourceId: bigint,
): string[] {
  const conIdx = designationConIndex(entry.dc, entry.c);
  const conCode = conIdx !== NO_CONSTELLATION_INDEX
    ? constellations[conIdx]?.code ?? '' : '';
  const out: string[] = [];
  if (entry.p) out.push(entry.p);
  if (entry.b && conCode) out.push(bayerDesignation(entry.b, entry.bx, conCode));
  if (entry.f !== undefined && conCode) out.push(`${entry.f} ${conCode}`);
  if (entry.gd !== undefined && conCode) {
    out.push(gouldDesignation(entry.gd, entry.gh, conCode));
  }
  const gcvsFirst = entry.g?.split(/\s+/)[0] ?? '';
  // Lowercase-start guard: GCVS letter-sequence designations (R, VY, MU)
  // are uppercase; only the lowercase Greek forms are Bayer duplicates.
  if (entry.g && !(/^[a-z]/.test(gcvsFirst) && gcvsFirst.toLowerCase() in ASCII_GREEK)) {
    out.push(formatGcvsDesignation(entry.g));
  }
  // An alias rides the record only where the pair is unresolved, so this ONE
  // record is what both catalogue numbers reach — listing both is what makes
  // that legible, rather than a card denying a number the search box just
  // accepted (scripts/catalog/classic-ids/README.md § An alias stops at the
  // blend). Sorted, so the line does not depend on overlay cell order.
  if (entry.hr !== undefined) {
    for (const hr of [entry.hr, ...(entry.hra ?? [])].sort((a, b) => a - b)) {
      out.push(`HR ${hr}`);
    }
  }
  if (entry.hd !== undefined) {
    for (const hd of [entry.hd, ...(entry.hda ?? [])].sort((a, b) => a - b)) {
      out.push(`HD ${hd}`);
    }
  }
  if (entry.hip !== undefined) out.push(`HIP ${entry.hip}`);
  if (entry.gl) out.push(entry.gl);
  if (gaiaSourceId !== 0n) out.push(`Gaia DR3 ${gaiaSourceId}`);
  return out;
}
