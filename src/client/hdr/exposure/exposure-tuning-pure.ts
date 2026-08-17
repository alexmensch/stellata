// Text of the debug panel's exposure readout: the statistic, the three
// adaptation branches and which governs, and the exposure decomposition.

import { LUMA_CEIL } from '../emission/emission-pure';
import { L_THRESH } from '../tonemap-pure';
import { type AdaptationRegime, ADAPT_SLEW_SETTLE_MAG } from './scene-adaptation-pure';
import type { ParkPhase } from './adaptation-park-pure';

export interface ExposureReadout {
  /** Both rescaled to the base instrument exposure, as the branches read
   *  them (`reduction/README.md` § Measure at the base exposure). */
  meanL: number;
  discL: number;
  coverage: number;
  weight: number;
  eye: number;
  pin: number;
  floor: number;
  /** This frame's branch answer, before the slew. */
  measuredDm: number;
  /** What the frame actually ran on — trails `measuredDm` by the slew. */
  appliedDm: number;
  regime: AdaptationRegime;
  parkPhase: ParkPhase;
  limitMag: number;
  ev: number;
  effectiveLimitMag: number;
  exposure: number;
  whitePoint: number;
  extendedThresholdSb: number;
  pinCoverage: number;
  dotCoverage: number;
}

const REGIME_LABEL: Record<AdaptationRegime, string> = {
  open: 'OPEN (no term cut)',
  eye: 'EYE (perception)',
  surface: 'SURFACE (resolved pin)',
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
 *  the frame with no measurement rather than a zero-luminance one, which
 *  the `open` regime would otherwise be indistinguishable from. */
export function hasMeasurement(r: ExposureReadout): boolean {
  return r.meanL > 0 || r.coverage > 0;
}

const PARK_SUFFIX: Record<ParkPhase, string> = {
  active: '',
  parked: ' · PARKED (measurement gated)',
  probing: ' · probing',
};

export function regimeLine(r: ExposureReadout): string {
  const park = PARK_SUFFIX[r.parkPhase];
  if (!hasMeasurement(r)) return 'no measurement — no cut' + park;
  const settling = Math.abs(r.appliedDm - r.measuredDm) > ADAPT_SLEW_SETTLE_MAG;
  return REGIME_LABEL[r.regime] + (settling ? ' · slewing' : '') + park;
}

export function formatExposureReadout(r: ExposureReadout): string {
  return [
    `L̄ ${r.meanL.toExponential(2)}   cover ${pct(r.coverage)}   D ${r.discL.toExponential(2)}`,
    `dm_eye ${mag(r.eye)}   pin ${mag(r.pin)}   floor ${mag(r.floor)}   w ${r.weight.toFixed(2)}`,
    `dm  measured ${mag(r.measuredDm)}   applied ${mag(r.appliedDm)}`,
    regimeLine(r),
    '',
    `m_lim ${r.limitMag.toFixed(2)}   EV ${mag(r.ev)}`,
    `effective limit  m ${r.effectiveLimitMag.toFixed(2)}`,
    `uExposure ${r.exposure.toExponential(3)}`,
    `f_pin ${pct(r.pinCoverage)}   f_dot ${pct(r.dotCoverage)}`,
    '',
    `derived: Lw ${r.whitePoint.toFixed(2)}  S_lim ${r.extendedThresholdSb.toFixed(2)}`,
    `baked:   L_THRESH ${L_THRESH}  LUMA_CEIL ${LUMA_CEIL}`,
  ].join('\n');
}
