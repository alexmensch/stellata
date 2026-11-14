// Gaia DR3 5p astrometry: the row schema, its parse, and the declared table.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource, type Declared } from '../../util/sources/source';
import {
  sourceRowRef, type RowKeyed, type SourceRowRef,
} from '../../util/sources/row-ref-pure';
import { readTable, tableLineReader, type TableRow } from '../../util/tsv/table-pure';

/** 5p astrometry row from `data/gaia/gaia_dr3_astrometry.tsv`.
 *  ra/dec are at J2016.0. `parallaxMas === null` marks a 2p
 *  (position-only) solution — Gaia detected the source but could not
 *  fit parallax + PM. */
export interface GaiaAstrometryCatalogRow {
  raDeg: number;
  decDeg: number;
  parallaxMas: number | null;
  parallaxErrorMas: number | null;
  pmraMasyr: number | null;
  pmdecMasyr: number | null;
  ruwe: number | null;
  ipdFracMultiPeak: number | null;
  gMag: number | null;
  bpMag: number | null;
  rpMag: number | null;
  /** Epoch of ra/dec, Julian years: 2016.0 throughout DR3. */
  refEpoch: number;
  /** DR3 `radial_velocity` (km/s), the RVS median. Null on the ~2/3 of
   *  sources RVS did not reach — magnitude-limited to G_RVS ≲ 14. */
  radialVelocityKmS: number | null;
  /** DR3 `radial_velocity_error` (km/s) — the uncertainty on that median.
   *  Non-null wherever `radial_velocity` is, in the published catalogue. */
  radialVelocityErrorKmS: number | null;
  /** The row of whichever Gaia file supplied it: the catalogue table, or the
   *  magnitude pull for a source only that term admitted. */
  ref: SourceRowRef<string>;
}

const ASTROMETRY_COLUMNS = [
  'source_id', 'ra', 'dec', 'parallax', 'parallax_error', 'pmra', 'pmdec',
  'ref_epoch', 'ruwe', 'ipd_frac_multi_peak', 'phot_g_mean_mag', 'phot_bp_mean_mag',
  'phot_rp_mean_mag', 'radial_velocity', 'radial_velocity_error',
] as const;

type AstrometryRow = TableRow<(typeof ASTROMETRY_COLUMNS)[number]>;

/** source_id stays a string — Gaia IDs exceed Number.MAX_SAFE_INTEGER, so a
 *  numeric parse would corrupt the key. */
function foldAstrometryRow(
  row: AstrometryRow,
  onRow: (sourceId: string, row: GaiaAstrometryCatalogRow) => void,
  from: RowKeyed<string>,
  keep?: ReadonlySet<string>,
): void {
  const sourceId = row.sourceId('source_id');
  if (sourceId === null) return;
  if (keep && !keep.has(sourceId)) return;
  const raDeg = row.float('ra');
  const decDeg = row.float('dec');
  const refEpoch = row.float('ref_epoch');
  if (raDeg === null || decDeg === null || refEpoch === null) return;
  onRow(sourceId, {
    raDeg,
    decDeg,
    parallaxMas: row.float('parallax'),
    parallaxErrorMas: row.float('parallax_error'),
    pmraMasyr: row.float('pmra'),
    pmdecMasyr: row.float('pmdec'),
    ruwe: row.float('ruwe'),
    ipdFracMultiPeak: row.float('ipd_frac_multi_peak'),
    gMag: row.float('phot_g_mean_mag'),
    bpMag: row.float('phot_bp_mean_mag'),
    rpMag: row.float('phot_rp_mean_mag'),
    refEpoch,
    radialVelocityKmS: row.float('radial_velocity'),
    radialVelocityErrorKmS: row.float('radial_velocity_error'),
    ref: sourceRowRef(from, sourceId),
  });
}

/** Line-fed, so a streaming read over the magnitude pull folds rows exactly
 *  as the whole-text parse does, handing each to `onRow` without holding the
 *  table. `keep` filters to a subset. */
export function gaiaAstrometryLineReader(
  from: Declared & RowKeyed<string>,
  onRow: (sourceId: string, row: GaiaAstrometryCatalogRow) => void,
  keep?: ReadonlySet<string>,
): (raw: string) => void {
  return tableLineReader({ ...from, columns: ASTROMETRY_COLUMNS }, (row) => foldAstrometryRow(row, onRow, from, keep));
}

export function gaiaAstrometryAccumulator(
  from: Declared & RowKeyed<string>,
  keep?: ReadonlySet<string>,
): {
  line: (raw: string) => void;
  result: () => Map<string, GaiaAstrometryCatalogRow>;
} {
  const out = new Map<string, GaiaAstrometryCatalogRow>();
  return {
    line: gaiaAstrometryLineReader(from, (sourceId, row) => out.set(sourceId, row), keep),
    result: () => out,
  };
}

export function parseGaiaAstrometryTsv(
  text: string,
  from: Declared & RowKeyed<string>,
): Map<string, GaiaAstrometryCatalogRow> {
  const out = new Map<string, GaiaAstrometryCatalogRow>();
  const keepRow = (sourceId: string, row: GaiaAstrometryCatalogRow): void => { out.set(sourceId, row); };
  for (const row of readTable({ ...from, columns: ASTROMETRY_COLUMNS }, text)) foldAstrometryRow(row, keepRow, from);
  return out;
}

export const GAIA_ASTROMETRY = defineSource({
  file: DATA_FILES.gaiaAstrometry,
  hint: 'Re-run `pnpm run refresh:gaia-astrometry`.',
  rowKey: { id: 'gaia-dr3-astrometry', text: (sourceId: string) => sourceId },
  parse: (input): Map<string, GaiaAstrometryCatalogRow> =>
    parseGaiaAstrometryTsv(input.text(), GAIA_ASTROMETRY),
});
