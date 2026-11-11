// The display-name composer: the one pure ladder the record build and the
// runtime both render from, plus the wire adapter onto it. Contract in /docs/star-naming.md#3-the-ladder
// and /docs/star-naming.md#6-rendering--glyphs-everywhere-no-fallback-path.

import {
  designationConIndex,
  NO_CONSTELLATION_INDEX,
  type SearchEntry,
} from '../record/catalog-pure';
import { GREEK_GLYPHS } from './greek-forms';

// The ladder stops at the catalogue tier. Its Gaia tail and the `SID #<n>`
// last resort below it are the runtime's `resolveStarName`
// (src/client/format/star-companion-format.ts): neither is a designation a
// catalogue published, and neither reaches the search index, so composing
// them here would only give every record a base and stop components
// borrowing their system's.
export const NAME_TIERS = [
  'override', 'iau', 'eponym', 'bayer', 'flamsteed', 'bayer_latin', 'gould',
  'gcvs', 'catalogue',
] as const;
export type NameTier = typeof NAME_TIERS[number];

/** Tiers where an authority approved the string as a NAME for one star,
 *  rather than a catalogue compiling it as a designation. The authority's
 *  attribution is the component statement, so no letter is appended and a
 *  second record claiming the same string is a data finding, not something
 *  lettering can settle. */
const APPROVED_NAME_TIERS: ReadonlySet<NameTier> = new Set<NameTier>([
  'override', 'iau', 'eponym',
]);

export function isApprovedName(tier: NameTier): boolean {
  return APPROVED_NAME_TIERS.has(tier);
}

/** Tiers that name a star's PLACE IN THE SKY rather than identify it: a
 *  Bayer letter (either series), a Flamsteed number and a Gould number are
 *  all constellation-relative designations a reader can site. A GCVS serial and
 *  a catalogue number identify the star and say nothing about the system it
 *  sits in, which is why a component wearing one prefers its system's
 *  designation instead. */
const SKY_DESIGNATION_TIERS: ReadonlySet<NameTier> = new Set<NameTier>([
  'bayer', 'flamsteed', 'bayer_latin', 'gould',
]);

const TIER_RANK: ReadonlyMap<NameTier, number> = new Map(
  NAME_TIERS.map((tier, rank) => [tier, rank]),
);

/** A published name that already carries the anchor's OWN component letter
 *  is not the system's base: AT-HYG prints `Struve 2398 A` for the A
 *  component, and appending D to it reads "Struve 2398 A D". */
