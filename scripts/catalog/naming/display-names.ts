// The record build's half of the composer: every record's designation set
// to its display name, with the NAME tiers written into `proper`.
// See README.md § Two callers, one composer.

import { FLAG_HAS_NAME, NO_CONSTELLATION_INDEX } from '../catalog-pure';
import type { ComponentDesignation } from '../companions/record-index/record-index';
import {
  isApprovedName,
  NAME_TIERS,
  resolveDisplayNames,
  type DesignationSet,
  type DisplayName,
  type DisplayNameInput,
  type NameTier,
} from './star-naming-pure';

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
  desigConIndex: number;
  flags: number;
}

export function designationSetOf(
  star: DisplayNameSource,
  constellations: readonly { code: string }[],
  override?: string,
): DesignationSet {
  // The designation's own constellation, never the positional one: once a
  // boundary moves past a named star the two diverge and the positional
  // index renames ρ Aql to ρ Del (docs/star-naming.md § 6).
  const conIdx = star.desigConIndex !== NO_CONSTELLATION_INDEX
    ? star.desigConIndex : star.conIndex;
  const con = conIdx !== NO_CONSTELLATION_INDEX ? constellations[conIdx] : undefined;
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
   *  two catalogue entries claiming one designation (§ 8.4). */
  namingDuplicateLabels: number;
  namingDuplicateRecords: number;
}

export interface DisplayNameResult {
  counts: DisplayNameCounts;
  labels: Map<number, DisplayName>;
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
  const inputs: DisplayNameInput<number>[] = stars.map((star, i) => {
    const component = components.get(i);
    const input: DisplayNameInput<number> = {
      key: i,
      set: designationSetOf(star, constellations, overrides.get(recordSids[i])),
    };
    if (component !== undefined) {
      input.component = component.comp;
      input.anchorKey = component.primaryIdx;
    }
    if (star.bayerComponent !== null) input.statedComponent = star.bayerComponent;
    return input;
  });

  const labels = resolveDisplayNames(inputs);
  const counts: DisplayNameCounts = {
    namingTier: zeroedTiers(),
    namingBorrowed: 0,
    namingLettered: 0,
    namingNameTable: 0,
    namingOverrides: overrides.size,
    namingUnlabelled: 0,
    namingDuplicateLabels: 0,
    namingDuplicateRecords: 0,
  };

  const claimants = new Map<string, number[]>();
  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    const label = labels.get(i);
    if (label === undefined) {
      star.proper = null;
      star.flags &= ~FLAG_HAS_NAME;
      counts.namingUnlabelled++;
      continue;
    }
    counts.namingTier[label.tier]++;
    if (label.borrowed) counts.namingBorrowed++;
    else if (label.lettered) counts.namingLettered++;
    // A name attaches to a star; a designation is compiled for it. Only the
    // former reaches catalog.bin, so first paint carries names while the
    // runtime composes designations off the search index.
    const isName = isApprovedName(label.tier);
    star.proper = isName ? label.label : null;
    if (isName) {
      star.flags |= FLAG_HAS_NAME;
      counts.namingNameTable++;
    } else {
      star.flags &= ~FLAG_HAS_NAME;
    }
    const bucket = claimants.get(label.label);
    if (bucket) bucket.push(i);
    else claimants.set(label.label, [i]);
  }

  const duplicates = new Map<string, number[]>();
  for (const [label, idxs] of claimants) {
    if (idxs.length < 2) continue;
    duplicates.set(label, idxs);
    counts.namingDuplicateLabels++;
    counts.namingDuplicateRecords += idxs.length;
  }
  return { counts, labels, duplicates };
}
