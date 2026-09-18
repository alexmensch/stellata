// Which slots the extinction refill dispatches this frame, and what the
// cursor becomes. README.md.

/** Moving this moves the staleness bound — see README.md § The staleness
 *  this buys. */
export const REFILL_SLICES = 4;

/** Slots per dispatch. Every slice but the last is this long. */
export function refillSliceLength(count: number, slices: number = REFILL_SLICES): number {
  return Math.max(1, Math.ceil(count / Math.max(1, slices)));
}

export interface RefillCursor {
  /** Next slot to refill; `count` once the cycle has covered the catalogue. */
  readonly base: number;
  readonly pending: boolean;
}

/** A cursor with nothing to do — `base` at the end of the catalogue. */
export const idleRefill = (count: number): RefillCursor => ({ base: count, pending: false });

export interface RefillPlan {
  /** Null dispatches nothing this frame. */
  readonly base: number | null;
  readonly length: number;
  readonly next: RefillCursor;
  /** This dispatch reaches the end of the catalogue. */
  readonly completesCycle: boolean;
}

/** A request never restarts a running cycle — README.md § The cursor. */
export function planRefill(
  cursor: RefillCursor, wanted: boolean, count: number, sliceLength: number,
): RefillPlan {
  let { base, pending } = cursor;
  if (wanted) {
    if (base >= count) {
      base = 0;
      pending = false;
    } else {
      pending = true;
    }
  }
  if (base >= count || count <= 0) {
    return { base: null, length: 0, next: { base, pending }, completesCycle: false };
  }
  const length = Math.min(sliceLength, count - base);
  const end = base + length;
  const completesCycle = end >= count;
  const next: RefillCursor = completesCycle && pending
    ? { base: 0, pending: false }
    : { base: end, pending };
  return { base, length, next, completesCycle };
}
