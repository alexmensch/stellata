// The names no WGSN row approves: cited string designations that display, and dropped names that ship as search-only aliases. See README.md#string-designations.

import type { Declared } from '../../util/sources/source';
import { readTable, type TableRow } from '../../util/tsv/table-pure';

export const EPONYM_CLASSES = ['discovery-designation', 'catalogue-designation', 'gould-designation'] as const;
export type EponymClass = (typeof EPONYM_CLASSES)[number];

export const NAME_DROP_CLASSES = ['component-letter', 'discovery-designation', 'gould-designation', 'latin-bayer', 'unattributed'] as const;
export type NameDropClass = (typeof NAME_DROP_CLASSES)[number];

const RECORD_KEY = /^(hd|hip|gaia):([1-9][0-9]*)$/;

export interface RecordIdentifiers {
  readonly hd: number | null;
  readonly hip: number | null;
  readonly gaiaSourceId: string | null;
}

export function recordKeys({ hd, hip, gaiaSourceId }: RecordIdentifiers): string[] {
  const keys: string[] = [];
  if (hd !== null) keys.push(`hd:${hd}`);
  if (hip !== null) keys.push(`hip:${hip}`);
  if (gaiaSourceId !== null) keys.push(`gaia:${gaiaSourceId}`);
  return keys;
}

export type EponymCitation =
  | { readonly source: 'simbad'; readonly oid: number; readonly ident: string }
  | { readonly source: 'wgsn' };

export interface EponymRow {
  readonly name: string;
  readonly class: EponymClass;
  readonly key: string;
  readonly citation: EponymCitation;
}

export interface NameDropRow {
  readonly name: string;
  readonly class: NameDropClass;
  readonly key: string;
}

export interface ShortForm {
  readonly simbadPrefix: string;
  readonly longPrefix: string;
}

function recordKey<C extends string>(row: TableRow<C>, column: C): string {
  const key = row.requiredText(column);
  return RECORD_KEY.test(key) ? key : row.fail(`${column} must be hd:<n>, hip:<n> or gaia:<source_id>`);
}

export function parseEponyms(text: string, from: Declared): EponymRow[] {
  const columns = ['name', 'class', 'key', 'source', 'citation', 'ident'] as const;
  return [...readTable({ ...from, columns }, text)].map((row) => {
    const source = row.oneOf('source', ['simbad', 'wgsn'] as const);
    const citation: EponymCitation = source === 'wgsn'
      ? { source }
      : { source, oid: row.requiredId('citation'), ident: row.requiredText('ident') };
    return { name: row.requiredText('name'), class: row.oneOf('class', EPONYM_CLASSES), key: recordKey(row, 'key'), citation };
  });
}

export function parseNameDrops(text: string, from: Declared): NameDropRow[] {
  const columns = ['name', 'class', 'key', 'evidence'] as const;
  return [...readTable({ ...from, columns }, text)].map((row) => {
    row.requiredText('evidence');
    return { name: row.requiredText('name'), class: row.oneOf('class', NAME_DROP_CLASSES), key: recordKey(row, 'key') };
  });
}

export function parseShortForms(text: string, from: Declared): ShortForm[] {
  const columns = ['simbad_prefix', 'long_prefix', 'reason'] as const;
  return [...readTable({ ...from, columns }, text)].map((row) => {
    row.requiredText('reason');
    return { simbadPrefix: row.requiredText('simbad_prefix'), longPrefix: row.text('long_prefix') ?? '' };
  });
}

/** The designation a SIMBAD ident spells in full, or null where no short form covers its class. */
export function expandSimbadIdent(ident: string, forms: readonly ShortForm[]): string | null {
  for (const { simbadPrefix, longPrefix } of forms) {
    if (!ident.startsWith(`${simbadPrefix} `)) continue;
    const rest = ident.slice(simbadPrefix.length + 1).trim();
    return longPrefix === '' ? rest : `${longPrefix} ${rest}`;
  }
  return null;
}

const squash = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
const COMPONENT_SUFFIX = /^(.*\d)[A-Z]{1,2}$/;
const NAMES_A_COMPONENT = / [A-Z]{1,2}$/;

/** README.md#string-designations. */
export function identAttests(ident: string, name: string, forms: readonly ShortForm[]): boolean {
  const long = expandSimbadIdent(ident, forms);
  if (long === null) return false;
  if (squash(long) === squash(name)) return true;
  const suffixed = COMPONENT_SUFFIX.exec(long);
  return suffixed !== null && !NAMES_A_COMPONENT.test(name) && squash(suffixed[1]) === squash(name);
}

export interface StringDesignations {
  readonly eponym: EponymRow | null;
  readonly drops: readonly NameDropRow[];
}

export interface StringDesignationIndex {
  of(record: RecordIdentifiers): StringDesignations;
}

export function buildStringDesignationIndex(
  eponyms: readonly EponymRow[],
  drops: readonly NameDropRow[],
): StringDesignationIndex {
  const eponymByKey = new Map<string, EponymRow>();
  for (const row of eponyms) {
    if (eponymByKey.has(row.key)) throw new Error(`eponyms: two rows key ${row.key}`);
    eponymByKey.set(row.key, row);
  }
  const dropsByKey = new Map<string, NameDropRow[]>();
  for (const row of drops) dropsByKey.set(row.key, [...dropsByKey.get(row.key) ?? [], row]);
  return {
    of(record) {
      const keys = recordKeys(record);
      const reached = keys.flatMap((k) => eponymByKey.get(k) ?? []);
      if (reached.length > 1) {
        throw new Error(`eponyms: ${reached.map((r) => r.name).join(' and ')} reach one record`);
      }
      return { eponym: reached[0] ?? null, drops: keys.flatMap((k) => dropsByKey.get(k) ?? []) };
    },
  };
}

export type StringDesignationRow = EponymRow | NameDropRow;
export type StringDesignationReach = ReadonlyMap<StringDesignationRow, { readonly records: number; readonly iauNamed: number }>;

export function stringDesignationReach<R extends RecordIdentifiers>(
  index: StringDesignationIndex,
  records: Iterable<R>,
  isIauNamed: (record: R) => boolean,
): StringDesignationReach {
  const reach = new Map<StringDesignationRow, { records: number; iauNamed: number }>();
  for (const record of records) {
    const { eponym, drops } = index.of(record);
    const named = isIauNamed(record) ? 1 : 0;
    for (const row of new Set<StringDesignationRow>([...(eponym === null ? [] : [eponym]), ...drops])) {
      const seen = reach.get(row) ?? { records: 0, iauNamed: 0 };
      reach.set(row, { records: seen.records + 1, iauNamed: seen.iauNamed + named });
    }
  }
  return reach;
}

export function stringDesignationFailures(
  rows: readonly StringDesignationRow[],
  reachedBy: StringDesignationReach,
): string[] {
  const failures: string[] = [];
  for (const row of rows) {
    const reach = reachedBy.get(row) ?? { records: 0, iauNamed: 0 };
    if (reach.records !== 1) failures.push(`${row.name} (${row.key}) reaches ${reach.records} records, not 1`);
    if (reach.iauNamed > 0) failures.push(`${row.name} (${row.key}) reaches a record the IAU WGSN names: delete the row`);
  }
  return failures;
}
