// Scene-driven exposure adaptation: the two branches the reduced frame
// statistic drives, and the cut they imply. See README.md § Adaptation.

import { MAG_PER_STOP } from './exposure-epoch';
import { tonemapWhitePoint } from '../tonemap-pure';

/** Display luminance a correctly-exposed sunlit disc reads at —
 *  measured, not chosen: the geometric mean of three independently
 *  judged planets (`docs/science-hdr-pipeline.md` § 3.1). */
export const L_TARGET = 0.89;

/** Reference coverage — the frame fraction a body lands exactly on
 *  `L_TARGET` at. Not free: it is the park coverage, derived from
 *  `PLANET_PARK_FILL_FRACTION` on the calibration viewport's minor axis
 *  (§ 3.1 carries the derivation). */
export const ADAPT_REF_COVERAGE = 0.0685;

/** Adaptation anchor — `L̄` at which the perception branch's cut is
 *  exactly zero. */
export const L_ADAPT = L_TARGET * ADAPT_REF_COVERAGE;

/** Peak over mean of a Lambert disc at full phase: `∫√(1−ρ²)·2ρ dρ` = 2/3
 *  of the sub-solar radiance. Exact, and the only reason `L_CAP` and
 *  `adaptedDiscMeanL` are different numbers. */
export const DISC_PEAK_OVER_MEAN = 1.5;

/** Ceiling the highlight guard holds the frame's brightest **visible
 *  pixel** at — a display compensation, not a perceptual claim; § 3.2
 *  (The highlight guard) carries the reasoning. The buffer max returns a
 *  true brightest pixel where the source walk returned a disc MEAN, so
 *  this is the 1.2 that shipped through the walk era times
 *  `DISC_PEAK_OVER_MEAN`: the level a resolved disc settles at is
 *  unchanged. The one knob smoke-tuning moves. */
export const L_CAP = 1.8;

/** Time constant of the slew limit on the **applied** cut, in real
 *  seconds. The measurement stays instantaneous, and the filter runs in
 *  magnitudes so the ramp is stops-per-second at any absolute level. */
export const ADAPT_SLEW_TAU_S = 0.3;

/** The slew snaps to its target inside this many magnitudes — an
 *  exponential never arrives, and exactly 0 is the sentinel the
 *  uniform's skip-if-unchanged reads. */
export const ADAPT_SLEW_SETTLE_MAG = 1e-3;

/** One frame of the slew limit: blend the applied cut toward the frame's
 *  measurement, snapping once inside `ADAPT_SLEW_SETTLE_MAG`. */
export function slewDm(applied: number, measured: number, blend: number): number {
  if (Math.abs(measured - applied) <= ADAPT_SLEW_SETTLE_MAG) return measured;
  return applied + (measured - applied) * blend;
}

/**
 * The perception branch: retinal illuminance drives the cut. `dm ≤ 0` is
 * an invariant — a dark-adapted eye at the instrument's limit is the
 * ceiling, so adaptation only ever cuts.
 */
export function eyeAdaptationDm(meanL: number): number {
  if (meanL <= L_ADAPT) return 0;
  return -2.5 * Math.log10(meanL / L_ADAPT);
}

/**
 * The display branch: hold the frame's brightest visible pixel at
 * `L_CAP`. Also clamped at 0 — it is a *limit* on saturation, never a
 * licence to expose past threshold.
 */
export function highlightGuardDm(peakL: number): number {
  if (peakL <= L_CAP) return 0;
  return -2.5 * Math.log10(peakL / L_CAP);
}

/** The deepest cut any displayed frame can justify: the perception
 *  branch's own response to a full-white frame, the strongest stimulus
 *  the display can deliver. The scene-referred cut past this point
 *  simulates a retinal bleaching the monitor never caused —
 *  `docs/science-hdr-pipeline.md` § 3.2 (The display floor). */
export const ADAPT_DISPLAY_FLOOR_DM = -2.5 * Math.log10(tonemapWhitePoint() / L_ADAPT);

/** Width of the handover blend, in magnitudes of branch disagreement —
 *  one stop, i.e. a factor-2 band of coverage below the handover. The
 *  floor and the guard's pin can sit many magnitudes apart, so without a
 *  ramp the crossing would step. */
export const ADAPT_HANDOVER_BLEND_MAG = MAG_PER_STOP;

/**
 * The frame's cut. Where a resolved surface dominates (`guard ≥ eye`,
 * i.e. coverage at or above the handover) the guard's pin governs
 * untouched; elsewhere the perception branch applies, bounded by the
 * display floor, with a one-stop ramp joining the two continuously.
 * Never deeper than `max(eye, guard)` — the display model only ever
 * raises the exposure the scene measurement asked for.
 */
export function adaptationDm(meanL: number, peakL: number): number {
  const eye = eyeAdaptationDm(meanL);
  const guard = highlightGuardDm(peakL);
  if (guard >= eye) return guard;
  const floored = Math.max(eye, ADAPT_DISPLAY_FLOOR_DM);
  const blend = Math.max(0, 1 + (guard - eye) / ADAPT_HANDOVER_BLEND_MAG);
  return Math.max(eye, floored + (guard - floored) * blend);
}

/** Coverage at which the two branches agree — above it the guard governs
 *  and a resolved disc's PEAK reads `L_CAP`, below it the perception
 *  model does and a small bright source is allowed to clip. */
export function guardHandoverCoverage(): number {
  return L_ADAPT * DISC_PEAK_OVER_MEAN / L_CAP;
}

/** Disc-mean luminance a body settles at: `L_ADAPT / f` under the
 *  perception branch, `L_CAP` over the Lambert peak-to-mean where the
 *  guard governs — and clipped wherever the display floor binds, which is
 *  why the disc's own luminance is now an input (§ 3.2's sensitivity
 *  analysis). */
export function adaptedDiscMeanL(coverage: number, discMeanL: number): number {
  const dm = adaptationDm(discMeanL * coverage, discMeanL * DISC_PEAK_OVER_MEAN);
  return discMeanL * 10 ** (0.4 * dm);
}

/** Stops of manual trim a body needs to land its disc mean back on
 *  `L_TARGET`. Constant wherever the guard governs, since the guard
 *  already pins the level. */
export function trimStopsForCoverage(coverage: number, discMeanL: number): number {
  return Math.log2(L_TARGET / adaptedDiscMeanL(coverage, discMeanL));
}
