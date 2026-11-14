// SIMBAD's identifier namespaces, basic-table columns, bibcoded groups and flux bands, as the pulls name them. See README.md.

/** One identifier namespace of the `ident` table: `prefix` plus a suffix composes an id, and `parseIdent` reads one back. */
export interface Namespace {
  /** With its trailing space: `HIP `, `Gaia DR3 `. */
  readonly prefix: string;
  /** The TSV column and request-line name. */
  readonly name: string;
  /** Integer suffixes; a non-numeric namespace's suffix is text (a TYC, a GJ with its component letter). */
  readonly numeric: boolean;
}

export const HIP: Namespace = { prefix: 'HIP ', name: 'hip', numeric: true };
export const GAIA_DR3: Namespace = { prefix: 'Gaia DR3 ', name: 'source_id', numeric: true };
export const TYC: Namespace = { prefix: 'TYC ', name: 'tyc', numeric: false };
export const GJ: Namespace = { prefix: 'GJ ', name: 'gj', numeric: false };
/** Read only by corroboration, never shipped: each release numbers the same star differently. */
export const GAIA_DR2: Namespace = { prefix: 'Gaia DR2 ', name: 'source_id_dr2', numeric: true };
export const GAIA_DR1: Namespace = { prefix: 'Gaia DR1 ', name: 'source_id_dr1', numeric: true };
export const GAIA_RELEASES: readonly Namespace[] = [GAIA_DR3, GAIA_DR2, GAIA_DR1];
export const HD: Namespace = { prefix: 'HD ', name: 'hd', numeric: true };
/** One WDS component, `WDS J<wds_id><component>` with no space; SIMBAD holds no id for the bare system. */
export const WDS: Namespace = { prefix: 'WDS J', name: 'wds', numeric: false };

/** The namespaces a source_id-keyed row falls through to, in this order: the no-Gaia tier's ladder (README.md#the-widening-falls-through-on-resolution-not-on-cell-presence). */
export const WIDENING_LADDER = [HIP, TYC, GJ] as const;
export type LadderName = (typeof WIDENING_LADDER)[number]['name'];

export const compose = (ns: Namespace, suffix: string): string => `${ns.prefix}${suffix}`;

/** An id without its whitespace, case kept: the key a reply asked whole joins back to its request on (README.md#two-invariants-the-adql-depends-on). */
export const identKey = (id: string): string => id.replace(/\s+/g, '');
const fold = (key: string): string => key.toLowerCase();
/** What SIMBAD matches an id on: whitespace dropped and case folded (README.md#two-invariants-the-adql-depends-on). */
export const simbadMatchKey = (id: string): string => fold(identKey(id));

export type ReplyJoin<T> =
  | { readonly kind: 'asked'; readonly value: T }
  | { readonly kind: 'folded' }
  | { readonly kind: 'unasked' };

/** A reply's key against the keys asked: `folded` when it equals one only case-folded, so names another id than any asked (README.md#two-invariants-the-adql-depends-on). */
export function replyJoiner<T>(asked: ReadonlyMap<string, T>): (key: string) => ReplyJoin<T> {
  const folded = new Set([...asked.keys()].map(fold));
  return (key) => {
    const value = asked.get(key);
    if (value !== undefined) return { kind: 'asked', value };
    return folded.has(fold(key)) ? { kind: 'folded' } : { kind: 'unasked' };
  };
}
export const likePattern = (ns: Namespace): string => `${ns.prefix}%`;

/** A numeric namespace's id with a component letter after its number (`HIP 55203A`, `HIP 12345 A`): SIMBAD also holds the bare number for the same object. */
const COMPONENT_SUFFIX = /^(\d+) ?([A-Za-z]{1,3})$/;

export type ParsedIdent =
  | { readonly kind: 'other' }
  | { readonly kind: 'suffix'; readonly suffix: string }
  | { readonly kind: 'component'; readonly number: string; readonly letter: string }
  | { readonly kind: 'unparsed'; readonly id: string };

