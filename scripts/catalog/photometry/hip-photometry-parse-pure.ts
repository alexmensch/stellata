// Printed Johnson V and B−V per HIP from the I/239/hip_main slice. See README.md.

import type { Declared } from '../../util/sources/source';
import { sourceRowRef, type RowKeyed, type SourceRowRef } from '../../util/sources/row-ref-pure';
import { readTable } from '../../util/tsv/table-pure';

const HIP_PHOTOMETRY_COLUMNS = ['hip', 'vmag', 'bv', 'hd'] as const;

/** A printed value with the I/239 row it was read from. */
export interface PrintedHipValue {
  readonly value: number;
  readonly ref: SourceRowRef<number>;
}

/** The two HIP-keyed printed values, as separate maps rather than one map of
 *  pairs: their consumers are disjoint, and 1,281 rows carry a V with no B−V,
 *  so a pair-shaped entry would hand every V consumer a nullable field to
 *  re-check. */
export interface HipPhotometryTables {
  /** HIP → printed Johnson V. Three consumers need the same value: the V
   *  cascade's bright tier, the classic-ID overlay's binding gate — where a
   *  saturated star's mis-bound source has a G well below the star's
   *  catalogued V — and the astrometry request, which narrows the gate's
   *  candidates by it. All key it by HIP rather than through a driver row,
   *  which is what lets it outlive AT-HYG. */
  vmag: Map<number, PrintedHipValue>;
  /** HIP → printed Johnson B−V, the ci cascade's tier below the synthetic
   *  photometry. */
  bv: Map<number, PrintedHipValue>;
  /** Every HIP and HD the slice publishes, and its HIP → HD pairing (the last
   *  row wins): the primaries audit's I/239 attestation. */
  hips: Set<number>;
  hds: Set<number>;
  hdByHip: Map<number, number>;
}

/** One printed value for a record's own HIP, `null` where the record has no
 *  HIP or the slice has no such row. Both cascades key their printed tier
 *  this way, and both want the two misses to look alike. */
export function printedByHip(
  table: ReadonlyMap<number, PrintedHipValue>,
  hip: number | null,
): PrintedHipValue | null {
  return hip === null ? null : table.get(hip) ?? null;
}

/** `data/hipparcos/hip_main_vmag.tsv` → the two printed-photometry tables. */
export function parseHipPhotometryTsv(text: string, from: Declared & RowKeyed<number>): HipPhotometryTables {
  const vmag = new Map<number, PrintedHipValue>();
  const bv = new Map<number, PrintedHipValue>();
  const hips = new Set<number>();
  const hds = new Set<number>();
  const hdByHip = new Map<number, number>();
  for (const row of readTable({ ...from, columns: HIP_PHOTOMETRY_COLUMNS }, text)) {
    const hip = row.int('hip');
    const hd = row.int('hd');
    if (hip !== null) hips.add(hip);
    if (hd !== null) hds.add(hd);
    if (hip !== null && hd !== null) hdByHip.set(hip, hd);
    if (hip === null || hip <= 0) continue;
    const ref = sourceRowRef(from, hip);
    const v = row.float('vmag');
    if (v !== null && !vmag.has(hip)) vmag.set(hip, { value: v, ref });
    const colour = row.float('bv');
    if (colour !== null && !bv.has(hip)) bv.set(hip, { value: colour, ref });
  }
  return { vmag, bv, hips, hds, hdByHip };
}