function systemBaseOf(base: string, anchorComponent: string | undefined): string {
  if (anchorComponent === undefined) return base;
  const suffix = ` ${anchorComponent}`;
  return base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

/** One star's structured designation set. Every field is canonical per
 *  /docs/star-naming.md#4-canonical-designation-forms — the Bayer letter is the Unicode glyph, not an
 *  ASCII convention, and no consumer parses a designation string. */
export interface DesignationSet {
  override?: string;
  iauName?: string;
  /** A published designation carried as a string because no structured
   *  source states it: discovery / eponymous / X-ray catalogue forms
   *  (`Ross 128`, `Kapteyn's Star`, `Cygnus X-1`). */
  eponym?: string;
  /** Bayer letter glyph — Greek (`α`) or the bare Latin overflow series
   *  (`p`, `A`). */
  bayer?: string;
  bayerSup?: number;
  flamsteed?: number;
  gould?: number;
  /** Serpens' Gould halves are numbered separately, so the half is part of
   *  the designation (`4 G. Ser Cau`). */
  gouldHalf?: string;
  gcvs?: string;
  hip?: number;
  hd?: number;
  hr?: number;
  gl?: string;
  /** IAU 3-letter code of the constellation the Bayer / Flamsteed / Gould
   *  designation is NAMED for. Absent leaves those tiers unrenderable and
   *  the ladder falls through. */
  dc?: string;
}

const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

export function superscript(n: number | string): string {
  return String(n).split('')
    .map((d) => SUPERSCRIPT_DIGITS[Number(d)] ?? d).join('');
}

/** GCVS stores V-number designations zero-padded to four digits
 *  ("V0645 Cen"); common usage — and what a user types — drops the padding.
 *  Anchored at the start, so "LMC V0471" keeps its zeros. */
export function formatGcvsDesignation(raw: string): string {
  return raw.replace(/^V0*(\d)/, 'V$1');
}

export function bayerDesignation(glyph: string, sup: number | undefined, dc: string): string {
  return `${glyph}${sup === undefined ? '' : superscript(sup)} ${dc}`;
}

export function gouldDesignation(num: number, half: string | undefined, dc: string): string {
  return `${num} G. ${dc}${half ? ` ${half}` : ''}`;
}

/** Total over `NAME_TIERS`, and the single statement of every tier's
 *  rendering — `ownDesignation` walks it rather than restating the ladder,
 *  so the two cannot answer one tier differently. */
export function designationAtTier(
  d: DesignationSet,
  tier: NameTier,
): string | null {
  if (tier === 'override') return d.override || null;
  if (tier === 'iau') return d.iauName || null;
  if (tier === 'eponym') return d.eponym || null;
  if (tier === 'gcvs') return d.gcvs ? formatGcvsDesignation(d.gcvs) : null;
  if (tier === 'catalogue') {
    if (d.hip !== undefined) return `HIP ${d.hip}`;
    if (d.hd !== undefined) return `HD ${d.hd}`;
    if (d.hr !== undefined) return `HR ${d.hr}`;
    return d.gl || null;
  }
  // The constellation-relative tiers are unrenderable without the
  // constellation the designation is NAMED for, so the ladder falls past
  // them rather than siting them by position (/docs/star-naming.md#6-rendering--glyphs-everywhere-no-fallback-path).
  if (!d.dc) return null;
  if (tier === 'bayer' || tier === 'bayer_latin') {
    if (!d.bayer) return null;
    // Bayer ran out of Greek and carried on into Latin, and the two halves
    // of that series are read differently. The Greek letter is how every
    // reference names the star; the Latin overflow is real and published but
    // the Flamsteed number is what atlases and observing lists print, so it
    // sits BELOW Flamsteed rather than above — /docs/star-naming.md#3-the-ladder.
    const greek = GREEK_GLYPHS.has(d.bayer);
    if (greek !== (tier === 'bayer')) return null;
    return bayerDesignation(d.bayer, d.bayerSup, d.dc);
  }
  if (tier === 'flamsteed') {
    return d.flamsteed === undefined ? null : `${d.flamsteed} ${d.dc}`;
  }
  return d.gould === undefined ? null : gouldDesignation(d.gould, d.gouldHalf, d.dc);
}

/** The highest tier the star carries in its own right, rendered without a
 *  component letter. Null when it carries nothing a user could read. */
export function ownDesignation(
  d: DesignationSet,
): { base: string; tier: NameTier } | null {
  for (const tier of NAME_TIERS) {
    const base = designationAtTier(d, tier);
    if (base !== null) return { base, tier };
  }
  return null;
}

export interface DisplayNameInput<K> {
  key: K;
  set: DesignationSet;
  /** WDS / CCDM component letter, stated relative to the WDS root. Renders
   *  only where a SIBLING OWNS the same designation — which is not the same
   *  as the label needing it to be unique, since a sibling that owns the
   *  designation and then borrows a higher tier displays a lettered form of
   *  it anyway (δ Cep A beside δ Cep C/D/E). */
  component?: string;
  /** The component the AUTHORITY attributes the star's own designation to.
   *  `κ Her` names component A, so the row for the B component states B and
   *  the letter renders unconditionally — the ownership test cannot derive
   *  it, since the A component displays its approved name and never claims
   *  the Bayer base. */
  statedComponent?: string;
  /** The WDS root's naming anchor: the record whose designation a component
   *  with nothing better of its own borrows a base from. */
  anchorKey?: K;
}

/** Why a component took its system anchor's base over its own designation. */
export type BorrowReason =
  /** It carries no designation of its own. */
  | 'no-own-designation'
  /** Its own designation is one the anchor also carries (ξ UMa B's 53 UMa). */
  | 'system-designation'
  /** Its own is an identifier (GCVS, catalogue) ranked below the anchor's tier. */
  | 'outranked-identifier';

/** Where the label's component letter came from: the authority's attribution
 *  of the designation to a component, or the WDS letter, rendered because a
 *  sibling owns the same designation. */
export type OwnLetter = { source: 'stated' | 'sibling-owns'; comp: string };

export type DisplayName<K = unknown> =
  | {
    kind: 'own';
    label: string;
    tier: NameTier;
    letter: OwnLetter | null;
  }
  | {
    kind: 'borrowed';
    label: string;
    /** The anchor's tier. */
    tier: NameTier;
    anchorKey: K;
    reason: BorrowReason;
    /** The WDS component letter, always rendered. */
    comp: string;
  };

/** A component letter is part of the label. */
export function isLettered(name: DisplayName): boolean {
  return name.kind === 'borrowed' || name.letter !== null;
}

function borrowReason(
  own: { base: string; tier: NameTier } | undefined,
  anchorSet: DesignationSet,
  anchorTier: NameTier,
): BorrowReason | null {
  if (own === undefined) return 'no-own-designation';
  // A designation the SYSTEM also carries names the system, not this
  // component: ξ UMa B's Flamsteed number 53 is ξ UMa's, so it reads
  // "Alula Australis B" rather than "53 UMa" — and the same holds of
  // a catalogue number the anchor displays too.
  if (designationAtTier(anchorSet, own.tier) === own.base) return 'system-designation';
  if (!SKY_DESIGNATION_TIERS.has(own.tier)
      && (TIER_RANK.get(anchorTier) ?? 0) < (TIER_RANK.get(own.tier) ?? 0)) {
    return 'outranked-identifier';
  }
  return null;
}

const LOWEST_IDENTIFIER_RANK = Math.max(
  ...NAME_TIERS.filter((tier) => !SKY_DESIGNATION_TIERS.has(tier)).map((tier) => TIER_RANK.get(tier) ?? 0),
);

/** The tiers an anchor can lend a component under each borrowing rule: an
 *  outranked identifier needs an anchor tier strictly above the record's own. */
export const BORROWABLE_TIERS: Readonly<Record<BorrowReason, readonly NameTier[]>> = {
  'no-own-designation': NAME_TIERS,
  'system-designation': NAME_TIERS,
  'outranked-identifier': NAME_TIERS.filter((tier) => (TIER_RANK.get(tier) ?? 0) < LOWEST_IDENTIFIER_RANK),
};

/** The letter turns on OWNERSHIP, not on label uniqueness: a sibling that
 *  owns the designation and then borrows a higher tier still displays a
 *  lettered form of it, so δ Cep A reads as such beside δ Cep C/D/E rather
 *  than reverting to the bare designation its siblings no longer claim. */
export function resolveDisplayNames<K>(
  inputs: readonly DisplayNameInput<K>[],
): Map<K, DisplayName<K>> {
  const own = new Map<K, { base: string; tier: NameTier }>();
  const byKey = new Map<K, DisplayNameInput<K>>();
  const owners = new Map<string, number>();
  for (const input of inputs) byKey.set(input.key, input);
  for (const input of inputs) {
    const o = ownDesignation(input.set);
    if (o === null) continue;
    own.set(input.key, o);
    owners.set(o.base, (owners.get(o.base) ?? 0) + 1);
  }

  const out = new Map<K, DisplayName<K>>();
  for (const input of inputs) {
    const o = own.get(input.key);
    // Two DIFFERENT identifiers of one tier trade nothing. The anchor is
    // included in its own root with its own letter, and a record lends
    // itself nothing.
    const anchorKey = input.anchorKey === input.key ? undefined : input.anchorKey;
    const anchorInput = anchorKey === undefined ? undefined : byKey.get(anchorKey);
    const anchor = anchorKey === undefined ? undefined : own.get(anchorKey);
    const reason = anchor !== undefined && anchorInput !== undefined
      ? borrowReason(o, anchorInput.set, anchor.tier) : null;
    if (reason !== null && anchor !== undefined && anchorKey !== undefined
        && input.component !== undefined) {
      const base = systemBaseOf(anchor.base, anchorInput?.component);
      out.set(input.key, {
        kind: 'borrowed',
        label: `${base} ${input.component}`,
        tier: anchor.tier,
        anchorKey,
        reason,
        comp: input.component,
      });
      continue;
    }
    if (o === undefined) continue;
    const letter = ownLetter(input, o, owners);
    out.set(input.key, {
      kind: 'own',
      label: letter === null ? o.base : `${o.base} ${letter.comp}`,
      tier: o.tier,
      letter,
    });
  }
  return out;
}

function ownLetter<K>(
  input: DisplayNameInput<K>,
  own: { base: string; tier: NameTier },
  owners: ReadonlyMap<string, number>,
): OwnLetter | null {
  if (isApprovedName(own.tier)) return null;
  if (input.statedComponent !== undefined) return { source: 'stated', comp: input.statedComponent };
  if (input.component !== undefined && (owners.get(own.base) ?? 0) > 1) {
    return { source: 'sibling-owns', comp: input.component };
  }
  return null;
}

/** `p` enters as the name tier — the build wrote it from this same ladder —
 *  so a record the authority named never takes a component letter on top
 *  of it. */
export function designationSetOfEntry(
  entry: SearchEntry,
  constellations: readonly { code: string }[],
): DesignationSet {
  const conIdx = designationConIndex(entry.dc, entry.c);
  const con = conIdx !== NO_CONSTELLATION_INDEX ? constellations[conIdx] : undefined;
  const set: DesignationSet = {};
  if (entry.p !== undefined) set.iauName = entry.p;
  if (entry.b !== undefined) set.bayer = entry.b;
  if (entry.bx !== undefined) set.bayerSup = entry.bx;
  if (entry.f !== undefined) set.flamsteed = entry.f;
  if (entry.gd !== undefined) set.gould = entry.gd;
  if (entry.gh !== undefined) set.gouldHalf = entry.gh;
  if (entry.g !== undefined) set.gcvs = entry.g;
  if (entry.hip !== undefined) set.hip = entry.hip;
  if (entry.hd !== undefined) set.hd = entry.hd;
  if (entry.hr !== undefined) set.hr = entry.hr;
  if (entry.gl !== undefined) set.gl = entry.gl;
  if (con !== undefined) set.dc = con.code;
  return set;
}

/** Compose every entry's display label off the shipped search index —
 *  exactly what the runtime does at boot, through the same function. */
export function displayNamesFromSearchIndex(
  raw: readonly SearchEntry[],
  constellations: readonly { code: string }[],
): Map<number, DisplayName<number>> {
  return resolveDisplayNames(raw.map((entry): DisplayNameInput<number> => {
    const input: DisplayNameInput<number> = {
      key: entry.i,
      set: designationSetOfEntry(entry, constellations),
    };
    if (entry.cl !== undefined) input.component = entry.cl;
    if (entry.bc !== undefined) input.statedComponent = entry.bc;
    if (entry.cp !== undefined) input.anchorKey = entry.cp;
    return input;
  }));
}
