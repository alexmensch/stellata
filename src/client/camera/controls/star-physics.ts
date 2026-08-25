// Per-star camera/screen-geometry helpers — catalog-indexed wrappers
// over `star-geometry.ts` primitives + `../focus/focus-transition.ts`
// `parkDistance`. See src/client/camera/controls/README.md.

import * as THREE from 'three';
import type { Catalog } from '../../loaders/catalog-loader';
import { limitMagOf, sizeSpanOf, type FilterState } from '../../filters/filter-state';
import {
  physSizePx,
  distAtFillFraction,
  peakAmplitudeFactor as peakAmplitudeFactorPrim,
} from './star-geometry';
import { parkDistance } from '../focus/focus-transition';
import { R_SUN_PC, MIN_PHYSICAL_RADIUS_R_SUN } from '../../util/astronomy-constants';
import { DCAM_LOG_FLOOR_PC } from '../timing';
import { apparentMagnitude } from '../../solar-system/perceptual-magnitude';
import {
  perceptualAppSizePx,
  perceptualDmEff,
} from '../../star-pipeline/perceptual-disc/perceptual-disc-pure';
import type { ChartDiscParams } from '../../chart-mode/chart-disc-pure';

// Target screen-fill fraction of the viewport minor axis at the manual-
// zoom orbit floor. The shader reads this as `uMaxPhysFrac` and clamps
// the per-star disc to it; the auto-park calibration uses the same value
// so a star's pulse peak lands at exactly this fraction at closest
// approach. Hoisted here so stellata.ts seeds the uniform from the same
// constant the orbit-floor + park-distance math reads.
export const ZOOM_FLOOR_FRACTION = 0.9;

// Subset of the star-shader uniforms read by renderedSizePx /
// renderedDiscPxAtPeak. The fields shape-match `THREE.IUniform<T>` so
// callers pass `material.uniforms` directly under a typed assertion.
export interface StarPhysicsUniforms {
  uFovYRad: { value: number };
  uViewport: { value: THREE.Vector2 };
  uModelDays: { value: number };
  uModelDaysPerRealSec: { value: number };
  uMinPeriodSec: { value: number };
  uSizeKnee: { value: number };
}

// Subset consumed by getChartDiscParams.
export interface ChartDiscUniforms {
  uChartDiscMaxPx: { value: number };
  uChartDiscMinPx: { value: number };
  uChartMagBright: { value: number };
}

// Smaller of the camera's vertical and horizontal FOV in radians. The
// disc-fill geometry uses the minor axis so the target fraction reads
// consistently in both portrait and landscape viewports.
export function fovMinorRad(camera: THREE.PerspectiveCamera): number {
  const fovY = (camera.fov * Math.PI) / 180;
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
  return Math.min(fovX, fovY);
}

// Peak-amplitude radius factor for a catalog row. The disc swing peaks at
// `radiusFactor = √ρ` (ρ = per-type peak-to-peak ratio, from the catalog
// pulsation table). Returns 1 for non-variables (period = 0 or amplitude
// = 0). Feeds the orbit floor and parking distance so the pulse peak (not
// the static R) hits ZOOM_FLOOR_FRACTION at closest approach and the
// navigate-mode arrow fade reads a phase-stable disc envelope.
export function peakAmplitudeFactor(catalog: Catalog, idx: number): number {
  return peakAmplitudeFactorPrim(
    catalog.pulsRho[idx],
    catalog.amplitudeMag[idx],
    catalog.periodDays[idx],
  );
}

export interface ParkArgs {
  catalog: Catalog;
  idx: number;
  /** Pre-computed via `fovMinorRad(camera)` so callers can amortise the
   *  conversion across multiple stars in the same frame. */
  fovMinorRad: number;
}

