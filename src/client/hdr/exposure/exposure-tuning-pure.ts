// Text of the debug panel's exposure readout: the statistic, the three
// adaptation branches and which governs, and the exposure decomposition.

import { LUMA_CEIL } from '../emission/emission-pure';
import { L_THRESH } from '../tonemap-pure';
import { type AdaptationRegime, ADAPT_SLEW_SETTLE_MAG } from './scene-adaptation-pure';

export interface ExposureReadout {
  /** Both rescaled to the base instrument exposure, as the branches read
   *  them (`reduction/README.md` § Measure at the base exposure). */
  meanL: number;
  peakL: number;
  eye: number;
  guard: number;
  floor: number;
  /** This frame's branch answer, before the slew. */
  measuredDm: number;
  /** What the frame actually ran on — trails `measuredDm` by the slew. */
  appliedDm: number;
  regime: AdaptationRegime;
  limitMag: number;
  ev: number;
  effectiveLimitMag: number;
  exposure: number;
  whitePoint: number;
  extendedThresholdSb: number;
  handoverCoverage: number;
  refCoverage: number;
}

const REGIME_LABEL: Record<AdaptationRegime, string> = {
  eye: 'EYE (perception)',
  guard: 'GUARD (highlight pin)',
  floor: 'FLOOR (display bound)',
  handover: 'HANDOVER (ramp)',
};

function mag(m: number): string {
  return (m >= 0 ? '+' : '') + m.toFixed(2);
}

function pct(f: number): string {
  return (f * 100).toFixed(2) + '%';
}

/** A statistic that has not landed yet, or chart mode's reset — both leave
 *  the frame with no measurement rather than a zero-luminance one, and
 *  `adaptationBranches` would label that as the guard governing at 0.  */
export function hasMeasurement(r: ExposureReadout): boolean {
  return r.meanL > 0 || r.peakL > 0;
}

export function regimeLine(r: ExposureReadout): string {
  if (!hasMeasurement(r)) return 'no measurement — no cut';
  const settling = Math.abs(r.appliedDm - r.measuredDm) > ADAPT_SLEW_SETTLE_MAG;
  return REGIME_LABEL[r.regime] + (settling ? ' · slewing' : '');
}

export function formatExposureReadout(r: ExposureReadout): string {
  return [
    `L̄ ${r.meanL.toExponential(2)}   peak ${r.peakL.toExponential(2)}`,
    `dm_eye ${mag(r.eye)}   guard ${mag(r.guard)}   floor ${mag(r.floor)}`,
    `dm  measured ${mag(r.measuredDm)}   applied ${mag(r.appliedDm)}`,
    regimeLine(r),
    '',
    `m_lim ${r.limitMag.toFixed(2)}   EV ${mag(r.ev)}`,
    `effective limit  m ${r.effectiveLimitMag.toFixed(2)}`,
    `uExposure ${r.exposure.toExponential(3)}`,
    `f* ${pct(r.handoverCoverage)}   f_ref ${pct(r.refCoverage)}`,
    '',
    `baked: L_THRESH ${L_THRESH}  Lw ${r.whitePoint.toFixed(2)}`,
    `       LUMA_CEIL ${LUMA_CEIL}  S_lim ${r.extendedThresholdSb.toFixed(2)}`,
  ].join('\n');
}
