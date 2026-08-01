// The constellation a record's Bayer / Flamsteed designation is NAMED for,
// resolved from IV/27A by designation. See README.md § The designation
// constellation.
import { NO_CONSTELLATION_INDEX } from '../catalog-pure';
import { CON_INDEX } from '../parse/constellations';
import type { CrossIndexRow } from './classic-ids-parse';

/** IV/27A's `cst` in the `CONSTELLATIONS` index space, keyed by both
 *  identifiers the table carries. HD is the table's own key; HIP covers the
 *  rows a record reaches by HIP alone. */
export interface DesignationConIndex {
  byHd: Map<number, number>;
  byHip: Map<number, number>;
}

export interface DesignationConIndexCounts {
  /** IV/27A rows whose `cst` names no IAU-88 constellation. Pinned at 0 — the
   *  table's own abbreviations are the IAU set, so a non-zero value is an
   *  upstream convention change, not a tolerable miss. */
  crossIndexUnknownCst: number;
}

/** Build the lookup. A designation → designation cross index carries NO
 *  astrometric claim — it says the star named HD 216956 is also named α PsA,
 *  never which Gaia source holds that star's photons — so unlike the
 *  source_id-keyed label overlay it needs no binding gate, and it may key on
 *  HD/HIP where the overlay may not. That is also what lets it reach the
 *  bright tier: Gaia saturates near G ≈ 3, so 117 records at V ≤ 3 have no
 *  overlay row at all, Fomalhaut among them. */
export function buildDesignationConIndex(
  rows: readonly CrossIndexRow[],
): { index: DesignationConIndex; counts: DesignationConIndexCounts } {
  const index: DesignationConIndex = { byHd: new Map(), byHip: new Map() };
  let unknown = 0;
  for (const row of rows) {
    if (row.cst === null) continue;
    const conIndex = CON_INDEX.get(row.cst.toLowerCase());
    if (conIndex === undefined) {
      unknown++;
      continue;
    }
    if (!index.byHd.has(row.hd)) index.byHd.set(row.hd, conIndex);
    if (row.hip !== null && !index.byHip.has(row.hip)) {
      index.byHip.set(row.hip, conIndex);
    }
  }
  return { index, counts: { crossIndexUnknownCst: unknown } };
}

/** The record's designation constellation, or `NO_CONSTELLATION_INDEX` where
 *  IV/27A carries no row for either of its identifiers — 123 faint
 *  Flamsteed-only records, which then ride the positional fallback in
 *  `designationConIndex`. HD first: it is IV/27A's own key, and the HIP column
 *  is the table's cross-reference to it. */
export function resolveDesignationConIndex(
  index: DesignationConIndex,
  hd: number | null,
  hip: number | null,
): number {
  const byHd = hd === null ? undefined : index.byHd.get(hd);
  if (byHd !== undefined) return byHd;
  const byHip = hip === null ? undefined : index.byHip.get(hip);
  return byHip ?? NO_CONSTELLATION_INDEX;
}
