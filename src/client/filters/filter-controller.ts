// Owns FilterState + instrument/FOV/render-knob mutations and their
// shader uniform writes. See src/client/filters/README.md.

import type * as THREE from 'three';
import type { EventBus } from '../util/event-bus';
import type { StellataEventMap } from '../stellata';
import {
  arcsecPerPx,
  DEFAULT_FILTER,
  type FilterState,
  type InstrumentName,
  sizeSpanOf,
  starExaggerationK,
  starPxSizes,
  STAR_K_MULTIPLIER_DEFAULT,
  type StarRenderParams,
  getStarKMultiplier as readStarKMultiplier,
  setStarKMultiplier as patchStarKMultiplier,
} from './filter-state';
import {
  type DetailLevel,
  type RenderStyle,
  type SceneElementBinds,
  type SceneElementId,
  SCENE_ELEMENT_FLOORS,
  SCENE_ELEMENT_IDS,
  floorPermits,
} from '../scene/scene-elements';

/** The star-pipeline sharedUniforms subset this controller writes. All
 *  three star passes share the value objects, so a single write here
 *  propagates to every pass. The magnitude bounds and `uExposure` are
 *  NOT here — `ExposureController` owns those (`../hdr/README.md`
 *  § The three terms). */
export interface FilterUniforms {
  uMinDistSol: { value: number };
  uMaxDistSol: { value: number };
  uSpectMask: { value: number };
  uSizeMin: { value: number };
  uSizeMax: { value: number };
  uSizeSpan: { value: number };
  uFovYRad: { value: number };
  uVisibleThreshold: { value: number };
  uVisibleK: { value: number };
  uCoreThreshold: { value: number };
  uDiscardThreshold: { value: number };
  uDistNMin: { value: number };
  uDistNMax: { value: number };
  uLumBiasMin: { value: number };
  uLumBiasMax: { value: number };
  uSizeKnee: { value: number };
}

export interface FilterControllerDeps {
  camera: THREE.PerspectiveCamera;
  uniforms: FilterUniforms;
  bus: EventBus<StellataEventMap>;
  /** Layer side-effects of a filter patch (planet-field cull refresh,
   *  milkyway / LG-emission enable) — the shell owns layer identity. */
  onFilterApplied: (f: Readonly<FilterState>) => void;
  /** The focused object's orbit floor is an angular solve for every hard
   *  kind — re-solve when the FOV changes. Wired to
   *  FocusController.refreshOrbitFloor. */
  refreshOrbitFloor: () => void;
  /** Per-element visibility adapters, exhaustive over SceneElementId.
   *  applyDetailPreset / setSceneElementVisible drive these; each folds
   *  one scene layer's visibility idiom into a single call site. */
  sceneElementBinds: SceneElementBinds;
}

export class FilterController {
  private readonly deps: FilterControllerDeps;
  private readonly filter: FilterState = { ...DEFAULT_FILTER };

  constructor(deps: FilterControllerDeps) {
    this.deps = deps;
  }

  /** Live readonly view — callers must mutate through setFilter. */
  getFilter(): Readonly<FilterState> { return this.filter; }

  getDetailLevel(): DetailLevel { return this.filter.detailLevel; }

  // Re-derive every element's permission from the preset floors within the
  // current render style. Overwriting the whole set clears any per-element
  // override a prior setSceneElementVisible left in the cache.
  //
  // The preset is authoritative, so it also clears the one per-element user
  // toggle left that ANDs with the floors (lg emission) — a within-scene
  // hide must not outlive the mode change. An element below its floor stays
  // hidden regardless. `resetOverrides:false` is the render-style recompute
  // (chart↔realistic) preserving that toggle across the style flip and
  // through URL restore.
  applyDetailPreset(level: DetailLevel, resetOverrides = true): void {
    this.filter.detailLevel = level;
    if (resetOverrides) {
      this.filter.showLgEmission = true;
    }
    const style: RenderStyle = this.filter.chart ? 'chart' : 'realistic';
    for (const id of SCENE_ELEMENT_IDS) {
      this.deps.sceneElementBinds[id](floorPermits(SCENE_ELEMENT_FLOORS[id][style], level));
    }
    this.deps.bus.emit('filter', this.filter);
    this.deps.bus.emit('state');
  }

  // Override one element's permission directly; superseded by the next
  // applyDetailPreset, which re-derives the whole set.
  setSceneElementVisible(id: SceneElementId, on: boolean): void {
    this.deps.sceneElementBinds[id](on);
    this.deps.bus.emit('filter', this.filter);
    this.deps.bus.emit('state');
  }

  setFilter(patch: Partial<FilterState>): void {
    Object.assign(this.filter, patch);
    const u = this.deps.uniforms;
    u.uMinDistSol.value = this.filter.minDistSol;
    u.uMaxDistSol.value = this.filter.maxDistSol;
    u.uSpectMask.value = this.filter.spectMask;
    u.uSizeMin.value = this.filter.sizeMin;
    u.uSizeMax.value = this.filter.sizeMax;
    u.uSizeSpan.value = sizeSpanOf(this.filter);
    this.deps.onFilterApplied(this.filter);
    this.deps.bus.emit('filter', this.filter);
    this.deps.bus.emit('state');
  }

