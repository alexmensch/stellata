// Star hover formatter — name (tier-ordered fallback), constellation +
// camera-frame distance, cleaned spectral class, variability, and
// binary-companion lines. See ./README.md.

import { FLAG_BINARY_COMPANION_SYNTHETIC } from '../../../../scripts/catalog/catalog-pure';
import { fmtDistAuto } from '../../ui/distance-util';
import { formatSpectral, spectralLine } from '../../format/spectral-format';
import { formatVariability } from '../../format/physical-format';
import {
  companionLines,
  resolveStarName,
  type CompanionFormatContext,
  type StarNameContext,
} from '../../format/star-companion-format';
import type {
  SystemMember,
  SystemMembershipProvider,
} from '../../system-membership/system-membership';
import { rosterCardOrNull, UNNAMED_MEMBER_LABEL } from './system-card-format';
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
  /** Kind-generic membership queries (Stellata.systemMembership) —
   *  each cluster is the renderer's own live "these render as one
   *  point" verdict. Drives the system-card swap for collapsed
   *  multiples; omit (focus card reuse) to always get the
   *  per-component card. */
  membership?: SystemMembershipProvider;
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

  const system = ctx.membership
    ? rosterCardOrNull(ctx.membership, { kind: 'star', idx }, ctxLine, (m) => starMemberLabel(m, ctx))
    : null;
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

// Members carry a name only when their implementation could supply one
// (planets); star members resolve through the shared name fallbacks.
function starMemberLabel(m: SystemMember, ctx: StarNameContext): string {
  if (m.name) return m.name;
  return m.target.kind === 'star' ? resolveStarName(ctx, m.target.idx) : UNNAMED_MEMBER_LABEL;
}
