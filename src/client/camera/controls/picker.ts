// Per-layer pick paths. Click picks return raw catalog indices; hover
// picks return HoverHit for the cross-provider disambiguator.

import * as THREE from 'three';
import type { Catalog } from '../../loaders/catalog-loader';
import type { FilterState } from '../../filters/filter-state';
import type { PlanetBodyField } from '../../solar-system/planets/planet-body-field';
import type { TargetKind } from '../focus/focus-target';
import type { KindPick } from '../../kinds/kind-module';
import { DCAM_LOG_FLOOR_PC } from '../timing';
import { apparentMagnitude } from '../../solar-system/perceptual-magnitude';
import { projectToScreen } from '../../overlays/overlay-project';
import {
  MIN_DISC_HIT_RADIUS_PX,
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
  getPlanetBodyField: () => PlanetBodyField;
  // Kind-module pick surfaces (kinds/kind-module.ts) — one entry per
  // migrated kind, absent for kinds whose pick path is still inline.
  // Hover providers call the same functions, so the two can't disagree.
  kindPicks: Readonly<Partial<Record<TargetKind, KindPick>>>;
  // Floating-origin offset — picks for objects in absolute (catalog)
  // space (Local Group, boundary shells) need to project into the local
  // frame the camera lives in. Read each call; recentre mutates it
  // in-place.
  getWorldOffset: () => Readonly<THREE.Vector3>;
  // Star disc pixel diameter for the prime-tier hit radius. Threaded
  // as a callback so Picker stays decoupled from material uniforms.
  renderedSizePxFn: (idx: number) => number;
  // Faintest drawn magnitude, so a pick can never disagree with the
  // fragment shader's taper. Chart hard-clips; navigate fades over the
  // soft taper. `ExposureController.drawCutoffMag`.
  drawCutoffMagFn: (chart: boolean) => number;
  // Collapsed-cluster lead resolver: when the winning star renders as
  // one point with other members of its system (composite-suppressed),
  // every pick surface resolves to the cluster's primary — hover card,
  // POI pin, vector, and focus must all act on the same object the
  // user sees as "the point". Identity for unsuppressed stars.
  resolveCollapsedLead: (idx: number) => number;
}

export class Picker {
  private readonly deps: PickerDeps;

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

  /** Dispatch a hover-shaped pick to a kind module's pick surface.
   *  Null when the kind has no module pick registered. */
  pickKindHit(
    kind: TargetKind,
    clientX: number,
    clientY: number,
    pixelThreshold = 14,
  ): HoverHit | null {
    return this.deps.kindPicks[kind]?.(clientX, clientY, pixelThreshold) ?? null;
  }

  // ─── Internal ─────────────────────────────────────────────────────

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
    const cutoff = this.deps.drawCutoffMagFn(f.chart);
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
      // Pickable exactly where the disc renders — the shared cutoff rule
      // closes the renders-but-unpickable band at the visibility edge.
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
