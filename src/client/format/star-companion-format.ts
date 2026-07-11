// Binary-companion card lines shared by the star hover formatter and the
// star focus-card provider. See ./README.md.

import { J2000_JD } from '../util/astronomy-constants';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  type BinariesData,
  type BinaryRelation,
} from '../binaries/binaries-loader';
import { evaluateOrbitSkyAU } from '../binaries/binary-orbit-pure';
import { relationToElements } from '../binaries/orbit-relation-cache';

export interface CompanionFormatContext {
  starLabels: Map<number, string>;
  // Parsed binaries.bin, or null when the artifact is absent — the
  // companion lines simply drop out in that case.
  binaries: BinariesData | null;
  // Current sim time as JD (tToJDE(getT())), injected fresh per card by
  // the caller. Drives the Tier-1 live separation.
  nowJd: number;
}

export function resolveStarName(starLabels: Map<number, string>, idx: number): string {
  return starLabels.get(idx) ?? `Unnamed #${idx}`;
}

// Lines describing the star's binary role: a two-line block per relation
// where it is a secondary (heading + orbital detail) and/or a companion
// count + named list when it is itself a primary. A hierarchical member
// can be both.
export function companionLines(idx: number, ctx: CompanionFormatContext): string[] {
  const binaries = ctx.binaries;
  if (!binaries) return [];
  const out: string[] = [];

  const secRelIdxs = binaries.secondaryIdxToRelations.get(idx);
  if (secRelIdxs) {
    out.push(
      ...companionOfAllLines(secRelIdxs.map((i) => binaries.relations[i]), ctx),
    );
  }

  const primRelIdxs = binaries.primaryIdxToRelations.get(idx);
  if (primRelIdxs && primRelIdxs.length > 0) {
    out.push(...hasCompanionsLines(primRelIdxs, binaries, ctx.starLabels));
  }

  return out;
}

// One block per companion-of relation, except that tier-3 relations
// quoting the IDENTICAL measurement collapse into one heading naming
// every primary — a secondary anchored off two members of the same
// system (HD 108250 off Acrux A and B) would otherwise repeat the same
// ρ/PA block per primary.
function companionOfAllLines(
  rels: BinaryRelation[],
  ctx: CompanionFormatContext,
): string[] {
  const out: string[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < rels.length; i++) {
    if (consumed.has(i)) continue;
    const rel = rels[i];
    if ((rel.flags & FLAG_HAS_ORBIT) !== 0) {
      out.push(...orbitCompanionOfLines(rel, ctx));
      continue;
    }
    const detail = tier3DetailLine(rel);
    const names = [resolveStarName(ctx.starLabels, rel.primaryIdx)];
    for (let j = i + 1; j < rels.length; j++) {
      if (consumed.has(j)) continue;
      const other = rels[j];
      if ((other.flags & FLAG_HAS_ORBIT) === 0 && tier3DetailLine(other) === detail) {
        consumed.add(j);
        names.push(resolveStarName(ctx.starLabels, other.primaryIdx));
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

// The star is the secondary of an orbit-bearing (tier 1/2) relation.
// A heading line names the primary; the detail line is per-tier, keyed
// on the relation flags (see ../binaries/README.md § Tier mapping).
function orbitCompanionOfLines(
  rel: BinaryRelation,
  ctx: CompanionFormatContext,
): string[] {
  const primaryName = resolveStarName(ctx.starLabels, rel.primaryIdx);
  const period = formatOrbitalPeriod(rel.pDays);
  const head = `Orbits ${primaryName}`;
  if ((rel.flags & FLAG_HAS_INCLINATION) === 0) {
    // Tier 2 — period known, inclination not.
    return [head, `P = ${period} (unknown orbit)`];
  }

  // Tier 1 — full Kepler: ρ is the live 3D separation at the current time,
  // shown on the heading beside the primary.
  const now = evaluateOrbitSkyAU(relationToElements(rel), ctx.nowJd);
  const sepAU = Math.hypot(now.northAU, now.eastAU, now.radialAU);
  return [
    `${head} · ρ = ${sepAU.toFixed(1)} AU`,
    `P = ${period} · e = ${rel.e.toFixed(2)}`,
  ];
}

// The star is the primary of one or more pairs — the converse card
// block. One inline line names a sole companion; multiple companions
// get a count heading followed by each name on its own line.
function hasCompanionsLines(
  relIdxs: number[],
  binaries: BinariesData,
  starLabels: Map<number, string>,
): string[] {
  const names = relIdxs.map((i) =>
    resolveStarName(starLabels, binaries.relations[i].secondaryIdx),
  );
  if (names.length === 1) return [`1 known companion: ${names[0]}`];
  return [`${names.length} known companions:`, ...names];
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
