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

  // Every range below is derived from the shipped value rather than
  // hardcoded: the emissivity constants are solved now, so a re-solve
  // would otherwise leave a slider unable to represent its own default.
  const span = (shipped: number) => ({
    min: 0,
    max: 3 * shipped,
    step: shipped / 100,
  });

  // Surface-brightness zero point, mag/arcsec². A constant of the shared
  // emission unit (`../hdr/emission/emission-pure.ts`), not a calibration knob —
  // moving it desynchronises the band from the Local Group layer.
  body.appendChild(makeSlider({
    label: 'glowMagOffset',
    min: v.glowMagOffset - 5,
    max: v.glowMagOffset + 5,
    step: 0.1,
    initial: v.glowMagOffset,
    format: (x) => x.toFixed(1),
    onChange: (x) => layer.setGlowMagOffset(x),
  }));

  body.appendChild(makeSlider({
    ...span(v.discDensity),
    label: 'discDensity',
    initial: v.discDensity,
    format: (x) => x.toExponential(2),
    onChange: (x) => layer.setDiscDensity(x),
  }));

  body.appendChild(makeSlider({
    ...span(v.bulgeDensity),
    label: 'bulgeDensity',
    initial: v.bulgeDensity,
    format: (x) => x.toExponential(2),
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
