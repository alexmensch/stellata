import type { Stellata } from '../stellata';
import { type DebugSection, makeSlider } from './debug-panel';

// Dev-only tuning section for the reflected-planet-glare pass. Two knobs:
//   • uGlareGain — scales the surface-radiance the glare base + bloom
//     onset read.
//   • uBloomThreshold — lit-surface radiance at which a body blooms into
//     a star-like halo (shape of the veiling-glare bloom).
// See planet.vert.glsl and solar-system/README.md § Planet mesh LOD.
//
// No reverse sync — see `SliderOpts.initial` in debug-panel.ts.

export function buildPlanetSection(stellata: Stellata): DebugSection {
  const body = document.createElement('div');

  body.appendChild(makeSlider({
    label: 'glare gain (radiance scale)',
    min: 0,
    max: 4,
    step: 0.05,
    initial: stellata.getPlanetGlareGain(),
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.setPlanetGlareGain(x),
  }));

  body.appendChild(makeSlider({
    label: 'bloom threshold (star-glare onset)',
    min: 0,
    max: 2,
    step: 0.02,
    initial: stellata.getPlanetBloomThreshold(),
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.setPlanetBloomThreshold(x),
  }));

  return {
    element: body,
    dispose: () => {},
    setVisible: () => {},
  };
}
