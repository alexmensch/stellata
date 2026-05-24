// Star hover formatter — name (tier-ordered fallback), constellation +
// distance, spectral class, variability. See ./README.md.

import { fmtDist } from '../../ui/distance-util';
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

  const name = starLabels.get(idx) ?? `Unnamed #${idx}`;
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
  return { name, lines };
}
