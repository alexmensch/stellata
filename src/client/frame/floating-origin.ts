// The floating-origin service: worldOffset ownership, the ordered
// recentre fan-out, and the pluggable anchor-policy seam. See ./README.md.

import * as THREE from 'three';

/** Decides where the local origin should sit this frame: the desired
 *  absolute-space origin written into `out`, or null to leave the
 *  origin where it is. Implementations close over their own gates
 *  (focus state, camera-busy checks) — the service stays free of
 *  camera and focus knowledge. */
export type AnchorPolicy = (out: THREE.Vector3) => THREE.Vector3 | null;

export type RecenterListener = (
  newOrigin: Readonly<THREE.Vector3>,
  delta: Readonly<THREE.Vector3>,
) => void;

/**
 * Owns the renderer's floating local frame: `worldOffset` (the
 * absolute-space coordinate at local (0,0,0)), the `uWorldOffset`
 * shader mirror, and the recentre fan-out every frame-holding consumer
 * subscribes to. `tick()` applies the anchor policy; `recenterTo` is
 * the direct entry point for callers that recentre on their own
 * trigger (focus mutations, warp mid-fly, URL restore).
 */
export class FloatingOrigin {
  /** Absolute-space coordinate sitting at local (0,0,0). Read-only to
   *  callers — `recenterTo` is the only writer; consumers that subtract
   *  it per frame (StarFrame) hold it by reference. */
  readonly worldOffset = new THREE.Vector3();

  private readonly listeners = new Set<RecenterListener>();
  private policy: AnchorPolicy | null = null;
  private readonly delta = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();

  constructor(private readonly uWorldOffset: { value: THREE.Vector3 }) {}

  /** Register a recentre listener; fan-out order is registration order.
   *  Order is load-bearing: the star-buffer rewrite must run before the
   *  camera/target shift and the scene-layer fan-out (./README.md
   *  § Recentre fan-out). Returns an unsubscribe, safe to call from
   *  inside the fan-out. */
  onRecenter(listener: RecenterListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setPolicy(policy: AnchorPolicy | null): void {
    this.policy = policy;
  }

  /**
   * Shift the local origin to `newOrigin` (absolute space) — see
   * ./README.md § Floating origin. Returns the applied (dx, dy, dz),
   * null on the no-op path (no listener fires). The returned Vector3
   * is shared scratch — copy it to outlive the next call.
   */
  recenterTo(newOrigin: THREE.Vector3): THREE.Vector3 | null {
    const dx = newOrigin.x - this.worldOffset.x;
    const dy = newOrigin.y - this.worldOffset.y;
    const dz = newOrigin.z - this.worldOffset.z;
    if (dx === 0 && dy === 0 && dz === 0) return null;
    this.worldOffset.copy(newOrigin);
    this.uWorldOffset.value.copy(newOrigin);
    this.delta.set(dx, dy, dz);
    for (const listener of this.listeners) listener(this.worldOffset, this.delta);
    return this.delta;
  }

  /** Apply the anchor policy: recentre onto its desired origin when it
   *  names one. Returns true iff this call recentred — callers key
   *  policy-driven side effects on this return, never on a recentre
   *  listener, so an externally triggered recentre (warp mid-fly)
   *  doesn't run them. */
  tick(): boolean {
    const want = this.policy?.(this.desired);
    if (!want) return false;
    return this.recenterTo(want) !== null;
  }

  dispose(): void {
    this.listeners.clear();
    this.policy = null;
  }
}
