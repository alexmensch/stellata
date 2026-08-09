// Exposure + tone-map section for the unified debug panel: the live
// statistic and branch decomposition, over the operator's shape knobs.

import type { Stellata } from '../../stellata';
import {
  type DebugSection,
  makeMonoReadout,
  makeSlider,
} from '../../debug/debug-panel';
import { extendedThresholdSbFor } from '../../filters/filter-state';
import { DR_MAG, HIGHLIGHT_DESAT } from '../tonemap-pure';
import {
  type ExposureReadout,
  formatExposureReadout,
} from './exposure-tuning-pure';
import {
  ADAPT_REF_COVERAGE,
  ADAPT_SLEW_TAU_S,
  guardHandoverCoverage,
  L_ADAPT,
  L_CAP,
} from './scene-adaptation-pure';

function readState(stellata: Stellata): ExposureReadout {
  const { adaptation, exposure, hdr } = stellata;
  const branches = adaptation.branches();
  const tuning = adaptation.getTuning();
  return {
    meanL: adaptation.getMeanLuminance(),
    peakL: adaptation.getPeakLuminance(),
    eye: branches.eye,
    guard: branches.guard,
    floor: branches.floor,
    measuredDm: branches.dm,
    appliedDm: adaptation.getDm(),
    regime: branches.regime,
    limitMag: exposure.getLimitMag(),
    ev: exposure.getEv(),
    effectiveLimitMag: exposure.getEffectiveLimitMag(),
    exposure: hdr.emitterUniforms.uExposure.value,
    whitePoint: tuning.whitePoint,
    extendedThresholdSb: extendedThresholdSbFor(exposure.getInstrument()),
    handoverCoverage: guardHandoverCoverage(tuning),
    refCoverage: ADAPT_REF_COVERAGE,
  };
}

export function buildExposureSection(stellata: Stellata): DebugSection {
  const body = document.createElement('div');

  const readout = makeMonoReadout('margin-bottom:8px;');
  body.appendChild(readout);

  let visible = true;
  let last = '';
  const onFrame = () => {
    if (!visible) return;
    const text = formatExposureReadout(readState(stellata));
    if (text === last) return;
    last = text;
    readout.textContent = text;
  };
  onFrame();
  const unsubscribe = stellata.on('frame', onFrame);

  // The two levels the branches measure against. Both ship at values the
  // design gate derived rather than chose (§ 3.1's smoke pass for L_ADAPT,
  // the Lambert peak-over-mean for L_CAP), so a slider here is for
  // re-running that judgement, not for taste.
  body.appendChild(makeSlider({
    label: 'L_ADAPT (perception anchor)',
    min: 0.005,
    max: 0.3,
    step: 0.001,
    initial: L_ADAPT,
    format: (x) => x.toFixed(3),
    onChange: (x) => stellata.adaptation.setLAdapt(x),
  }));

  body.appendChild(makeSlider({
    label: 'L_CAP (highlight pin)',
    min: 0.5,
    max: 6,
    step: 0.05,
    initial: L_CAP,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.adaptation.setLCap(x),
  }));

  // Floored well above zero: at tau 0 a frame pair landing in the same
  // millisecond divides 0 by 0 and poisons the cut with NaN.
  body.appendChild(makeSlider({
    label: 'slew tau (s)',
    min: 0.05,
    max: 2,
    step: 0.05,
    initial: ADAPT_SLEW_TAU_S,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.adaptation.setSlewTauS(x),
  }));

  // Both re-author every chrome colour through syncMode, and DR_MAG also
  // moves the display floor the readout above reports.
  body.appendChild(makeSlider({
    label: 'DR_MAG (threshold → white)',
    min: 5.5,
    max: 11,
    step: 0.1,
    initial: DR_MAG,
    format: (x) => x.toFixed(1),
    onChange: (x) => stellata.hdr.setDynamicRangeMag(x),
  }));

  body.appendChild(makeSlider({
    label: 'highlight desat',
    min: 0,
    max: 1,
    step: 0.01,
    initial: HIGHLIGHT_DESAT,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.hdr.setHighlightDesat(x),
  }));

  return {
    element: body,
    dispose: () => { unsubscribe(); },
    setVisible: (visibleNow: boolean) => { visible = visibleNow; },
  };
}
