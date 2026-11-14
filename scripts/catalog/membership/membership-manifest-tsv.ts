// See README.md#files-in-this-area.

import { defineArtifact, nullableCell } from '../../util/tsv/artifact-pure';
import { compareSourceIds, idCell, idListCell, sourceIdCell } from '../../util/tsv/table-pure';
import { SOL_PROPER_NAME } from '../../../src/catalog-format/record/catalog-pure';
import { canonicalKeyOf, compareDesignations, starDesignations } from '../../sid/sid-pure';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { BINDING_CLASSES, type BindingClass } from './ledger-rows-pure';
import type { LabelMergeRecord } from '../classic-ids/label-merge/label-merge-pure';
import { parkedRecordKey } from '../distance/parallax/parked-ledger-pure';

/** Multi-value separator inside `hd_alt` / `hr_alt` / `routes`. */
export const MANIFEST_VALUE_SEPARATOR = '|';

export function joinManifestValues(values: readonly (string | number)[]): string {
  return values.map(String).join(MANIFEST_VALUE_SEPARATOR);
}

export const MANIFEST_COLUMNS = [
  'tyc', 'hip', 'hd', 'hd_alt', 'hr', 'hr_alt', 'gl', 'flam', 'bayer', 'proper',
  'gaia_source_id', 'binding', 'routes', 'term', 'origin_key',
] as const;
export type ManifestColumn = (typeof MANIFEST_COLUMNS)[number];

/** Which term of `/docs/catalog-driver.md#1-the-driver-model`'s union admitted the row.
 *  `magnitude-term/README.md#the-column-is-the-ledger`. */
export const MEMBERSHIP_TERMS = ['primaries', 'magnitude'] as const;
export type MembershipTerm = (typeof MEMBERSHIP_TERMS)[number];


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
  /** The record's lineage origin key (../lineage/README.md#identity--the-origin-source-row). */
  originKey: string;
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
    originKey: cell('origin_key') || fail('origin_key is empty'),
    isSol: proper === SOL_PROPER_NAME,
  };
}

const textOrNull = (cell: string | null): string | null => (cell === '' ? null : cell);

/** A primaries row from its merged labels: the spine's printed TYC, Bayer and
 *  proper cells (empty on an addition) beside the label merge's record. */
export function primariesManifestRecord(
  cells: { tyc: string; bayer: string; proper: string },
  r: LabelMergeRecord,
  binding: BindingClass,
  originKey: string,
): ManifestRecord {
  const proper = textOrNull(cells.proper);
  return {
    tyc: textOrNull(cells.tyc),
    hip: r.hip,
    hd: r.hd,
    hdAlt: [...r.hdAlt],
    hr: r.hr,
    hrAlt: [...r.hrAlt],
    gl: textOrNull(r.gl),
    flam: r.flam,
    bayer: textOrNull(cells.bayer),
    proper,
    gaiaSourceId: textOrNull(r.gaiaSourceId),
    binding,
    routes: '',
    term: 'primaries',
    originKey,
    isSol: proper === SOL_PROPER_NAME,
  };
}

/** A magnitude-term row: every classical cell empty, the source_id its whole
 *  identity. */
export function magnitudeManifestRecord(sourceId: string, originKey: string): ManifestRecord {
  return {
    tyc: null, hip: null, hd: null, hdAlt: [], hr: null, hrAlt: [], gl: null, flam: null,
    bayer: null, proper: null,
    gaiaSourceId: sourceId,
    binding: 'gaia_native',
    routes: '',
    term: 'magnitude',
    originKey,
    isSol: false,
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
  file: DATA_FILES.membershipManifest,
  columns: MANIFEST_COLUMNS,
  hint: 'Re-run `pnpm run build:membership`.',
  order: 'as-given',
  decode: (row) => manifestRecord((c) => row.raw(c), (m) => row.fail(m)),
  encode: (r) => ({
    tyc: nullableCell(r.tyc),
    hip: nullableCell(r.hip),
    hd: nullableCell(r.hd),
    hd_alt: joinManifestValues(r.hdAlt),
    hr: nullableCell(r.hr),
    hr_alt: joinManifestValues(r.hrAlt),
    gl: nullableCell(r.gl),
    flam: nullableCell(r.flam),
    bayer: nullableCell(r.bayer),
    proper: nullableCell(r.proper),
    gaia_source_id: nullableCell(r.gaiaSourceId),
    binding: r.binding,
    routes: r.routes,
    term: r.term,
    origin_key: r.originKey,
  }),
});

/** The identifier tuple a ledger row and a manifest row share — the same five
 *  cells the parked ledger keys on. */
export function manifestKey(record: ManifestRecord): string {
  return parkedRecordKey(MEMBERSHIP_MANIFEST.encode(record));
}
