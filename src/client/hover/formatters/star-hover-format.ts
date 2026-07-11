// Star hover formatter — name (tier-ordered fallback), constellation +
// camera-frame distance, cleaned spectral class, variability, and
// binary-companion lines. See ./README.md.

import { fmtDistAuto } from '../../ui/distance-util';
import { formatSpectral, spectralLine } from '../../format/spectral-format';
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
  // `constellation` is a Float32Array in the catalog (carried as a
  // vertex attribute); 255 marks "no constellation".
  constellation: Float32Array;
  constellations: ReadonlyArray<{ name: string }>;
  periodDays: Float32Array;
  amplitudeMag: Float32Array;
}

export function formatStarHover(
  idx: number,
  cameraDistancePc: number,
  ctx: StarHoverFormatContext,
): HoverPayload {
  const {
    starLabels,
    spectralMap,
    spectClass,
    luminosityClass,
    constellation,
    constellations,
    periodDays,
    amplitudeMag,
  } = ctx;

  const name = resolveStarName(starLabels, idx);
  const conIdx = constellation[idx];
  const con = conIdx !== 255 ? constellations[conIdx].name : '';
  const lines: string[] = [];
  const ctxLine = [con, fmtDistAuto(cameraDistancePc)].filter(Boolean).join(' · ');
  if (ctxLine) lines.push(ctxLine);
  const spect = spectralLine(
    formatSpectral(spectralMap.get(idx), spectClass[idx], luminosityClass[idx]),
  );
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
