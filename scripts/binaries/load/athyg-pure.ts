// The AT-HYG v3.3 classic-ID rows the binaries stages read.

import type { ColumnTable, TableRow } from '../../util/tsv/table-pure';

export interface AthygRow {
  readonly hip: number | null;
  /** Tycho-2 designation, `"4669-731-1"`. */
  readonly tyc: string | null;
  readonly gaia: string | null;
  readonly hd: number | null;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly xPc: number;
  readonly yPc: number;
  readonly zPc: number;
  readonly distPc: number;
  readonly vMag: number | null;
  readonly absmag: number;
  readonly ci: number | null;
  readonly spect: string;
  readonly proper: string;
  /** μ_α*, cos δ applied, as AT-HYG inherits it from Hipparcos / Gaia. */
  readonly pmRaMasyr: number | null;
  readonly pmDecMasyr: number | null;
}

const COLUMNS = [
  'hip', 'tyc', 'gaia', 'hd', 'ra', 'dec', 'x0', 'y0', 'z0', 'dist',
  'mag', 'absmag', 'ci', 'spect', 'proper', 'pm_ra', 'pm_dec',
] as const;
type Column = (typeof COLUMNS)[number];

const HOURS_TO_DEG = 15.0;

/** AT-HYG writes an absent identifier as empty or `0`. */
function identifier(row: TableRow<Column>, column: Column): string | null {
  const t = row.text(column);
  return t === null || t === '0' ? null : t;
}

function intIdentifier(row: TableRow<Column>, column: 'hip' | 'hd'): number | null {
  return identifier(row, column) === null ? null : row.int(column);
}

/** Every row with a position, a distance and an absolute magnitude; RA in
 *  hours becomes degrees. */
export function parseAthygRows(table: ColumnTable): AthygRow[] {
  const rows: AthygRow[] = [];
  for (const row of table(COLUMNS)) {
    const ra = row.float('ra');
    const decDeg = row.float('dec');
    const xPc = row.float('x0');
    const yPc = row.float('y0');
    const zPc = row.float('z0');
    const distPc = row.float('dist');
    const absmag = row.float('absmag');
    if (ra === null || decDeg === null || xPc === null || yPc === null || zPc === null || distPc === null) continue;
    if (absmag === null) continue;
    rows.push({
      hip: intIdentifier(row, 'hip'),
      tyc: identifier(row, 'tyc'),
      gaia: identifier(row, 'gaia') === null ? null : row.sourceId('gaia'),
      hd: intIdentifier(row, 'hd'),
      raDeg: ra * HOURS_TO_DEG,
      decDeg, xPc, yPc, zPc, distPc, absmag,
      vMag: row.float('mag'),
      ci: row.float('ci'),
      spect: row.text('spect') ?? '',
      proper: row.text('proper') ?? '',
      pmRaMasyr: row.float('pm_ra'),
      pmDecMasyr: row.float('pm_dec'),
    });
  }
  return rows;
}
