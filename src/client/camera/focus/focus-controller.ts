// Focus FSM + focus-park lerp + pin-engage geometry.
// See src/client/camera/focus/README.md.

import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { Catalog } from '../../loaders/catalog-loader';
import type { CameraMode, StellataEventMap } from '../../stellata';
import type { EventBus } from '../../util/event-bus';
import type { AimController } from '../controls/aim-controller';
import type { ObserveControls } from '../observe/observe-controls';
import type { ObserveTransition } from '../observe/observe-transition';
import type { WarpController } from '../warp/warp-controller';
import type { FocusableProviders, FocusTarget, Target, TargetKind } from './focus-target';
import type { MolecularClouds } from '../../molecular-clouds/molecular-clouds';
import { cloudViewingDistancePc } from '../../molecular-clouds/molecular-clouds';
import type { LocalGroupLayer } from '../../local-group/local-group';
import { lgViewingDistancePc } from '../../local-group/local-group-loader';
import {
  type PlanetSystem,
  getPlanetSystem,
  hasPlanets,
} from '../../solar-system/planet-system';
import { R_SUN_PC, MIN_PHYSICAL_RADIUS_R_SUN } from '../../util/astronomy-constants';
import { chartPlateauDistancePc } from '../../chart-mode/chart-disc-pure';
import * as starPhysics from '../controls/star-physics';
import {
  type FocusLerpState,
  newFocusLerpFrom,
  tickFocusLerp,
} from './focus-transition';
import { shiftArrivalWaypoints } from '../arrival/camera-motion';
import { warpArrivalEaseFn } from '../warp/warp-tuning';
import { FOCUS_LERP_MS } from '../timing';
import { alignCameraUpToQuaternion } from '../controls/up-align-pure';

/** Fallback orbit-controls floor when no star is focused. Sized to keep
 *  the camera comfortably outside any single star's physical envelope
 *  (Sol's photosphere at 2.25×10⁻⁸ pc, Earth's orbit at 4.85×10⁻⁶ pc) so
 *  approaching origin without an explicit focus anchor doesn't enter the
 *  extreme-close-range regime where float32 matrix cancellation drifts
 *  the projected center off-screen. To get closer than this, focus a
 *  star — `minOrbitDistForStar` then returns the per-star physical floor. */
export const GLOBAL_MIN_DIST_PC = 5e-3;

/** Squared-length threshold below which `controls.target` is treated as
 *  coincident with the local origin (= focal-star position). Engages the
 *  uPinFocusToCenter shader pin so the focused star renders at NDC (0,0)
 *  regardless of float32 cancellation. 1e-12 pc² ≈ (1e-6 pc)² ≈ 0.2 AU
 *  — under this, the geometric pin is the right answer. */
export const PIN_ENGAGE_THRESHOLD_SQ_PC = 1e-12;

/** Floating-origin primitive — stays on the integration shell so the
 *  star-pipeline buffer rewrite + `iPositionAttr.needsUpdate` happen
 *  next to the resources they touch. Cleaner extraction is coupled to
 * the StarPipeline extract. */
export interface FrameAnchor {
  recenterOrigin(newOrigin: THREE.Vector3): THREE.Vector3 | null;
  getWorldOffset(): Readonly<THREE.Vector3>;
  starLocalPosition(idx: number): THREE.Vector3;
  starLocalPositionInto(idx: number, out: THREE.Vector3): THREE.Vector3;
}

/** Cross-controller seam consumed by WarpController. FocusController
 *  implements it natively (focus, vector slot, cameraMode all live
 *  here); only the frame-anchor methods delegate to the integration
 *  shell via deps. */
export interface FocusOps {
  /** FocusTarget describing whichever object is currently focused,
   *  or null if nothing is focused. Source side of a warp. */
  currentFocusTarget(): FocusTarget | null;
  /** Build a FocusTarget for `target`, or null when its layer hasn't
   *  loaded or the index is out of range. */
  makeFocusTarget(target: Target): FocusTarget | null;
  /** Star position in the renderer's local frame. */
  starLocalPosition(idx: number): THREE.Vector3;
  /** Star's live local position (catalog baseline + orbital perturbation)
   *  in float64, written into `out`. Correct even right after a recentre,
   *  before the walk perturbs the buffer. */
  starLivePositionInto(idx: number, out: THREE.Vector3): THREE.Vector3;
  /** Shift the floating origin to `newOrigin`, returning the applied
   *  delta. The returned Vector3 is shared scratch — copy if needed
   *  beyond the synchronous call. Returns null on no-op. */
  recenterOrigin(newOrigin: THREE.Vector3): THREE.Vector3 | null;
  /** Star-specific shorthand: recenterOrigin onto catalog[idx] PLUS
   *  the focus-state book-keeping. No event emit; caller decides when
   *  to fan out 'focus' / 'state'. */
  recenterFocusToStar(idx: number): THREE.Vector3 | null;
  setFocus(idx: number | null): void;
  /** Clear whichever distance-vector destination is set (any kind) —
   *  warp arrival wipes the slot regardless of the warp's kind. */
  clearVector(): void;
  getFocusedStar(): number | null;
  getFocusedTarget(): Target | null;
  /** True when an observe enter / exit transition is in flight ('unfocus'
   *  excluded). startWarp bails so warp doesn't collide. */
  isObserveTransitionActive(): boolean;
  cancelFocusLerp(): void;
  cancelUnfocusLerp(): void;
}

