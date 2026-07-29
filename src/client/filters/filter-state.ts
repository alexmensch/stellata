// Observing-instrument records, filter state, and the plate-scale star
// size derivation. See src/client/filters/README.md.

import type { CoordSphereFrame } from '../galactic/coord-spheres/coord-sphere';
import type { DetailLevel } from '../scene/scene-elements';

export type InstrumentName = 'unaided-eye';

/**
 * An observing instrument: aperture plus the data aperture cannot
 * supply. Everything a renderer reads off it is either a field here or
 * derived from one — `docs/science-hdr-pipeline.md` § 3.4.
 */
export interface Instrument {
  apertureMm: number;
  defaultFovDeg: number;
  /** PSF width on the sky. */
  psfArcsec: number;
  /** Crowding half of the exaggeration K, NOT the shipped 12/9/5 —
   *  the plate-scale half is derived per frame by `starPxSizes`. */
  kDensity: number;
  /** Footprint dynamic range, magnitudes. */
  sizeSpan: number;
  /** No consumer yet — § 3.4's two remaining preset axes. */
  skyBackgroundMagArcsec2: number;
  passband: 'V';
}

// The reference observer: a 7 mm dark-adapted pupil reaching m 7.8 in
// vacuum under a Bortle-1 sky. Aperture and limit are anchored together
// because σ = 30″ is derived at that same pupil.
const EYE_APERTURE_MM = 7;
const EYE_LIMIT_MAG = 7.8;

/** Limiting magnitude from aperture — collecting area goes as D², so
 *  every doubling of aperture buys 1.5 magnitudes. */
export function limitMagForAperture(apertureMm: number): number {
  return EYE_LIMIT_MAG + 5 * Math.log10(apertureMm / EYE_APERTURE_MM);
}

export const INSTRUMENTS: Record<InstrumentName, Instrument> = {
  'unaided-eye': {
    apertureMm: EYE_APERTURE_MM,
    defaultFovDeg: 50,
    psfArcsec: 30,
    kDensity: 1,
    sizeSpan: 8,
    skyBackgroundMagArcsec2: 22,
    passband: 'V',
  },
};

export const DEFAULT_INSTRUMENT: InstrumentName = 'unaided-eye';

export function instrumentLimitMag(name: InstrumentName): number {
  return limitMagForAperture(INSTRUMENTS[name].apertureMm);
}

/** Convenience for the CPU mirrors that read the limit off filter state
 *  rather than off the shader uniform. */
export function limitMagOf(f: Pick<FilterState, 'instrument'>): number {
  return instrumentLimitMag(f.instrument);
}

