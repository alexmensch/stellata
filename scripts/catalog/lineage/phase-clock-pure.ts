// A stage lineage's timed window split by phase, so a budget overrun names the phase that spent it.

export interface PhaseClock {
  /** Runs `work`, charging its wall-clock to `phase`; a phase lapped twice adds up. */
  lap<T>(phase: string, work: () => T): T;
  totalMs(): number;
  /** `phase ms, …` in first-lap order, whole milliseconds. */
  report(): string;
}

export function phaseClock(now: () => number): PhaseClock {
  const spent = new Map<string, number>();
  const started = now();
  return {
    lap(phase, work) {
      const from = now();
      try {
        return work();
      } finally {
        spent.set(phase, (spent.get(phase) ?? 0) + now() - from);
      }
    },
    totalMs: () => now() - started,
    report: () => [...spent].map(([phase, ms]) => `${phase} ${ms.toFixed(0)}`).join(', '),
  };
}
