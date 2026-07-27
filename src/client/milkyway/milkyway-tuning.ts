import type { MilkyWay } from './milkyway';
import { type DebugSection, makeColor, makeSlider } from '../debug/debug-panel';

// Dev-only tuning section for the volumetric Milky Way layer. Builds a
// labelled section with sliders + colour pickers wired to the layer's
// setters. Designed to be appended into the shared debug panel root.
//
// Reddening uses linear sliders since the CCM default has channels above
// 1.0 (1.32 in blue), which rules out an HTML colour picker. Disc/bulge
// palette colours use `<input type="color">` since their channels are
// bounded to [0,1].
//
// No reverse sync — see `SliderOpts.initial` in debug-panel.ts.

export function buildMilkywaySection(layer: MilkyWay): DebugSection {
  const body = document.createElement('div');
  const v = layer.getValues();

  // Surface-brightness anchor, in mag/arcsec². Range straddles the
  // derived value; H7 lands the shipped anchor.
  body.appendChild(makeSlider({
    label: 'glowMagOffset',
    min: 26,
    max: 36,
    step: 0.1,
    initial: v.glowMagOffset,
    format: (x) => x.toFixed(1),
    onChange: (x) => layer.setGlowMagOffset(x),
  }));

  body.appendChild(makeSlider({
    label: 'discDensity',
    min: 0,
    max: 10,
    step: 0.05,
    initial: v.discDensity,
    format: (x) => x.toFixed(2),
    onChange: (x) => layer.setDiscDensity(x),
  }));

  body.appendChild(makeSlider({
    label: 'bulgeDensity',
    min: 0,
    max: 30,
    step: 0.1,
    initial: v.bulgeDensity,
    format: (x) => x.toFixed(2),
    onChange: (x) => layer.setBulgeDensity(x),
  }));

  body.appendChild(makeSlider({
    label: 'extinctionStrength',
    min: 0,
    max: 3,
    step: 0.05,
    initial: v.extinctionStrength,
    format: (x) => x.toFixed(2),
    onChange: (x) => layer.setExtinctionStrength(x),
  }));

  body.appendChild(makeColor({
    label: 'discColor',
    initial: v.discColor,
    onChange: ({ r, g, b }) => layer.setDiscColor(r, g, b),
  }));

  body.appendChild(makeColor({
    label: 'bulgeColor',
    initial: v.bulgeColor,
    onChange: ({ r, g, b }) => layer.setBulgeColor(r, g, b),
  }));

  // Reddening RGB — linear sliders since channels can exceed 1.0
  // (CCM default has 1.32 in blue). Updated together via a small
  // closure so any slider write applies all three current values.
  const reddening = { ...v.reddening };
  const updateReddening = () => layer.setReddeningRGB(reddening.r, reddening.g, reddening.b);
  for (const channel of ['r', 'g', 'b'] as const) {
    body.appendChild(makeSlider({
      label: 'reddening.' + channel,
      min: 0,
      max: 2,
      step: 0.01,
      initial: reddening[channel],
      format: (x) => x.toFixed(2),
      onChange: (x) => {
        reddening[channel] = x;
        updateReddening();
      },
    }));
  }

  return {
    element: body,
    dispose: () => {},
    setVisible: () => {},
  };
}
