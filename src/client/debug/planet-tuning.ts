import type { Stellata } from '../stellata';
import { type DebugSection, makeSlider } from './debug-panel';

// Dev-only tuning section for the reflected-planet-glare pass. The one
// knob is uGlareGain — the flux-continuity calibration between the
// resolved bloom peak and the mesh surface it sits over. See
// planet.vert.glsl (bloomPeak) and solar-system/README.md § Planet mesh
// LOD for what it shapes.
//
// No reverse sync — see `SliderOpts.initial` in debug-panel.ts.

export function buildPlanetSection(stellata: Stellata): DebugSection {
  const body = document.createElement('div');

  body.appendChild(makeSlider({
    label: 'glare gain (bloom vs mesh)',
    min: 0,
    max: 4,
    step: 0.05,
    initial: stellata.getPlanetGlareGain(),
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.setPlanetGlareGain(x),
  }));

  return {
    element: body,
    dispose: () => {},
    setVisible: () => {},
  };
}
