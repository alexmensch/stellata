// Store for user-pinned points of interest — the single source of truth
// for the pinned-object list. See README.md for the pin semantics.

import { targetsEqual, type Target, type TargetKind } from '../camera/focus/focus-target';

// POI cap. Bounds both the in-app pin list and the `?v=` blob's POI
// payload — one constant so the two can't drift apart.
export const POI_MAX_COUNT = 16;

export interface PoiStoreDeps {
  /** Per-kind pin rule, EXHAUSTIVE over TargetKind — a new focusable
   *  kind must state its rule (or `() => false`) to compile, the same
   *  contract FocusableProviders / FocusCardProviders carry. URL state
   *  persists POIs by SID, so every rule must imply a resolvable SID. */
  pinnable: { readonly [K in TargetKind]: (idx: number) => boolean };
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
    return this.deps.pinnable[target.kind](target.idx);
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
      console.info(`[POI] cannot pin ${target.kind} ${target.idx} (unknown or no SID).`);
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
