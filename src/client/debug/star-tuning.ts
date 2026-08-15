import type { Stellata } from '../stellata';
import { type DebugSection, makeMonoReadout, makeSlider } from './debug-panel';

// Dev-only tuning section for star-disc rendering. Each slider drives one
// uniform on the shared star material. Defaults match the production
// values; pulling sliders gives an immediate visual sweep.
//
// See star.frag.glsl for what each uniform shapes — comments there are
// the source of truth. Slider ranges are conservative envelopes around
// values that produce sensible visuals; nothing crashes outside them, but
// extremes (e.g. lumBias < 0.3) start to look cartoony.
//
// No reverse sync — see `SliderOpts.initial` in debug-panel.ts.

export function buildStarSection(stellata: Stellata): DebugSection {
  const body = document.createElement('div');
  const v = stellata.filters.getStarRenderParams();

  // Derived-K readout. K is a product of instrument density, the
  // multiplier slider and the live plate scale, so the slider value alone
  // doesn't tell you what the stars are actually being drawn at.
  const kReadout = makeMonoReadout('margin-bottom:8px;');
  body.appendChild(kReadout);

  let visible = true;
  let last = '';
  const onFrame = () => {
    if (!visible) return;
    const f = stellata.filters.getFilter();
    const text =
      `K ${stellata.filters.getStarExaggerationK().toFixed(3)}`
      + `  (×${stellata.filters.getStarKMultiplier().toFixed(2)} slider)\n`
      + `plate ${stellata.filters.getArcsecPerPx().toFixed(2)}″/px`
      + `  fov ${stellata.filters.getCameraFov().toFixed(1)}°\n`
      + `sizeMin ${f.sizeMin.toFixed(2)}px  sizeMax ${f.sizeMax.toFixed(2)}px`;
    if (text === last) return;
    last = text;
    kReadout.textContent = text;
  };
  onFrame();
  const unsubscribe = stellata.on('frame', onFrame);

  body.appendChild(makeSlider({
    label: 'visibleThreshold',
    min: 0.02,
    max: 0.40,
    step: 0.005,
    initial: v.visibleThreshold,
    format: (x) => x.toFixed(3),
    onChange: (x) => stellata.filters.setStarRenderParams({ visibleThreshold: x }),
  }));

  body.appendChild(makeSlider({
    label: 'coreThreshold',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    initial: v.coreThreshold,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.filters.setStarRenderParams({ coreThreshold: x }),
  }));

  body.appendChild(makeSlider({
    label: 'discardThreshold',
    min: 0.0,
    max: 0.20,
    step: 0.005,
    initial: v.discardThreshold,
    format: (x) => x.toFixed(3),
    onChange: (x) => stellata.filters.setStarRenderParams({ discardThreshold: x }),
  }));

  body.appendChild(makeSlider({
    label: 'distN min (distant)',
    min: 1.0,
    max: 5.0,
    step: 0.1,
    initial: v.distNMin,
    format: (x) => x.toFixed(1),
    onChange: (x) => stellata.filters.setStarRenderParams({ distNMin: x }),
  }));

  body.appendChild(makeSlider({
    label: 'distN max (close)',
    min: 2.0,
    max: 10.0,
    step: 0.1,
    initial: v.distNMax,
    format: (x) => x.toFixed(1),
    onChange: (x) => stellata.filters.setStarRenderParams({ distNMax: x }),
  }));

  body.appendChild(makeSlider({
    label: 'lumBias dwarf',
    min: 0.5,
    max: 1.5,
    step: 0.05,
    initial: v.lumBiasMin,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.filters.setStarRenderParams({ lumBiasMin: x }),
  }));

  body.appendChild(makeSlider({
    label: 'lumBias hypergiant',
    min: 0.3,
    max: 1.0,
    step: 0.05,
    initial: v.lumBiasMax,
    format: (x) => x.toFixed(2),
    onChange: (x) => stellata.filters.setStarRenderParams({ lumBiasMax: x }),
  }));

  // Soft-knee saturation extent (magnitudes). 0 = hard cap on appSize at
  // Δm = uSizeSpan (legacy); higher values stretch the curve so very
  // bright stars (Sol from inside its own neighborhood, focused-star
  // close approach) keep growing before saturating. See uSizeKnee in
  // star.vert.glsl for the exact formula.
  body.appendChild(makeSlider({
    label: 'sizeKnee (sat. extent, mag)',
    min: 0,
    max: 48,
    step: 1,
    initial: v.sizeKnee,
    format: (x) => x.toFixed(0),
    onChange: (x) => stellata.filters.setStarRenderParams({ sizeKnee: x }),
  }));

  return {
    element: body,
    dispose: () => { unsubscribe(); },
    setVisible: (visibleNow: boolean) => { visible = visibleNow; },
  };
}
