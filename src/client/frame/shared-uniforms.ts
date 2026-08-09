// The shared view/screen uniform map every render pass and downstream
// consumer holds by reference. See ./README.md.

import * as THREE from 'three';
import { ZOOM_FLOOR_FRACTION } from '../camera/controls/star-physics';
import {
  DEFAULT_FILTER,
  instrumentLimitMag,
  sizeSpanOf,
  STAR_RENDER_DEFAULTS,
} from '../filters/filter-state';
import { cullMagFor } from '../hdr/exposure/exposure-epoch';
import type { HdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { R_SUN_PC } from '../util/astronomy-constants';
import { makeColorLutTexture } from '../star-pipeline/blackbody-lut';
import type { PerceptualDiscUniforms } from '../star-pipeline/perceptual-disc-uniforms';
import { MIRROR_CAPACITY } from '../star-pipeline/local-pass/star-local-mirror';

export interface SharedUniformsOptions {
  pixelRatio: number;
  /** Camera vertical FOV in radians — mirrored from `camera.fov`
   *  whenever `setCameraFov` runs. */
  fovYRad: number;
  viewportW: number;
  viewportH: number;
  /** `HdrPipeline.emitterUniforms`, spread in by reference so the seam's
   *  exposure and target state reach all three passes with one write. */
  hdr: HdrEmitterUniforms;
}

export type SharedUniforms = ReturnType<typeof buildSharedUniforms>;

/**
 * Build the shared uniform map. All three star passes
 * point at the same value objects, so any filter / theme / resize write
 * propagates to every pass without duplicate bookkeeping; `uRenderMode`
 * is the only divergent uniform and `StarPipeline` binds it per
 * material. The planet body field and the Milky Way pass pick slots out
 * of the same map by reference for the same reason.
 */
export function buildSharedUniforms(opts: SharedUniformsOptions) {
  const baseLimitMag = instrumentLimitMag(DEFAULT_FILTER.instrument);
  return {
    // Exposure + the inline-operator branch. Owned by HdrPipeline, which
    // rewrites uHdrTarget whenever the seam, the resolve, or chart mode
    // changes; the star passes only read them.
    ...opts.hdr,
    uCameraPos: { value: new THREE.Vector3() },
    // The three magnitude bounds, all owned by ExposureController (it
    // rewrites them from its constructor, so these seeds only have to be
    // shape-correct): uLimitMag is the instrument's limit — the footprint
    // window, chart disc sizing and the MW chart isobar; uThresholdMag is
    // where a source lands on the just-visible floor, and is the taper
    // anchor; uCullMag is the static population bound the vertex stage
    // culls at. `../../hdr/exposure/README.md` § One writer, four slots.
    uLimitMag: { value: baseLimitMag },
    uThresholdMag: { value: baseLimitMag },
    uCullMag: { value: cullMagFor(baseLimitMag) },
    uMinDistSol: { value: DEFAULT_FILTER.minDistSol },
    uMaxDistSol: { value: DEFAULT_FILTER.maxDistSol },
    uSpectMask: { value: DEFAULT_FILTER.spectMask },
    uPixelRatio: { value: opts.pixelRatio },
    uSizeMin: { value: DEFAULT_FILTER.sizeMin },
    uSizeMax: { value: DEFAULT_FILTER.sizeMax },
    uSizeSpan: { value: sizeSpanOf(DEFAULT_FILTER) },
    uMonochrome: { value: 0 },
    // Chart-mode disc sizing. Pixel range + bright-end magnitude
    // reference; vertex shader uses these only when uMonochrome > 0.5.
    // The same constants are read JS-side by chart-labels.ts to size
    // variable rings + binary wings.
    uChartDiscMaxPx: { value: 28.0 },
    uChartDiscMinPx: { value: 1.5 },
    uChartMagBright: { value: -2.0 },
    uFovYRad: { value: opts.fovYRad },
    // Solar-radii → parsecs conversion for the physical-size formula.
    // catalog.physicalRadius is in solar radii; iLogRadius decodes back
    // to solar radii via pow(10, x); multiply by uRSunPc to get pc.
    uRSunPc: { value: R_SUN_PC },
    uViewport: { value: new THREE.Vector2(opts.viewportW, opts.viewportH) },
    // Peak-disc cap (mirrored to GLSL); single source of truth in the
    // TS-side ZOOM_FLOOR_FRACTION so the shader and the renderedSizePx
    // mirror clamp resolved discs to the same viewport fraction.
    uMaxPhysFrac: { value: ZOOM_FLOOR_FRACTION },
    // Variability clock. Pulsation runs on the model clock (getT()) at
    // real GCVS periods, so it responds to time-warp like binary orbits.
    // uModelDays is model time in days since J2000; uModelDaysPerRealSec
    // is the warp rate (model days per real second), which floors the
    // effective period via uMinPeriodSec so short-period variables can't
    // strobe under heavy warp. Updated per frame from getT() + the clock
    // rate.
    uModelDays: { value: 0 },
    uModelDaysPerRealSec: { value: 1 / 86400 },
    uMinPeriodSec: { value: 4.0 },

    // Star-disc rendering knobs (debug-panel tunable). See star.frag.glsl
    // for what each parameter shapes; defaults here are the calibrated
    // baseline that ships in production.
    uVisibleThreshold: { value: STAR_RENDER_DEFAULTS.visibleThreshold },
    uVisibleK: { value: -Math.log(STAR_RENDER_DEFAULTS.visibleThreshold) },
    uCoreThreshold: { value: STAR_RENDER_DEFAULTS.coreThreshold },
    uDiscardThreshold: { value: STAR_RENDER_DEFAULTS.discardThreshold },
    uDistNMin: { value: STAR_RENDER_DEFAULTS.distNMin },
    uDistNMax: { value: STAR_RENDER_DEFAULTS.distNMax },
    uLumBiasMin: { value: STAR_RENDER_DEFAULTS.lumBiasMin },
    uLumBiasMax: { value: STAR_RENDER_DEFAULTS.lumBiasMax },
    uSizeKnee: { value: STAR_RENDER_DEFAULTS.sizeKnee },

    // Interstellar-dust extinction. Off by default (uDustEnabled = 0) —
    // attachDust() wires in the Data3DTexture progressively as chunks
    // arrive from the network and bumps uDustEnabled to 1 once the
    // texture is GPU-resident. A separate uExtinctionStrength is a
    // user-facing knob (0 = off, 1 = realism, >1 = amplified).
    //
    // The shader reconstructs absolute positions via iPosition +
    // uWorldOffset / uCameraPos + uWorldOffset, then raymarches through
    // the dust texture in ICRS heliocentric pc to integrate A_V.
    uDustTexture: { value: null as THREE.Data3DTexture | null },
    uDustBoundsPc: { value: 1250.0 },
    // Log-window decode: density = uDustDensityMin * exp(sample * uDustLogRatio).
    // Defaults are overwritten by attachDust() with the manifest's
    // autotuned range; this placeholder avoids divide-by-zero if the
    // shader runs before dust attaches.
    uDustDensityMin: { value: 1e-7 },
    uDustLogRatio: { value: Math.log(1e3) },
    uDustAvPerDensityPc: { value: 2.742 },
    uDustEnabled: { value: 0.0 },
    uExtinctionStrength: { value: 1.0 },
    uWorldOffset: { value: new THREE.Vector3() },
    // Per-star A_V prepass consumers — owned by ExtinctionPrepass
    // (constructed on attachDust); the vertex shader falls back to the
    // in-vertex raymarch while uAvPrepassEnabled is 0.
    uAvPrepassTex: { value: null as THREE.Texture | null },
    uAvPrepassEnabled: { value: 0.0 },
    // OBSERVE-mode focal-star suppression. Set to the focused-star catalog
    // index when the camera is parked on it; -1 disables the gate. All
    // three star passes (disc, glow, core mask) share these uniforms so
    // the suppression fires uniformly.
    uHideFocusIdx: { value: -1 },
    // Member stars of the active local-depth clusters; a member's
    // main-pass instance collapses and the pass's mirror draws render
    // it. Written per frame by StarLocalCluster.update. -1 = empty slot.
    uLocalMemberIdx: { value: new Int32Array(MIRROR_CAPACITY).fill(-1) },
    // Blackbody → sRGB lookup for the star vertex shader's ciToColor.
    // See docs/science-stellar-modelling.md § "Star colour calibration".
    uColorLut: { value: makeColorLutTexture() },
    // Force-center the focused star at NDC (0,0). At the close-approach
    // orbit floor (~5×10⁻⁸ pc for Sol-class stars), float32 cancellation
    // in projectionMatrix * modelViewMatrix * (0,0,0,1) can drift the
    // projected center by visible pixels even though the star is
    // mathematically at view-origin (controls.target = star, lookAt
    // aligns -Z with target). This uniform names the instance to pin;
    // the shader replaces its centreClip with projectionMatrix *
    // (0, 0, -distCam, 1) to bypass the cancellation. -1 disables.
    // Updated each frame in animate() since pan can move target away.
    uPinFocusToCenter: { value: -1 },
  } satisfies PerceptualDiscUniforms & Record<string, THREE.IUniform>;
}