export interface FocusControllerDeps {
  camera: THREE.PerspectiveCamera;
  controls: TrackballControls;
  observeControls: ObserveControls;
  catalog: Catalog;
  bus: EventBus<StellataEventMap>;
  frameAnchor: FrameAnchor;
  aim: AimController;
  uHideFocusIdxRef: { value: number };
  getClouds: () => MolecularClouds | null;
  getLocalGroup: () => LocalGroupLayer | null;
  /** Lazy refs due to circular construction: warp + observe consume
   *  FocusOps from this controller, so they're built after. Resolved
   *  at request time. */
  getWarp: () => WarpController;
  getObserve: () => ObserveTransition;
  /** Lazy for the same reason: the star provider's focusParkDistance
   *  closes back over this controller. */
  getFocusables: () => FocusableProviders;
  /** Focal star's float64 orbital perturbation from its catalog baseline
   *  at the current sim time, written into `out`; false when the star is
   *  in no binary relation. Wired to BinaryOrbitField.focalPerturbationInto
   *  through the integration shell. Read at focus-entry (before the walk
   *  has perturbed the star's buffer slot) to snap the orbit target onto
   *  the star's live position. */
  focalPerturbationInto: (idx: number, out: THREE.Vector3) => boolean;
}

export class FocusController implements FocusOps {
  private readonly deps: FocusControllerDeps;
  // Focused object and distance-vector destination, one Target each.
  // Cross-kind mutual exclusion is structural; the setters' remaining
  // job is emitting the clearing event for a displaced kind.
  private focused: Target | null = null;
  private vector: Target | null = null;
  private cameraMode: CameraMode = 'navigate';
  private focusedPlanetSystem: PlanetSystem | null = null;
  private planetSystemToken = 0;
  private focusLerpState: FocusLerpState | null = null;

  // Scratch — only safe inside its single synchronous call site.
  private readonly tmpRecenter = new THREE.Vector3();
  private readonly tmpLive = new THREE.Vector3();
  private readonly tmpPert = new THREE.Vector3();

  constructor(deps: FocusControllerDeps) {
    this.deps = deps;
  }

  // Star-kind view over the sum-type slot — the star-only affordances'
  // guard value (null for every other kind).
  private get focusedStar(): number | null {
    return this.focused?.kind === 'star' ? this.focused.idx : null;
  }

  // ─── queries ───────────────────────────────────────────────────────

  getFocusedStar(): number | null { return this.focusedStar; }
  getFocusedTarget(): Target | null { return this.focused; }
  getFocusedPlanetSystem(): PlanetSystem | null { return this.focusedPlanetSystem; }
  isFocusLerpActive(): boolean { return this.focusLerpState !== null; }

  getCameraMode(): CameraMode { return this.cameraMode; }
  /** Raw mode write — no event emit. ObserveTransition / the shell's
   *  wiring drive this; 'cameraMode' events are emitted by whichever
   *  transition owns the mode change. */
  setCameraModeValue(mode: CameraMode): void { this.cameraMode = mode; }

  // ─── distance-vector slot ──────────────────────────────────────────

  getVectorTo(): number | null {
    return this.vector?.kind === 'star' ? this.vector.idx : null;
  }
  getVectorTarget(): Target | null { return this.vector; }

  /** Star-kind convenience for the click ladder + focusStar's
   *  star-slot-only clear (a non-star vector deliberately survives a
   *  star focus change). */
  setVectorTo(idx: number | null): void { this.setVectorSlot('star', idx); }

  /** Set (any kind) or clear (null → whichever kind is set) the
   *  distance-vector destination. */
  setVector(target: Target | null): void {
    if (target === null) this.clearVector();
    else this.setVectorSlot(target.kind, target.idx);
  }

  /** One mutation path for every vector kind — the single Target slot
   *  makes cross-kind displacement structural. Passing null clears
   *  only the named kind's slot. OBSERVE doesn't draw vectors —
   *  non-null writes are dropped there (defensive: search "To" or URL
   *  state could try one). */
  private setVectorSlot(kind: TargetKind, idx: number | null): void {
    if (idx !== null
      && (this.cameraMode === 'observe' || this.isObserveTransitionActive())) return;
    const cur = this.vector;
    if (idx === null) {
      if (cur === null || cur.kind !== kind) return;
      this.vector = null;
    } else {
      if (cur !== null && cur.kind === kind && cur.idx === idx) return;
      this.vector = { kind, idx };
    }
    this.deps.bus.emit('vector', this.vector);
    this.deps.bus.emit('state');
  }

