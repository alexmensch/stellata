// Text of the debug panel's exposure readout: the statistic, the three
// adaptation branches and which governs, and the exposure decomposition.

import { LUMA_CEIL } from '../emission/emission-pure';
import { L_THRESH } from '../tonemap/tonemap-pure';
import {
  type AdaptationBranches,
  type AdaptationRegime,
  ADAPT_SLEW_SETTLE_MAG,
} from './scene-adaptation-pure';
import type { ParkPhase } from './park/adaptation-park-pure';

export interface ExposureReadout {
  /** This frame's branch answer, before the slew, or null where no reduction
   *  has landed — a cold start or chart's reset, which the `open` regime of a
   *  measured dark frame must not be mistaken for. */
  measurement: AdaptationBranches | null;
  /** What the frame actually ran on — trails the measured `dm` by the slew. */
  appliedDm: number;
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

const PARK_SUFFIX: Record<ParkPhase, string> = {
  active: '',
  parked: ' · PARKED (measurement gated)',
  probing: ' · probing',
};

export function regimeLine(r: ExposureReadout): string {
  const park = PARK_SUFFIX[r.parkPhase];
  const m = r.measurement;
  if (m === null) return 'no measurement — no cut' + park;
  const settling = Math.abs(r.appliedDm - m.dm) > ADAPT_SLEW_SETTLE_MAG;
  return REGIME_LABEL[m.regime] + (settling ? ' · slewing' : '') + park;
}

const UNMEASURED = '—';

function measurementLines(m: AdaptationBranches | null, appliedDm: number): string[] {
  if (m === null) {
    return [
      `L̄ ${UNMEASURED}   cover ${UNMEASURED}   D ${UNMEASURED}`,
      `dm_eye ${UNMEASURED}   pin ${UNMEASURED}   floor ${UNMEASURED}   w ${UNMEASURED}`,
      `dm  measured ${UNMEASURED}   applied ${mag(appliedDm)}`,
    ];
  }
  return [
    `L̄ ${m.meanL.toExponential(2)}   cover ${pct(m.coverage)}   D ${m.discL.toExponential(2)}`,
    `dm_eye ${mag(m.eye)}   pin ${mag(m.pin)}   floor ${mag(m.floor)}   w ${m.weight.toFixed(2)}`,
    `dm  measured ${mag(m.dm)}   applied ${mag(appliedDm)}`,
  ];
}

export function formatExposureReadout(r: ExposureReadout): string {
  return [
    ...measurementLines(r.measurement, r.appliedDm),
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
