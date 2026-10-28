// Printed Johnson V and B−V per HIP from the I/239/hip_main slice. See README.md.

import { readTable, type TableSpec } from '../../util/tsv/table-pure';

const HIP_PHOTOMETRY = {
  file: 'data/hipparcos/hip_main_vmag.tsv',
  columns: ['hip', 'vmag', 'bv'] as const,
  hint: 'Re-run `pnpm run refresh:hip-vmag`.',
} satisfies TableSpec<string>;

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
  vmag: Map<number, number>;
  /** HIP → printed Johnson B−V, the ci cascade's tier below the synthetic
   *  photometry. */
  bv: Map<number, number>;
}

/** One printed value for a record's own HIP, `null` where the record has no
 *  HIP or the slice has no such row. Both cascades key their printed tier
 *  this way, and both want the two misses to look alike. */
export function printedByHip(
  table: ReadonlyMap<number, number>,
  hip: number | null,
): number | null {
  return hip === null ? null : table.get(hip) ?? null;
}

/** `data/hipparcos/hip_main_vmag.tsv` → the two printed-photometry tables. */
export function parseHipPhotometryTsv(text: string): HipPhotometryTables {
  const vmag = new Map<number, number>();
  const bv = new Map<number, number>();
  for (const row of readTable(HIP_PHOTOMETRY, text)) {
    const hip = row.int('hip');
    if (hip === null || hip <= 0) continue;
    const v = row.float('vmag');
    if (v !== null && !vmag.has(hip)) vmag.set(hip, v);
    const colour = row.float('bv');
    if (colour !== null && !bv.has(hip)) bv.set(hip, colour);
  }
  return { vmag, bv };
}