  /** Clear whichever vector destination is set (any kind). */
  clearVector(): void {
    if (this.vector !== null) this.setVectorSlot(this.vector.kind, null);
  }

  /** True while *any* camera-driving animation is in flight: warp,
   *  aim-slerp, focus-park lerp, OR an observe transition (enter / exit /
   *  navigate-close-zoom unfocus). ObserveTransition reads this through
   *  the ObserveFocusOps seam. */
  isCameraBusy(): boolean {
    return this.deps.getWarp().isActive()
      || this.deps.aim.isActive()
      || this.focusLerpState !== null
      || this.deps.getObserve().isAnyActive();
  }

  /** True when an observe-mode transition (enter or exit) is in flight.
   *  The 'unfocus' kind is excluded — it reuses the controller's state
   *  slot for a navigate-mode lerp and shouldn't surface to UI/overlay
   *  code gating on observe-mode visibility. */
  isObserveTransitionActive(): boolean {
    return this.deps.getObserve().isActive();
  }

  /** Threshold squared-length below which `controls.target` engages the
   *  focused-star pin. Surfaced for the pin debug HUD so the displayed
   *  rule matches the runtime constant exactly. */
  getPinEngageThresholdSq(): number { return PIN_ENGAGE_THRESHOLD_SQ_PC; }

  /** Whether the focused-star pin (uPinFocusToCenter) would engage right
   *  now, mirroring the per-frame guard in animate(). Read by the pin
   *  section of the unified debug panel (`debug.panel()`) to display
   *  live state.
   *
   *  The warp guard releases when `warp.isRecenteredToDest()` is true:
   *  after the mid-Fly recentre the destination is at
   *  local (0,0,0) and the camera is doing `lookAt(local origin)` per
   *  frame. focus-park lerp stays guarded — that path slerps through a
   *  non-lookAt arc where pin-to-centre would snap the focal star to
   *  NDC origin before the slerp finishes turning into it. */
  isPinEngaged(): boolean {
    const warp = this.deps.getWarp();
    const focal = this.focusedStar;
    if (
      focal === null
      || this.cameraMode !== 'navigate'
      || (warp.isActive() && !warp.isRecenteredToDest())
      || this.deps.aim.isActive()
      || this.focusLerpState !== null
    ) return false;
    // Engage iff the orbit target coincides with the focal star's LIVE
    // local position (catalog baseline + orbital perturbation, read from
    // the star buffer). Panning moves target off the star → disengage.
    // For a non-orbiting star the live position is its baseline (local
    // origin under focus), so this reduces to target ≈ origin.
    const live = this.deps.frameAnchor.starLocalPositionInto(focal, this.tmpLive);
    return this.deps.controls.target.distanceToSquared(live) < PIN_ENGAGE_THRESHOLD_SQ_PC;
  }

  /** Re-solve the focused star's manual-zoom floor against the current
   *  camera FOV / aspect. No-op when nothing is focused. Called on FOV
   *  change (FilterController.setCameraFov) and viewport resize — both
   *  move `fov_minor`, which the floor solve depends on. */
  refreshOrbitFloor(): void {
    if (this.focusedStar === null) return;
    this.deps.controls.minDistance = starPhysics.minOrbitDistForStar({
      catalog: this.deps.catalog,
      idx: this.focusedStar,
      fovMinorRad: starPhysics.fovMinorRad(this.deps.camera),
    });
  }

  /** Auto-park target — pure star-physics helper applied with the
   *  current camera. Exposed for the ObserveFocusOps seam. */
  parkDistForStar(idx: number): number {
    return starPhysics.parkDistForStar({
      catalog: this.deps.catalog,
      idx,
      fovMinorRad: starPhysics.fovMinorRad(this.deps.camera),
    });
  }

  // ─── frame anchor + vector slot delegation ─────────────────────────

  starLocalPosition(idx: number): THREE.Vector3 {
    return this.deps.frameAnchor.starLocalPosition(idx);
  }
  /** Star `idx`'s live local position in float64: its catalog baseline in
   *  the current floating-origin frame PLUS its orbital perturbation.
   *  Computed from the catalog + worldOffset (not the star buffer), so it
   *  is correct even right after a recentre — before the walk has
   *  perturbed the buffer slot — and never double-counts the perturbation.
   *  The one place "where does the focal star actually sit" is answered. */
  starLivePositionInto(idx: number, out: THREE.Vector3): THREE.Vector3 {
    const wo = this.deps.frameAnchor.getWorldOffset();
    const p = this.deps.catalog.positions;
    out.set(p[idx * 3] - wo.x, p[idx * 3 + 1] - wo.y, p[idx * 3 + 2] - wo.z);
    if (this.deps.focalPerturbationInto(idx, this.tmpPert)) out.add(this.tmpPert);
    return out;
  }

  /** Focal star's live local position (baseline + orbital perturbation)
   *  into `out`; false when unfocused. Consumed by ObserveTransition and
   *  WarpController to park the camera on the star. */
  focalLocalPositionInto(out: THREE.Vector3): boolean {
    if (this.focusedStar === null) return false;
    this.starLivePositionInto(this.focusedStar, out);
    return true;
  }
  recenterOrigin(newOrigin: THREE.Vector3): THREE.Vector3 | null {
    return this.deps.frameAnchor.recenterOrigin(newOrigin);
  }