/** An `ident` id read under `ns`: its suffix with SIMBAD's space padding stripped (README.md#two-invariants-the-adql-depends-on), an integer one in canonical digits. */
export function parseIdent(ns: Namespace, id: string): ParsedIdent {
  if (!id.startsWith(ns.prefix)) return { kind: 'other' };
  const suffix = id.slice(ns.prefix.length).trim();
  if (!ns.numeric) return suffix === '' ? { kind: 'unparsed', id } : { kind: 'suffix', suffix };
  if (/^\d+$/.test(suffix)) return { kind: 'suffix', suffix: BigInt(suffix).toString() };
  const component = COMPONENT_SUFFIX.exec(suffix);
  return component === null ? { kind: 'unparsed', id } : { kind: 'component', number: BigInt(component[1]).toString(), letter: component[2] };
}

/** A basic-table column: what SIMBAD calls it, and what the TSV writes. */
export interface BasicColumn {
  readonly column: string;
  readonly tsv: string;
}

const basic = (column: string, tsv = column): BasicColumn => ({ column, tsv });

export const OID = basic('oid', 'simbad_oid');
export const MAIN_ID = basic('main_id', 'simbad_main_id');
export const SP_TYPE = basic('sp_type');
export const SP_QUAL = basic('sp_qual');
export const SP_BIBCODE = basic('sp_bibcode');
export const OTYPE = basic('otype');
export const RA = basic('ra');
export const DEC = basic('dec');
export const COO_QUAL = basic('coo_qual');
export const COO_BIBCODE = basic('coo_bibcode');
export const PMRA = basic('pmra');
export const PMDEC = basic('pmdec');
export const PM_QUAL = basic('pm_qual');
export const PM_BIBCODE = basic('pm_bibcode');
export const PLX_VALUE = basic('plx_value');
export const PLX_ERR = basic('plx_err');
export const PLX_QUAL = basic('plx_qual');
export const PLX_BIBCODE = basic('plx_bibcode');
export const RVZ_RADVEL = basic('rvz_radvel');
export const RVZ_ERR = basic('rvz_err');
export const RVZ_TYPE = basic('rvz_type');
export const RVZ_QUAL = basic('rvz_qual');
export const RVZ_BIBCODE = basic('rvz_bibcode');

/** TSV columns that ship only beside a filled bibcode: README.md#an-unbibcoded-value-never-reaches-the-file. */
export interface BibcodedGroup {
  readonly bibcode: string;
  readonly values: readonly string[];
}

const group = (bibcode: BasicColumn, ...values: BasicColumn[]): BibcodedGroup => ({ bibcode: bibcode.tsv, values: values.map((v) => v.tsv) });

export const BASIC_BIBCODED_GROUPS: readonly BibcodedGroup[] = [
  group(COO_BIBCODE, RA, DEC, COO_QUAL),
  group(PM_BIBCODE, PMRA, PMDEC, PM_QUAL),
  group(PLX_BIBCODE, PLX_VALUE, PLX_ERR, PLX_QUAL),
  group(RVZ_BIBCODE, RVZ_RADVEL, RVZ_ERR, RVZ_TYPE, RVZ_QUAL),
];

/** One band of the long-format `flux` table, pivoted into `flux_<F>`, `flux_<F>_err`, `flux_<F>_bibcode`. */
export interface FluxBand {
  readonly filter: string;
}

/** Each pivoted TSV column beside the `flux`-table column it comes from, in TSV order. */
export function fluxColumns(band: FluxBand): readonly { readonly tsv: string; readonly source: 'flux' | 'flux_err' | 'bibcode' }[] {
  return [
    { tsv: `flux_${band.filter}`, source: 'flux' },
    { tsv: `flux_${band.filter}_err`, source: 'flux_err' },
    { tsv: `flux_${band.filter}_bibcode`, source: 'bibcode' },
  ];
}

export function fluxGroup(band: FluxBand): BibcodedGroup {
  const [value, err, bibcode] = fluxColumns(band).map((c) => c.tsv);
  return { bibcode, values: [value, err] };
}
