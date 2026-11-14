// Post-sort addressing of catalog records from multiples.tsv rows, and the
// two passes that need only that. See README.md.

import {
  FLAG_BINARY_PRIMARY,
} from '../../../../src/catalog-format/record/catalog-pure';
import type { Star } from '../../parse/stars-parse';
import type { MultiplicityCounts } from '../../multiplicity/multiplicity-stage-pure';
import { isMoreCanonicalAnchor } from '../../../binaries/component-tokens-pure';
import { hasRenderableOrbit } from '../../../../src/catalog-format/binaries/binaries-format';
import type { CatalogRowIndexMap } from './catalog-row-index-map-pure';
import { distinctEnds, type ResolvedPair } from './pair-resolution-pure';

// Build the lookup sidecar after the final record sort. The runtime
// binaries loader resolves multiples.tsv rows to catalog.bin records
// through this map; the build script writes it next to catalog.bin /
// search-index.json.
export function buildCatalogRowIndexMap(
  stars: Star[],
  /** README.md#the-sidecar-and-how-a-component-resolves. */
  synthGaiaBridges: ReadonlyMap<string, string> = new Map(),
): CatalogRowIndexMap {
  const byGaia: Record<string, number> = {};
  const byHip: Record<string, number> = {};
  const bySynth: Record<string, number> = {};
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (s.gaiaSourceId && !(s.gaiaSourceId in byGaia)) {
      byGaia[s.gaiaSourceId] = i;
    }
    if (s.hip !== null && s.hip > 0 && !(`${s.hip}` in byHip)) {
      byHip[`${s.hip}`] = i;
    }
    if (s.syntheticId && !(s.syntheticId in bySynth)) {
      bySynth[s.syntheticId] = i;
    }
  }
  for (const [synthId, gaiaId] of synthGaiaBridges) {
    const idx = byGaia[gaiaId];
    if (idx !== undefined && !(synthId in bySynth)) bySynth[synthId] = idx;
  }
  return { byGaia, byHip, bySynth };
}

// ---- Wings for renderable-companion primaries --------------------------

/** Every rendered pair whose row carries a renderable orbit, as (primary,
 *  secondary) record indices: the pairs binaries.bin draws apart from the
 *  elements alone. */
export function renderableOrbitRelations(resolved: readonly ResolvedPair[]): Array<[number, number]> {
  return resolved.flatMap(({ pair, rendered }): Array<[number, number]> =>
    (distinctEnds(rendered) && hasRenderableOrbit(pair.elements) ? [[rendered.primary, rendered.secondary]] : []));
}

/** Every record a pair's own row resolves to, provided the pair's primary
 *  does: the set MULTIPLICITY_RESOLVED covers. */
export function resolvedMemberIndices(resolved: readonly ResolvedPair[]): Set<number> {
  const members = new Set<number>();
  for (const { own } of resolved) {
    if (own.primary === null) continue;
    members.add(own.primary);
    if (own.secondary !== null) members.add(own.secondary);
  }
  return members;
}

/** See ./README.md#renderable-companion-wings. */
export function wingRenderablePrimaries(
  resolved: readonly ResolvedPair[],
  stars: Star[],
): Pick<MultiplicityCounts, 'renderableCompanionWinged'> {
  const members = new Map<string, Set<number>>();
  const drawsAPair = new Set<string>();
  for (const { pair, own, rendered } of resolved) {
    let set = members.get(pair.wdsId);
    if (!set) { set = new Set(); members.set(pair.wdsId, set); }
    for (const idx of [own.primary, own.secondary, rendered.primary, rendered.secondary]) {
      if (idx !== null) set.add(idx);
    }
    if (distinctEnds(rendered)) drawsAPair.add(pair.wdsId);
  }

  let renderableCompanionWinged = 0;
  for (const root of drawsAPair) {
    const indices = members.get(root) as Set<number>;
    let anchor = -1;
    let alreadyWinged = false;
    for (const idx of indices) {
      if ((stars[idx].flags & FLAG_BINARY_PRIMARY) !== 0) {
        alreadyWinged = true;
        break;
      }
      if (anchor < 0 || stars[idx].absmag < stars[anchor].absmag) anchor = idx;
    }
    if (alreadyWinged || anchor < 0) continue;
    stars[anchor].flags |= FLAG_BINARY_PRIMARY;
    renderableCompanionWinged++;
  }
  return { renderableCompanionWinged };
}

