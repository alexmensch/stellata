// Pure statistics for the frame-cost harness: dwell summaries and
// baseline-vs-disabled differential rows. See README.md § Frame pricing.

export interface DwellStats {
  readonly samples: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

export interface PriceFrameRow {
  readonly pass: string;
  readonly method: 'timer-query' | 'raf-delta';
  readonly baselineMs: number;
  readonly disabledMs: number;
  readonly savedMs: number;
  readonly savedPct: number;
  readonly samples: number;
  readonly spreadMs: number;
}

export function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeDwell(samples: readonly number[]): DwellStats | null {
  if (samples.length === 0) return null;
  return {
    samples: samples.length,
    medianMs: median(samples),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

/** One table row: what disabling `pass` saved against the baseline dwell.
 *  spreadMs is the wider of the two dwells' max−min — the run-to-run
 *  noise floor a differential has to clear before it means anything. */
export function buildPriceRow(
  pass: string,
  method: PriceFrameRow['method'],
  baseline: DwellStats,
  disabled: DwellStats,
): PriceFrameRow {
  const savedMs = baseline.medianMs - disabled.medianMs;
  return {
    pass,
    method,
    baselineMs: round3(baseline.medianMs),
    disabledMs: round3(disabled.medianMs),
    savedMs: round3(savedMs),
    savedPct: baseline.medianMs > 0 ? round1((savedMs / baseline.medianMs) * 100) : 0,
    samples: Math.min(baseline.samples, disabled.samples),
    spreadMs: round3(Math.max(
      baseline.maxMs - baseline.minMs,
      disabled.maxMs - disabled.minMs,
    )),
  };
}

function round3(x: number): number {
  return Number(x.toFixed(3));
}

function round1(x: number): number {
  return Number(x.toFixed(1));
}