  // ─── star/cloud focus FSM ──────────────────────────────────────────

  setFocus(idx: number | null): void {
    // Every kind's focus shares the one Target slot, so a non-star
    // focus is displaced here structurally; the single 'focus' emit at
    // the end carries the whole transition.
    const displaced = this.focused !== null && this.focused.kind !== 'star';
    if (displaced) this.focused = null;
    if (this.focusedStar === idx) {
      if (displaced) {
        this.deps.bus.emit('focus', null);
        this.deps.bus.emit('state');
      }
      return;
    }
    // OBSERVE depends on a focused star anchor. Any change to the anchor
    // (unfocus or switch to another star) bails out of observe immediately.
    // Snap rather than animate because a transition needs the original
    // anchor to mean anything.
    if (this.cameraMode === 'observe') {
      // Snap-exit observe BEFORE the focus mutation runs: an in-flight
      // 'enter' / 'exit' transition references the OLD focal star via
      // fromPos/toPos and must be dropped before the floating-origin
      // recentre downstream. This path deliberately does NOT touch
      // controls.target or call controls.update() — the camera is at
      // local (0,0,0) right now and target is set by the
      // recenterFocusToStar block below.
      this.deps.getObserve().cancelTransition();
      this.deps.aim.cancel();
      this.cameraMode = 'navigate';
      this.deps.uHideFocusIdxRef.value = -1;
      this.deps.observeControls.disable();
      alignCameraUpToQuaternion(this.deps.camera);
      this.deps.controls.enabled = true;
      this.deps.bus.emit('cameraMode', 'navigate');
    }
    // Recenter the floating origin only when *focusing* a star. The new
    // origin snaps to the focal star's absolute position, so close-range
    // rendering happens with tiny coordinate values and the projection
    // chain stays float32-clean. On *unfocus* (idx === null) we leave
    // worldOffset alone — the camera is wherever it was, and continuing
    // to render in the (former focal star's) local frame keeps every
    // close-orbit precision invariant intact across the focus → unfocus
    // transition.
    if (idx !== null) {
      this.recenterFocusToStar(idx);
      // Snap controls.target onto the focal star's LIVE local position
      // (catalog baseline + current orbital perturbation) and shift the
      // camera by the same delta so the camera-to-target relationship —
      // and thus the user-visible pose — is preserved. The buffer hasn't
      // been perturbed yet this frame, so the perturbation comes from the
      // float64 accessor. For a non-orbiting star pert is zero and this
      // lands target at (0,0,0), clearing the Sol-catalog-offset and
      // long-warp Float32 residuals that would otherwise disengage the
      // pin. The focal-frame ride keeps target glued to the star after.
      const live = this.starLivePositionInto(idx, this.tmpLive);
      const t = this.deps.controls.target;
      this.deps.camera.position.x += live.x - t.x;
      this.deps.camera.position.y += live.y - t.y;
      this.deps.camera.position.z += live.z - t.z;
      t.copy(live);
    } else {
      this.focused = null;
      // Unfocus: clamp the new minDistance to ≤ current eye distance so
      // TrackballControls doesn't push the camera outward when the user was
      // sitting closer than GLOBAL_MIN_DIST_PC to the (former) focal star.
      // Once minDistance is below current eye, future zoom-out is free; the
      // 5e-3 pc unfocused floor latches once the user has zoomed out past it.
      const eye = this.deps.camera.position.distanceTo(this.deps.controls.target);
      this.deps.controls.minDistance = Math.min(GLOBAL_MIN_DIST_PC, eye);
      this.refreshPlanetSystem(null);
    }
    this.deps.bus.emit('focus', this.focused);
    this.deps.bus.emit('state');
  }

  /** Shared setter for the soft-focus kinds (cloud / LG). A star focus
   *  is displaced through the full setFocus(null) path (orbit floor
   *  clamp + planet-system detach + observe bail-out); another soft
   *  kind is displaced structurally by the slot write. Passing null
   *  clears only the named kind's focus. */
  private setSoftFocus(kind: 'cloud' | 'lg', idx: number | null): void {
    if (idx !== null && this.focusedStar !== null) {
      this.setFocus(null);
    }
    const cur = this.focused?.kind === kind ? this.focused.idx : null;
    if (cur === idx) return;
    this.focused = idx === null ? null : { kind, idx };
    this.deps.bus.emit('focus', this.focused);
    this.deps.bus.emit('state');
  }

