// Post-sort addressing of catalog records from multiples.tsv rows, and the
// two passes that need only that. See README.md.

import {
  FLAG_BINARY_PRIMARY,
} from '../../catalog-pure';
import type { Star } from '../../parse/stars-parse';
import {
  canonicalCompLetter,
  composeSyntheticId,
  groupBySystem,
  wdsRootOf,
  type MultiplesTsvRow,
  type PairCursor,
} from '../companion-promotion';

export interface CatalogRowIndexMap {
  /** Gaia DR3 source_id (decimal string) → catalog.bin record index. */
  byGaia: Record<string, number>;
  /** Hipparcos catalog number → catalog.bin record index. */
  byHip: Record<string, number>;
  /** Synthetic identifier → catalog.bin record index. See
   *  ../README.md § Companion promotion from `data/binaries/multiples.tsv`. */
  bySynth: Record<string, number>;
}

// Build the lookup sidecar after the final absmag sort. The runtime
// binaries loader resolves multiples.tsv rows to catalog.bin records
// through this map; the build script writes it next to catalog.bin /
// search-index.json.
export function buildCatalogRowIndexMap(stars: Star[]): CatalogRowIndexMap {
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
  return { byGaia, byHip, bySynth };
}

// ---- Wings for renderable-companion primaries --------------------------

/** gaia → hip → synth catalog-row resolution — the TS twin of
 *  build-runtime-binaries.py's `resolve_idx`. Kept faithful so the winged
 *  set matches binaries.bin's rendered pairs; the invariant is pinned by
 *  multi-star-regression.test.ts against the real artifacts. */
function resolveMultiplesIdx(
  gaia: string | null,
  hip: number | null,
  synthKey: string | null,
  rowIndexMap: CatalogRowIndexMap,
): number | null {
  if (gaia) {
    const hit = rowIndexMap.byGaia[gaia];
    if (hit !== undefined) return hit;
  }
  if (hip !== null && hip > 0) {
    const hit = rowIndexMap.byHip[`${hip}`];
    if (hit !== undefined) return hit;
  }
  if (synthKey !== null) {
    const hit = rowIndexMap.bySynth[synthKey];
    if (hit !== undefined) return hit;
  }
  return null;
}

/** The catalog row a component's synth key addresses, or null when no synth
 *  record exists or it aliases `exclude`. TS twin of the Python `synth_slot`;
 *  a hit is the truer slot than an id-first resolve that blended onto a
 *  system anchor. */
function synthSlotIdx(
  synthKey: string | null,
  rowIndexMap: CatalogRowIndexMap,
  exclude: number | null = null,
): number | null {
  if (synthKey === null) return null;
  const hit = rowIndexMap.bySynth[synthKey];
  return hit === undefined || hit === exclude ? null : hit;
}

interface ResolvedComponent {
  idx: number;
  /** Canonical WDS component letter (`canonicalCompLetter` applied). */
  comp: string;
}

interface ResolvedSystem {
  systemId: string;
  primaryIdx: number;
  /** The primary (its own comp letter) followed by every secondary that
   *  resolves to a record distinct from the primary. */
  components: ResolvedComponent[];
}

/** Resolve a pair cursor's primary + secondaries to catalog record indices
 *  through the gaia → hip → synth priority + both-ends synth re-home that
 *  build-runtime-binaries.py's `resolve_idx` uses, so both consumers below
 *  (wings, component designations) track binaries.bin's rendered pairs. A
 *  blended component (its id resolves onto another member's row) has its own
 *  distinct synth slot minted by promotion, and that slot is the truer end.
 *  Null when the primary itself doesn't resolve. */
