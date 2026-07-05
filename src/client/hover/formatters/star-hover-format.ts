// Star hover formatter — name (tier-ordered fallback), constellation +
// distance, spectral class, variability, and binary-companion lines.
// See ./README.md.

import { fmtDist } from '../../ui/distance-util';
import { J2000_JD } from '../../util/astronomy-constants';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  type BinariesData,
  type BinaryRelation,
} from '../../binaries/binaries-loader';
import { evaluateOrbitSkyAU } from '../../binaries/binary-orbit-pure';
import { relationToElements } from '../../binaries/orbit-relation-cache';
import type { HoverPayload } from '../hover-types';

export interface StarHoverFormatContext {
  starLabels: Map<number, string>;
  spectralMap: Map<number, string>;
  positions: Float32Array;
  // `constellation` is a Float32Array in the catalog (carried as a
  // vertex attribute); 255 marks "no constellation".
  constellation: Float32Array;
  constellations: ReadonlyArray<{ name: string }>;
  periodDays: Float32Array;
  amplitudeMag: Float32Array;
  // Parsed binaries.bin, or null when the artifact is absent — the
  // companion lines simply drop out in that case.
  binaries: BinariesData | null;
  // Current sim time as JD (tToJDE(getT())), injected fresh per hover by
  // the provider. Drives the Tier-1 live separation.
  nowJd: number;
}

export function formatStarHover(
  idx: number,
  ctx: StarHoverFormatContext,
): HoverPayload {
  const {
    starLabels,
    spectralMap,
    positions,
    constellation,
    constellations,
    periodDays,
    amplitudeMag,
  } = ctx;

  const name = resolveStarName(starLabels, idx);
  const conIdx = constellation[idx];
  const con = conIdx !== 255 ? constellations[conIdx].name : '';
  const dist = Math.sqrt(
    positions[idx * 3] ** 2 +
      positions[idx * 3 + 1] ** 2 +
      positions[idx * 3 + 2] ** 2,
  );
  const lines: string[] = [];
  const ctxLine = [con, fmtDist(dist)].filter(Boolean).join(' · ');
  if (ctxLine) lines.push(ctxLine);
  const spect = spectralMap.get(idx);
  if (spect) lines.push(spect);
  const period = periodDays[idx];
  const amp = amplitudeMag[idx];
  if (period > 0 && amp > 0) {
    const periodStr =
      period >= 10 ? `${period.toFixed(0)}d` : `${period.toFixed(2)}d`;
    lines.push(`Variable · Period ${periodStr} · Δmag ${amp.toFixed(1)}`);
  }
  lines.push(...companionLines(idx, ctx));
  return { name, lines };
}

function resolveStarName(starLabels: Map<number, string>, idx: number): string {
  return starLabels.get(idx) ?? `Unnamed #${idx}`;
}

// Lines describing the hovered star's binary role: a two-line block when
// it is a secondary (heading + orbital detail) and/or a companion count +
// named list when it is itself a primary. A hierarchical member can be both.
function companionLines(idx: number, ctx: StarHoverFormatContext): string[] {
  const binaries = ctx.binaries;
  if (!binaries) return [];
  const out: string[] = [];

  const secRelIdx = binaries.secondaryIdxToRelation.get(idx);
  if (secRelIdx !== undefined) {
    out.push(...companionOfLines(binaries.relations[secRelIdx], ctx));
  }

  const primRelIdxs = binaries.primaryIdxToRelations.get(idx);
  if (primRelIdxs && primRelIdxs.length > 0) {
    out.push(...hasCompanionsLines(primRelIdxs, binaries, ctx.starLabels));
  }

  return out;
}

// The hovered star is the secondary of `rel`. A heading line names the
// primary; the detail line is per-tier, keyed on the relation flags (see
// ../../binaries/README.md § Tier mapping).
function companionOfLines(
  rel: BinaryRelation,
  ctx: StarHoverFormatContext,
): string[] {
  const primaryName = resolveStarName(ctx.starLabels, rel.primaryIdx);

  if ((rel.flags & FLAG_HAS_ORBIT) === 0) {
    // Tier 3 — no orbit: quote the static WDS sep + PA at its epoch.
    const head = `Visual companion of ${primaryName}`;
    const measured: string[] = [];
    if (Number.isFinite(rel.sepArcsec) && rel.sepArcsec > 0) {
      measured.push(`ρ = ${rel.sepArcsec.toFixed(1)}″`);
    }
    if (Number.isFinite(rel.paDeg)) {
      measured.push(`PA ${Math.round(rel.paDeg)}°`);
    }
    if (measured.length === 0) return [head];
    return [head, `${measured.join(' · ')} at ${formatEpoch(rel.sepPaEpochJd)}`];
  }

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

// The hovered star is the primary of one or more pairs — the converse
// card block. One inline line names a sole companion; multiple companions
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
