// The record build's half of the composer: every record's designation set
// to its display name, with the NAME tiers written into `proper`.
// See /src/catalog-format/naming/README.md#two-callers-one-composer.

import { FLAG_HAS_NAME, NO_CONSTELLATION_INDEX } from '../../../src/catalog-format/record/catalog-pure';
import type { ComponentDesignation } from '../companions/record-index/record-index';
import type { DesignationCon, StatedDesignationCon } from '../classic-ids/designation-constellation-pure';
import {
  isApprovedName,
  NAME_TIERS,
  resolveDisplayNames,
  type DesignationSet,
  type DisplayName,
  type DisplayNameInput,
  type NameTier,
} from '../../../src/catalog-format/naming/star-naming-pure';

/** Structural subset of `Star` the display-name pass reads. */
export interface DisplayNameSource {
  proper: string | null;
  iauName: string | null;
  eponym: string | null;
  bayer: string | null;
  bayerSup: number | null;
  bayerComponent: string | null;
  flam: number | null;
  gould: number | null;
  gouldHalf: string | null;
  gcvsName: string | null;
  hip: number | null;
  hd: number | null;
  hr: number | null;
  gl: string | null;
  conIndex: number;
  desigCon: DesignationCon;
  flags: number;
}

/** Which constellation the record's constellation-relative designations
 *  render against. */
export type DesignationConUse =
  | { from: 'designation'; con: StatedDesignationCon }
  | { from: 'positional'; index: number }
  | { from: 'none' };

/** The designation's own constellation, never the positional one: once a
 *  boundary moves past a named star the two diverge and the positional
 *  index renames ρ Aql to ρ Del (/docs/star-naming.md#6-rendering--glyphs-everywhere-no-fallback-path). */
export function designationConUse(star: Pick<DisplayNameSource, 'desigCon' | 'conIndex'>): DesignationConUse {
  if (star.desigCon.via !== 'none') return { from: 'designation', con: star.desigCon };
  if (star.conIndex !== NO_CONSTELLATION_INDEX) return { from: 'positional', index: star.conIndex };
  return { from: 'none' };
}

export function designationSetOf(
  star: DisplayNameSource,
  constellations: readonly { code: string }[],
  dc: DesignationConUse,
  override?: string,
): DesignationSet {
  const con = dc.from === 'none' ? undefined
    : constellations[dc.from === 'designation' ? dc.con.index : dc.index];
  const set: DesignationSet = {};
  if (override !== undefined) set.override = override;
  if (star.iauName !== null) set.iauName = star.iauName;
  if (star.eponym !== null) set.eponym = star.eponym;
  if (star.bayer !== null) set.bayer = star.bayer;
  if (star.bayerSup !== null) set.bayerSup = star.bayerSup;
  if (star.flam !== null) set.flamsteed = star.flam;
  if (star.gould !== null) set.gould = star.gould;
  if (star.gouldHalf !== null) set.gouldHalf = star.gouldHalf;
  if (star.gcvsName !== null) set.gcvs = star.gcvsName;
  if (star.hip !== null) set.hip = star.hip;
  if (star.hd !== null) set.hd = star.hd;
  if (star.hr !== null) set.hr = star.hr;
  if (star.gl !== null) set.gl = star.gl;
  if (con !== undefined) set.dc = con.code;
  return set;
}

export interface DisplayNameCounts {
  /** Records displaying each tier's designation. */
  namingTier: Record<NameTier, number>;
  /** Records whose base came from their system's naming anchor. */
  namingBorrowed: number;
  /** Records carrying a component letter because a sibling owns the same
   *  designation (θ¹ Ori A/B/C/D). */
  namingLettered: number;
  /** Records whose name reaches catalog.bin's name table. */
  namingNameTable: number;
  namingOverrides: number;
  /** Records with no composed label — no designation of their own and no
   *  anchor to borrow from. They display the runtime's `Gaia DR3` /
   *  `SID #` last resort. */
  namingUnlabelled: number;
  /** Labels two or more records both compose. Every one is a data finding:
   *  two catalogue entries claiming one designation (/docs/star-naming.md#84-known-duplicate-display-names). */
  namingDuplicateLabels: number;
  namingDuplicateRecords: number;
}

export type NameOutcome = DisplayName<number> | { kind: 'unlabelled' };

/** One record's naming decision: what it displays, the designation set the
 *  ladder weighed, and the constellation that set renders against. */
