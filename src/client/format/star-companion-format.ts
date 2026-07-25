// Binary-companion card lines shared by the star hover formatter and the
// star focus-card provider. See ./README.md.

import { J2000_JD } from '../util/astronomy-constants';
import {
  type BinariesData,
  type BinaryRelation,
} from '../binaries/binaries-loader';
import { evaluateOrbitSeparationAU } from '../binaries/binary-orbit-pure';
import {
  keplerRelationParams,
  type KeplerRelationParams,
} from '../binaries/orbit-relation-cache';

export interface StarNameContext {
  starLabels: Map<number, string>;
  // Catalog identifier arrays backing the no-label fallback (0n / the
  // NO_SID 0 sentinel = absent).
  gaiaSourceId: BigUint64Array;
  sid: Uint32Array;
}

export interface CompanionFormatContext extends StarNameContext {
  // Parsed binaries.bin, or null when the artifact is absent — the
  // companion lines simply drop out in that case.
  binaries: BinariesData | null;
  // Current sim time as JD (tToJDE(getT())), injected fresh per card by
  // the caller. Drives the Tier-1 live separation.
  nowJd: number;
}

/** Display name for any star: search-index label when one exists, else
 *  'Gaia DR3 <id>', else 'Unnamed (SID #<n>)'. The fallbacks are stable
 *  identifiers — never the catalog record index, which reshuffles on
 *  every pipeline rebuild. Both are typeable in search. */
export function resolveStarName(ctx: StarNameContext, idx: number): string {
  const named = ctx.starLabels.get(idx);
  if (named) return named;
  const gaia = ctx.gaiaSourceId[idx];
  if (gaia !== 0n) return `Gaia DR3 ${gaia}`;
  return `Unnamed (SID #${ctx.sid[idx]})`;
}

// Connected component over primary/secondary links containing `idx`,
// restricted to relations passing `edgeActive`, in first-seen order
// walking the (topologically sorted) relation list — outer primaries
// lead, inner members follow. Returns [] when no edge is reachable.
function connectedMemberIndices(
  binaries: BinariesData,
  idx: number,
  edgeActive: (rel: BinaryRelation) => boolean,
): number[] {
  const relIdxs = new Set<number>();
  const seen = new Set<number>();
  const stack = [idx];
  while (stack.length > 0) {
    const star = stack.pop() as number;
    if (seen.has(star)) continue;
    seen.add(star);
    for (const list of [
      binaries.primaryIdxToRelations.get(star),
      binaries.secondaryIdxToRelations.get(star),
    ]) {
      if (!list) continue;
      for (const ri of list) {
        const r = binaries.relations[ri];
        if (!edgeActive(r)) continue;
        relIdxs.add(ri);
        stack.push(r.primaryIdx, r.secondaryIdx);
      }
    }
  }
  const members: number[] = [];
  const emitted = new Set<number>();
  for (const ri of [...relIdxs].sort((a, b) => a - b)) {
    for (const m of [binaries.relations[ri].primaryIdx, binaries.relations[ri].secondaryIdx]) {
      if (!emitted.has(m)) {
        emitted.add(m);
        members.push(m);
      }
    }
  }
  return members;
}

/** Every star record in `idx`'s multiple-star system. Returns [] when
 *  the star is in no relation. */
export function systemMemberIndices(binaries: BinariesData, idx: number): number[] {
  return connectedMemberIndices(binaries, idx, () => true);
}

/** Members of `idx`'s COLLAPSED cluster: stars reachable through
 *  relations whose secondary is composite-suppressed right now — i.e.
 *  the components actually rendering as one point with the hovered
 *  star. A visually separated member (Proxima at 2.2° from α Cen A+B)
 *  has no active suppressed edge and comes back a singleton [idx]. */
export function collapsedClusterIndices(
  binaries: BinariesData,
  idx: number,
  isCollapsed: (starIdx: number) => boolean,
): number[] {
  const members = connectedMemberIndices(binaries, idx, (r) => isCollapsed(r.secondaryIdx));
  return members.length === 0 ? [idx] : members;
}

// Lines describing the star's binary role: a two-line block per relation
// where it is a secondary (heading + orbital detail), then a
// "Known companions:" heading + one name per line when it is itself a
// primary. A hierarchical member can be both.
export function companionLines(idx: number, ctx: CompanionFormatContext): string[] {
  const out = companionOfLines(idx, ctx);
  const names = companionNames(idx, ctx);
  if (names.length > 0) out.push('Known companions:', ...names);
  return out;
}

