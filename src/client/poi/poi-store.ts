// Store for user-pinned points of interest — the single source of truth
// for the pinned-star list. See README.md for the pin semantics.

// POI cap. Bounds both the in-app pin list and the `?v=` blob's POI
// payload — one constant so the two can't drift apart.
export const POI_MAX_COUNT = 16;

export interface PoiStoreDeps {
  /** Catalog row count — out-of-range indices are rejected. */
  count: number;
  /** Sol's catalog row — excluded from pinning (the dedicated HUD
   *  #sol-arrow already covers it). */
  solIndex: number;
  /** Per-record SIDs. URL state persists POIs by SID, so a record
   *  without one (never occurs on a shipped catalog) is rejected. */
  sid: Uint32Array;
  /** Fired after every accepted mutation with the live list. */
  onChange: (pois: readonly number[]) => void;
}

export class PoiStore {
  // Insertion-ordered (Array, not Set) so round-trips through URL state
  // preserve the user's pin order.
  private pois: number[] = [];

  constructor(private deps: PoiStoreDeps) {}

  get(): readonly number[] {
    return this.pois;
  }

  has(idx: number): boolean {
    return this.pois.indexOf(idx) >= 0;
  }

  atCap(): boolean {
    return this.pois.length >= POI_MAX_COUNT;
  }

  /** Whether `idx` may be pinned at all (independent of the cap). */
  pinnable(idx: number): boolean {
    return (
      idx >= 0 &&
      idx < this.deps.count &&
      idx !== this.deps.solIndex &&
      this.deps.sid[idx] !== 0
    );
  }

  /** Pin `idx`, or unpin it when already pinned. Rejects (with a console
   *  breadcrumb, no state change) unpinnable indices and, when adding,
   *  a list already at POI_MAX_COUNT. */
  toggle(idx: number): void {
    if (idx < 0 || idx >= this.deps.count) return;
    if (idx === this.deps.solIndex) {
      console.info('[POI] Sol is excluded (already shown via #sol-arrow).');
      return;
    }
    if (this.deps.sid[idx] === 0) {
      console.info('[POI] cannot pin a star without a SID.');
      return;
    }
    const existing = this.pois.indexOf(idx);
    if (existing >= 0) {
      this.pois.splice(existing, 1);
      this.deps.onChange(this.pois);
      return;
    }
    if (this.pois.length >= POI_MAX_COUNT) {
      console.info(`[POI] cap reached (${POI_MAX_COUNT}); unpin one first.`);
      return;
    }
    this.pois.push(idx);
    this.deps.onChange(this.pois);
  }

  /** Replace the whole list (URL-state restore). Unpinnable entries and
   *  duplicates are dropped silently; the result is capped. No-op (no
   *  onChange) when the validated list matches the current one. */
  set(idxs: readonly number[]): void {
    const next: number[] = [];
    for (const idx of idxs) {
      if (next.length >= POI_MAX_COUNT) break;
      if (!this.pinnable(idx)) continue;
      if (next.indexOf(idx) >= 0) continue;
      next.push(idx);
    }
    if (
      next.length === this.pois.length &&
      next.every((v, i) => v === this.pois[i])
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
