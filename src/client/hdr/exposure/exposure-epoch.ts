// The exposure model: instrument limit, scene adaptation, and the manual
// EV trim collapsed into one scalar, plus the two magnitude bounds the
// shaders derive from it. See README.md § The three terms.

import { DEFAULT_INSTRUMENT, instrumentLimitMag } from '../../filters/filter-state';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { L_THRESH } from '../tonemap-pure';

/** One photographic stop in magnitudes: 2.5·log10(2). */
export const MAG_PER_STOP = 2.5 * Math.log10(2);

/** Trim range, in stops either side of EV 0. */
export const EV_MAX_STOPS = 3;

/** Trim granularity, in stops. The slider geometry and the URL field's
 *  quantisation are the same grid, so a shared URL round-trips exactly. */
export const EV_STEP_STOPS = 1 / 3;

/** `uExposure` for a magnitude limit — the luminance a source at m = 0
 *  carries, fixed so a source at `magLimit` lands exactly on
 *  `L_THRESH`. */
export function exposureForMagLimit(magLimit: number, lThresh = L_THRESH): number {
  return lThresh * 10 ** (0.4 * magLimit);
}

/**
 * The scene's single exposure scalar. `dm` is the automatic adaptation
 * cut (≤ 0 by invariant — nothing adapts to see fainter than
 * threshold); `ev` is the manual trim and is the one term that may go
 * positive.
 */
export function sceneExposure(limitMag: number, dm = 0, ev = 0): number {
  return exposureForMagLimit(limitMag) * 10 ** (0.4 * Math.min(0, dm)) * 2 ** ev;
}

/**
 * The magnitude a source lands on `L_THRESH` at — the visible faint
 * edge. Adaptation is deliberately absent: a dark-adapted eye at the
 * instrument's limit is the ceiling, and dimming the field is what the
 * operator does with the exposure it already has. Only the instrument
 * and the manual trim move where "just visible" sits, which is why the
 * cull bound below can be static.
 */
export function thresholdMagFor(limitMag: number, ev = 0): number {
  return limitMag + MAG_PER_STOP * ev;
}

/**
 * Population cull bound — the faintest star the vertex stage keeps. Set
 * at the deepest threshold the trim can reach plus the soft taper, so
 * the visible faint edge is always the taper and can never be a
 * population edge. Static in the instrument: adaptation only ever cuts.
 */
export function cullMagFor(limitMag: number): number {
  return thresholdMagFor(limitMag, EV_MAX_STOPS) + SOFT_TAPER_MARGIN_MAG;
}

/**
 * The faintest magnitude that still puts pixels on screen — the CPU
 * mirror of the fragment shaders' taper, and the one rule every
 * "is it drawn, so is it pickable?" gate reads. Chart hard-clips at the
 * instrument limit: no taper, and it inherits no exposure state.
 */
export function drawCutoffMag(
  limitMag: number,
  thresholdMag: number,
  chart: boolean,
): number {
  return chart ? limitMag : thresholdMag + SOFT_TAPER_MARGIN_MAG;
}

/** The default instrument at EV 0 on an unadapted frame — every light
 *  decision in the scene grounds on it. */
export const BASE_EPOCH_EXPOSURE = sceneExposure(instrumentLimitMag(DEFAULT_INSTRUMENT));
