// Codec for data/binaries/multiples.tsv. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { defineArtifact, nullableCell } from '../util/tsv/artifact-pure';
import { MULTIPLES_ROW_KEY } from './multiples-row-key-pure';
import { wdsRootOf } from './component-tokens-pure';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';
import {
  ASTROMETRY_VIA, A_VIA, type IdentifierWithOrigin, MULTIPLES_SOURCES, type MultiplesRecord, ORBIT_ROLES, ORBIT_VIA, PHOTOMETRY_VIA, RESOLVE_VIA, SPECT_VIA, formatIdOrigin, gaiaFields, hipFields, parseIdOrigin,
} from './multiples-record-pure';

export const MULTIPLES_COLUMNS = [
  'system_id', 'comp', 'hip', 'gaia_source_id', 'hd',
  'x_pc', 'y_pc', 'z_pc', 'absmag', 'ci', 'spect', 'name',
  'source', 'regime',
  'resolve_via', 'gaia_origin', 'hip_origin', 'astrometry_via', 'orbit_via', 'spect_via',
  'photometry_via', 'a_via',
  'orbit_role',
  'P_days', 'T_jd', 'e', 'a_AU', 'i_rad', 'omega_rad', 'Omega_rad', 'q', 'dist_pc',
  'sep_arcsec', 'pa_deg', 'sep_pa_epoch_jd', 'dmag',
  'anchor_sep_arcsec', 'anchor_pa_deg', 'anchor_comp', 'mag_pri', 'mag_sec',
] as const;
type Column = (typeof MULTIPLES_COLUMNS)[number];

/** Each float column's decimal places, as the Stage 6 writer prints them. */
const PLACES = {
  x_pc: 6, y_pc: 6, z_pc: 6, absmag: 4, ci: 4,
  P_days: 6, T_jd: 4, e: 6, a_AU: 6, i_rad: 6, omega_rad: 6, Omega_rad: 6, q: 6, dist_pc: 6,
  sep_arcsec: 3, pa_deg: 2, sep_pa_epoch_jd: 4, dmag: 4,
  anchor_sep_arcsec: 3, anchor_pa_deg: 2, mag_pri: 2, mag_sec: 2,
} as const satisfies Partial<Record<Column, number>>;

function fixed(v: number | null, places: number): string {
  if (v === null) return '';
  const s = v.toFixed(places);
  return Object.is(v, -0) ? `-${s}` : s;
}

