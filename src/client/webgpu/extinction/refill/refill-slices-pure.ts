// Which quarter of the extinction refill worklist a frame marches, and the
// cursor that owes the rest. README.md.

/** Moving this moves the staleness bound — see README.md § The staleness
 *  this buys. */
export const REFILL_SLICES = 4;

/** CPU mirror of the kernel's `self % REFILL_SLICES`. */
export function refillQuarterOf(star: number, slices: number = REFILL_SLICES): number {
  return star % slices;
}

export interface RefillCursor {
  /** Armed frames still owed — one residue class built per frame; 0 parked. */
  readonly owed: number;
  /** The class built last frame and marched this one, if `built`. */
  readonly quarter: number;
  /** The compaction built a class last frame, so a march is owed now. */
  readonly built: boolean;
}

export const idleRefill = (): RefillCursor => ({ owed: 0, quarter: 0, built: false });

export const refillInFlight = (cursor: RefillCursor): boolean => cursor.owed > 0 || cursor.built;

export interface RefillPlan {
  /** March `quarter` this frame. */
  readonly dispatch: boolean;
  readonly quarter: number;
  /** The compaction builds `next.quarter` this frame. */
  readonly arm: boolean;
  readonly next: RefillCursor;
}

/** A request arms the producer for every class again; each armed frame
 *  builds one and the next frame marches it — README.md § The cursor. */
export function planRefill(
  cursor: RefillCursor, wanted: boolean, slices: number = REFILL_SLICES,
): RefillPlan {
  const dispatch = cursor.built;
  const owed = wanted ? slices : cursor.owed;
  const arm = owed > 0;
  const { quarter } = cursor;
  return {
    dispatch,
    quarter,
    arm,
    next: {
      owed: arm ? owed - 1 : 0,
      quarter: dispatch ? (quarter + 1) % slices : quarter,
      built: arm,
    },
  };
}
