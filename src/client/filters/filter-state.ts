// Filter / magnitude-preset / star-render-knob state: types, defaults,
// and the preset derivation math. See src/client/filters/README.md.

import type { CoordSphereFrame } from '../galactic/coord-sphere';
import type { DetailLevel } from '../scene/scene-elements';

export type MagPresetName = 'naked-eye' | 'binoculars' | 'all';

export interface FilterState {
  minDistSol: number;
  maxDistSol: number;
  maxAppMag: number;
  spectMask: number;
  highlightCon: number; // -1 = none; consumed by overlay, not shader
  sizeMin: number;      // CSS pixels — set from the active preset's angular
  sizeMax: number;      // size at the current viewport, or by manual slider.
  sizeSpan: number;
  // Active magnitude preset. Drives preset-defaults behaviour when the
  // viewport resizes — non-overridden size fields recompute against this
  // preset's angular targets so stars stay proportional to the scene
  // (especially the Milky Way disc) regardless of screen size.
  activePreset: MagPresetName;
  // Manual-override flags for the size sliders. Set by slider input,
  // cleared by the corresponding reset button (which also re-applies the
  // active preset's value). When false, the preset writes its computed
  // pixel value into the field on each preset switch and viewport resize.
  sizeMinOverridden: boolean;
  sizeMaxOverridden: boolean;
  sizeSpanOverridden: boolean;
  // Master visibility for constellation stick figures. When false the
  // overlay draws nothing regardless of `highlightCon` (which is preserved
  // so re-enabling restores the prior selection); the picker UI is also
  // disabled and the C shortcut is suppressed by their own gates.
  showConstellation: boolean;
  // Which coordinate sphere is up (grid lines on a 50 kpc sphere) — galactic
  // l/b, equatorial RA/Dec, or none. Mutually exclusive by construction; the
  // equatorial one additionally self-hides away from Sol. The galactic disc is
  // always-on (fades by zoom) so it isn't gated here.
  coordSphere: CoordSphereFrame;
  // HUD: Sol/GC locator arrows in both navigate + observe modes, plus the
  // OBSERVE-mode screen-centred ring. Future HUD widgets hang off this flag.
  showHud: boolean;
  // Milky Way analytic background. Default-on; chart mode switches to
  // outline-only rendering on this same toggle.
  showMilkyway: boolean;
  // Local Group volumetric emission. Default-on; chart mode hides the
  // layer independently of this toggle.
  showLgEmission: boolean;
  // Star chart mode. Only meaningful while cameraMode==='observe';
  // chart-mode orchestrator (chart-mode.ts) ignores it otherwise. Drives
  // the paper-aesthetic palette, label rendering, isobar outlines on
  // cloud / milkyway, and flat-disc star rendering.
  chart: boolean;
  // Declutter cycle: how much of the scene is drawn within the current
  // render style. Cumulative physical<representational<all; the floor
  // table + derivation live in scene/scene-elements.ts. Default 'all' so
  // a fresh scene draws everything (fully cluttered).
  detailLevel: DetailLevel;
}

export const ALL_SPECT_MASK = 0b111111111;

// Star size physics — see docs/science-stellar-modelling.md § Stellar perception model.
// STAR_PHYSICS_FACTOR = 2·ln(10)/2.5. Per-preset starExaggerationK
// is tunable via Stellata.setStarExaggerationK (debug panel).
export const STAR_PSF_ARCSEC = 30;
export const STAR_PHYSICS_FACTOR = 1.84;
export const STAR_EXAGGERATION_K_DEFAULTS: Record<MagPresetName, number> = {
  'naked-eye':  12,
  'binoculars': 9,
  'all':        5,
};
let starExaggerationK: Record<MagPresetName, number> = { ...STAR_EXAGGERATION_K_DEFAULTS };

// Star-disc rendering knobs. Defaults shipped to production; debug panel
// can sweep each one independently for visual calibration. See
// star.frag.glsl for the meaning of each value — the doc lives there
// alongside the math that consumes it.
export interface StarRenderParams {
  visibleThreshold: number;
  coreThreshold: number;
  discardThreshold: number;
  distNMin: number;
  distNMax: number;
  lumBiasMin: number;
  lumBiasMax: number;
  // Soft-knee saturation extent (magnitudes) for the Gaussian-PSF disc
  // size formula. See uSizeKnee comment in star.vert.glsl. 0 = hard cap
  // (legacy behaviour); larger values let bright stars keep growing
  // before saturating. 16 lands ~43% size advantage for Sol over Sirius
  // when standing at the unfocused floor inside the solar system.
  sizeKnee: number;
}
export const STAR_RENDER_DEFAULTS: StarRenderParams = {
  visibleThreshold: 0.2,
  coreThreshold: 0.4,
  discardThreshold: 0.02,
  distNMin: 2.2,
  distNMax: 10.0,
  lumBiasMin: 1.0,
  lumBiasMax: 0.6,
  sizeKnee: 16,
};

