// Per-frame collector for the adaptation statistic: walks the frame's
// light sources and reduces them to one exposure cut. See README.md
// § Adaptation.

import * as THREE from 'three';
import type { RenderedSizeComponents } from '../camera/controls/star-physics';
import { mark as perfMark, measure as perfMeasure } from '../debug/perf-hud';
import { projectToScreenInto } from '../overlays/overlay-project';
import { luminanceForMagnitude } from './emission-pure';
import {
  adaptationDm,
  type LuminanceSample,
  meanSceneLuminance,
  negligibleAppMag,
  sampleFluxL,
  starAdaptationWindowPc,
  windowTaper,
} from './scene-adaptation-pure';

/** Solar-system bodies drawn this frame, visited as flux samples.
 *  Implemented by `PlanetBodyField`. */
export interface AdaptationBodySources {
  forEachDrawnBody(
    camera: THREE.PerspectiveCamera,
    viewportW: number,
    viewportH: number,
    visit: (sample: LuminanceSample) => void,
  ): void;
}

/** The star half — the shell owns the uniform / filter references the
 *  size mirror reads, so it arrives as callbacks (the shape
 *  `StarLocalClusterDeps` uses for the same walk). */
export interface AdaptationStarSources {
  forEachStarNearCamera: (dThreshPc: number, cb: (idx: number) => boolean) => void;
  renderedSizeComponents: (idx: number, out: RenderedSizeComponents) => RenderedSizeComponents;
  localPositions: () => Float32Array;
  starLabel: (idx: number) => string | null;
}

export interface SceneAdaptationDeps {
  /** Viewport in CSS px, held by reference so resizes reach it. */
  viewport: { value: THREE.Vector2 };
  /** The instrument's own exposure — no adaptation, no trim. Measuring
   *  against the live scalar would close a feedback loop. */
  baseExposure: () => number;
  bodies: AdaptationBodySources;
  stars: AdaptationStarSources;
}

/**
 * The area-weighted mean-luminance measurement
 * (`docs/science-hdr-pipeline.md` § 3.1), evaluated on the CPU from the
 * same magnitudes and true angular sizes the shaders derive their
 * emission from. Analytic rather than a GPU reduce because `LUMA_CEIL`
 * clamps at emission — a mip-reduce reads a resolved Venus 38× too dim,
 * exactly when adaptation matters most.
 */
export class SceneAdaptation {
  private readonly deps: SceneAdaptationDeps;
  private readonly sizeScratch: RenderedSizeComponents = {
    appMag: 0, appSizePx: 0, physSizePx: 0,
  };
  private readonly starPos = new THREE.Vector3();
  private readonly screen: [number, number] = [0, 0];
  private readonly starSample: LuminanceSample = {
    appMag: 0, diameterPx: 0, screenX: 0, screenY: 0, fluxScale: 1, label: null,
  };

  private dm = 0;
  private meanL = 0;
  private dominantLabel: string | null = null;
  private dominantFluxL = 0;
  private fluxL = 0;
  private w = 1;
  private h = 1;
  private exposure = 1;

  constructor(deps: SceneAdaptationDeps) {
    this.deps = deps;
  }

  /**
   * Measure this frame and return the exposure cut in magnitudes. Chart
   * mode bypasses the whole HDR seam, so it measures nothing and reports
   * no cut rather than leaving the last scene's value standing.
   */
  measure(camera: THREE.PerspectiveCamera, chart: boolean): number {
    if (chart) return this.reset();
    perfMark('adaptation');
    const viewport = this.deps.viewport.value;
    this.w = viewport.x;
    this.h = viewport.y;
    this.exposure = this.deps.baseExposure();
    this.fluxL = 0;
    this.dominantFluxL = 0;
    this.dominantLabel = null;
    this.deps.bodies.forEachDrawnBody(camera, this.w, this.h, this.accumulate);
    this.collectStars(camera);
    this.meanL = meanSceneLuminance(this.fluxL, this.w, this.h);
    this.dm = adaptationDm(this.meanL);
    perfMeasure('adaptation');
    return this.dm;
  }

  /** The cut this frame's measurement produced. */
  getDm(): number {
    return this.dm;
  }

  /** `L̄` itself — the debug panel's row. */
  getMeanLuminance(): number {
    return this.meanL;
  }

  /**
   * What the frame is adapted TO: the source carrying most of the flux,
   * once there is a cut to explain. Null while nothing is adapting, and
   * null for a dominant source with no name — the readout drops the
   * clause rather than inventing a label.
   */
  getDominantLabel(): string | null {
    return this.dm === 0 ? null : this.dominantLabel;
  }

  private reset(): number {
    this.dm = 0;
    this.meanL = 0;
    this.fluxL = 0;
    this.dominantFluxL = 0;
    this.dominantLabel = null;
    return 0;
  }

  private accumulate = (sample: LuminanceSample): void => {
    const fluxL = sampleFluxL(sample, this.exposure, this.w, this.h);
    this.fluxL += fluxL;
    if (fluxL > this.dominantFluxL) {
      this.dominantFluxL = fluxL;
      this.dominantLabel = sample.label;
    }
  };

  /**
   * Stars close enough to matter. The gate is flux, not resolvedness:
   * Sol at 100 AU is a third of a pixel wide and 473× over `L_ADAPT`, so
   * "is it a disc yet?" is the wrong question. Every star fainter than
   * `ADAPT_STAR_ABSMAG_REF` is covered exactly by the window; brighter
   * ones fade out through the taper instead of popping at the bound.
   */
  private collectStars(camera: THREE.PerspectiveCamera): void {
    const { w, h, exposure } = this;
    const windowPc = starAdaptationWindowPc(exposure, w * h);
    const gateFluxL = luminanceForMagnitude(exposure, negligibleAppMag(exposure, w * h));
    const local = this.deps.stars.localPositions();
    const s = this.starSample;
    this.deps.stars.forEachStarNearCamera(windowPc, (idx) => {
      const j = idx * 3;
      this.starPos.set(local[j], local[j + 1], local[j + 2]);
      const taper = windowTaper(this.starPos.distanceTo(camera.position), windowPc);
      if (taper <= 0) return false;
      const c = this.deps.stars.renderedSizeComponents(idx, this.sizeScratch);
      if (luminanceForMagnitude(exposure, c.appMag) * taper < gateFluxL) return false;
      if (!projectToScreenInto(this.starPos, camera, w, h, this.screen)) return false;
      s.appMag = c.appMag;
      s.diameterPx = c.physSizePx;
      s.screenX = this.screen[0];
      s.screenY = this.screen[1];
      s.fluxScale = taper;
      s.label = this.deps.stars.starLabel(idx);
      this.accumulate(s);
      return false;
    });
  }
}