export interface NamedRecord {
  name: NameOutcome;
  set: DesignationSet;
  dc: DesignationConUse;
}

export interface DisplayNameResult {
  counts: DisplayNameCounts;
  /** Indexed by record. */
  records: NamedRecord[];
  /** Duplicate label → the records claiming it, for the parity ledger. */
  duplicates: Map<string, number[]>;
}

function zeroedTiers(): Record<NameTier, number> {
  const out = {} as Record<NameTier, number>;
  for (const tier of NAME_TIERS) out[tier] = 0;
  return out;
}

export function assignDisplayNames(
  stars: DisplayNameSource[],
  components: Map<number, ComponentDesignation>,
  constellations: readonly { code: string }[],
  overrides: Map<number, string>,
  recordSids: readonly number[],
): DisplayNameResult {
  // A curated row is the one tier no published source can be re-read to
  // check, so an unmatched SID has to fail rather than count as applied —
  // the same review-join discipline as the naming-authority residual gate (/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them).
  if (overrides.size > 0) {
    const present = new Set(recordSids);
    const unmatched = [...overrides.keys()].filter((sid) => !present.has(sid));
    if (unmatched.length > 0) {
      throw new Error(
        `The name overrides name ${unmatched.length} SID(s) no record `
        + `carries: ${unmatched.join(', ')} — a retired or mistyped SID, so the `
        + 'override would silently display nothing (/docs/star-naming.md#7-curation-seam)',
      );
    }
  }

  const dcs = stars.map(designationConUse);
  const inputs: DisplayNameInput<number>[] = stars.map((star, i) => {
    const component = components.get(i);
    const input: DisplayNameInput<number> = {
      key: i,
      set: designationSetOf(star, constellations, dcs[i], overrides.get(recordSids[i])),
    };
    if (component !== undefined) {
      input.component = component.comp;
      input.anchorKey = component.primaryIdx;
    }
    if (star.bayerComponent !== null) input.statedComponent = star.bayerComponent;
    return input;
  });

  const labels = resolveDisplayNames(inputs);
  const records: NamedRecord[] = inputs.map((input, i) => ({
    name: labels.get(i) ?? { kind: 'unlabelled' },
    set: input.set,
    dc: dcs[i],
  }));
  for (let i = 0; i < stars.length; i++) writeName(stars[i], records[i].name);
  const duplicates = duplicateLabels(records);
  return { counts: displayNameCounts(records, duplicates, overrides.size), records, duplicates };
}

/** A name attaches to a star; a designation is compiled for it. Only the
 *  former reaches catalog.bin, so first paint carries names while the
 *  runtime composes designations off the search index. */
function writeName(star: DisplayNameSource, name: NameOutcome): void {
  const isName = name.kind !== 'unlabelled' && isApprovedName(name.tier);
  star.proper = isName ? name.label : null;
  if (isName) star.flags |= FLAG_HAS_NAME;
  else star.flags &= ~FLAG_HAS_NAME;
}

function duplicateLabels(records: readonly NamedRecord[]): Map<string, number[]> {
  const claimants = new Map<string, number[]>();
  records.forEach(({ name }, i) => {
    if (name.kind === 'unlabelled') return;
    const bucket = claimants.get(name.label);
    if (bucket) bucket.push(i);
    else claimants.set(name.label, [i]);
  });
  return new Map([...claimants].filter(([, idxs]) => idxs.length > 1));
}

function displayNameCounts(
  records: readonly NamedRecord[],
  duplicates: ReadonlyMap<string, number[]>,
  overrides: number,
): DisplayNameCounts {
  const counts: DisplayNameCounts = {
    namingTier: zeroedTiers(),
    namingBorrowed: 0,
    namingLettered: 0,
    namingNameTable: 0,
    namingOverrides: overrides,
    namingUnlabelled: 0,
    namingDuplicateLabels: duplicates.size,
    namingDuplicateRecords: [...duplicates.values()].reduce((n, idxs) => n + idxs.length, 0),
  };
  for (const { name } of records) {
    if (name.kind === 'unlabelled') {
      counts.namingUnlabelled++;
      continue;
    }
    counts.namingTier[name.tier]++;
    if (name.kind === 'borrowed') counts.namingBorrowed++;
    else if (name.letter !== null) counts.namingLettered++;
    if (isApprovedName(name.tier)) counts.namingNameTable++;
  }
  return counts;
}
