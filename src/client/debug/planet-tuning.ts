import type { Stellata } from '../stellata';
import { type DebugSection, makeSlider } from './debug-panel';

// Dev-only tuning section for the reflected-planet-glare pass. One knob:
// uGlareGain — the glare peak multiplier, i.e. planet-glare brightness
// relative to a star of the same apparent magnitude (1 = identical). See
// solar-system/planets/glare/README.md.
//
// No reverse sync — see `SliderOpts.initial` in debug-panel.ts.

export function buildPlanetSection(stellata: Stellata): DebugSection {
  const body = document.createElement('div');

  body.appendChild(makeSlider({
    label: 'glare brightness (vs star mag)',
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