// Manual-zoom floor for TrackballControls when a star is focused. The
// camera can orbit down to where the focused star's true angular disc
// fills ZOOM_FLOOR_FRACTION of the viewport's minor axis — same on-
// screen coverage for any star, regardless of physical radius. For
// variables, R is bumped to peak-amplitude so the pulse peak hits
// ZOOM_FLOOR_FRACTION and the trough is correspondingly smaller, rather
// than the static R hitting the floor and the peak overshooting the
// viewport.
export function minOrbitDistForStar(args: ParkArgs): number {
  const R = Math.max(args.catalog.physicalRadius[args.idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC;
  const Reff = R * peakAmplitudeFactor(args.catalog, args.idx);
  return distAtFillFraction(Reff, args.fovMinorRad, ZOOM_FLOOR_FRACTION);
}

// Auto-park target — composed from the generic `parkDistance` primitive
// with star-specific inputs: Reff = R · peakAmplitudeFactor (variables
// park clear of their pulse peak) and the 90 %-fill manual-zoom floor
// as dMinFloor. Result is "1 AU outside the surface, but never closer
// than dMin."
export function parkDistForStar(args: ParkArgs): number {
  const R = Math.max(args.catalog.physicalRadius[args.idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC;
  const Reff = R * peakAmplitudeFactor(args.catalog, args.idx);
  const dMinFloor = distAtFillFraction(Reff, args.fovMinorRad, ZOOM_FLOOR_FRACTION);
  return parkDistance({ R_pc: Reff, dMinFloor });
}

// Screen-fill fraction of the viewport minor axis at a focused planet's
// auto-park pose. A star parks 1 AU outside its surface (parkDistance's
// AU term) because its brightness carries the arrival; a planet is a
// dim reflected-light body, so the park is purely angular — close
// enough that the disc reads as a world, far enough to keep context.
export const PLANET_PARK_FILL_FRACTION = 0.3;

// Manual-zoom floor for a focused planet — same 90 %-fill angular solve
// as minOrbitDistForStar, keyed on the body's equatorial radius (~2.4 R
// at the default FOV; ~15 000 km camera-to-centre for Earth).
export function minOrbitDistForPlanet(radiusPc: number, fovMinorRad: number): number {
  return distAtFillFraction(radiusPc, fovMinorRad, ZOOM_FLOOR_FRACTION);
}

// Auto-park target for a focused planet (~7.6 R at the default FOV —
// Earth from ~48 000 km). Never inside the manual-zoom floor by
// construction (fill fractions are ordered).
export function parkDistForPlanet(radiusPc: number, fovMinorRad: number): number {
  return distAtFillFraction(radiusPc, fovMinorRad, PLANET_PARK_FILL_FRACTION);
}

export interface RenderedSizeArgs {
  catalog: Catalog;
  idx: number;
  camPos: Readonly<THREE.Vector3>;
  localPositions: Float32Array;
  uniforms: StarPhysicsUniforms;
  filter: Readonly<FilterState>;
  /** Per-instance pulsation-suppress flag mirroring the shader's
   *  `iSuppressPulsation` attribute. When the corresponding slot is
   *  `1.0` the SVG overlay reads the static (un-modulated) disc size
   *  so it tracks the rendered disc on eclipsing binaries whose
   *  pulsation has been gated off. Optional — call sites without
   *  access to the runtime suppress array fall through to the
   *  unsuppressed behaviour. */
  suppressPulsation?: Float32Array;
  /** Dust extinction to fold into the magnitude, as the shader does.
   *  Omitted by the overlay consumers (focus ring, distance-vector tip),
   *  which track a star the user is already looking at and would pay a
   *  GPU readback per frame for a sub-pixel size change. The pick paths
   *  pass it: there the dust term decides whether the star is on screen
   *  at all (`../../hdr/exposure/emitter-visibility-pure.ts`). */
  extinctionAvMag?: number;
}

/** The GCVS amplitude the vertex shader will actually swing this star
 *  by — zero wherever `iSuppressPulsation` gates the pulsation block off
 *  (`../../star-pipeline/star.vert.glsl`). Every CPU mirror of that gate
 *  routes through here: the disc-size mirror below, and the pick path's
 *  bright-extreme reach. Two mirrors of one shader gate is how the two
 *  came to disagree over 1,342 eclipsing rows. */
export function activePulsationAmp(
  catalog: Pick<Catalog, 'periodDays' | 'amplitudeMag'>,
  idx: number,
  suppressPulsation?: Float32Array | null,
): number {
  const amp = catalog.amplitudeMag[idx];
  if (catalog.periodDays[idx] <= 0 || amp <= 0) return 0;
  return suppressPulsation && suppressPulsation[idx] > 0.5 ? 0 : amp;
}

/** The perceptual, brightness-driven half of a star's quad size in px.
 *  Split out of `renderedSizeComponents` because the pick path re-solves
 *  it at the eclipse-dimmed magnitude: `star.vert.glsl` folds the dim into
 *  `appMag` before deriving `pxSize`, so a dimmed star draws a smaller
 *  quad and the pick radius has to follow. */
export function appSizePxForMag(
  appMag: number,
  filter: Readonly<FilterState>,
  sizeKnee: number,
): number {
  const sizeSpan = sizeSpanOf(filter);
  const dMEff = perceptualDmEff(appMag, limitMagOf(filter), sizeSpan, sizeKnee);
  return perceptualAppSizePx(dMEff, filter.sizeMin, filter.sizeMax, sizeSpan);
}

export interface RenderedSizeComponents {
  /** Apparent magnitude incl. the pulsation modulation, and the dust
   *  term only when the caller supplied `extinctionAvMag`. */
  appMag: number;
  appSizePx: number;
  physSizePx: number;
  /** `physSizePx` BEFORE the viewport-fraction up-clamp. star.vert.glsl
   *  divides the point-source peak by the true angular radius and clamps
   *  only afterwards, so a visibility mirror must take this one — the
   *  clamped value over-brightens a star at the zoom floor. */
  physSizePxUncapped: number;
}

// The two size terms behind the GPU-rendered quad size — the CPU mirror
// of star.vert.glsl's `max(appSize, physSize)` sizing. Consumers that
// need the disc/glow pass split (physSize vs appSize dominance) read the
// components; everything sizing against the rendered disc edge takes the
// max via `renderedSizePx`. If the shader's size computation changes,
// this must change in lockstep.
export function renderedSizeComponents(
  args: RenderedSizeArgs,
  out: RenderedSizeComponents,
): RenderedSizeComponents {
  const { catalog, idx, camPos, localPositions, uniforms: u, filter } = args;
  const { physicalRadius, absmag } = catalog;

  const dx = localPositions[idx * 3] - camPos.x;
  const dy = localPositions[idx * 3 + 1] - camPos.y;
  const dz = localPositions[idx * 3 + 2] - camPos.z;
  const dCam = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), DCAM_LOG_FLOOR_PC);
  let appMag = apparentMagnitude(absmag[idx], dCam) + (args.extinctionAvMag ?? 0);

  const fovYRad = u.uFovYRad.value;
  const viewport = u.uViewport.value;
  const R = Math.max(physicalRadius[idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC;
  const maxPhysSize = ZOOM_FLOOR_FRACTION * Math.min(viewport.x, viewport.y);

  let radiusFactor = 1;
  const amp = activePulsationAmp(catalog, idx, args.suppressPulsation);
  if (amp > 0) {
    // Mirror star.vert.glsl: model-clock phase (days since J2000) with the
    // uMinPeriodSec anti-strobe floor, φ = 0 = maximum light (cos).
    // magMod carries the full V-band amplitude; radiusFactor swings the
    // ρ-bounded disc with its minimum at maximum light (negative exponent).
    const periodDaysEff = Math.max(
      catalog.periodDays[idx],
      u.uModelDaysPerRealSec.value * u.uMinPeriodSec.value,
    );
    const phaseRaw = u.uModelDays.value / periodDaysEff;
    const phase = phaseRaw - Math.floor(phaseRaw); // fract, mirroring the shader
    const c = Math.cos(2 * Math.PI * phase);

    const magMod = -0.5 * amp * c;
    appMag += magMod;
    radiusFactor = Math.pow(catalog.pulsRho[idx], -0.5 * c);
  }

  // Same perceptualDmEff soft-knee + √Δm curve as star.vert.glsl — the
  // shared CPU mirrors in solar-system/perceptual-magnitude.ts. A local
  // reimplementation here previously hard-clamped brightness at sizeMax
  // and undersized the focus ring / pick radius on the brightest stars.
  const appSize = appSizePxForMag(appMag, filter, u.uSizeKnee.value);

  // Up-clamp physSize to the viewport fraction, mirroring star.vert.glsl.
  const physSizeTrue = physSizePx(R, dCam, viewport.y, fovYRad, radiusFactor);
  out.appMag = appMag;
  out.appSizePx = appSize;
  out.physSizePx = Math.min(physSizeTrue, maxPhysSize);
  out.physSizePxUncapped = physSizeTrue;
  return out;
}

const sizeScratch: RenderedSizeComponents =
  { appMag: 0, appSizePx: 0, physSizePx: 0, physSizePxUncapped: 0 };

// Rendered quad diameter (px) — `max(appSize, physSize)` over the
// components above. What SVG / overlay code (focus ring, distance-vector
// tip) aligns to.
export function renderedSizePx(args: RenderedSizeArgs): number {
  const c = renderedSizeComponents(args, sizeScratch);
  return Math.max(c.appSizePx, c.physSizePx);
}

export interface PeakDiscArgs {
  catalog: Catalog;
  idx: number;
  camPos: Readonly<THREE.Vector3>;
  localPositions: Float32Array;
  uniforms: Pick<StarPhysicsUniforms, 'uFovYRad' | 'uViewport'>;
}

// Peak-amplitude rendered disc diameter in pixels. Mirrors the physSize
// branch of `renderedSizePx` but with the variable held at its peak
// radius (no time-phase oscillation), so the navigate-mode arrow fade
// reads a stable disc envelope across the variability cycle. Used only
// for fade gating — visible disc rendering and other overlays still
// call `renderedSizePx` so they track the actual rendered disc edge.
export function renderedDiscPxAtPeak(args: PeakDiscArgs): number {
  const { catalog, idx, camPos, localPositions, uniforms: u } = args;
  const dx = localPositions[idx * 3] - camPos.x;
  const dy = localPositions[idx * 3 + 1] - camPos.y;
  const dz = localPositions[idx * 3 + 2] - camPos.z;
  const dCam = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), DCAM_LOG_FLOOR_PC);

  const R = Math.max(catalog.physicalRadius[idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC;
  const viewport = u.uViewport.value;
  const peak = physSizePx(R, dCam, viewport.y, u.uFovYRad.value, peakAmplitudeFactor(catalog, idx));
  // Up-clamp to the viewport fraction, mirroring star.vert.glsl / renderedSizePx.
  return Math.min(peak, ZOOM_FLOOR_FRACTION * Math.min(viewport.x, viewport.y));
}

// Chart-mode disc-tuning bag pulled from the shader uniforms. Surfaced
// for chart-labels.ts so the per-frame label engine reads the same
// values the chart-mode shader does.
export function getChartDiscParams(
  uniforms: ChartDiscUniforms,
): ChartDiscParams {
  return {
    maxPx: uniforms.uChartDiscMaxPx.value,
    minPx: uniforms.uChartDiscMinPx.value,
    magBright: uniforms.uChartMagBright.value,
  };
}