  /** Star-focused recentre: pivot the floating origin onto catalog[idx]
   *  AND update the focus-state book-keeping (focusedStar, per-star
   *  minDistance, planet-system reload). No 'focus' / 'state' event
   *  emit — caller fires those when the camera has landed (setFocus,
   *  WarpController.swapObserveAnchor, WarpController.tryMidFlyRecentre
   *  via dest.emitFocusEvents at finishWarp). */
  recenterFocusToStar(newIdx: number): THREE.Vector3 | null {
    const p = this.deps.catalog.positions;
    const delta = this.deps.frameAnchor.recenterOrigin(this.tmpRecenter.set(
      p[newIdx * 3], p[newIdx * 3 + 1], p[newIdx * 3 + 2],
    ));
    this.focused = { kind: 'star', idx: newIdx };
    this.deps.controls.minDistance = starPhysics.minOrbitDistForStar({
      catalog: this.deps.catalog,
      idx: newIdx,
      fovMinorRad: starPhysics.fovMinorRad(this.deps.camera),
    });
    this.refreshPlanetSystem(newIdx);
    return delta;
  }

  // Reload the focused star's planet system. Called from every code path
  // that mutates focusedStar (setFocus + makeStarFocusTarget.applyFocus).
  // The token guard drops a previous in-flight load if the focus changes
  // again before the Promise resolves — relevant once the exoplanet epic
  // introduces truly async fetches; for Sol the resolve happens on the
  // next microtask, ahead of the next animation frame.
  private refreshPlanetSystem(idx: number | null): void {
    const token = ++this.planetSystemToken;
    if (idx === null || !hasPlanets(this.deps.catalog, idx)) {
      if (this.focusedPlanetSystem !== null) {
        this.focusedPlanetSystem = null;
        this.deps.bus.emit('planetSystem', null);
      }
      return;
    }
    void getPlanetSystem(this.deps.catalog, idx).then((ps) => {
      if (token !== this.planetSystemToken) return;
      if (this.focusedPlanetSystem === ps) return;
      this.focusedPlanetSystem = ps;
      this.deps.bus.emit('planetSystem', ps);
    });
  }

  // ─── focus-park lerp (private state, public cancel) ────────────────

  /** Public for WarpController's FocusOps seam: cancel at startWarp
   *  time so the in-flight lerp doesn't fight the warp claim. */
  cancelFocusLerp(): void {
    this.endFocusLerp();
  }

  /** Public for WarpController's FocusOps seam. */
  cancelUnfocusLerp(): void {
    this.deps.getObserve().cancelUnfocusLerp();
  }

  /** Ride the in-flight focus-park lerp's cached waypoints with the focal
   *  star's per-frame orbital drift. No-op when no lerp is running. Called
   *  by the integration shell's focal-frame ride so the lerp lands on the
   *  star's live position rather than its position at lerp-start. */
  translateFocusFrame(delta: Readonly<THREE.Vector3>): void {
    if (this.focusLerpState === null) return;
    shiftArrivalWaypoints(this.focusLerpState, -delta.x, -delta.y, -delta.z);
  }

  /** Per-frame tick. Stellata's animate() dispatches here when
   *  `isFocusLerpActive()` is true. controls.enabled is left true
   *  throughout; the dispatcher routes here instead of controls.update(),
   *  so user drag accumulates in TC without visible effect until the
   *  lerp lands. On landing we re-issue controls.update() so TC re-syncs
   *  against the final camera pose. */
  tick(nowMs: number): void {
    const state = this.focusLerpState;
    if (!state) return;
    const stillActive = tickFocusLerp(state, nowMs, this.deps.camera);
    if (!stillActive) {
      this.endFocusLerp();
      this.deps.controls.update();
    }
  }

  // Set/clear the focus-lerp slot through these helpers so overlays
  // subscribed to the 'focusLerp' event see exactly one true → false edge
  // per lerp. Calling startFocusLerp twice in a row emits a single 'true'
  // (state changed shape but stays active); endFocusLerp() is a no-op
  // when no lerp is running.
  private startFocusLerp(state: FocusLerpState): void {
    const wasInactive = this.focusLerpState === null;
    this.focusLerpState = state;
    if (wasInactive) {
      this.deps.bus.emit('focusLerp', true);
    }
  }
  private endFocusLerp(): void {
    if (this.focusLerpState !== null) {
      this.focusLerpState = null;
      this.deps.bus.emit('focusLerp', false);
    }
  }

  // ─── click/select-driven focus paths ───────────────────────────────