function resolvePairComponents(
  cursor: PairCursor,
  rowIndexMap: CatalogRowIndexMap,
): ResolvedSystem | null {
  const primary = cursor.primary;
  if (primary === null) return null;
  const primarySynth = composeSyntheticId(primary.systemId, primary.comp);
  const priId = resolveMultiplesIdx(
    primary.gaiaSourceId, primary.hip, primarySynth, rowIndexMap,
  );
  if (priId === null) return null;
  const primaryIdx = synthSlotIdx(primarySynth, rowIndexMap, priId) ?? priId;
  const components: ResolvedComponent[] = [{ idx: primaryIdx, comp: primary.comp }];
  for (const sec of cursor.secondaries) {
    if (sec.orbitRole !== 'secondary') continue;
    const comp = canonicalCompLetter(primary.comp, sec.comp);
    const secondarySynth = composeSyntheticId(sec.systemId, comp);
    let secIdx = resolveMultiplesIdx(
      sec.gaiaSourceId, sec.hip, secondarySynth, rowIndexMap,
    );
    if (secIdx !== null) {
      secIdx = synthSlotIdx(secondarySynth, rowIndexMap, secIdx) ?? secIdx;
    }
    if (secIdx === null || secIdx === primaryIdx) continue;
    components.push({ idx: secIdx, comp });
  }
  return { systemId: primary.systemId, primaryIdx, components };
}

/** OR FLAG_BINARY_PRIMARY (chart-mode wings) onto the anchor of every
 *  physical system that renders a companion but which build-catalog's three
 *  wings passes (geometric, CCDM, eclipsing) all missed (Canopus, 16 Cyg A).
 *  A pair renders a companion when its sides resolve to DISTINCT catalog
 *  records under the same `resolve_idx` + blended-sibling synth retries
 *  build-runtime-binaries.py runs to emit binaries.bin, so the winged set
 *  tracks binaries.bin's primaries (both retries mirrored; the writer's
 *  post-resolution override / relation dedup can't change the distinct-pair
 *  boolean this pass keys on, only which index, which root-grouping and the
 *  brightest-participant pick below already absorb). Invariants: one glyph
 *  per WDS system, on the brightest participant (skips a system any earlier
 *  pass already flagged); additive only, so eclipsing / iconic doubles with
 *  no rendered companion keep their wings. Returns the count newly winged
 *  plus every resolved multiples.tsv member index — the record set the
 *  MULTIPLICITY_RESOLVED status covers (a blended primary whose members all
 *  collapse onto it counts: the row exists for it even with nothing
 *  rendered apart). See ./README.md § Renderable-companion wings. */
