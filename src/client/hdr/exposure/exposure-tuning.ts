// Exposure + tone-map section for the unified debug panel: the live
// statistic and branch decomposition, over the operator's shape knobs.

import type { Stellata } from '../../stellata';
import {
  type DebugSection,
  makeMonoReadout,
  makeSlider,
  setReadoutText,
} from '../../debug/debug-panel';
import { extendedThresholdSbFor } from '../../filters/filter-state';
import {
  type ExposureReadout,
  formatExposureReadout,
} from './exposure-tuning-pure';
import {
  ADAPT_DOT_COVERAGE,
  ADAPT_PIN_COVERAGE,
} from './scene-adaptation-pure';

function readState(stellata: Stellata): ExposureReadout {
  const { adaptation, exposure, hdr } = stellata;
  const branches = adaptation.branches();
  const tuning = adaptation.getTuning();
  return {
    meanL: adaptation.getStatistic().meanL,
    discL: branches.discL,
    coverage: branches.coverage,
    weight: branches.weight,
    eye: branches.eye,
    pin: branches.pin,
    floor: branches.floor,
    measuredDm: branches.dm,
    appliedDm: adaptation.getDm(),
    regime: branches.regime,
    parkPhase: adaptation.getParkPhase(),
    limitMag: exposure.getLimitMag(),
    ev: exposure.getEv(),
    effectiveLimitMag: exposure.getEffectiveLimitMag(),
    exposure: hdr.emitterUniforms.uExposure.value,
    whitePoint: tuning.whitePoint,
    extendedThresholdSb: extendedThresholdSbFor(exposure.getInstrument()),
    pinCoverage: ADAPT_PIN_COVERAGE,
    dotCoverage: ADAPT_DOT_COVERAGE,
  };
}

export function buildExposureSection(stellata: Stellata): DebugSection {
  const body = document.createElement('div');

  const readout = makeMonoReadout('margin-bottom:8px;');
  body.appendChild(readout);

  let visible = true;
  const onFrame = () => {
    if (!visible) return;
    setReadoutText(readout, formatExposureReadout(readState(stellata)));
  };
  onFrame();
  const unsubscribe = stellata.on('frame', onFrame);

  // Every slider seeds from live state: the panel rebuilds each section on
  // open while the overrides outlive it, so a module-constant seed would
  // show defaults over a swept build.
  body.appendChild(makeSlider({
    label: 'L_ADAPT (perception anchor)',
    min: 0.005,
    max: 0.3,
    step: 0.001,
    initial: stellata.adaptation.getLAdapt(),
    format: (x) => x.toFixed(3),
    onChange: (x) => stellata.adaptation.setLAdapt(x),
  }));

  body.appendChild(makeSlider({
    label: 'L_TARGET (resolved-surface pin)',
    min: 0.2,
    max: 4,
    step: 0.01,
    initial: stellata.adaptation.getLTarget(),
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.adaptation.setLTarget(x),
  }));

  // Floored well above zero: at tau 0 a frame pair landing in the same
  // millisecond divides 0 by 0 and poisons the cut with NaN.
  body.appendChild(makeSlider({
    label: 'slew tau (s)',
    min: 0.05,
    max: 2,
    step: 0.05,
    initial: stellata.adaptation.getSlewTauS(),
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.adaptation.setSlewTauS(x),
  }));

  body.appendChild(makeSlider({
    label: 'DR_MAG (threshold → white)',
    min: 5.5,
    max: 11,
    step: 0.1,
    initial: stellata.hdr.getDynamicRangeMag(),
    format: (x) => x.toFixed(1),
    onChange: (x) => stellata.hdr.setDynamicRangeMag(x),
  }));

  body.appendChild(makeSlider({
    label: 'highlight desat',
    min: 0,
    max: 1,
    step: 0.01,
    initial: stellata.hdr.getHighlightDesat(),
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.hdr.setHighlightDesat(x),
  }));

  return {
    element: body,
    dispose: () => { unsubscribe(); },
    setVisible: (visibleNow: boolean) => { visible = visibleNow; },
  };
}