export interface MagPreset {
  maxAppMag: number;
  sizeSpan: number;
  sizeMinArcsec: number;
  sizeMaxArcsec: number;
}

/** Naked-eye limiting magnitude (Bortle-1 dark sky) — the app-default
 *  sensitivity. Safe to import as a scalar where the MAG_PRESETS live
 *  binding must not be captured at module load. */
export const NAKED_EYE_LIMIT_MAG = 6.5;

// Static portion of each preset — the magnitude limit and dynamic range
// don't depend on the exaggeration constant. sizeMinArcsec / sizeMaxArcsec
// are recomputed from the current K via computeMagPresets().
const PRESET_BASE: Record<MagPresetName, { maxAppMag: number; sizeSpan: number }> = {
  // Magnitudes: binoculars 10.5 (typical 7×50 dark sky); all 15
  // (matches the catalog/UI slider ceiling).
  'naked-eye':  { maxAppMag: NAKED_EYE_LIMIT_MAG, sizeSpan: 8 },
  'binoculars': { maxAppMag: 10.5, sizeSpan: 12 },
  'all':        { maxAppMag: 15,   sizeSpan: 17 },
};

function computeMagPresets(): Record<MagPresetName, MagPreset> {
  const result = {} as Record<MagPresetName, MagPreset>;
  for (const name of Object.keys(PRESET_BASE) as MagPresetName[]) {
    const base = PRESET_BASE[name];
    const sizeMinArcsec = STAR_PSF_ARCSEC * starExaggerationK[name];
    result[name] = {
      ...base,
      sizeMinArcsec,
      sizeMaxArcsec: sizeMinArcsec * Math.sqrt(STAR_PHYSICS_FACTOR * base.sizeSpan),
    };
  }
  return result;
}

// Live binding — re-bound by setStarExaggerationK so consumers reading
// MAG_PRESETS see the latest values after a K tweak.
export let MAG_PRESETS: Record<MagPresetName, MagPreset> = computeMagPresets();

export function getStarExaggerationK(name: MagPresetName): number {
  return starExaggerationK[name];
}

/** Patch the exaggeration constant for one preset and re-derive
 *  MAG_PRESETS (size targets scale with K). */
export function setStarExaggerationK(name: MagPresetName, k: number): void {
  starExaggerationK[name] = k;
  MAG_PRESETS = computeMagPresets();
}

/** Test hook — restore the default K record and re-derive MAG_PRESETS
 *  so K tweaks can't leak across vitest cases. */
export function resetStarExaggerationK(): void {
  starExaggerationK = { ...STAR_EXAGGERATION_K_DEFAULTS };
  MAG_PRESETS = computeMagPresets();
}

// Default vertical FOV (degrees). User-tunable via the FOV slider; the
// reset button snaps back to this value.
export const DEFAULT_FOV = 50;

export const DEFAULT_FILTER: FilterState = {
  minDistSol: 0,
  maxDistSol: 50_000,
  maxAppMag: MAG_PRESETS['naked-eye'].maxAppMag,
  spectMask: ALL_SPECT_MASK,
  highlightCon: -1,
  // sizeMin/Max placeholders — applyMagnitudePreset is called from the
  // constructor with the actual viewport to fill in real values, and again
  // on every viewport resize.
  sizeMin: 1.8,
  sizeMax: 7.0,
  sizeSpan: MAG_PRESETS['naked-eye'].sizeSpan,
  activePreset: 'naked-eye',
  sizeMinOverridden: false,
  sizeMaxOverridden: false,
  sizeSpanOverridden: false,
  showConstellation: true,
  coordSphere: 'none',
  showHud: false,
  showMilkyway: true,
  showLgEmission: true,
  chart: false,
  detailLevel: 'all',
};

// Convert a preset's angular size targets to CSS pixels for a camera FOV
// (degrees, vertical) and reference viewport dimension. Callers pass the
// *larger* viewport dimension as `refDim` — Three.js's camera.fov is the
// vertical FOV, but tying calibration to height alone makes stars vanish
// on landscape mobile (height = 390 px) while feeling right on desktops
// (height = 1080 px). Scaling by max(w, h) gives a consistent absolute
// pixel size regardless of orientation, at the cost of strict angular
// fidelity in the secondary axis. 1-px floor on sizeMin since a sub-pixel
// disc renders as nothing — and the same floor on sizeMax so it never
// falls below sizeMin. (At low exaggeration K both raw values can be
// sub-pixel; without the symmetric floor the saturation disc would
// invert below the threshold disc.)
export function presetPxSizes(
  name: MagPresetName,
  fovDeg: number,
  refDim: number,
): { sizeMinPx: number; sizeMaxPx: number } {
  const p = MAG_PRESETS[name];
  const arcsecPerPx = (fovDeg * 3600) / refDim;
  const minPx = Math.max(1.0, p.sizeMinArcsec / arcsecPerPx);
  return {
    sizeMinPx: minPx,
    sizeMaxPx: Math.max(minPx, p.sizeMaxArcsec / arcsecPerPx),
  };
}
