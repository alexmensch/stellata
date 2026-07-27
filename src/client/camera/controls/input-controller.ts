// Mode-agnostic pointer input: the canvas click FSM (single/double
// dispatch in both camera modes) and the roll gestures — Shift-drag,
// two-finger twist, Safari trackpad. See README.md § Input controller.

import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { EventBus } from '../../util/event-bus';
import type { CameraMode, StellataEventMap } from '../../stellata';
import { targetsEqual, type Target } from '../focus/focus-target';
import type { FilterState } from '../../filters/filter-state';
import type { PoiStore } from '../../poi/poi-store';
import { clickLadderAction } from '../../poi/click-ladder-pure';
import { PendingClickDispatcher } from '../../util/pending-click';
import { bestHitBy } from '../../hover/hover-pick-disambiguator';
import type { HoverHit } from '../../hover/hover-types';
import type { Picker } from './picker';
import type { ReferenceUpController } from './reference-up';
import { SNAP_TO_LEVEL_RAD } from './reference-up-pure';

export interface InputControllerDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: TrackballControls;
  picker: Picker;
  bus: EventBus<StellataEventMap>;
  poiStore: PoiStore;
  referenceUp: ReferenceUpController;
  getCameraMode: () => CameraMode;
  getFilter: () => Readonly<FilterState>;
  getFocusedTarget: () => Target | null;
  getVectorTarget: () => Target | null;
  setVector: (target: Target | null) => void;
  /** Composition-layer busy gates + cancellation the FSM re-checks at
   *  pointer-up AND again when a deferred click fires. */
  isWarpActive: () => boolean;
  isAimActive: () => boolean;
  isObserveTransitionActive: () => boolean;
  cancelUnfocusLerp: () => void;
  cancelFocusLerp: () => void;
  flyTo: (target: Target) => void;
  setOrbitTarget: (target: Target) => void;
  unfocus: () => void;
  togglePoi: (target: Target) => boolean;
  aimAt: (pointLocal: THREE.Vector3) => void;
}

export class InputController {
  private readonly deps: InputControllerDeps;

  private pointerDownAt: { x: number; y: number; t: number } | null = null;
  private twoFingerAngle: number | null = null;
  private gestureLastRotation = 0;
  // Shift-drag roll. `angle` is null while the pointer sits inside the
  // dead-zone at screen centre, where the atan2 bearing is unstable — the
  // next sample outside it re-seeds instead of rolling by a jump.
  private rollDrag: { pointerId: number; angle: number | null } | null = null;

  // Canvas clicks in BOTH modes are held for DBL_CLICK_MS so single
  // (per-mode click semantics) and double (aim-at in observe, travel in
  // navigate) can be disambiguated.
  private static DBL_CLICK_MS = 280;
  private static DBL_CLICK_DIST_PX_SQ = 8 * 8;
  private readonly clickDispatcher = new PendingClickDispatcher(
    InputController.DBL_CLICK_MS,
    InputController.DBL_CLICK_DIST_PX_SQ,
    (x, y) => this.dispatchSingleClick(x, y),
    (x, y) => this.dispatchDoubleClick(x, y),
  );