export const MULTIPLES_TSV = defineArtifact({
  file: DATA_FILES.multiples,
  columns: MULTIPLES_COLUMNS,
  hint: 'Re-run `pnpm run build:binaries`.',
  order: 'as-given',
  rowKey: MULTIPLES_ROW_KEY,
  decode: (row): MultiplesRecord => {
    const regime = row.int('regime') ?? row.fail('regime is empty');
    const positive = (column: 'P_days' | 'a_AU'): number | null => {
      const v = row.float(column);
      return v === null || v > 0 ? v : row.fail(`${column} ${v} is not positive`);
    };
    const eccentricity = row.float('e');
    if (eccentricity !== null && !(eccentricity >= 0 && eccentricity < 1)) {
      row.fail(`e ${eccentricity} is not a bound orbit's eccentricity`);
    }
    const systemId = row.raw('system_id');
    if (wdsRootOf(systemId) === null) row.fail(`system_id "${systemId}" names no WDS id`);
    const comp = row.raw('comp');
    if (comp.trim() === '') row.fail('comp is empty');
    const withOrigin = <T>(value: T | null, column: 'gaia_origin' | 'hip_origin'): IdentifierWithOrigin<T> | null => {
      const cell = row.raw(column);
      if (value === null) return cell === '' ? null : row.fail(`${column} "${cell}" names the origin of no identifier`);
      return { value, origin: parseIdOrigin(cell) ?? row.fail(`${column} "${cell}" is not own or <kind>:<token>`) };
    };
    return {
      systemId,
      comp,
      ...hipFields(withOrigin(row.int('hip'), 'hip_origin')),
      ...gaiaFields(withOrigin(row.sourceId('gaia_source_id'), 'gaia_origin')),
      hd: row.int('hd'),
      x_pc: row.float('x_pc'),
      y_pc: row.float('y_pc'),
      z_pc: row.float('z_pc'),
      absmag: row.float('absmag'),
      ci: row.float('ci'),
      spect: row.raw('spect'),
      name: row.raw('name'),
      source: row.oneOf('source', MULTIPLES_SOURCES),
      regime,
      resolveVia: row.oneOf('resolve_via', RESOLVE_VIA),
      astrometryVia: row.oneOf('astrometry_via', ASTROMETRY_VIA),
      orbitVia: row.oneOf('orbit_via', ORBIT_VIA),
      spectVia: row.oneOf('spect_via', SPECT_VIA),
      photometryVia: row.oneOf('photometry_via', PHOTOMETRY_VIA),
      aVia: row.oneOf('a_via', A_VIA),
      orbitRole: row.oneOf('orbit_role', ORBIT_ROLES),
      pDays: positive('P_days'),
      tJd: row.float('T_jd'),
      e: eccentricity,
      aAU: positive('a_AU'),
      iRad: row.float('i_rad'),
      omegaRad: row.float('omega_rad'),
      OmegaRad: row.float('Omega_rad'),
      q: row.float('q'),
      distPc: row.float('dist_pc'),
      sepArcsec: row.float('sep_arcsec'),
      paDeg: row.float('pa_deg'),
      sepPaEpochJd: row.float('sep_pa_epoch_jd'),
      dmag: row.float('dmag'),
      anchorSepArcsec: row.float('anchor_sep_arcsec'),
      anchorPaDeg: row.float('anchor_pa_deg'),
      anchorComp: row.text('anchor_comp'),
      magPri: row.float('mag_pri'),
      magSec: row.float('mag_sec'),
    };
  },
  encode: (r) => ({
    system_id: r.systemId,
    comp: r.comp,
    hip: nullableCell(r.hip),
    gaia_source_id: nullableCell(r.gaiaSourceId),
    hd: nullableCell(r.hd),
    x_pc: fixed(r.x_pc, PLACES.x_pc),
    y_pc: fixed(r.y_pc, PLACES.y_pc),
    z_pc: fixed(r.z_pc, PLACES.z_pc),
    absmag: fixed(r.absmag, PLACES.absmag),
    ci: fixed(r.ci, PLACES.ci),
    spect: r.spect,
    name: r.name,
    source: r.source,
    regime: String(r.regime),
    resolve_via: r.resolveVia,
    gaia_origin: r.gaiaOrigin === null ? '' : formatIdOrigin(r.gaiaOrigin),
    hip_origin: r.hipOrigin === null ? '' : formatIdOrigin(r.hipOrigin),
    astrometry_via: r.astrometryVia,
    orbit_via: r.orbitVia,
    spect_via: r.spectVia,
    photometry_via: r.photometryVia,
    a_via: r.aVia,
    orbit_role: r.orbitRole,
    P_days: fixed(r.pDays, PLACES.P_days),
    T_jd: fixed(r.tJd, PLACES.T_jd),
    e: fixed(r.e, PLACES.e),
    a_AU: fixed(r.aAU, PLACES.a_AU),
    i_rad: fixed(r.iRad, PLACES.i_rad),
    omega_rad: fixed(r.omegaRad, PLACES.omega_rad),
    Omega_rad: fixed(r.OmegaRad, PLACES.Omega_rad),
    q: fixed(r.q, PLACES.q),
    dist_pc: fixed(r.distPc, PLACES.dist_pc),
    sep_arcsec: fixed(r.sepArcsec, PLACES.sep_arcsec),
    pa_deg: fixed(r.paDeg, PLACES.pa_deg),
    sep_pa_epoch_jd: fixed(r.sepPaEpochJd, PLACES.sep_pa_epoch_jd),
    dmag: fixed(r.dmag, PLACES.dmag),
    anchor_sep_arcsec: fixed(r.anchorSepArcsec, PLACES.anchor_sep_arcsec),
    anchor_pa_deg: fixed(r.anchorPaDeg, PLACES.anchor_pa_deg),
    anchor_comp: r.anchorComp ?? '',
    mag_pri: fixed(r.magPri, PLACES.mag_pri),
    mag_sec: fixed(r.magSec, PLACES.mag_sec),
  }),
});

export const MULTIPLES_TSV_PATH = resolve(REPO_ROOT, MULTIPLES_TSV.file);
