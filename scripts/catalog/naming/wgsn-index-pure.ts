// Reads the committed WGSN tables back and answers, per catalog record,
// which approved name and which glyph-bearing designations reach it.
// See README.md#the-record-side-join.

import { GREEK_GLYPHS } from '../../../src/catalog-format/naming/greek-forms';
import type { DesignationRow } from './wgsn-tables-pure';
import type { WgsnRow } from './wgsn-parse-pure';
import { compareCodeUnits } from '../../../src/astro-core/order-pure';

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

/** Most component-specific first: a HIP-first join collapses p Eri A and B
 *  onto one record. */
const KEY_ORDER = ['hr', 'hd', 'hip'] as const;
type KeyKind = typeof KEY_ORDER[number];

export interface NamingKeys {
  hip: number | null;
  hd: number | null;
  hr: number | null;
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
    a.name.length - b.name.length || compareCodeUnits(a.name, b.name)
    || compareCodeUnits(a.srcId, b.srcId))[0];
}

/** Several Bayer rows can reach one record, and the choice is not
 *  arbitrary: a Greek glyph outranks the Latin overflow series, then a row
 *  with no component cell names the STAR where a lettered one names a
 *  component of it, then a superscripted row is the component's own
 *  designation where the bare one names the pair. */
/** README.md#the-record-side-join. */
export function alternateNames(rows: readonly WgsnNameRow[], picked: WgsnNameRow): string[] {
  const names = new Set(rows.flatMap((r) => [
    ...(r === picked || NAME_WITH_COMPONENT.test(r.name) ? [] : [r.name]),
    ...r.aliases,
  ]));
  names.delete(picked.name);
  return [...names].sort(compareCodeUnits);
}

export function pickBayerRow(
  rows: readonly DesignationRow[],
): DesignationRow {
  const greek = rows.filter((r) => r.letter !== null && GREEK_GLYPHS.has(r.letter));
  const pool = greek.length > 0 ? greek : rows;
  return [...pool].sort((a, b) =>
    (a.component === null ? 0 : 1) - (b.component === null ? 0 : 1)
    || (a.sup === null ? 1 : 0) - (b.sup === null ? 1 : 0)
    || (a.sup ?? 0) - (b.sup ?? 0)
    || compareCodeUnits(a.letter ?? '', b.letter ?? ''))[0];
}

export function pickGouldRow(
  rows: readonly DesignationRow[],
): DesignationRow {
  return [...rows].sort((a, b) =>
    (a.num ?? 0) - (b.num ?? 0)
    || compareCodeUnits(a.dc, b.dc)
    || compareCodeUnits(a.half ?? '', b.half ?? ''))[0];
}

export interface WgsnIndex {
  /** Every name row the record's first reaching key holds. */
  namesOf(keys: NamingKeys): WgsnNameRow[];
  bayerOf(keys: NamingKeys): DesignationRow | null;
  gouldOf(keys: NamingKeys): DesignationRow | null;
}

export function buildWgsnIndex(
  names: readonly WgsnNameRow[],
  designations: readonly DesignationRow[],
): WgsnIndex {
  const nameIdx = indexRows(names);
  const bayerIdx = indexRows(designations.filter((d) => d.kind === 'bayer'));
  const gouldIdx = indexRows(designations.filter((d) => d.kind === 'gould'));

  return {
    namesOf(keys) {
      return lookup(nameIdx, keys).rows;
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