  /**
   * Focus a star. With `animate: true` (default), the camera glides to
   * `parkDistForStar(idx)` over `FOCUS_LERP_MS` when the camera is
   * currently outside that park distance; otherwise the camera stays put
   * and only the focus state / orbit floor are updated. With
   * `animate: false`, the camera snaps to the park pose directly
   * (URL-restore path).
   *
   * Flow: `setFocus` translates the camera into the new floating-origin
   * frame (new star at local (0,0,0)). We capture starting orientation
   * BEFORE `setFocus`, then build the lerp AFTER — the lerp's
   * fromPos/toPos must live in the post-recentre frame, otherwise the
   * camera teleports backward and lands at `|targetOld|` past the star.
   */
  focusStar(starIndex: number, opts: { animate?: boolean } = {}): void {
    if (this.deps.getWarp().isActive()) return;
    this.cancelUnfocusLerp();
    this.cancelFocusLerp();
    const animate = opts.animate ?? true;

    // Orientation is frame-shift-invariant; capture once. After setFocus
    // we still want `fromQuat` to be the user's pre-click camera view.
    const startQuat = this.deps.camera.quaternion.clone();
    const startUp = this.deps.camera.up.clone();

    const fovMinor = starPhysics.fovMinorRad(this.deps.camera);
    const parkDist = starPhysics.parkDistForStar({
      catalog: this.deps.catalog, idx: starIndex, fovMinorRad: fovMinor,
    });
    const minOrbit = starPhysics.minOrbitDistForStar({
      catalog: this.deps.catalog, idx: starIndex, fovMinorRad: fovMinor,
    });

    // setFocus's contract: caller seeds controls.target with the new
    // star's local position in the CURRENT (pre-recentre) frame; setFocus
    // then recentres worldOffset to the new star and translates camera +
    // target by -target so both land in the new frame with target at
    // (0,0,0). Match that contract.
    this.deps.controls.target.copy(this.deps.frameAnchor.starLocalPosition(starIndex));
    this.deps.controls.minDistance = minOrbit;
    this.setVectorTo(null);
    this.setFocus(starIndex);
    // From here on: the new star sits at local (0,0,0); camera.position
    // is already translated into the new frame.

    const target = this.deps.controls.target; // focal live pos post-recentre
    const eyeDist = this.deps.camera.position.distanceTo(target);

    if (animate && eyeDist > parkDist) {
      this.startFocusLerp(newFocusLerpFrom(
        this.deps.camera.position,
        startQuat,
        startUp,
        target,
        parkDist,
        FOCUS_LERP_MS,
        performance.now(),
        warpArrivalEaseFn({
          d0: eyeDist,
          dEnd: parkDist,
          targetRadius:
            Math.max(this.deps.catalog.physicalRadius[starIndex], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC,
        }),
      ));
      // Deliberately do NOT toggle controls.enabled. The animate-loop
      // dispatcher routes through tick() before controls.update(), so
      // user input accumulates inside TrackballControls but doesn't
      // apply visually. Disabling here would race the click-to-focus
      // event chain — Stellata's pointerup runs before TC's dynamically-
      // added pointerup, and TC's _state would stay stuck at ROTATE
      // until the next click clears it (cursor appears captured).
    } else if (eyeDist > parkDist) {
      // animate: false snap path — outside park: place at park along
      // current eye direction with an explicit lookAt so orientation
      // matches what TC would resolve.
      const dir = this.deps.camera.position.clone().sub(target).normalize();
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);
      this.deps.camera.position.copy(target).addScaledVector(dir, parkDist);
      this.deps.camera.lookAt(target);
      this.deps.controls.update();
    } else {
      // Inside park: stay-put. Nothing to move.
      this.deps.controls.update();
    }
  }

  /** Kind-agnostic travel entry point — search-select, canvas clicks,
   *  URL restore. Stars route through `focusStar`; soft kinds
   *  (cloud / LG) share the focus-park path below, reading their
   *  geometry through the FocusableProviders registry. No-op when the
   *  target's layer hasn't loaded. */
  flyTo(target: Target, opts: { animate?: boolean } = {}): void {
    if (target.kind === 'star') {
      this.focusStar(target.idx, opts);
      return;
    }
    // setFocus(null) below leaves worldOffset alone, so no frame-shift
    // handling is needed — the provider's local position is valid in
    // the current local frame both before and after the focus clear.
    const provider = this.deps.getFocusables()[target.kind];
    const dest = new THREE.Vector3();
    if (!provider.localPositionInto(target.idx, dest)) return;
    if (this.deps.getWarp().isActive()) return;
    this.cancelUnfocusLerp();
    this.cancelFocusLerp();

    if (this.focusedStar !== null) this.setFocus(null);
    this.clearVector();

    const animate = opts.animate ?? true;
    const startQuat = this.deps.camera.quaternion.clone();
    const startUp = this.deps.camera.up.clone();

    this.deps.controls.target.copy(dest);
    const parkDist = provider.focusParkDistance(target.idx);
    const eyeDist = this.deps.camera.position.distanceTo(dest);

    if (animate && eyeDist > parkDist) {
      this.startFocusLerp(newFocusLerpFrom(
        this.deps.camera.position,
        startQuat,
        startUp,
        dest,
        parkDist,
        FOCUS_LERP_MS,
        performance.now(),
        warpArrivalEaseFn({
          d0: eyeDist,
          dEnd: parkDist,
          targetRadius: provider.arrivalRadiusPc(target.idx),
        }),
      ));
      // controls.enabled stays true — see focusStar's comment.
    } else if (eyeDist > parkDist) {
      const dir = new THREE.Vector3()
        .subVectors(this.deps.camera.position, dest)
        .normalize();
      if (dir.lengthSq() === 0) dir.set(0, 0, 1);
      this.deps.camera.position.copy(dest).addScaledVector(dir, parkDist);
      this.deps.camera.lookAt(dest);
      this.deps.controls.update();
    } else {
      this.deps.controls.update();
    }
    this.setSoftFocus(target.kind, target.idx);
  }

