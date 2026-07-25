// Per-layer pick paths. Click picks return raw catalog indices; hover
// picks return HoverHit for the cross-provider disambiguator.

import * as THREE from 'three';
import type { Catalog } from '../../loaders/catalog-loader';
import type { FilterState } from '../../filters/filter-state';
import type { MolecularClouds } from '../../molecular-clouds/molecular-clouds';
import type { LocalGroupLayer } from '../../local-group/local-group';
import type { ShellRegistry } from '../../fresnel-shell/shell-registry';
import { pickShellSilhouette } from '../../fresnel-shell/shell-pick';
import type { PlanetBodyField } from '../../solar-system/planets/planet-body-field';
import { DCAM_LOG_FLOOR_PC } from '../timing';
import { apparentMagnitude, SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { projectToScreen } from '../../overlays/overlay-project';
import {
  MIN_DISC_HIT_RADIUS_PX,
  angularToPx,
  pickFromCandidates,
  pickScore,
  sortedDistRange,
  type PickResult,
  type StarPickCandidate,
} from './star-geometry';
import type { HoverHit } from '../../hover/hover-types';

export interface PickerDeps {
  domElement: HTMLElement;
  camera: THREE.PerspectiveCamera;
  catalog: Catalog;
  sortedByDistFromSol: Uint32Array;
  sortedDistFromSol: Float32Array;
  // The local-frame star position buffer lives on Stellata and is
  // shifted in-place on floating-origin recentre, so the getter returns
  // the live Float32Array rather than a snapshot reference.
  getLocalPositions: () => Float32Array;
  getFilter: () => Readonly<FilterState>;
  getClouds: () => MolecularClouds | null;
  getLocalGroupLayer: () => LocalGroupLayer | null;
  getShells: () => ShellRegistry;
  getPlanetBodyField: () => PlanetBodyField;
  // Floating-origin offset — picks for objects in absolute (catalog)
  // space (clouds, Local Group) need to project into the local frame
  // the camera lives in. Read each call; recentre mutates it in-place.
  getWorldOffset: () => Readonly<THREE.Vector3>;
  getWarpActive: () => boolean;
  // Star disc pixel diameter for the prime-tier hit radius. Threaded
  // as a callback so Picker stays decoupled from material uniforms.
  renderedSizePxFn: (idx: number) => number;
  // Collapsed-cluster lead resolver: when the winning star renders as
  // one point with other members of its system (composite-suppressed),
  // every pick surface resolves to the cluster's primary — hover card,
  // POI pin, vector, and focus must all act on the same object the
  // user sees as "the point". Identity for unsuppressed stars.
  resolveCollapsedLead: (idx: number) => number;
  // The shader-side FOV / viewport pair, live by reference — the
  // canonical pixels-per-radian source for pick paths that size a
  // target on screen (the cloud silhouette today; physSizePx when
  // Picker takes that over from stellata.ts).
  fovYRadRef: { value: number };
  viewportRef: { value: THREE.Vector2 };
}

export class Picker {
  private readonly deps: PickerDeps;

  // Per-instance scratch state. Reused per call to avoid re-allocating
  // Three.js objects on the hot pick path.
  private readonly tmpV3 = new THREE.Vector3();

  constructor(deps: PickerDeps) {
    this.deps = deps;
  }

  // ─── Click picks ──────────────────────────────────────────────────

  /** Pick a star under the cursor for the click FSM. Returns the
   *  winning catalog index or -1 if no star is hit. */
  pickStar(clientX: number, clientY: number, pixelThreshold = 16): number {
    const idx = this.pickStarResult(clientX, clientY, pixelThreshold)?.candidate.idx ?? -1;
    return idx >= 0 ? this.deps.resolveCollapsedLead(idx) : idx;
  }

  /** Hit-test a screen-space cursor against the cloud layer. Returns
   *  the winning cloud index, or null if no cloud is under the cursor.
   *  Always returns null when no layer is attached or while warping. */
  pickCloud(clientX: number, clientY: number): number | null {
    if (this.deps.getWarpActive()) return null;
    return this.cloudHit(clientX, clientY)?.idx ?? null;
  }

  // ─── Hover picks ──────────────────────────────────────────────────

  pickStarHit(clientX: number, clientY: number, pixelThreshold = 14): HoverHit | null {
    const r = this.pickStarResult(clientX, clientY, pixelThreshold);
    if (r === null) return null;
    // Collapsed members sit sub-pixel from their lead, so the picked
    // candidate's camera distance stands in for the lead's.
    return {
      idx: this.deps.resolveCollapsedLead(r.candidate.idx),
      cameraDistancePc: r.candidate.cameraDistancePc,
      tier: r.tier,
    };
  }

  pickPlanetHit(clientX: number, clientY: number, pixelThreshold = 14): HoverHit | null {
    const rect = this.deps.domElement.getBoundingClientRect();
    return this.deps.getPlanetBodyField().pick(
      this.deps.camera,
      rect,
      clientX,
      clientY,
      pixelThreshold,
    );
  }

  /** Click-pick sibling of `pickPlanetHit`: same pick, but `idx` is
   *  rewritten to the field's FLAT instance index — the Target
   *  {kind:'planet'} currency the click FSM feeds to flyTo. Tier and
   *  camera distance ride through for the star-vs-planet tiebreak. */
  pickPlanetClick(clientX: number, clientY: number, pixelThreshold = 16): HoverHit | null {
    const hit = this.pickPlanetHit(clientX, clientY, pixelThreshold);
    if (hit === null || hit.hostStarIdx === undefined) return null;
    const flat = this.deps.getPlanetBodyField().instanceIndexOf(hit.hostStarIdx, hit.idx);
    if (flat === null) return null;
    return { ...hit, idx: flat };
  }

  // Returns null when the LG layer isn't attached (fresh checkout
  // without the build artifact).
  pickLocalGroupHit(clientX: number, clientY: number, pixelThreshold = 14): HoverHit | null {
    const lg = this.deps.getLocalGroupLayer();
    if (!lg) return null;
    const rect = this.deps.domElement.getBoundingClientRect();
    return lg.pick(
      this.deps.camera,
      this.deps.getWorldOffset() as THREE.Vector3,
      rect,
      clientX,
      clientY,
      pixelThreshold,
    );
  }

  // Boundary-shell hit (Local Bubble, heliopause): the nearest registered
  // shell whose silhouette / label bbox is under the cursor. Fallback tier
  // — stars / planets / LG win any overlap. Only visible (drawn) shells
  // pick, so a decluttered or camera-inside shell isn't hoverable.
  pickShellHit(clientX: number, clientY: number): HoverHit | null {
    const shells = this.deps.getShells();
    const rect = this.deps.domElement.getBoundingClientRect();
    const worldOffset = this.deps.getWorldOffset() as THREE.Vector3;
    const cameraPos = this.deps.camera.position;
    let best: HoverHit | null = null;
    for (let idx = 0; idx < shells.count; idx++) {
      const shell = shells.at(idx);
      if (!shell || !shell.pick.visible()) continue;
      const hit = pickShellSilhouette({
        camera: this.deps.camera,
        rect,
        clientX,
        clientY,
        worldOffset,
        surface: shell.pick,
        cameraDistancePc: shells.cameraDistancePc(idx, worldOffset, cameraPos),
        idx,
        scratch: this.tmpV3,
      });
      if (hit && (best === null || hit.cameraDistancePc < best.cameraDistancePc)) best = hit;
    }
    return best;
  }

  // Fallback-only tier. Decoupled from warp state (the click-focus
  // pickCloud keeps its warp gate; hover doesn't need one).
  pickCloudHit(clientX: number, clientY: number): HoverHit | null {
    if (!this.deps.getClouds()?.group.visible) return null;
    return this.cloudHit(clientX, clientY);
  }

  // ─── Internal ─────────────────────────────────────────────────────

  // Both cloud surfaces resolve their winner in the layer, so click and
  // hover can never disagree on which of two overlapping clouds wins
  // (molecular-clouds/README.md § Picking + hover).
  private cloudHit(clientX: number, clientY: number): HoverHit | null {
    const clouds = this.deps.getClouds();
    if (!clouds) return null;
    return clouds.pick(
      this.deps.camera,
      this.deps.getWorldOffset(),
      this.deps.domElement.getBoundingClientRect(),
      clientX,
      clientY,
      angularToPx(this.deps.viewportRef.value.y, this.deps.fovYRadRef.value),
    );
  }

  // Two-tier star pick (project + filter + collect; reducer in
  // star-geometry.ts). Camera distance is deliberately ignored — see
  // pickScore for the rationale.
  private pickStarResult(
    clientX: number,
    clientY: number,
    pixelThreshold: number,
  ): PickResult<StarPickCandidate> | null {
    const { camera, catalog } = this.deps;
    const rect = this.deps.domElement.getBoundingClientRect();
    const viewportW = rect.width;
    const viewportH = rect.height;
    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;

    const camPos = camera.position;
    // Local-frame positions drive camera-relative math and screen projection
    // (the camera lives in local frame under the floating origin). distSol
    // values are precomputed in sortedDistFromSol — no per-star sqrt needed.
    const locPos = this.deps.getLocalPositions();
    const { absmag, spectClass, amplitudeMag, periodDays } = catalog;
    const f = this.deps.getFilter();
    const v = new THREE.Vector3();

    // Window the scan to the slice of sortedDistFromSol that lies inside
    // the user's [minDistSol, maxDistSol] band. Skips out-of-band stars
    // without computing per-star sqrt(x²+y²+z²); also collapses the
    // catalog to the visible distance window when the user has narrowed
    // the slider.
    const sortedIdx = this.deps.sortedByDistFromSol;
    const { start, end } = sortedDistRange(this.deps.sortedDistFromSol, f.minDistSol, f.maxDistSol);

    const candidates: StarPickCandidate[] = [];
    for (let k = start; k < end; k++) {
      const i = sortedIdx[k];
      const bit = 1 << (spectClass[i] | 0);
      if (!(f.spectMask & bit)) continue;
      const x = locPos[i * 3 + 0];
      const y = locPos[i * 3 + 1];
      const z = locPos[i * 3 + 2];
      const dx = x - camPos.x;
      const dy = y - camPos.y;
      const dz = z - camPos.z;
      const dCam = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), DCAM_LOG_FLOOR_PC);
      const appMag = apparentMagnitude(absmag[i], dCam);
      // For variables, use the bright-extreme appMag so a star whose
      // disc is only visible at peak phase remains pickable across the
      // whole cycle. Without this, a variable with static appMag just
      // above the limit gets dropped here even though the GPU shows
      // its disc whenever magMod swings negative.
      const amp = periodDays[i] > 0 ? amplitudeMag[i] : 0;
      const filterMag = appMag - amp * 0.5;
      // Pickable exactly where the disc renders: the shader fades over the
      // soft taper in navigate/normal (cutoff + margin), and hard-clips at
      // the bare cutoff in chart mode. Matching this here closes the
      // renders-but-unpickable band at the visibility edge.
      const cutoff = f.maxAppMag + (f.chart ? 0 : SOFT_TAPER_MARGIN_MAG);
      if (filterMag > cutoff) continue;

      v.set(x, y, z);
      const screen = projectToScreen(v, camera, viewportW, viewportH);
      if (!screen) continue;
      const pxDist = Math.hypot(cursorX - screen[0], cursorY - screen[1]);
      const pxSize = this.deps.renderedSizePxFn(i);
      const hitRadius = Math.max(pxSize * 0.5, MIN_DISC_HIT_RADIUS_PX);
      // Prune to candidates that could win in either tier; the reducer
      // re-checks tier eligibility, this is just to keep the array tiny.
      if (pxDist > hitRadius && pxDist > pixelThreshold) continue;
      candidates.push({ idx: i, pxDist, hitRadius, appMag, cameraDistancePc: dCam });
    }
    return pickFromCandidates(
      candidates,
      pixelThreshold,
      (c) => pickScore(c.pxDist, c.appMag),
    );
  }
}
