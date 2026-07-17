// Star hover formatter — name (tier-ordered fallback), constellation +
// camera-frame distance, cleaned spectral class, variability, and
// binary-companion lines. See ./README.md.

import { FLAG_BINARY_COMPANION_SYNTHETIC } from '../../../../scripts/catalog/catalog-pure';
import { fmtDistAuto } from '../../ui/distance-util';
import { formatSpectral, spectralLine } from '../../format/spectral-format';
import { formatVariability } from '../../format/physical-format';
import {
  collapsedClusterIndices,
  companionLines,
  resolveStarName,
  systemMemberIndices,
  type CompanionFormatContext,
} from '../../format/star-companion-format';
import type { HoverPayload } from '../hover-types';

export interface StarHoverFormatContext extends CompanionFormatContext {
  spectralMap: Map<number, string>;
  spectClass: Float32Array;
  luminosityClass: Uint8Array;
  // Catalog per-record flag byte — the synthetic-companion bit marks
  // class bytes as brightness-derived so the spectral descriptor reads
  // "(estimated)".
  flags: Uint8Array;
  // `constellation` is a Float32Array in the catalog (carried as a
  // vertex attribute); 255 marks "no constellation".
  constellation: Float32Array;
  constellations: ReadonlyArray<{ name: string }>;
  periodDays: Float32Array;
  amplitudeMag: Float32Array;
  /** Live per-star composite-suppress verdict (Stellata
   *  .isCompositeSuppressed) — true when the orbit walk's sub-pixel LOD
   *  collapsed the star onto its primary this frame. Drives the
   *  system-card swap for multiples; omit (tests, focus card reuse) to
   *  always get the per-component card. */
  isCollapsed?: (idx: number) => boolean;
}

/** A record's spectral class is an estimate (not an observation) when it
 *  is a synthetic promoted companion with no raw spectral string — its
 *  class bytes were derived from brightness, assuming main sequence. */
export function spectralIsEstimated(
  rawDisplay: string | undefined,
  flagByte: number,
): boolean {
  return !rawDisplay && (flagByte & FLAG_BINARY_COMPANION_SYNTHETIC) !== 0;
}

export function formatStarHover(
  idx: number,
  cameraDistancePc: number,
  ctx: StarHoverFormatContext,
): HoverPayload {
  const {
    spectralMap,
    spectClass,
    luminosityClass,
    flags,
    constellation,
    constellations,
    periodDays,
    amplitudeMag,
  } = ctx;

  const conIdx = constellation[idx];
  const con = conIdx !== 255 ? constellations[conIdx].name : '';
  const ctxLine = [con, fmtDistAuto(cameraDistancePc)].filter(Boolean).join(' · ');

  const system = systemCardOrNull(idx, ctxLine, ctx);
  if (system) return system;

  const name = resolveStarName(ctx, idx);
  const lines: string[] = [];
  if (ctxLine) lines.push(ctxLine);
  const raw = spectralMap.get(idx);
  const spect = spectralLine(
    formatSpectral(raw, spectClass[idx], luminosityClass[idx], spectralIsEstimated(raw, flags[idx])),
  );
  if (spect) lines.push(spect);
  const variability = formatVariability(periodDays[idx], amplitudeMag[idx]);
  if (variability) lines.push(`Variable · ${variability}`);
  lines.push(...companionLines(idx, ctx));
  return { name, lines };
}

/** System card for a screen-collapsed multiple. Fires only when the
 *  hovered star's system has 3+ components (a plain binary keeps its
 *  per-component card — the "Known companions" line already covers it)
 *  AND the hovered star's own collapsed cluster — components reachable
 *  through currently-suppressed relations, i.e. actually rendering as
 *  one point with it — has 2+ members. The roster lists the CLUSTER
 *  only: hovering Proxima (visibly separated from the α Cen A+B point)
 *  or a close-up Castor A (only its spectroscopic partner overlaps)
 *  must not enumerate members the user can see elsewhere on screen. */
function systemCardOrNull(
  idx: number,
  ctxLine: string,
  ctx: StarHoverFormatContext,
): HoverPayload | null {
  if (!ctx.binaries || !ctx.isCollapsed) return null;
  const members = systemMemberIndices(ctx.binaries, idx);
  if (members.length < 3) return null;
  const cluster = collapsedClusterIndices(ctx.binaries, idx, ctx.isCollapsed);
  if (cluster.length < 2) return null;
  const lines: string[] = [];
  if (ctxLine) lines.push(ctxLine);
  lines.push(
    cluster.length === members.length
      ? `${members.length} components:`
      : `${cluster.length} of ${members.length} components here:`,
    cluster.map((m) => resolveStarName(ctx, m)).join(', '),
  );
  return { name: `${resolveStarName(ctx, cluster[0])} system`, lines };
}
