// Mode-agnostic pointer input: the canvas click FSM (single/double
// dispatch in both camera modes), the two-finger / Safari-gesture roll,
// and shift-drag pan binding. See README.md § Input controller.

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
import { bindShiftPan } from './shift-pan';

export interface InputControllerDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: TrackballControls;
  picker: Picker;
  bus: EventBus<StellataEventMap>;
  poiStore: PoiStore;
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
  private readonly shiftPanDispose: () => void;

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
  private readonly rollForward = new THREE.Vector3();
  private readonly rollQuat = new THREE.Quaternion();

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
    const canvas = deps.canvas;
    // Shift-drag panning: orbit on a plain drag, translate while Shift is
    // held. See shift-pan.ts.
    this.shiftPanDispose = bindShiftPan(deps.controls);
    canvas.addEventListener('pointerdown', this.onPointerDown);
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
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('touchstart', this.onTouchStart);
    canvas.removeEventListener('touchmove', this.onTouchMove);
    canvas.removeEventListener('touchend', this.onTouchEnd);
    canvas.removeEventListener('touchcancel', this.onTouchEnd);
    canvas.removeEventListener('gesturestart', this.onGestureStart as EventListener);
    canvas.removeEventListener('gesturechange', this.onGestureChange as EventListener);
    this.clickDispatcher.dispose();
    this.shiftPanDispose();
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerCancel = () => {
    this.pointerDownAt = null;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
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

  private dispatchSingleClick(x: number, y: number) {
    if (this.deps.isWarpActive() || this.deps.isAimActive()
      || this.deps.isObserveTransitionActive()) return;
    const did = this.deps.getCameraMode() === 'observe'
      ? this.observeSingleClick(x, y)
      : this.navigateSingleClick(x, y);
    // Only clicks that changed nothing ripple (overlays/click-ripple.ts)
    // — a click that did something has its own lasting feedback (ring,
    // vector, focus, aim) and doesn't need a second affordance.
    if (!did) this.deps.bus.emit('noopClick', { x, y });
  }

  private dispatchDoubleClick(x: number, y: number) {
    if (this.deps.isWarpActive() || this.deps.isAimActive()
      || this.deps.isObserveTransitionActive()) return;
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
   *  Local Group objects, and boundary shells — run the same tiebreak the
   *  hover engine uses (prime beats fallback, then closer camera), so
   *  click and hover can't disagree on which object wins an overlap.
   *  Shells are fallback-tier, so a star/planet/LG in front always wins. */
  private pickLadderObject(x: number, y: number): Target | null {
    const star = this.deps.picker.pickStarHit(x, y, 16);
    const planet = this.deps.picker.pickPlanetClick(x, y, 16);
    const lg = this.deps.picker.pickLocalGroupHit(x, y, 16);
    const shell = this.deps.picker.pickShellHit(x, y, 16);
    const picks: Array<{ kind: 'star' | 'planet' | 'lg' | 'shell'; hit: HoverHit } | null> = [
      star ? { kind: 'star', hit: star } : null,
      planet ? { kind: 'planet', hit: planet } : null,
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

  // Rotate the camera around the view direction.
  //
  // NAVIGATE: mutate camera.up — TrackballControls reads it every update()
  // and the orbit math needs the rolled vertical to persist through
  // subsequent orbit/zoom.
  //
  // OBSERVE: rotate camera.quaternion to actually roll the rendered image.
  // Also rotate camera.up by the same angle even though observe-controls.ts
  // doesn't read it: the URL state encodes camera.up, so leaving it stale
  // would lose the roll on round-trip (observe entry rebuilds the
  // quaternion from cam/tgt/up, dropping any roll baked into the
  // quaternion alone).
  private rollCamera(angle: number) {
    const forward = this.rollForward
      .subVectors(this.deps.controls.target, this.deps.camera.position);
    if (forward.lengthSq() === 0) return;
    forward.normalize();
    this.deps.camera.up.applyAxisAngle(forward, angle).normalize();
    if (this.deps.getCameraMode() === 'observe') {
      const q = this.rollQuat.setFromAxisAngle(forward, angle);
      this.deps.camera.quaternion.premultiply(q).normalize();
    }
  }
}