export interface FilterState {
  minDistSol: number;
  maxDistSol: number;
  spectMask: number;
  highlightCon: number; // -1 = none; consumed by overlay, not shader
  sizeMin: number;      // CSS pixels — set from the instrument's angular
  sizeMax: number;      // size at the current viewport, or by manual slider.
  sizeSpan: number;
  // The observing instrument. Drives the limiting magnitude, the
  // exposure anchor, the footprint window, and the recompute of
  // non-overridden size fields on viewport resize.
  instrument: InstrumentName;
  // Manual-override flags for the size sliders. Set by slider input,
  // cleared by the corresponding reset button (which also re-applies the
  // instrument's derived value). When false, the derivation writes its
  // computed pixel value into the field on each viewport resize.
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

// Star size physics — see docs/science-stellar-modelling.md § Stellar
// perception model. STAR_PHYSICS_FACTOR = 2·ln(10)/2.5.
export const STAR_PHYSICS_FACTOR = 1.84;

/** Pixel size a threshold star lands on, at every FOV and every
 *  viewport height — the one number that moves absolute star size.
 *  Calibrated by eye against the real sky (docs/science-stellar-modelling.md
 *  § Stellar perception model), not derived. */
export const TARGET_PX = 2.592;

// Debug-panel multiplier on the derived exaggeration K. 1 = the
// plate-scale derivation untouched.
export const STAR_K_MULTIPLIER_DEFAULT = 1;

/** Multiplier slider bounds, kept symmetric about
 *  `STAR_K_MULTIPLIER_DEFAULT` so the calibrated value sits mid-track and
 *  a drag either way reads as an equal-sized departure from it. */
export const STAR_K_MULTIPLIER_MIN = 0.5;
export const STAR_K_MULTIPLIER_MAX = 1.5;
export const STAR_K_MULTIPLIER_STEP = 0.05;
let starKMultiplier = STAR_K_MULTIPLIER_DEFAULT;

export function getStarKMultiplier(): number { return starKMultiplier; }
export function setStarKMultiplier(m: number): void { starKMultiplier = m; }
/** Test hook — K tweaks must not leak across vitest cases. */
export function resetStarKMultiplier(): void {
  starKMultiplier = STAR_K_MULTIPLIER_DEFAULT;
}

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

// Default vertical FOV (degrees). User-tunable via the FOV slider; the
// reset button snaps back to this value.
export const DEFAULT_FOV = INSTRUMENTS[DEFAULT_INSTRUMENT].defaultFovDeg;

export const DEFAULT_FILTER: FilterState = {
  minDistSol: 0,
  maxDistSol: 50_000,
  spectMask: ALL_SPECT_MASK,
  highlightCon: -1,
  // sizeMin/Max placeholders — recomputeStarPxSizes is called from the
  // constructor with the actual viewport to fill in real values, and again
  // on every viewport resize.
  sizeMin: 1.8,
  sizeMax: 7.0,
  sizeSpan: INSTRUMENTS[DEFAULT_INSTRUMENT].sizeSpan,
  instrument: DEFAULT_INSTRUMENT,
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

/** Arcsec one CSS pixel of viewport HEIGHT subtends — the axis
 *  `camera.fov` maps to, and the axis `physSize` and `Ω_px` project
 *  through. */
export function arcsecPerPx(fovDeg: number, viewportHeightPx: number): number {
  return (fovDeg * 3600) / viewportHeightPx;
}

/** The exaggeration K: the factor that lands a threshold star on
 *  TARGET_PX, floored at 1 where the true PSF already resolves. */
export function starExaggerationK(
  name: InstrumentName,
  arcsecPx: number,
  kMultiplier = getStarKMultiplier(),
): number {
  const inst = INSTRUMENTS[name];
  return inst.kDensity * kMultiplier
    * Math.max(1, (TARGET_PX * arcsecPx) / inst.psfArcsec);
}

/**
 * Threshold and saturation disc sizes in CSS pixels. `sizeMinPx` is
 * TARGET_PX identically until K floors at 1, past which the true PSF
 * resolves and the disc grows with the plate scale. 1-px floor on
 * sizeMin since a sub-pixel disc renders as nothing — and the same floor
 * on sizeMax so it never falls below sizeMin (at K = 1 and a narrow FOV
 * both raw values can be sub-pixel, and without the symmetric floor the
 * saturation disc would invert below the threshold disc).
 */
export function starPxSizes(
  name: InstrumentName,
  fovDeg: number,
  viewportHeightPx: number,
  kMultiplier = getStarKMultiplier(),
): { sizeMinPx: number; sizeMaxPx: number } {
  const inst = INSTRUMENTS[name];
  const arcsecPx = arcsecPerPx(fovDeg, viewportHeightPx);
  const sizeMinArcsec = inst.psfArcsec * starExaggerationK(name, arcsecPx, kMultiplier);
  const sizeMaxArcsec = sizeMinArcsec * Math.sqrt(STAR_PHYSICS_FACTOR * inst.sizeSpan);
  const minPx = Math.max(1.0, sizeMinArcsec / arcsecPx);
  return {
    sizeMinPx: minPx,
    sizeMaxPx: Math.max(minPx, sizeMaxArcsec / arcsecPx),
  };
}