  /** Orbit pivot moves to the object, the object becomes the focus,
   *  but the camera stays where it is (no teleport) — the URL-restore
   *  path when explicit camera params win, and the first-pick cloud
   *  click. For soft kinds the focus is set BEFORE the target write:
   *  displacing a star focus doesn't recentre worldOffset back to Sol,
   *  so the provider's local position is read in whatever frame the
   *  displacement left current. */
  setOrbitTarget(target: Target): void {
    if (target.kind === 'star') {
      this.deps.controls.target.copy(this.deps.frameAnchor.starLocalPosition(target.idx));
      this.deps.controls.update();
      this.setFocus(target.idx);
      return;
    }
    const provider = this.deps.getFocusables()[target.kind];
    if (!provider.localPositionInto(target.idx, this.tmpLive)) return;
    this.setSoftFocus(target.kind, target.idx);
    provider.localPositionInto(target.idx, this.deps.controls.target);
    this.deps.controls.update();
  }

  /** Clear focus + (optionally) animate the camera back to the focal
   *  star's parking distance. Honours the warp-active guard. Branches
   *  on cameraMode: observe → animated zoom-out via ObserveTransition
   *  startExit, navigate close-zoom → ObserveTransition startUnfocusLerp;
   *  otherwise hard-clears. */
  unfocus(opts: { animate?: boolean } = {}): void {
    if (this.deps.getWarp().isActive()) return;
    if (this.focused === null) {
      // Vector-only: nothing focused, but a measurement vector may be
      // drawn — wipe it (no-op when there's no vector either).
      this.clearVector();
      return;
    }
    // A focus-park lerp inbound to the same star we're now unfocusing
    // away from would otherwise race the unfocus zoom-out below.
    this.cancelFocusLerp();
    const animate = opts.animate ?? true;
    this.clearVector();
    // X-out from OBSERVE: drive the same animated zoom-out the
    // navigate-mode toggle uses, then clear focus. startExit captures
    // forward + camera.position before setFocus(null) runs, sets
    // cameraMode='navigate' (so setFocus's observe-cleanup branch
    // skips), and builds the 'exit' transition; setFocus(null)
    // afterwards clamps controls.minDistance and emits 'focus' so the
    // search box / overlays settle within the same frame. setFocus(null)
    // doesn't recentre, so the animation runs in the (former focal
    // star's) local frame.
    if (animate && this.cameraMode === 'observe' && this.focusedStar !== null) {
      this.deps.getObserve().startExit({ animate: true, clearFocusOnExit: false });
      this.setFocus(null);
      return;
    }
    // Navigate-mode close-zoom unfocus: animate the camera back to the
    // former focal star's parking distance instead of teleporting.
    // Skip when the camera is already further out than parkDistForStar
    // (the acceptance "no-op when at or beyond the floor" criterion),
    // or when there's no focused star to anchor on.
    if (
      animate
      && this.cameraMode === 'navigate'
      && this.focusedStar !== null
      && !this.deps.getObserve().isAnyActive()
    ) {
      const focalIdx = this.focusedStar;
      const minDist = this.parkDistForStar(focalIdx);
      const fromPos = this.deps.camera.position.clone();
      const eye = fromPos.distanceTo(this.deps.controls.target);
      if (eye < minDist) {
        const dir = fromPos.clone().sub(this.deps.controls.target).normalize();
        const toPos = this.deps.controls.target.clone().addScaledVector(dir, minDist);
        // Clear focus before the lerp starts so UI listeners (search box,
        // overlays, focus-ring) update immediately. setFocus(null) clamps
        // controls.minDistance to ≤ current eye, so the camera doesn't
        // fight the lerp's outward motion. After the lerp lands, the
        // controller's finish branch tightens minDistance to minDist.
        this.setFocus(null);
        // Don't toggle controls.enabled during the lerp. The animate()
        // dispatcher routes to observe.tick(), which lerps
        // camera.position directly and skips controls.update().
        // Disabling explicitly would race the click-to-unfocus event
        // chain (see ObserveTransition.startUnfocusLerp docblock).
        this.deps.getObserve().startUnfocusLerp(fromPos, toPos, minDist);
        return;
      }
    }
    // Single Target slot: setFocus(null) displaces a soft focus too.
    this.setFocus(null);
  }

  // ─── FocusTarget factories ─────────────────────────────────────────

  // Per-kind FocusTarget factories. The warp / camera-transition code
  // consumes these objects rather than switching on a `destKind`
  // literal; adding a new focusable kind = adding a factory + plumbing
  // pick / click handling to it, then everything below
  // (warp animation, mid-Fly recentre, pin guard, finishWarp event
  // family) just works without touching the warp internals. See
  // `src/client/README.md` § FocusTarget contract.

