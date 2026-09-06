// The display-name composer: the one pure ladder the record build and the
// runtime both render from, plus the wire adapter onto it. Contract in
// docs/star-naming.md §§ 3, 6.

import {
  designationConIndex,
  NO_CONSTELLATION_INDEX,
  type SearchEntry,
} from '../catalog-pure';
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
 *  docs/star-naming.md § 4 — the Bayer letter is the Unicode glyph, not an
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

/** How this designation set renders at ONE tier, ignoring every other.
 *  Total over `NAME_TIERS`, and the single statement of every tier's
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
  // them rather than siting them by position (docs/star-naming.md § 6).
  if (!d.dc) return null;
  if (tier === 'bayer' || tier === 'bayer_latin') {
    if (!d.bayer) return null;
    // Bayer ran out of Greek and carried on into Latin, and the two halves
    // of that series are read differently. The Greek letter is how every
    // reference names the star; the Latin overflow is real and published but
    // the Flamsteed number is what atlases and observing lists print, so it
    // sits BELOW Flamsteed rather than above — docs/star-naming.md § 3.
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

export interface DisplayName {
  label: string;
  /** Tier of the designation the base came from — the anchor's when
   *  `borrowed`. */
  tier: NameTier;
  /** The base came from the system's naming anchor, not this star. */
  borrowed: boolean;
  /** A component letter is part of the label. */
  lettered: boolean;
}

/** Compose every star's display name at once. Two of the three rules are
 *  relational, which is why the composer is a collection pass rather than a
 *  per-star function:
 *
 *  - a star with no designation of its own takes the WDS root anchor's base
 *    plus its own component letter (`Sirius B`, `HIP 82676 Ab`);
 *  - a component letter is appended to a DESIGNATION only where a SIBLING
 *    OWNS the same designation — several records own `θ¹ Ori`, so each
 *    takes its letter, while β² Sco owns its designation alone and stays
 *    bare. Ownership, not label uniqueness: a sibling that owns the
 *    designation and then borrows a higher tier still displays a lettered
 *    form of it, so δ Cep A reads as such beside δ Cep C/D/E rather than
 *    reverting to the bare designation its siblings no longer claim.
 *
 *  Injective given (naming anchor, component letter). A surviving duplicate
 *  is therefore a data finding — two catalogue entries claiming one
 *  designation — never something the renderer should qualify away. */
export function resolveDisplayNames<K>(
  inputs: readonly DisplayNameInput<K>[],
): Map<K, DisplayName> {
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

  const out = new Map<K, DisplayName>();
  for (const input of inputs) {
    const o = own.get(input.key);
    // A component borrows its system's base wherever it holds no sky
    // designation of its own: nothing at all, or a mere identifier the
    // system can better — σ² UMa C reads better than its own HIP 45064 and
    // λ Oph B better than its NSV serial, and both are what their siblings
    // read. A sky designation of its own wins outright however high the
    // system's tier: β² Sco stays β² Sco rather than becoming a lettered
    // Acrab, and θ¹ Tau stays θ¹ Tau rather than borrowing θ² Tau's
    // approved name. Two DIFFERENT identifiers of one tier trade nothing.
    // The anchor is included in its own root with its own letter, and a
    // record lends itself nothing.
    const anchorKey = input.anchorKey === input.key ? undefined : input.anchorKey;
    const anchorInput = anchorKey === undefined ? undefined : byKey.get(anchorKey);
    const anchor = anchorKey === undefined ? undefined : own.get(anchorKey);
    const borrows = anchor !== undefined && anchorInput !== undefined
      && (o === undefined
        // A designation the SYSTEM also carries names the system, not this
        // component: ξ UMa B's Flamsteed number 53 is ξ UMa's, so it reads
        // "Alula Australis B" rather than "53 UMa" — and the same holds of
        // a catalogue number the anchor displays too.
        || designationAtTier(anchorInput.set, o.tier) === o.base
        || (!SKY_DESIGNATION_TIERS.has(o.tier)
          && (TIER_RANK.get(anchor.tier) ?? 0) < (TIER_RANK.get(o.tier) ?? 0)));
    if (borrows && anchor !== undefined && input.component !== undefined) {
      const base = systemBaseOf(anchor.base, anchorInput.component);
      out.set(input.key, {
        label: `${base} ${input.component}`,
        tier: anchor.tier,
        borrowed: true,
        lettered: true,
      });
      continue;
    }
    if (o === undefined) continue;
    const letter = input.statedComponent ?? input.component;
    const lettered = !isApprovedName(o.tier)
      && letter !== undefined
      && (input.statedComponent !== undefined || (owners.get(o.base) ?? 0) > 1);
    out.set(input.key, {
      label: lettered ? `${o.base} ${letter}` : o.base,
      tier: o.tier,
      borrowed: false,
      lettered,
    });
  }
  return out;
}

/** A search-index entry's designation set. `p` enters as the name tier —
 *  the build wrote it from this same ladder — so a record the authority
 *  named never takes a component letter on top of it. */
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
): Map<number, DisplayName> {
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