/** Blocks for every relation where the star is the SECONDARY. One block
 *  per relation, except that tier-3 relations quoting the IDENTICAL
 *  measurement collapse into one heading naming every primary — a
 *  secondary anchored off two members of the same system (HD 108250 off
 *  Acrux A and B) would otherwise repeat the same ρ/PA block per
 *  primary. */
export function companionOfLines(idx: number, ctx: CompanionFormatContext): string[] {
  const binaries = ctx.binaries;
  if (!binaries) return [];
  const secRelIdxs = binaries.secondaryIdxToRelations.get(idx);
  if (!secRelIdxs) return [];
  return companionOfAllLines(secRelIdxs.map((i) => binaries.relations[i]), ctx);
}

/** Names of every companion for which the star is the PRIMARY, in
 *  relation order. */
export function companionNames(idx: number, ctx: CompanionFormatContext): string[] {
  const binaries = ctx.binaries;
  if (!binaries) return [];
  const relIdxs = binaries.primaryIdxToRelations.get(idx);
  if (!relIdxs) return [];
  return relIdxs.map((i) =>
    resolveStarName(ctx, binaries.relations[i].secondaryIdx),
  );
}

function companionOfAllLines(
  rels: BinaryRelation[],
  ctx: CompanionFormatContext,
): string[] {
  const out: string[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < rels.length; i++) {
    if (consumed.has(i)) continue;
    const rel = rels[i];
    const kepler = keplerRelationParams(rel);
    if (kepler !== null) {
      out.push(...orbitCompanionOfLines(rel, kepler, ctx));
      continue;
    }
    const detail = tier3DetailLine(rel);
    const names = [resolveStarName(ctx, rel.primaryIdx)];
    for (let j = i + 1; j < rels.length; j++) {
      if (consumed.has(j)) continue;
      const other = rels[j];
      if (keplerRelationParams(other) === null && tier3DetailLine(other) === detail) {
        consumed.add(j);
        names.push(resolveStarName(ctx, other.primaryIdx));
      }
    }
    out.push(`Visual companion of ${joinNames(names)}`);
    if (detail) out.push(detail);
  }
  return out;
}

// Tier-3 static measurement line: "ρ = 3.5″ · PA 111° at J2015.5", or
// null when the record carries neither field.
function tier3DetailLine(rel: BinaryRelation): string | null {
  const measured: string[] = [];
  if (Number.isFinite(rel.sepArcsec) && rel.sepArcsec > 0) {
    measured.push(`ρ = ${rel.sepArcsec.toFixed(1)}″`);
  }
  if (Number.isFinite(rel.paDeg)) {
    measured.push(`PA ${Math.round(rel.paDeg)}°`);
  }
  if (measured.length === 0) return null;
  return `${measured.join(' · ')} at ${formatEpoch(rel.sepPaEpochJd)}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Tier 2's fallback is the plane ORIENTATION only — every field quoted here
// is measured in both tiers (../binaries/README.md § Tier mapping).
function orbitCompanionOfLines(
  rel: BinaryRelation,
  kepler: KeplerRelationParams,
  ctx: CompanionFormatContext,
): string[] {
  const { tier, elements } = kepler;
  const sepAU = evaluateOrbitSeparationAU(elements, ctx.nowJd);
  const orbit = `P = ${formatOrbitalPeriod(elements.P)} · e = ${elements.e.toFixed(2)}`;
  return [
    `Orbits ${resolveStarName(ctx, rel.primaryIdx)} · ρ = ${sepAU.toFixed(1)} AU`,
    tier === 2 ? `${orbit} (unknown orbital plane)` : orbit,
  ];
}

// Orbital period in days below one year, years above — spectroscopic
// pairs (days) and visual pairs (decades-plus) both read naturally.
function formatOrbitalPeriod(pDays: number): string {
  return pDays < 365.25
    ? `${pDays.toFixed(2)} d`
    : `${(pDays / 365.25).toFixed(2)} yr`;
}

// Julian-year epoch of the stored sep + PA. The catalog separation is
// measured at Gaia J2016 / WDS date_last, not J2000, so quote the real
// epoch rather than a hard-coded J2000.
function formatEpoch(jd: number): string {
  const year = 2000 + (jd - J2000_JD) / 365.25;
  return `J${year.toFixed(1)}`;
}
