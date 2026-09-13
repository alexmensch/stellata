// How many rendered frames apart the statistic readback may go out, for a
// caller that needs the duty cycle held rather than emergent.
// README.md § Latency.

export class ReadbackCadence {
  /** Rendered frames between readbacks, or null for the emergent rate the
   *  app runs at — a request as soon as the last one has landed. */
  every: number | null = null;

  private since = 0;

  /**
   * Once per rendered frame, BEFORE any early-out the caller takes — a
   * pinned cadence counts frames, and counting only the frames a request
   * could have gone out on stretches the period by the readback's own round
   * trip. True admits a request; a caller that cannot take it leaves the
   * count standing and gets the slot on the next frame it can, so the
   * cadence caps the rate and never raises it.
   */
  dueThisFrame(): boolean {
    this.since += 1;
    return this.every === null || this.since >= this.every;
  }

  /** A request went out: the count starts again. */
  issued(): void {
    this.since = 0;
  }

  reset(): void {
    this.since = 0;
  }
}