  /** applyFocus leg shared by all kinds: run the star-detach side
   *  effects when a star focus is displaced, then set the new target.
   *  No events fire — emitFocusEvents carries the whole transition in
   *  one 'focus' payload when the camera lands. */
  private applyFocusState(target: Target): void {
    if (this.focused !== null && this.focused.kind === 'star' && target.kind !== 'star') {
      this.refreshPlanetSystem(null);
      // Per-cloud/LG minDistance floor isn't tracked today; mirror
      // setFocus(null)'s clamp so the controls don't trap the camera
      // further out than the parked pose.
      const eye = this.deps.camera.position.distanceTo(this.deps.controls.target);
      this.deps.controls.minDistance = Math.min(GLOBAL_MIN_DIST_PC, eye);
    }
    this.focused = target;
  }

  /** Build a FocusTarget for the star at catalog index `idx`. */
  private makeStarFocusTarget(idx: number): FocusTarget {
    return {
      kind: 'star',
      idx,
      anchorInto: (out) => {
        const p = this.deps.catalog.positions;
        out.set(p[idx * 3], p[idx * 3 + 1], p[idx * 3 + 2]);
        return true;
      },
      localPositionInto: (out) => {
        this.deps.frameAnchor.starLocalPositionInto(idx, out);
        return true;
      },
      parkRadius: () => this.parkDistForStar(idx),
      applyFocus: () => {
        this.applyFocusState({ kind: 'star', idx });
        this.deps.controls.minDistance = starPhysics.minOrbitDistForStar({
          catalog: this.deps.catalog,
          idx,
          fovMinorRad: starPhysics.fovMinorRad(this.deps.camera),
        });
        this.refreshPlanetSystem(idx);
      },
      emitFocusEvents: () => {
        this.deps.bus.emit('focus', { kind: 'star', idx });
        this.deps.bus.emit('state');
      },
      physicalRadius: () =>
        Math.max(this.deps.catalog.physicalRadius[idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC,
      chartPlateauDistance: (magBright) =>
        chartPlateauDistancePc(this.deps.catalog.absmag[idx], magBright),
    };
  }

  /** Build a FocusTarget for the cloud at index `idx`. Returns null
   *  when the cloud layer hasn't loaded or the index is out of range. */
  private makeCloudFocusTarget(idx: number): FocusTarget | null {
    const clouds = this.deps.getClouds();
    if (!clouds) return null;
    const cloud = clouds.clouds[idx];
    if (!cloud) return null;
    return {
      kind: 'cloud',
      idx,
      anchorInto: (out) => {
        out.copy(cloud.centerAbs);
        return true;
      },
      localPositionInto: (out) => {
        const wo = this.deps.frameAnchor.getWorldOffset();
        out.copy(cloud.centerAbs).sub(wo);
        return true;
      },
      parkRadius: () => cloudViewingDistancePc(cloud),
      applyFocus: () => {
        this.applyFocusState({ kind: 'cloud', idx });
      },
      emitFocusEvents: () => {
        this.deps.bus.emit('focus', { kind: 'cloud', idx });
        this.deps.bus.emit('state');
      },
      physicalRadius: () => null,
      chartPlateauDistance: () => null,
    };
  }

  /** Build a FocusTarget for the LG object at index `idx`. Returns null
   *  when the layer hasn't loaded or the index is out of range. */
  private makeLgFocusTarget(idx: number): FocusTarget | null {
    const lg = this.deps.getLocalGroup();
    if (!lg) return null;
    const obj = lg.objects[idx];
    if (!obj) return null;
    return {
      kind: 'lg',
      idx,
      anchorInto: (out) => {
        out.copy(obj.centerAbs);
        return true;
      },
      localPositionInto: (out) => {
        const wo = this.deps.frameAnchor.getWorldOffset();
        out.copy(obj.centerAbs).sub(wo);
        return true;
      },
      parkRadius: () => lgViewingDistancePc(obj),
      applyFocus: () => {
        this.applyFocusState({ kind: 'lg', idx });
      },
      emitFocusEvents: () => {
        this.deps.bus.emit('focus', { kind: 'lg', idx });
        this.deps.bus.emit('state');
      },
      physicalRadius: () => null,
      chartPlateauDistance: () => null,
    };
  }

  /** Per-kind FocusTarget dispatch — the one switch, feeding warp and
   *  any future camera transition. Null when the target's layer hasn't
   *  loaded or the index is out of range. */
  makeFocusTarget(target: Target): FocusTarget | null {
    if (target.kind === 'star') return this.makeStarFocusTarget(target.idx);
    if (target.kind === 'cloud') return this.makeCloudFocusTarget(target.idx);
    return this.makeLgFocusTarget(target.idx);
  }

  /** Build a FocusTarget describing whichever object is currently
   *  focused, or null if nothing is focused. Source side of a warp. */
  currentFocusTarget(): FocusTarget | null {
    return this.focused === null ? null : this.makeFocusTarget(this.focused);
  }

  dispose(): void {
    this.focusLerpState = null;
    this.focused = null;
    this.vector = null;
    this.focusedPlanetSystem = null;
  }
}
