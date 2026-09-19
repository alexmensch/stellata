// Which quarter of the extinction refill worklist a frame marches, and the
// cursor that owes the rest. README.md.

/** Moving this moves the staleness bound — see README.md § The staleness
 *  this buys. */
export const REFILL_SLICES = 4;

/** Capacity of one quarter's sub-list — a residue class is at most this
 *  large (README.md § The compaction appends the worklist). */
export function refillSliceLength(count: number, slices: number = REFILL_SLICES): number {
  return Math.max(1, Math.ceil(count / Math.max(1, slices)));
}

/** CPU mirror of the kernel's `self % REFILL_SLICES`. */
export function refillQuarterOf(star: number, slices: number = REFILL_SLICES): number {
  return star % slices;
}

export function refillListBase(
  quarter: number, count: number, slices: number = REFILL_SLICES,
): number {
  return quarter * refillSliceLength(count, slices);
}

export function refillWorklistLength(count: number, slices: number = REFILL_SLICES): number {
  return slices * refillSliceLength(count, slices);
}

export interface RefillCursor {
  /** Quarters still owed on the list the compaction last built; 0 parked. */
  readonly owed: number;
  /** Marched next, and sized by the compaction's finish kernel. */
  readonly quarter: number;
}

export const idleRefill = (): RefillCursor => ({ owed: 0, quarter: 0 });

export interface RefillPlan {
  /** March `quarter` of the list this frame. */
  readonly dispatch: boolean;
  readonly quarter: number;
  /** The compaction rebuilds the list this frame. */
  readonly arm: boolean;
  readonly next: RefillCursor;
}

/** A request arms the producer and owes every quarter again; a frame with
 *  quarters owed marches one — README.md § The cursor. */
export function planRefill(
  cursor: RefillCursor, wanted: boolean, slices: number = REFILL_SLICES,
): RefillPlan {
  const dispatch = cursor.owed > 0;
  const { quarter } = cursor;
  return {
    dispatch,
    quarter,
    arm: wanted,
    next: {
      owed: wanted ? slices : Math.max(0, cursor.owed - 1),
      quarter: dispatch ? (quarter + 1) % slices : quarter,
    },
  };
}