export function wingRenderablePrimaries(
  rows: MultiplesTsvRow[],
  stars: Star[],
  rowIndexMap: CatalogRowIndexMap,
): { winged: number; memberIndices: Set<number> } {
  const memberIndices = new Set<number>();
  // Catalog indices participating in a rendered pair, grouped by WDS root.
  const perSystem = new Map<string, Set<number>>();
  for (const cursor of groupBySystem(rows).values()) {
    const resolved = resolvePairComponents(cursor, rowIndexMap);
    if (resolved === null) continue;
    for (const c of resolved.components) memberIndices.add(c.idx);
    const root = wdsRootOf(resolved.systemId);
    if (root === null) continue;
    const secIdxs = resolved.components
      .filter((c) => c.idx !== resolved.primaryIdx)
      .map((c) => c.idx);
    if (secIdxs.length === 0) continue;
    let set = perSystem.get(root);
    if (!set) { set = new Set(); perSystem.set(root, set); }
    set.add(resolved.primaryIdx);
    for (const idx of secIdxs) set.add(idx);
  }

  let winged = 0;
  for (const indices of perSystem.values()) {
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
    winged++;
  }
  return { winged, memberIndices };
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

/** Which of two pair primaries sharing a WDS root NAMES the system: the
 *  top-level letter decides, then depth. Comparing whole comps by length
 *  would put "Aa" below every single-letter branch, and 15 Mon's root
 *  (`06410+0954`, whose only A-branch cursor is Aa,Ab) would name itself
 *  after its E component — every letter in it composing against HD 261938
 *  rather than 15 Mon. A deeper cursor inside the A branch is still the A
 *  branch.
 *
 *  Deliberately not promotion's own anchor pick, which chooses the record a
 *  companion inherits its POSITION from: that choice decides where records
 *  land, so the two questions keep their own rules. */
function isMoreCanonicalNamingAnchor(
  candidateComp: string,
  incumbentComp: string,
): boolean {
  if (candidateComp === incumbentComp) return false;
  const branch = (comp: string) => comp.charAt(0);
  if (branch(candidateComp) !== branch(incumbentComp)) {
    return branch(candidateComp) < branch(incumbentComp);
  }
  if (candidateComp.length !== incumbentComp.length) {
    return candidateComp.length < incumbentComp.length;
  }
  return candidateComp < incumbentComp;
}

/** A component letter is stated relative to the WDS ROOT, so the base it
 *  attaches to has to be the root's, not the cursor primary's. WDS lists
 *  θ¹ Ori C as component D of the θ² Ori root (`05354-0525`), and taking
 *  the cursor primary composed that root's E as "θ¹ Ori E" — colliding with
 *  the real θ¹ Ori E in root `05353-0523`.
 *
 *  A root may not borrow its identity from a star another root already owns.
 *  `05353-0524` is an Orion Nebula Cluster multiple whose only identified
 *  member is θ¹ Ori C, arriving as its component I — so every letter in it
 *  composed against θ¹ Ori, asserting an identity the data does not
 *  support. Refusing the anchor leaves those records on their own
 *  designations, which is what the gate means by a surviving collision
 *  being a data finding rather than a renderer concession
 *  (docs/star-naming.md § 8.4).
 *
 *  Map each multiples.tsv component to a root-relative designation so the
 *  composer and the runtime can both build "<base> <letter>". The anchor is
 *  included with its own comp letter (so "α Cen A" focuses it). Resolution
 *  mirrors binaries.bin (`resolvePairComponents`); coverage is bounded by
 *  what decomposes in multiples.tsv. First-write-wins on a record shared
 *  across pairs (α Cen A appears in both the AB and AC rows). */
export function buildComponentDesignations(
  rows: MultiplesTsvRow[],
  rowIndexMap: CatalogRowIndexMap,
): Map<number, ComponentDesignation> {
  const resolved: { root: string; pair: ResolvedSystem }[] = [];
  const anchors = new Map<string, { comp: string; idx: number }>();
  for (const cursor of groupBySystem(rows).values()) {
    const pair = resolvePairComponents(cursor, rowIndexMap);
    if (pair === null) continue;
    const root = wdsRootOf(pair.systemId);
    if (root === null) continue;
    resolved.push({ root, pair });
    const comp = pair.components[0].comp;
    const incumbent = anchors.get(root);
    if (!incumbent || isMoreCanonicalNamingAnchor(comp, incumbent.comp)) {
      anchors.set(root, { comp, idx: pair.primaryIdx });
    }
  }

  // Which roots hold each record as a component that is not their anchor.
  const heldBy = new Map<number, Set<string>>();
  for (const { root, pair } of resolved) {
    const anchorIdx = anchors.get(root)?.idx;
    for (const c of pair.components) {
      if (c.idx === anchorIdx) continue;
      const roots = heldBy.get(c.idx);
      if (roots) roots.add(root);
      else heldBy.set(c.idx, new Set([root]));
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
  for (const { root, pair } of resolved) {
    const anchor = anchors.get(root);
    if (anchor === undefined) continue;
    for (const c of pair.components) {
      if (out.has(c.idx)) continue;
      out.set(c.idx, { comp: c.comp, primaryIdx: anchor.idx });
    }
  }
  // A letter is root-relative, so a component is addressable even when its
  // own pair cursor is not: Rigel's Ba,Bb cursor has an unresolvable Ba, and
  // requiring the cursor to resolve left Bb with no letter and no base to
  // compose against. The wings pass genuinely needs both ends of a pair, so
  // it keeps `resolvePairComponents`; naming needs the letter and the root.
  for (const cursor of groupBySystem(rows).values()) {
    const primary = cursor.primary;
    if (primary === null) continue;
    const root = wdsRootOf(primary.systemId);
    const anchor = root === null ? undefined : anchors.get(root);
    if (anchor === undefined) continue;
    for (const sec of cursor.secondaries) {
      if (sec.orbitRole !== 'secondary') continue;
      const comp = canonicalCompLetter(primary.comp, sec.comp);
      const synth = composeSyntheticId(sec.systemId, comp);
      let idx = resolveMultiplesIdx(sec.gaiaSourceId, sec.hip, synth, rowIndexMap);
      if (idx !== null) idx = synthSlotIdx(synth, rowIndexMap, idx) ?? idx;
      if (idx === null || idx === anchor.idx || out.has(idx)) continue;
      out.set(idx, { comp, primaryIdx: anchor.idx });
    }
  }
  return out;
}
