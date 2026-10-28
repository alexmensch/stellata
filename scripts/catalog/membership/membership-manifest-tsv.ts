// See README.md#files-in-this-area.

import { defineArtifact, nullableCell } from '../../util/tsv/artifact-pure';
import { idCell, idListCell, sourceIdCell } from '../../util/tsv/table-pure';
import { SOL_PROPER_NAME } from '../record/catalog-pure';
import { canonicalKeyOf, compareDesignations, starDesignations } from '../../sid/sid-pure';

export const MEMBERSHIP_MANIFEST_FILE = 'data/membership/membership-manifest.tsv';

/** Multi-value separator inside `hd_alt` / `hr_alt` / `routes`. */
export const MANIFEST_VALUE_SEPARATOR = '|';

export const MANIFEST_COLUMNS = [
  'tyc', 'hip', 'hd', 'hd_alt', 'hr', 'hr_alt', 'gl', 'flam', 'bayer', 'proper',
  'gaia_source_id', 'binding', 'routes', 'term',
] as const;
export type ManifestColumn = (typeof MANIFEST_COLUMNS)[number];

/** Which term of `/docs/catalog-driver.md#1-the-driver-model`'s union admitted the row.
 *  `magnitude-term/README.md#the-column-is-the-ledger`. */
export const MEMBERSHIP_TERMS = ['primaries', 'magnitude'] as const;
export type MembershipTerm = (typeof MEMBERSHIP_TERMS)[number];

/** How the row's `gaia_source_id` is justified. `crosswalk_gated` is a TYC /
 *  HIP / CNS5 candidate the HD-route gates (/docs/catalog-driver.md#4-how-hd-reaches-gaia) passed; `simbad_corroborated` is the
 *  source SIMBAD's frozen cross-IDs hold under the record's own designation,
 *  through the same gates; `reviewed` is the value a committed disposition row
 *  settles on stated evidence; `gaia_native` is the pull row itself; `none` is
 *  an empty cell. */
export const BINDING_CLASSES = [
  'crosswalk_gated', 'simbad_corroborated', 'reviewed', 'gaia_native', 'none',
] as const;
export type BindingClass = (typeof BINDING_CLASSES)[number];

export interface ManifestRecord {
  tyc: string | null;
  hip: number | null;
  hd: number | null;
  hdAlt: number[];
  hr: number | null;
  hrAlt: number[];
  gl: string | null;
  flam: number | null;
  bayer: string | null;
  proper: string | null;
  /** Kept as a string: a DR3 source_id exceeds Number.MAX_SAFE_INTEGER. */
  gaiaSourceId: string | null;
  binding: BindingClass;
  routes: string;
  term: MembershipTerm;
  isSol: boolean;
}

/** Builds a record from a row's cells as written. Throws, through `fail`, on
 *  any cell the column cannot hold. */
export function manifestRecord(
  cell: (c: ManifestColumn) => string,
  fail: (message: string) => never,
): ManifestRecord {
  const text = (c: ManifestColumn): string | null => (cell(c) === '' ? null : cell(c));
  const oneOf = <T extends string>(c: ManifestColumn, allowed: readonly T[]): T => {
    const v = cell(c);
    return (allowed as readonly string[]).includes(v) ? v as T : fail(`${c} "${v}" is not one of ${allowed.join(' | ')}`);
  };
  const parsed = <T>(c: ManifestColumn, parse: (raw: string) => T): T => {
    try {
      return parse(cell(c));
    } catch (e) {
      return fail(`${c}: ${(e as Error).message}`);
    }
  };
  const int = (c: ManifestColumn): number | null => parsed(c, idCell);
  const ints = (c: ManifestColumn): number[] => parsed(c, (raw) => idListCell(raw, MANIFEST_VALUE_SEPARATOR));
  const proper = text('proper');
  return {
    tyc: text('tyc'),
    hip: int('hip'),
    hd: int('hd'),
    hdAlt: ints('hd_alt'),
    hr: int('hr'),
    hrAlt: ints('hr_alt'),
    gl: text('gl'),
    flam: int('flam'),
    bayer: text('bayer'),
    proper,
    gaiaSourceId: parsed('gaia_source_id', sourceIdCell),
    binding: oneOf('binding', BINDING_CLASSES),
    routes: cell('routes'),
    term: oneOf('term', MEMBERSHIP_TERMS),
    isSol: proper === SOL_PROPER_NAME,
  };
}

/** The `starDesignations` set a manifest row stands in for — the membership
 *  term's half of SID resolution. */
export function manifestDesignations(r: ManifestRecord): string[] {
  return starDesignations({
    isSol: r.isSol,
    hip: r.hip,
    hd: r.hd,
    hr: r.hr,
    hdAlt: r.hdAlt,
    hrAlt: r.hrAlt,
    gl: r.gl,
    gaiaSourceId: r.gaiaSourceId,
    syntheticId: null,
  });
}

function compareSourceIds(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const ba = BigInt(a);
  const bb = BigInt(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}

/** SID canonical-key order, then TYC, then source — a total order over
 *  committed inputs, so a regeneration diffs by content and never by walk order. */
export function sortManifestRecords(records: readonly ManifestRecord[]): ManifestRecord[] {
  return records
    .map((record) => ({ record, key: canonicalKeyOf(manifestDesignations(record)) }))
    .sort((a, b) => compareDesignations(a.key, b.key)
      || ((a.record.tyc ?? '') < (b.record.tyc ?? '') ? -1 : (a.record.tyc ?? '') > (b.record.tyc ?? '') ? 1 : 0)
      || compareSourceIds(a.record.gaiaSourceId, b.record.gaiaSourceId))
    .map((d) => d.record);
}

export const MEMBERSHIP_MANIFEST = defineArtifact({
  file: MEMBERSHIP_MANIFEST_FILE,
  columns: MANIFEST_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'as-given',
  decode: (row) => manifestRecord((c) => row.raw(c), (m) => row.fail(m)),
  encode: (r) => ({
    tyc: nullableCell(r.tyc),
    hip: nullableCell(r.hip),
    hd: nullableCell(r.hd),
    hd_alt: r.hdAlt.join(MANIFEST_VALUE_SEPARATOR),
    hr: nullableCell(r.hr),
    hr_alt: r.hrAlt.join(MANIFEST_VALUE_SEPARATOR),
    gl: nullableCell(r.gl),
    flam: nullableCell(r.flam),
    bayer: nullableCell(r.bayer),
    proper: nullableCell(r.proper),
    gaia_source_id: nullableCell(r.gaiaSourceId),
    binding: r.binding,
    routes: r.routes,
    term: r.term,
  }),
});