// ---- Component-letter search designations ------------------------------

export interface ComponentDesignation {
  /** Canonical WDS component letter, e.g. "A", "B", "C", "Ab". */
  comp: string;
  /** Catalog record index of the WDS root's naming anchor — the record the
   *  root's own primary component resolves to. Both the display-name
   *  composer and the runtime's "<base> <letter>" search aliases expand
   *  their base from it, so "Alpha Centauri C" / "α Cen C" focus Proxima. */
  primaryIdx: number;
}

/** A component letter is stated relative to the WDS ROOT, so the base it
 *  attaches to has to be the root's, not the cursor primary's — a cursor
 *  primary is routinely a component of a DIFFERENT root, and composing
 *  against it collides with that root's own letter.
 *
 *  A root may not borrow its identity from a star another root already owns.
 *  Refusing the anchor leaves those records on their own designations, which
 *  is what the gate means by a surviving collision being a data finding
 *  rather than a renderer concession (/docs/star-naming.md#8-parity--the-gate-on-any-naming-change).
 *
 *  The anchor is included with its own comp letter so "α Cen A" focuses it,
 *  and a record shared across pairs takes first-write-wins. */
export function buildComponentDesignations(
  resolved: readonly ResolvedPair[],
): Pick<MultiplicityCounts, 'componentDesignations'> & { designations: Map<number, ComponentDesignation> } {
  const anchored = resolved.flatMap(({ pair, own }) =>
    (own.primary === null ? [] : [{ pair, primary: own.primary, secondary: own.secondary }]));
  const anchors = new Map<string, { comp: string; idx: number }>();
  for (const { pair, primary } of anchored) {
    const incumbent = anchors.get(pair.wdsId);
    if (!incumbent || isMoreCanonicalAnchor(pair.primaryComp, incumbent.comp)) {
      anchors.set(pair.wdsId, { comp: pair.primaryComp, idx: primary });
    }
  }

  // Which roots hold each record as a component that is not their anchor.
  const heldBy = new Map<number, Set<string>>();
  for (const { pair, primary, secondary } of anchored) {
    const anchorIdx = anchors.get(pair.wdsId)?.idx;
    for (const idx of [primary, secondary]) {
      if (idx === null || idx === anchorIdx) continue;
      const roots = heldBy.get(idx);
      if (roots) roots.add(pair.wdsId);
      else heldBy.set(idx, new Set([pair.wdsId]));
    }
  }
  for (const [root, anchor] of [...anchors]) {
    const held = heldBy.get(anchor.idx);
    if (held === undefined) continue;
    for (const other of held) {
      if (other !== root) { anchors.delete(root); break; }
    }
  }

  const out = new Map<number, ComponentDesignation>();
  const designate = (idx: number | null, comp: string, anchorIdx: number): void => {
    if (idx === null || out.has(idx)) return;
    out.set(idx, { comp, primaryIdx: anchorIdx });
  };
  for (const { pair, primary, secondary } of anchored) {
    const anchor = anchors.get(pair.wdsId);
    if (anchor === undefined) continue;
    designate(primary, pair.primaryComp, anchor.idx);
    if (secondary !== primary) designate(secondary, pair.secondaryComp, anchor.idx);
  }
  // README.md#component-letter-search-designations: a letter is root-relative.
  for (const { pair, own } of resolved) {
    const anchor = anchors.get(pair.wdsId);
    if (anchor === undefined || own.secondary === anchor.idx) continue;
    designate(own.secondary, pair.secondaryComp, anchor.idx);
  }
  return { designations: out, componentDesignations: out.size };
}
