// Reads the committed WGSN tables back and answers, per catalog record,
// which approved name and which glyph-bearing designations reach it.
// See README.md#the-record-side-join.

import { GREEK_GLYPHS } from './greek-forms';
import { foldNameKey } from './wgsn-normalise-pure';
import type { DesignationRow } from './wgsn-tables-pure';
import type { WgsnRow } from './wgsn-parse-pure';
import { readTable, type TableSpec } from '../../util/tsv/table-pure';

export interface WgsnNameRow {
  name: string;
  aliases: string[];
  hip: number | null;
  hipComponent: string | null;
  hr: number | null;
  hd: number | null;
  hdComponent: string | null;
  vmag: number | null;
  source: WgsnRow['source'];
  srcId: string;
}

/** How each spine `proper` no WGSN name matches is routed
 *  (`data/iau-wgsn/athyg_proper_dispositions.tsv`, /docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them).
 *  `gould-designation` joins the string tier rather than the structured one:
 *  the authority carries only one of the three (82 G. Eri), and both render
 *  the identical form. */
export const PROPER_DISPOSITIONS = [
  'discovery-designation',
  'catalogue-designation',
  'gould-designation',
  'latin-bayer',
  'component-letter',
  'unattributed',
] as const;
export type ProperDisposition = (typeof PROPER_DISPOSITIONS)[number];

const STRING_DESIGNATION_CLASSES: ReadonlySet<ProperDisposition> = new Set<ProperDisposition>([
  'discovery-designation', 'catalogue-designation', 'gould-designation',
]);

/** `latin-bayer` is here as well as in the structured Bayer tier: the tier
 *  renders `p Eri`, and the spelling AT-HYG printed — `p Eridani`, the full
 *  genitive — is not derivable from it. */
const ALIAS_ONLY_CLASSES: ReadonlySet<ProperDisposition> = new Set<ProperDisposition>([
  'component-letter', 'unattributed', 'latin-bayer',
]);

export const PROPER_DISPOSITIONS_TABLE = {
  file: 'data/iau-wgsn/athyg_proper_dispositions.tsv',
  columns: ['proper', 'class', 'hip', 'hd'] as const,
  hint: 'It is hand-curated: restore the proper, class, hip and hd columns.',
} satisfies TableSpec<string>;

export interface ProperDispositionRow {
  proper: string;
  disposition: ProperDisposition;
  hip: number | null;
  hd: number | null;
}

export function parseProperDispositions(text: string): ProperDispositionRow[] {
  return [...readTable(PROPER_DISPOSITIONS_TABLE, text)].map((row) => ({
    proper: row.text('proper') ?? row.fail('proper is empty'),
    disposition: row.oneOf('class', PROPER_DISPOSITIONS),
    hip: row.int('hip'),
    hd: row.int('hd'),
  }));
}

/** Most component-specific first: a HIP-first join collapses p Eri A and B
 *  onto one record. */
const KEY_ORDER = ['hr', 'hd', 'hip'] as const;
type KeyKind = typeof KEY_ORDER[number];

export interface NamingKeys {
  hip: number | null;
  hd: number | null;
  hr: number | null;
  /** The record's spine `proper`. The last resort key: where none of the
   *  identifiers reach a name row, a record whose own printed name folds to
   *  an approved one is that star (Albireo B, whose spine row is HD 183914
   *  against the authority's 183913; Kaewkosin and Maru, whose spine rows
   *  carry no identifier at all). */
  proper: string | null;
}

interface RowIndex<T> {
  hip: Map<number, T[]>;
  hd: Map<number, T[]>;
  hr: Map<number, T[]>;
}

function indexRows<T extends { hip: number | null; hd: number | null; hr: number | null }>(
  rows: readonly T[],
): RowIndex<T> {
  const idx: RowIndex<T> = { hip: new Map(), hd: new Map(), hr: new Map() };
  for (const row of rows) {
    for (const k of KEY_ORDER) {
      const v = row[k];
      if (v === null) continue;
      const bucket = idx[k].get(v);
      if (bucket) bucket.push(row);
      else idx[k].set(v, [row]);
    }
  }
  return idx;
}

function lookup<T>(idx: RowIndex<T>, keys: NamingKeys): { rows: T[]; via: KeyKind | null } {
  for (const k of KEY_ORDER) {
    const v = keys[k];
    if (v === null) continue;
    const rows = idx[k].get(v);
    if (rows !== undefined) return { rows, via: k };
  }
  return { rows: [], via: null };
}

/** A trailing component letter baked into the authority's own name string
 *  (`Albireo A`, `Albireo B`) — the only names that carry one. */
