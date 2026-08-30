/** Hold window for a click, so a second one inside it reads as a double
 *  instead of two singles. One value across every surface that
 *  disambiguates the pair — the canvas click FSM and the attitude ball. */
export const DBL_CLICK_MS = 280;

/** Squared pointer travel a second click may sit from the first and still
 *  pair with it. */
export const DBL_CLICK_DIST_PX_SQ = 8 * 8;

/** Defers each click for `dblMs` so a second click landing within
 *  `maxDistPxSq` of it fires `onDouble` instead of two `onSingle`s. */
export class PendingClickDispatcher {
  private pending: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly dblMs: number,
    private readonly maxDistPxSq: number,
    private readonly onSingle: (x: number, y: number) => void,
    private readonly onDouble: (x: number, y: number) => void,
  ) {}

  click(x: number, y: number): void {
    const pending = this.pending;
    if (pending) {
      const dx = x - pending.x;
      const dy = y - pending.y;
      if (dx * dx + dy * dy <= this.maxDistPxSq) {
        clearTimeout(pending.timer);
        this.pending = null;
        this.onDouble(x, y);
        return;
      }
      // Far apart → treat as a fresh first click. Fire the original
      // pending single immediately so it isn't swallowed.
      clearTimeout(pending.timer);
      this.pending = null;
      this.onSingle(pending.x, pending.y);
    }
    const timer = setTimeout(() => {
      this.pending = null;
      this.onSingle(x, y);
    }, this.dblMs);
    this.pending = { x, y, timer };
  }

  /** Drop any held click without firing it. */
  cancel(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }

  dispose(): void {
    this.cancel();
  }
}