  // Scratch — one writer per gesture/click event, never retained.
  private readonly dblClickRay = new THREE.Vector3();
  private readonly dblClickAimPoint = new THREE.Vector3();

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
    const canvas = deps.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    // pointercancel partner for pointerdown/pointerup. Without it an
    // OS-cancelled touch (phone-call interrupt, system gesture preempt)
    // leaves pointerDownAt set, and the next genuine pointerup may satisfy
    // the click gates against a stale 'down' from a different gesture and
    // fire a phantom click.
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    // Two-finger roll. Touch events for mobile; gesture* events for Safari
    // desktop trackpad. Chrome/Firefox desktop don't expose a rotate gesture,
    // so roll is unavailable there by design.
    canvas.addEventListener('touchstart', this.onTouchStart);
    canvas.addEventListener('touchmove', this.onTouchMove);
    canvas.addEventListener('touchend', this.onTouchEnd);
    canvas.addEventListener('touchcancel', this.onTouchEnd);
    canvas.addEventListener('gesturestart', this.onGestureStart as EventListener);
    canvas.addEventListener('gesturechange', this.onGestureChange as EventListener);
  }

  dispose(): void {
    const canvas = this.deps.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('touchstart', this.onTouchStart);
    canvas.removeEventListener('touchmove', this.onTouchMove);
    canvas.removeEventListener('touchend', this.onTouchEnd);
    canvas.removeEventListener('touchcancel', this.onTouchEnd);
    canvas.removeEventListener('gesturestart', this.onGestureStart as EventListener);
    canvas.removeEventListener('gesturechange', this.onGestureChange as EventListener);
    this.clickDispatcher.dispose();
    this.endRollDrag();
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Shift decides the gesture at press time and holds for its duration:
    // TrackballControls seeds its drag deltas on pointerdown and only
    // advances them inside the rotate step this suppresses, so handing the
    // drag back mid-gesture would resume orbit against a stale delta.
    if (e.shiftKey) {
      this.deps.controls.noRotate = true;
      this.rollDrag = { pointerId: e.pointerId, angle: this.screenBearing(e) };
      return;
    }
    this.pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerCancel = () => {
    this.pointerDownAt = null;
    this.endRollDrag();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (this.rollDrag !== null) {
      this.endRollDrag();
      this.snapRollToLevel();
      return;
    }
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!down) return;
    if (this.deps.isWarpActive() || this.deps.isAimActive()) return;
    this.deps.cancelUnfocusLerp();
    this.deps.cancelFocusLerp();
    if (this.deps.isObserveTransitionActive()) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (dx * dx + dy * dy > 25) return;
    if (performance.now() - down.t > 500) return;

    // Both modes hold the click for DBL_CLICK_MS via the shared
    // dispatcher; the deferred handlers re-check the volatile guards
    // (warp / aim / transition) at fire time.
    this.clickDispatcher.click(e.clientX, e.clientY);
  };

  /** Deliberately narrower than `Stellata.isCameraBusy()`: the focus-park
   *  and unfocus lerps are *cancelled* by a click, not blocked by it, so
   *  including them here would make every click self-block. See
   *  `../README.md` § Camera-activity predicates. */
  private blocksClick(): boolean {
    return this.deps.isWarpActive()
      || this.deps.isAimActive()
      || this.deps.isObserveTransitionActive();
  }

  private dispatchSingleClick(x: number, y: number) {
    if (this.blocksClick()) return;
    const did = this.deps.getCameraMode() === 'observe'
      ? this.observeSingleClick(x, y)
      : this.navigateSingleClick(x, y);
    // Only clicks that changed nothing ripple (overlays/click-ripple.ts)
    // — a click that did something has its own lasting feedback (ring,
    // vector, focus, aim) and doesn't need a second affordance.
    if (!did) this.deps.bus.emit('noopClick', { x, y });
  }

  private dispatchDoubleClick(x: number, y: number) {
    if (this.blocksClick()) return;
    if (this.deps.getCameraMode() === 'observe') {
      this.observeDoubleClick(x, y);
      return;
    }
    // Navigate double-click = travel: the focus-park teleport that
    // click-the-vector-tip used to trigger, now on any star, planet,
    // or cloud.
    const picked = this.pickLadderObject(x, y);
    if (picked !== null) {
      this.deps.flyTo(picked);
      return;
    }
    const cloudIdx = this.deps.picker.pickCloud(x, y);
    if (cloudIdx !== null) {
      this.deps.flyTo({ kind: 'cloud', idx: cloudIdx });
      return;
    }
    this.deps.bus.emit('noopClick', { x, y });
  }

  /** Ladder-eligible objects under the cursor — stars, planet bodies,
   *  probes, Local Group objects, and boundary shells — run the same
   *  tiebreak the hover engine uses (prime beats fallback, then closer
   *  camera), so click and hover can't disagree on which object wins an
   *  overlap. Shells are fallback-tier, so a star/planet/probe/LG in
   *  front always wins. */
  private pickLadderObject(x: number, y: number): Target | null {
    const star = this.deps.picker.pickStarHit(x, y, 16);
    const planet = this.deps.picker.pickPlanetClick(x, y, 16);
    const probe = this.deps.picker.pickProbeHit(x, y, 16);
    const lg = this.deps.picker.pickLocalGroupHit(x, y, 16);
    const shell = this.deps.picker.pickShellHit(x, y);
    const picks: Array<{ kind: 'star' | 'planet' | 'probe' | 'lg' | 'shell'; hit: HoverHit } | null> = [
      star ? { kind: 'star', hit: star } : null,
      planet ? { kind: 'planet', hit: planet } : null,
      probe ? { kind: 'probe', hit: probe } : null,
      lg ? { kind: 'lg', hit: lg } : null,
      shell ? { kind: 'shell', hit: shell } : null,
    ];
    const winner = bestHitBy(picks, (p) => p.hit);
    return winner === null ? null : { kind: winner.kind, idx: winner.hit.idx };
  }

  private navigateSingleClick(x: number, y: number): boolean {
    // Point objects (stars, planet bodies) are the primary interaction
    // targets. Fall back to clouds when neither is hit.
    const picked = this.pickLadderObject(x, y);
    if (picked !== null) {
      return this.applyObjectClick(picked);
    }
    const cloudIdx = this.deps.picker.pickCloud(x, y);
    if (cloudIdx === null) return false;

    // Clouds keep the pre-ladder vector-first semantics (stellata-t2u5
    // tracks folding them into the click ladder).
    const clicked: Target = { kind: 'cloud', idx: cloudIdx };
    const focused = this.deps.getFocusedTarget();
    if (focused === null) {
      this.deps.setOrbitTarget(clicked);
      return true;
    }
    if (focused.kind === 'cloud' && focused.idx === cloudIdx) {
      if (this.deps.getVectorTarget() !== null) {
        this.deps.setVector(null);
      } else {
        this.deps.unfocus();
      }
      return true;
    }
    const vec = this.deps.getVectorTarget();
    if (vec !== null && vec.kind === 'cloud' && vec.idx === cloudIdx) {
      this.deps.flyTo(clicked);
      return true;
    }
    this.deps.setVector(clicked);
    return true;
  }

  /**
   * Canonical per-mode click semantics for point objects — one path for
   * every kind; deferred canvas clicks and the POI overlay's on-screen
   * labels both route here. Observe toggles the pin; navigate handles
   * focus / unfocus, then runs the click ladder (pin → vector → clear
   * both) for any other object. Returns whether the click changed
   * anything (false → noop-click ripple).
   */
  applyObjectClick(target: Target): boolean {
    if (this.deps.getCameraMode() === 'observe') {
      // Mirror the POI overlay visibility gate — toggling without a
      // visible ring/arrow would change state with no feedback.
      if (!this.deps.getFilter().showHud) return false;
      return this.deps.togglePoi(target);
    }

    const focused = this.deps.getFocusedTarget();

    // No focus → click parks the camera at the clicked object, matching
    // search-select and URL-restore.
    if (focused === null) {
      this.deps.flyTo(target);
      return true;
    }

    // Click on the focused object → clear vector if present (the
    // destination stays pinned), else unfocus.
    if (targetsEqual(focused, target)) {
      if (this.deps.getVectorTarget() !== null) {
        this.deps.setVector(null);
      } else {
        this.deps.unfocus();
      }
      return true;
    }

    // Pins are HUD widgets — with the HUD hidden a pin would be an
    // invisible state change, so the ladder sees HUD-off objects as
    // unpinnable/unpinned and steps only its vector rungs (existing
    // pins are left untouched). Mirrors the observe-branch gate above.
    const hudOn = this.deps.getFilter().showHud;
    const action = clickLadderAction({
      pinnable: hudOn && this.deps.poiStore.pinnable(target),
      pinned: hudOn && this.deps.poiStore.has(target),
      atCap: this.deps.poiStore.atCap(),
      isVectorDest: targetsEqual(this.deps.getVectorTarget(), target),
    });
    switch (action) {
      case 'pin': return this.deps.togglePoi(target);
      case 'vector': this.deps.setVector(target); return true;
      case 'clearVector': this.deps.setVector(null); return true;
      case 'clearBoth':
        this.deps.setVector(null);
        this.deps.togglePoi(target);
        return true;
    }
  }

  private observeSingleClick(x: number, y: number): boolean {
    const picked = this.pickLadderObject(x, y);
    if (picked === null) return false;
    return this.applyObjectClick(picked);
  }

  private observeDoubleClick(x: number, y: number) {
    // Convert (clientX, clientY) → NDC → unproject → world ray direction.
    // Build a far point along the ray and feed it to aimAt — that path
    // already handles the quaternion slerp, the duration ramp, and
    // disabling observeControls for the duration.
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dblClickRay.set((x / w) * 2 - 1, -(y / h) * 2 + 1, 0.5);
    this.dblClickRay.unproject(this.deps.camera);
    this.dblClickRay.sub(this.deps.camera.position).normalize();
    this.dblClickAimPoint
      .copy(this.deps.camera.position)
      .addScaledVector(this.dblClickRay, 1e6);
    this.deps.aimAt(this.dblClickAimPoint);
  }

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      this.twoFingerAngle = this.touchAngle(e.touches);
    } else {
      this.twoFingerAngle = null;
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2 || this.twoFingerAngle === null) return;
    const a = this.touchAngle(e.touches);
    let d = a - this.twoFingerAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    this.twoFingerAngle = a;
    this.rollCamera(-d);
  };

  private onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length !== 2) this.twoFingerAngle = null;
  };

  private touchAngle(t: TouchList): number {
    return Math.atan2(
      t[1].clientY - t[0].clientY,
      t[1].clientX - t[0].clientX,
    );
  }

  private onGestureStart = (e: Event) => {
    e.preventDefault();
    this.gestureLastRotation = 0;
  };

  private onGestureChange = (e: Event) => {
    e.preventDefault();
    const rot = (e as Event & { rotation: number }).rotation;
    const delta = ((rot - this.gestureLastRotation) * Math.PI) / 180;
    this.gestureLastRotation = rot;
    this.rollCamera(-delta);
  };

  private onPointerMove = (e: PointerEvent) => {
    const drag = this.rollDrag;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    const bearing = this.screenBearing(e);
    if (bearing === null) {
      drag.angle = null;
      return;
    }
    if (drag.angle !== null) {
      let d = bearing - drag.angle;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      this.rollCamera(-d);
    }
    drag.angle = bearing;
  };

  /** Pointer bearing about screen centre, or null inside the dead-zone. */
  private screenBearing(e: PointerEvent): number | null {
    const dx = e.clientX - window.innerWidth / 2;
    const dy = e.clientY - window.innerHeight / 2;
    if (dx * dx + dy * dy < ROLL_DEADZONE_PX * ROLL_DEADZONE_PX) return null;
    return Math.atan2(dy, dx);
  }

  private endRollDrag(): void {
    if (this.rollDrag === null) return;
    this.rollDrag = null;
    this.deps.controls.noRotate = false;
  }

  /** Alignment-guide snap: a release that leaves the view within
   *  `SNAP_TO_LEVEL_RAD` of galactic level lands exactly level. Evaluated on
   *  release only — a per-frame test would chatter at the boundary. */
  private snapRollToLevel(): void {
    const camera = this.deps.camera;
    const refUp = this.deps.referenceUp;
    if (this.deps.getCameraMode() === 'observe') {
      const err = refUp.renderedRollError(camera);
      if (Math.abs(err) <= SNAP_TO_LEVEL_RAD) refUp.rollQuaternion(camera, err);
      return;
    }
    if (Math.abs(refUp.referenceRollError(camera)) <= SNAP_TO_LEVEL_RAD) {
      refUp.snapReferenceToNorth(camera);
    }
  }

  /** Rotate the view around its own axis. NAVIGATE re-tilts the reference up
   *  axis (the persistent roll state the per-frame correction derives
   *  `camera.up` from); OBSERVE rolls the quaternion, which carries the
   *  rendered roll there. */
  private rollCamera(angle: number) {
    if (this.deps.getCameraMode() === 'observe') {
      this.deps.referenceUp.rollQuaternion(this.deps.camera, angle);
    } else {
      this.deps.referenceUp.roll(this.deps.camera, angle);
    }
  }
}

/** Radius around screen centre where the roll bearing is too unstable to
 *  sample — a twist gesture there would spin on sub-pixel jitter. */
const ROLL_DEADZONE_PX = 40;