const NAME_WITH_COMPONENT = /^.+ [A-Z][a-z]?$/;

/** Where several name rows reach one record — NEC lists the components of a
 *  close pair as separate serials, and Albireo appears both bare and as
 *  `Albireo A` — the bare name wins: it is the one the authority approved
 *  for the star rather than for a component of it. */
export function pickNameRow(rows: readonly WgsnNameRow[]): WgsnNameRow {
  const bare = rows.filter((r) => !NAME_WITH_COMPONENT.test(r.name));
  const pool = bare.length > 0 ? bare : rows;
  return [...pool].sort((a, b) =>
    a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.srcId < b.srcId ? -1 : 1))[0];
}

/** Several Bayer rows can reach one record, and the choice is not
 *  arbitrary: a Greek glyph outranks the Latin overflow series, then a row
 *  with no component cell names the STAR where a lettered one names a
 *  component of it, then a superscripted row is the component's own
 *  designation where the bare one names the pair. */
export function pickBayerRow(
  rows: readonly DesignationRow[],
): DesignationRow {
  const greek = rows.filter((r) => r.letter !== null && GREEK_GLYPHS.has(r.letter));
  const pool = greek.length > 0 ? greek : rows;
  return [...pool].sort((a, b) =>
    (a.component === null ? 0 : 1) - (b.component === null ? 0 : 1)
    || (a.sup === null ? 1 : 0) - (b.sup === null ? 1 : 0)
    || (a.sup ?? 0) - (b.sup ?? 0)
    || ((a.letter ?? '') < (b.letter ?? '') ? -1 : 1))[0];
}

export function pickGouldRow(
  rows: readonly DesignationRow[],
): DesignationRow {
  return [...rows].sort((a, b) =>
    (a.num ?? 0) - (b.num ?? 0)
    || (a.dc < b.dc ? -1 : a.dc > b.dc ? 1 : 0)
    || ((a.half ?? '') < (b.half ?? '') ? -1 : 1))[0];
}

export interface WgsnIndex {
  nameOf(keys: NamingKeys): { row: WgsnNameRow; viaProper: boolean } | null;
  bayerOf(keys: NamingKeys): DesignationRow | null;
  gouldOf(keys: NamingKeys): DesignationRow | null;
  /** Folded name keys the authority approves — the naming-authority gate's own set (/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them). */
  approvedNameKeys: ReadonlySet<string>;
}

export function buildWgsnIndex(
  names: readonly WgsnNameRow[],
  designations: readonly DesignationRow[],
): WgsnIndex {
  const nameIdx = indexRows(names);
  const byFoldedName = new Map<string, WgsnNameRow[]>();
  const approvedNameKeys = new Set<string>();
  for (const row of names) {
    for (const spelling of [row.name, ...row.aliases]) {
      const key = foldNameKey(spelling);
      approvedNameKeys.add(key);
      const bucket = byFoldedName.get(key);
      if (bucket) bucket.push(row);
      else byFoldedName.set(key, [row]);
    }
  }
  const bayerIdx = indexRows(designations.filter((d) => d.kind === 'bayer'));
  const gouldIdx = indexRows(designations.filter((d) => d.kind === 'gould'));

  return {
    approvedNameKeys,
    nameOf(keys) {
      const { rows } = lookup(nameIdx, keys);
      if (rows.length > 0) return { row: pickNameRow(rows), viaProper: false };
      if (keys.proper === null) return null;
      const byName = byFoldedName.get(foldNameKey(keys.proper));
      if (byName === undefined) return null;
      return { row: pickNameRow(byName), viaProper: true };
    },
    bayerOf(keys) {
      const { rows } = lookup(bayerIdx, keys);
      return rows.length > 0 ? pickBayerRow(rows) : null;
    },
    gouldOf(keys) {
      const { rows } = lookup(gouldIdx, keys);
      return rows.length > 0 ? pickGouldRow(rows) : null;
    },
  };
}

export interface DispositionRouting {
  /** A published designation string the ladder displays (the naming authority's designation
   *  classes, /docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them). */
  eponym: string | null;
  /** A published spelling that resolves a search and never displays. */
  alias: string | null;
}

/** A proper the authority approves is not disposed at all and arrives
 *  through the name tier instead. */
export function routeDisposedProper(
  proper: string,
  disposition: ProperDisposition | undefined,
): DispositionRouting {
  if (disposition === undefined) return { eponym: null, alias: null };
  if (STRING_DESIGNATION_CLASSES.has(disposition)) {
    return { eponym: proper, alias: null };
  }
  if (ALIAS_ONLY_CLASSES.has(disposition)) {
    return { eponym: null, alias: proper };
  }
  return { eponym: null, alias: null };
}
