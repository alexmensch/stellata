// Owns FilterState + preset/FOV/render-knob mutations and their shader
// uniform writes. See src/client/filters/README.md.

import type * as THREE from 'three';
import type { EventBus } from '../util/event-bus';
import type { StellataEventMap } from '../stellata';
import {
  DEFAULT_FILTER,
  type FilterState,
  INSTRUMENTS,
  type InstrumentName,
  starPxSizes,
  STAR_K_MULTIPLIER_DEFAULT,
  type StarRenderParams,
  getStarKMultiplier,
  setStarKMultiplier,
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
 *  § Exposure epochs). */
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
  /** The focused star's orbit floor depends on FOV — re-solve when the
   *  FOV changes. Wired to FocusController.refreshOrbitFloor. */
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
  // The preset is authoritative, so it also clears the per-element user
  // toggles (`C` constellations, mw band, lg emission) that AND with the
  // floors — a within-scene hide must not outlive the mode change. An
  // element below its floor stays hidden regardless. `resetOverrides:false`
  // is the render-style recompute (chart↔realistic) preserving those
  // toggles across the style flip and through URL restore.
  applyDetailPreset(level: DetailLevel, resetOverrides = true): void {
    this.filter.detailLevel = level;
    if (resetOverrides) {
      this.filter.showConstellation = true;
      this.filter.showMilkyway = true;
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
    u.uSizeSpan.value = this.filter.sizeSpan;
    this.deps.onFilterApplied(this.filter);
    this.deps.bus.emit('filter', this.filter);
    this.deps.bus.emit('state');
  }

  // Switch observing instrument. Always sets instrument + sizeSpan;
  // sizeMin/Max only if their override flags are false.
  setInstrument(name: InstrumentName): void {
    const patch: Partial<FilterState> = { instrument: name };
    if (!this.filter.sizeSpanOverridden) patch.sizeSpan = INSTRUMENTS[name].sizeSpan;
    const sizes = this.computeStarPxSizes(name);
    if (!this.filter.sizeMinOverridden) patch.sizeMin = sizes.sizeMinPx;
    if (!this.filter.sizeMaxOverridden) patch.sizeMax = sizes.sizeMaxPx;
    this.setFilter(patch);
  }

  // Recompute non-overridden pixel sizes from the instrument's angular
  // targets. Called on viewport resize, FOV change, and at construction —
  // only touches sizeMin/Max (the plate-scale-dependent fields), not
  // sizeSpan.
  recomputeStarPxSizes(): void {
    const sizes = this.computeStarPxSizes(this.filter.instrument);
    const patch: Partial<FilterState> = {};
    if (!this.filter.sizeMinOverridden) patch.sizeMin = sizes.sizeMinPx;
    if (!this.filter.sizeMaxOverridden) patch.sizeMax = sizes.sizeMaxPx;
    // Post-patch consistency: the effective max must stay >= effective min.
    // Both fields can be user-overridden independently; at low exaggeration K
    // a recomputed max can fall below a user's min override, which would
    // otherwise leave the filter in an inverted state.
    const newMin = patch.sizeMin ?? this.filter.sizeMin;
    const newMax = patch.sizeMax ?? this.filter.sizeMax;
    if (newMax < newMin) patch.sizeMax = newMin;
    if (Object.keys(patch).length > 0) this.setFilter(patch);
  }

  private computeStarPxSizes(name: InstrumentName) {
    return starPxSizes(name, this.deps.camera.fov, window.innerHeight);
  }

  // Camera FOV setter. Updates the projection matrix, mirrors the new FOV
  // into uFovYRad (drives the angular-diameter shader formula), recomputes
  // the focused star's orbit floor (which depends on FOV), rebases
  // non-overridden pixel sizes (arcsec/px depends on FOV), and fires a
  // state change so URL sync picks up the new value.
  setCameraFov(fov: number): void {
    if (this.deps.camera.fov === fov) return;
    this.deps.camera.fov = fov;
    this.deps.camera.updateProjectionMatrix();
    this.deps.uniforms.uFovYRad.value = (fov * Math.PI) / 180;
    this.deps.refreshOrbitFloor();
    this.recomputeStarPxSizes();
    this.deps.bus.emit('filter', this.filter);
    this.deps.bus.emit('state');
  }
  getCameraFov(): number { return this.deps.camera.fov; }

  // Multiplier on the plate-scale-derived exaggeration K (debug panel).
  // Writes new pixel sizes into any non-overridden field so the change
  // shows live.
  setStarKMultiplier(m: number): void {
    setStarKMultiplier(m);
    this.recomputeStarPxSizes();
    // Fire even when recompute patched nothing (e.g. sizes overridden) so
    // the debug readout reflects the new multiplier.
    this.deps.bus.emit('filter', this.filter);
    this.deps.bus.emit('state');
  }
  getStarKMultiplier(): number { return getStarKMultiplier(); }
  getStarKMultiplierDefault(): number { return STAR_K_MULTIPLIER_DEFAULT; }

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

  // Clear override flags for the named fields and write the instrument's
  // derived value into them. Used by the size and span reset buttons.
  clearSizeOverrides(fields: Array<'sizeMin' | 'sizeMax' | 'sizeSpan'>): void {
    const inst = INSTRUMENTS[this.filter.instrument];
    const sizes = this.computeStarPxSizes(this.filter.instrument);
    const patch: Partial<FilterState> = {};
    for (const f of fields) {
      if (f === 'sizeMin') {
        patch.sizeMinOverridden = false;
        patch.sizeMin = sizes.sizeMinPx;
      } else if (f === 'sizeMax') {
        patch.sizeMaxOverridden = false;
        patch.sizeMax = sizes.sizeMaxPx;
      } else if (f === 'sizeSpan') {
        patch.sizeSpanOverridden = false;
        patch.sizeSpan = inst.sizeSpan;
      }
    }
    this.setFilter(patch);
  }
}
