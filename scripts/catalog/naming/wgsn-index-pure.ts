// Reads the committed WGSN tables back and answers, per catalog record,
// which approved name and which glyph-bearing designations reach it.
// See README.md § The record-side join.

import { GREEK_GLYPHS } from './greek-forms';
import { foldNameKey } from './wgsn-normalise-pure';

export interface WgsnNameRow {
  name: string;
  aliases: string[];
  hip: number | null;
  hr: number | null;
  hd: number | null;
  srcId: string;
}

export interface WgsnDesignationRow {
  kind: 'bayer' | 'flamsteed' | 'gould';
  letter: string | null;
  sup: number | null;
  num: number | null;
  dc: string;
  half: string | null;
  component: string | null;
  hip: number | null;
  hr: number | null;
  hd: number | null;
}

/** How each spine `proper` no WGSN name matches is routed
 *  (`data/iau-wgsn/athyg_proper_dispositions.tsv`, docs/star-naming.md § 2).
 *  `gould-designation` joins the string tier rather than the structured one:
 *  the authority carries only one of the three (82 G. Eri), and both render
 *  the identical form. */
export type ProperDisposition =
  | 'discovery-designation'
  | 'catalogue-designation'
  | 'gould-designation'
  | 'latin-bayer'
  | 'component-letter'
  | 'unattributed';

const STRING_DESIGNATION_CLASSES: ReadonlySet<ProperDisposition> = new Set<ProperDisposition>([
  'discovery-designation', 'catalogue-designation', 'gould-designation',
]);

/** Classes whose string never displays but must keep resolving a search.
 *  `latin-bayer` is here as well as in the structured Bayer tier: the tier
 *  renders `p Eri`, and the spelling AT-HYG printed — `p Eridani`, the full
 *  genitive — is not derivable from it. */
const ALIAS_ONLY_CLASSES: ReadonlySet<ProperDisposition> = new Set<ProperDisposition>([
  'component-letter', 'unattributed', 'latin-bayer',
]);

function tsvRows(text: string): Map<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return new Map(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

const intOrNull = (v: string | undefined): number | null =>
  v === undefined || v === '' ? null : Number(v);
const strOrNull = (v: string | undefined): string | null =>
  v === undefined || v === '' ? null : v;

export function parseWgsnNamesTsv(text: string): WgsnNameRow[] {
  return tsvRows(text).map((r) => ({
    name: r.get('name') ?? '',
    aliases: (r.get('aliases') ?? '') === '' ? [] : (r.get('aliases') as string).split('|'),
    hip: intOrNull(r.get('hip')),
    hr: intOrNull(r.get('hr')),
    hd: intOrNull(r.get('hd')),
    srcId: r.get('src_id') ?? '',
  }));
}

export function parseWgsnDesignationsTsv(text: string): WgsnDesignationRow[] {
  return tsvRows(text).map((r) => ({
    kind: (r.get('kind') ?? '') as WgsnDesignationRow['kind'],
    letter: strOrNull(r.get('letter')),
    sup: intOrNull(r.get('sup')),
    num: intOrNull(r.get('num')),
    dc: r.get('dc') ?? '',
    half: strOrNull(r.get('half')),
    component: strOrNull(r.get('component')),
    hip: intOrNull(r.get('hip')),
    hr: intOrNull(r.get('hr')),
    hd: intOrNull(r.get('hd')),
  }));
}

export function parseProperDispositionsTsv(
  text: string,
): Map<string, ProperDisposition> {
  const out = new Map<string, ProperDisposition>();
  for (const r of tsvRows(text)) {
    out.set(r.get('proper') ?? '', (r.get('class') ?? '') as ProperDisposition);
  }
  return out;
}

/** The record's own identifiers, most component-specific first. Hipparcos
 *  resolved close pairs as ONE star, so its number is the least
 *  component-specific of the three: NEC lists both p Eri rows against
 *  HIP 7751 and separates them only by HR (486 / 487) and HD
 *  (10360 / 10361), so a HIP-first join collapses p Eri A and B onto one
 *  record. */
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
 *  arbitrary. In precedence order:
 *
 *  - a Greek glyph outranks the Latin overflow series. NEC hangs `y Cen B`
 *    on γ Cen's keys, and reading that as the star's designation renamed
 *    γ Cen to `y Cen` and collided it with the real y Cen (HIP 67819);
 *  - a row with no component cell names the STAR where a lettered one names
 *    a component of it, and γ Cen's keys carry all three (`γ Cen`,
 *    `γ Cen A`, `γ Cen B`) — the bare row is the star's designation;
 *  - a superscripted row is the component's own designation where the bare
 *    one names the pair (β Sco and β¹ Sco both key HIP 78820 — the star is
 *    β¹ Sco). */
export function pickBayerRow(
  rows: readonly WgsnDesignationRow[],
): WgsnDesignationRow {
  const greek = rows.filter((r) => r.letter !== null && GREEK_GLYPHS.has(r.letter));
  const pool = greek.length > 0 ? greek : rows;
  return [...pool].sort((a, b) =>
    (a.component === null ? 0 : 1) - (b.component === null ? 0 : 1)
    || (a.sup === null ? 1 : 0) - (b.sup === null ? 1 : 0)
    || (a.sup ?? 0) - (b.sup ?? 0)
    || ((a.letter ?? '') < (b.letter ?? '') ? -1 : 1))[0];
}

export function pickGouldRow(
  rows: readonly WgsnDesignationRow[],
): WgsnDesignationRow {
  return [...rows].sort((a, b) =>
    (a.num ?? 0) - (b.num ?? 0)
    || (a.dc < b.dc ? -1 : a.dc > b.dc ? 1 : 0)
    || ((a.half ?? '') < (b.half ?? '') ? -1 : 1))[0];
}

export interface WgsnIndex {
  nameOf(keys: NamingKeys): { row: WgsnNameRow; viaProper: boolean } | null;
  bayerOf(keys: NamingKeys): WgsnDesignationRow | null;
  gouldOf(keys: NamingKeys): WgsnDesignationRow | null;
  /** Folded name keys the authority approves — the § 2 gate's own set. */
  approvedNameKeys: ReadonlySet<string>;
}

export function buildWgsnIndex(
  names: readonly WgsnNameRow[],
  designations: readonly WgsnDesignationRow[],
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
  /** A published designation string the ladder displays (§ 2's designation
   *  classes). */
  eponym: string | null;
  /** A published spelling that resolves a search and never displays. */
  alias: string | null;
}

/** Route one spine `proper` by the class the disposition file assigns it.
 *  A proper the authority approves is not disposed at all and arrives
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
