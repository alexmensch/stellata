// Store for user-pinned points of interest — the single source of truth
// for the pinned-object list. See README.md for the pin semantics.

import { targetsEqual, type Target } from '../camera/focus/focus-target';

// POI cap. Bounds both the in-app pin list and the `?v=` blob's POI
// payload — one constant so the two can't drift apart.
export const POI_MAX_COUNT = 16;

export interface PoiStoreDeps {
  /** Catalog row count — out-of-range star indices are rejected. */
  count: number;
  /** Sol's catalog row — excluded from pinning (the dedicated HUD
   *  #sol-arrow already covers it). */
  solIndex: number;
  /** Per-record star SIDs. URL state persists POIs by SID, so a record
   *  without one (never occurs on a shipped catalog) is rejected. */
  sid: Uint32Array;
  /** Planet-kind pinnability: true when the flat instance index is
   *  covered by an attached host, which is also what makes its SID
   *  resolvable for the URL round-trip. */
  planetPinnable: (idx: number) => boolean;
  /** Fired after every accepted mutation with the live list. */
  onChange: (pois: readonly Target[]) => void;
}

export class PoiStore {
  // Insertion-ordered (Array, not Set) so round-trips through URL state
  // preserve the user's pin order.
  private pois: Target[] = [];

  constructor(private deps: PoiStoreDeps) {}

  get(): readonly Target[] {
    return this.pois;
  }

  has(target: Target): boolean {
    return this.pois.some((p) => targetsEqual(p, target));
  }

  atCap(): boolean {
    return this.pois.length >= POI_MAX_COUNT;
  }

  /** Whether `target` may be pinned at all (independent of the cap). */
  pinnable(target: Target): boolean {
    if (target.kind === 'star') {
      return (
        target.idx >= 0 &&
        target.idx < this.deps.count &&
        target.idx !== this.deps.solIndex &&
        this.deps.sid[target.idx] !== 0
      );
    }
    if (target.kind === 'planet') return this.deps.planetPinnable(target.idx);
    return false;
  }

  /** Pin `target`, or unpin it when already pinned. Unpinning always
   *  succeeds; pinning rejects (with a console breadcrumb, no state
   *  change) unpinnable targets and a list already at POI_MAX_COUNT.
   *  Returns whether the list changed. */
  toggle(target: Target): boolean {
    const existing = this.pois.findIndex((p) => targetsEqual(p, target));
    if (existing >= 0) {
      this.pois.splice(existing, 1);
      this.deps.onChange(this.pois);
      return true;
    }
    if (!this.pinnable(target)) {
      console.info(
        target.kind === 'star' && target.idx === this.deps.solIndex
          ? '[POI] Sol is excluded (already shown via #sol-arrow).'
          : `[POI] cannot pin ${target.kind} ${target.idx} (unknown or no SID).`,
      );
      return false;
    }
    if (this.pois.length >= POI_MAX_COUNT) {
      console.info(`[POI] cap reached (${POI_MAX_COUNT}); unpin one first.`);
      return false;
    }
    this.pois.push({ kind: target.kind, idx: target.idx });
    this.deps.onChange(this.pois);
    return true;
  }

  /** Replace the whole list (URL-state restore). Unpinnable entries and
   *  duplicates are dropped silently; the result is capped. No-op (no
   *  onChange) when the validated list matches the current one. */
  set(targets: readonly Target[]): void {
    const next: Target[] = [];
    for (const t of targets) {
      if (next.length >= POI_MAX_COUNT) break;
      if (!this.pinnable(t)) continue;
      if (next.some((p) => targetsEqual(p, t))) continue;
      next.push({ kind: t.kind, idx: t.idx });
    }
    if (
      next.length === this.pois.length &&
      next.every((v, i) => targetsEqual(v, this.pois[i]))
    ) return;
    this.pois = next;
    this.deps.onChange(this.pois);
  }

  clear(): void {
    if (this.pois.length === 0) return;
    this.pois = [];
    this.deps.onChange(this.pois);
  }
}
