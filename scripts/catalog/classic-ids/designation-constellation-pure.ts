// The constellation a record's Bayer / Flamsteed designation is NAMED for,
// resolved from IV/27A by designation. See README.md#the-designation-constellation.
import { NO_CONSTELLATION_INDEX } from '../../../src/catalog-format/record/catalog-pure';
import { CON_INDEX } from '../parse/constellations/constellations';
import type { CrossIndexRow } from './classic-ids-parse';

/** IV/27A's `cst` in the `CONSTELLATIONS` index space, keyed by both
 *  identifiers the table carries. HD is the table's own key; HIP covers the
 *  rows a record reaches by HIP alone. */
export interface DesignationConIndex {
  byHd: Map<number, number>;
  byHip: Map<number, number>;
}

/** Carries NO astrometric claim, so unlike the source_id-keyed label overlay
 *  it needs no binding gate and may key on HD/HIP where the overlay may not.
 *  That is also what lets it reach the bright tier, where Gaia saturates and
 *  most records have no overlay row at all
 *  (`membership.overlay.bright.no-entry` is the count). */
export function buildDesignationConIndex(rows: readonly CrossIndexRow[]): DesignationConIndex {
  const index: DesignationConIndex = { byHd: new Map(), byHip: new Map() };
  for (const row of rows) {
    if (row.cst === null) continue;
    const conIndex = CON_INDEX.get(row.cst.toLowerCase());
    if (conIndex === undefined) {
      throw new Error(`IV/27A row HD ${row.hd} names cst ${JSON.stringify(row.cst)}, which is no IAU-88 constellation`);
    }
    if (!index.byHd.has(row.hd)) index.byHd.set(row.hd, conIndex);
    if (row.hip !== null && !index.byHip.has(row.hip)) {
      index.byHip.set(row.hip, conIndex);
    }
  }
  return index;
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

/** A record's designation constellation and the cascade tier that wrote it.
 *  An authority tier names the IV/27A value it overwrote with a different one. */
export type DesignationCon =
  | { via: 'none' }
  | { via: 'iv27a' | 'gcvs' | 'anchor'; index: number }
  | { via: 'wgsn-bayer' | 'wgsn-gould'; index: number; displaced: number | null };

export type StatedDesignationCon = Exclude<DesignationCon, { via: 'none' }>;

export const NO_DESIGNATION_CON: DesignationCon = { via: 'none' };

/** A companion's designation constellation, taken from its system anchor. */
export function inheritedDesignationCon(anchor: DesignationCon): DesignationCon {
  return anchor.via === 'none' ? NO_DESIGNATION_CON : { via: 'anchor', index: anchor.index };
}
