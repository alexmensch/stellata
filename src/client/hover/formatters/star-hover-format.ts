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

  const name = resolveStarName(ctx, idx);
  const conIdx = constellation[idx];
  const con = conIdx !== 255 ? constellations[conIdx].name : '';
  const lines: string[] = [];
  const ctxLine = [con, fmtDistAuto(cameraDistancePc)].filter(Boolean).join(' · ');
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