  // Switch observing instrument. The footprint window rides the record,
  // so `setFilter`'s uniform write picks it up from the new instrument.
  setInstrument(name: InstrumentName): void {
    const sizes = this.computeStarPxSizes(name);
    this.setFilter({
      instrument: name,
      sizeMin: sizes.sizeMinPx,
      sizeMax: sizes.sizeMaxPx,
    });
  }

  // Re-derive the pixel sizes from the instrument's angular targets at the
  // live plate scale. Called on viewport resize, FOV change, K-multiplier
  // change, and at construction. `starPxSizes` already floors sizeMax at
  // sizeMin, so the pair cannot invert.
  recomputeStarPxSizes(): void {
    const sizes = this.computeStarPxSizes(this.filter.instrument);
    this.setFilter({ sizeMin: sizes.sizeMinPx, sizeMax: sizes.sizeMaxPx });
  }

  private computeStarPxSizes(name: InstrumentName) {
    return starPxSizes(name, this.deps.camera.fov, window.innerHeight);
  }

  // Camera FOV setter. Updates the projection matrix, mirrors the new FOV
  // into uFovYRad (drives the angular-diameter shader formula), recomputes
  // the focused star's orbit floor (which depends on FOV), and rebases the
  // derived pixel sizes (arcsec/px depends on FOV). The recompute runs
  // last: its `setFilter` is what emits filter + state, so URL sync sees
  // the new FOV already mirrored.
  setCameraFov(fov: number): void {
    if (this.deps.camera.fov === fov) return;
    this.deps.camera.fov = fov;
    this.deps.camera.updateProjectionMatrix();
    this.deps.uniforms.uFovYRad.value = (fov * Math.PI) / 180;
    this.deps.refreshOrbitFloor();
    this.recomputeStarPxSizes();
  }
  getCameraFov(): number { return this.deps.camera.fov; }

  // Multiplier on the plate-scale-derived exaggeration K — the panel's
  // "Star size exaggeration" slider. Re-derives the pixel sizes so the
  // change shows live.
  setStarKMultiplier(m: number): void {
    patchStarKMultiplier(m);
    this.recomputeStarPxSizes();
  }
  getStarKMultiplier(): number { return readStarKMultiplier(); }
  getStarKMultiplierDefault(): number { return STAR_K_MULTIPLIER_DEFAULT; }

  /** The *derived* K in effect right now — instrument density × the debug
   *  multiplier × the plate-scale factor at the live FOV and viewport.
   *  `getStarKMultiplier` is only the middle term. */
  getStarExaggerationK(): number {
    return starExaggerationK(
      this.filter.instrument,
      arcsecPerPx(this.deps.camera.fov, window.innerHeight),
    );
  }

  /** Plate scale the derivation above keys on, for the same readout. */
  getArcsecPerPx(): number {
    return arcsecPerPx(this.deps.camera.fov, window.innerHeight);
  }

  // Star-disc rendering knobs (debug panel). Patch any subset; uVisibleK
  // is recomputed whenever uVisibleThreshold changes. Both materials share
  // the same uniforms object so a single write hits the disc + glow passes.
  setStarRenderParams(patch: Partial<StarRenderParams>): void {
    const u = this.deps.uniforms;
    if (patch.visibleThreshold !== undefined) {
      u.uVisibleThreshold.value = patch.visibleThreshold;
      u.uVisibleK.value = -Math.log(patch.visibleThreshold);
    }
    if (patch.coreThreshold !== undefined) u.uCoreThreshold.value = patch.coreThreshold;
    if (patch.discardThreshold !== undefined) u.uDiscardThreshold.value = patch.discardThreshold;
    if (patch.distNMin !== undefined) u.uDistNMin.value = patch.distNMin;
    if (patch.distNMax !== undefined) u.uDistNMax.value = patch.distNMax;
    if (patch.lumBiasMin !== undefined) u.uLumBiasMin.value = patch.lumBiasMin;
    if (patch.lumBiasMax !== undefined) u.uLumBiasMax.value = patch.lumBiasMax;
    if (patch.sizeKnee !== undefined) u.uSizeKnee.value = patch.sizeKnee;
  }
  getStarRenderParams(): StarRenderParams {
    const u = this.deps.uniforms;
    return {
      visibleThreshold: u.uVisibleThreshold.value,
      coreThreshold: u.uCoreThreshold.value,
      discardThreshold: u.uDiscardThreshold.value,
      distNMin: u.uDistNMin.value,
      distNMax: u.uDistNMax.value,
      lumBiasMin: u.uLumBiasMin.value,
      lumBiasMax: u.uLumBiasMax.value,
      sizeKnee: u.uSizeKnee.value,
    };
  }
}
