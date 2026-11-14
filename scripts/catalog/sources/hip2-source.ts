// HIP2 astrometry: the row schema, its parse, and the declared table.

import { defineSource, type Declared } from '../../util/sources/source';
import {
  sourceRowRef, type RowKeyed, type SourceRowRef,
} from '../../util/sources/row-ref-pure';
import { readTable } from '../../util/tsv/table-pure';

/** van Leeuwen 2007 (/data/papers/index.md#vanleeuwen2007) reduction row from
 *  `data/hipparcos/hip2_van_leeuwen.tsv`. ra/dec are at the Hipparcos epoch
 *  J1991.25 (ESA 1997, /data/papers/index.md#esa1997). */
export interface Hip2AstrometryRow {
  raDeg: number;
  decDeg: number;
  plxMas: number | null;
  plxErrorMas: number | null;
  pmRaMasyr: number | null;
  pmDeMasyr: number | null;
  ref: SourceRowRef<number>;
}

const HIP2_COLUMNS = ['hip', 'ra_icrs', 'de_icrs', 'plx', 'e_plx', 'pm_ra', 'pm_de'] as const;

/** `hips` is every HIP the table publishes, positioned or not — what the
 *  primaries audit attests a cell against. */
export interface Hip2Table {
  astrometry: Map<number, Hip2AstrometryRow>;
  hips: Set<number>;
}

export function parseHip2Tsv(text: string, from: Declared & RowKeyed<number>): Hip2Table {
  const out = new Map<number, Hip2AstrometryRow>();
  const hips = new Set<number>();
  for (const row of readTable({ ...from, columns: HIP2_COLUMNS }, text)) {
    const hip = row.int('hip');
    if (hip !== null) {
      if (hips.has(hip)) row.fail(`HIP ${hip} has more than one row; which was meant is not the reader's to guess`);
      hips.add(hip);
    }
    if (hip === null || hip <= 0) continue;
    const raDeg = row.float('ra_icrs');
    const decDeg = row.float('de_icrs');
    if (raDeg === null || decDeg === null) continue;
    out.set(hip, {
      raDeg,
      decDeg,
      plxMas: row.float('plx'),
      plxErrorMas: row.float('e_plx'),
      pmRaMasyr: row.float('pm_ra'),
      pmDeMasyr: row.float('pm_de'),
      ref: sourceRowRef(from, hip),
    });
  }
  return { astrometry: out, hips };
}

export const HIP2 = defineSource({
  file: 'data/hipparcos/hip2_van_leeuwen.tsv',
  hint: 'Re-run `pnpm run refresh:hip2`.',
  rowKey: { id: 'i311', text: (hip: number) => String(hip) },
  parse: (input): Hip2Table => parseHip2Tsv(input.text(), HIP2),
});
