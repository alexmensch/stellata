import type { Stellata } from '../stellata';
import { type DebugSection, makeSlider } from './debug-panel';

// Dev-only tuning for the single-scattering atmosphere model. Four global
// multipliers applied on top of every body's calibrated base params (fly to
// the body, tune, bake the value into planet-system.ts). See
// solar-system/README.md § Atmospheres and atmosphere-scattering-pure.ts.
//
// No reverse sync — see `SliderOpts.initial` in debug-panel.ts.

export function buildAtmosphereSection(stellata: Stellata): DebugSection {
  const body = document.createElement('div');
  const v = stellata.getAtmosphereTuning();

  body.appendChild(makeSlider({
    label: 'density × (dial down / up)',
    min: 0,
    max: 3,
    step: 0.05,
    initial: v.densityMul,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.setAtmosphereTuning({ densityMul: x }),
  }));

  body.appendChild(makeSlider({
    label: 'rayleigh ↔ mie balance',
    min: 0,
    max: 1,
    step: 0.02,
    initial: v.rayleighMieBalance,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.setAtmosphereTuning({ rayleighMieBalance: x }),
  }));

  body.appendChild(makeSlider({
    label: 'scale height ×',
    min: 0.2,
    max: 3,
    step: 0.05,
    initial: v.scaleHeightMul,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.setAtmosphereTuning({ scaleHeightMul: x }),
  }));

  body.appendChild(makeSlider({
    label: 'sun intensity',
    min: 0,
    max: 3,
    step: 0.05,
    initial: v.sunIntensity,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.setAtmosphereTuning({ sunIntensity: x }),
  }));

  return {
    element: body,
    dispose: () => {},
    setVisible: () => {},
  };
}
