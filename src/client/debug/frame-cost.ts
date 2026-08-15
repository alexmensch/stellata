// Console-driven differential frame pricing: dwell on gpu.frame with one
// pass disabled at a time and difference the medians.
// See README.md § Frame pricing.

import type { Stellata } from '../stellata';
import { acquireGpuFrameSampler } from './perf-hud';
import {
  buildPriceRow,
  summarizeDwell,
  type DwellStats,
  type PriceFrameRow,
} from './frame-cost-pure';

export interface PassToggle {
  /** Row label in the output table. */
  readonly key: string;
  /** False when the pass is not contributing at the current view/state —
   *  the row is skipped with a note rather than measured as a
   *  meaningless zero, and the pass's state is never touched. */
  present(): boolean;
  /** Turn the pass off; returns the restore. Only called when present(). */
  disable(): () => void;
}

export interface PriceFrameOptions {
  /** Subset of pass keys to price; defaults to every present pass. */
  passes?: readonly string[];
  /** Frames whose samples count, per state. */
  dwellFrames?: number;
  /** Frames discarded after each state flip — absorbs rebuilds, shader
   *  recompiles, and the previous state's in-flight query results. */
  settleFrames?: number;
  /** Frames discarded before the baseline dwell. A cold first dwell
   *  biases every row against it, since it alone is the subtrahend. */
  warmupFrames?: number;
}

const DEFAULTS = { dwellFrames: 120, settleFrames: 12, warmupFrames: 60 } as const;

/** Whole-sweep ceiling. A run that cannot finish still has to hand the
 *  tab back with every pass restored, not sit on a broken frame. */
const SWEEP_BUDGET_MS = 180_000;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The eight passes the 2026-08 audit prices. hdrChain (the chart-mode
 *  park) also stops writing the statistic attachment, flips emitters to
 *  inline tone-mapping and parks the reduction — its row is the whole
 *  target chain against direct-to-canvas, not the resolve draw alone.
 *  extinctionPrepass reports the consumer A/B: disabling ADDS the
 *  in-vertex raymarch, so its savedMs is normally negative (what the
 *  cache saves). */
export function buildPassToggles(stellata: Stellata): PassToggle[] {
  const flag = (set: (on: boolean) => void): (() => void) => {
    set(false);
    return () => set(true);
  };
  return [
    {
      key: 'localDepth',
      present: () => true,
      disable: () => flag((on) => { stellata.localDepthPass.enabled = on; }),
    },
    {
      key: 'mwBand',
      present: () => stellata.milkyway.isEnabled(),
      disable: () => flag((on) => stellata.milkyway.setEnabled(on)),
    },
    {
      key: 'lgEmission',
      present: () => stellata.kinds.lg.emission?.isEnabled() ?? false,
      disable: () => flag((on) => stellata.kinds.lg.emission?.setEnabled(on)),
    },
    {
      key: 'cloudAbsorption',
      present: () => stellata.kinds.cloud.layer !== null,
      disable: () => flag((on) => stellata.kinds.cloud.layer?.setAbsorptionEnabled(on)),
    },
    {
      key: 'hdrChain',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setChartMode(!on)),
    },
    {
      key: 'reduction',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => { stellata.reduction.enabled = on; }),
    },
    {
      key: 'coreMask',
      present: () => true,
      disable: () => flag((on) => stellata.setCoreMaskEnabled(on)),
    },
    {
      key: 'extinctionPrepass',
      present: () => stellata.isExtinctionPrepassActive(),
      disable: () => flag((on) => stellata.setExtinctionPrepassEnabled(on)),
    },
  ];
}

/**
 * Price every present pass from wherever the camera sits: dwell on the
 * whole-frame GPU scope with the pass disabled, difference the median
 * against the enabled baseline. One pass at a time — differentials are
 * the only honest per-pass price on ANGLE/Metal (README.md § GPU timing).
 *
 * Timer-query where the driver has one; rAF-delta fallback otherwise
 * (Safari), where a differential smaller than the vsync quantum reads as
 * zero unless the frame is already over budget.
 */
export async function runPriceFrame(
  stellata: Stellata,
  toggles: readonly PassToggle[],
  options: PriceFrameOptions = {},
): Promise<PriceFrameRow[]> {
  const dwellFrames = options.dwellFrames ?? DEFAULTS.dwellFrames;
  const settleFrames = options.settleFrames ?? DEFAULTS.settleFrames;
  const warmupFrames = options.warmupFrames ?? DEFAULTS.warmupFrames;
  const deadline = performance.now() + SWEEP_BUDGET_MS;

  const gl = stellata.renderer.getContext() as WebGL2RenderingContext;
  const hasTimerExt =
    gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null;

  const sink: number[] = [];
  const release = hasTimerExt
    ? acquireGpuFrameSampler(gl, (ms) => sink.push(ms))
    : null;
  if (hasTimerExt && release === null) {
    console.warn(
      'priceFrame: close the debug panel first — its perf timer holds the ' +
      "context's single TIME_ELAPSED query slot",
    );
    return [];
  }
  const method = release !== null ? 'timer-query' : 'raf-delta';
  if (method === 'raf-delta') {
    console.info(
      'priceFrame: no GPU timer query on this context (Safari exposes ' +
      'none) — using rAF-delta wall time. Differentials below the vsync ' +
      'quantum read as zero unless the frame is already over budget.',
    );
  }

  const startPos = stellata.camera.position.clone();
  const startQuat = stellata.camera.quaternion.clone();

  const dwell = async (): Promise<DwellStats | null> => {
    for (let f = 0; f < settleFrames; f++) await nextFrame();
    sink.length = 0;
    if (method === 'timer-query') {
      for (let f = 0; f < dwellFrames; f++) await nextFrame();
    } else {
      let last = performance.now();
      for (let f = 0; f < dwellFrames; f++) {
        await nextFrame();
        const now = performance.now();
        sink.push(now - last);
        last = now;
      }
    }
    return summarizeDwell(sink);
  };

  const eligible = toggles.filter((t) => {
    if (options.passes && !options.passes.includes(t.key)) return false;
    if (!t.present()) {
      console.info(`priceFrame: '${t.key}' not active at this view/state — skipped`);
      return false;
    }
    return true;
  });

  const rows: PriceFrameRow[] = [];
  let restore: (() => void) | null = null;
  try {
    for (let f = 0; f < warmupFrames; f++) await nextFrame();
    const baseline = await dwell();
    if (baseline === null) {
      console.warn(
        'priceFrame: no baseline samples — the query slot was taken ' +
        'mid-run (debug panel opened?) or the context is lost',
      );
      return [];
    }

    for (const [i, toggle] of eligible.entries()) {
      if (performance.now() > deadline) {
        const dropped = eligible.slice(i).map((t) => t.key).join(', ');
        console.warn(
          `priceFrame: out of budget, sweep truncated — NOT priced: ${dropped}. ` +
          'Re-run those with { passes: [...] }, or shorten dwellFrames.',
        );
        break;
      }
      restore = toggle.disable();
      let disabled: DwellStats | null = null;
      try {
        disabled = await dwell();
      } finally {
        restore();
        restore = null;
      }
      if (disabled === null) {
        console.warn(`priceFrame: no samples with '${toggle.key}' disabled — dropped`);
        continue;
      }
      rows.push(buildPriceRow(toggle.key, method, baseline, disabled));
    }

    const recheck = await dwell();
    if (recheck !== null) {
      const driftMs = recheck.medianMs - baseline.medianMs;
      console.info(
        `priceFrame: baseline ${baseline.medianMs.toFixed(3)} ms, ` +
        `re-measured ${recheck.medianMs.toFixed(3)} ms ` +
        `(drift ${driftMs.toFixed(3)} ms — differentials near or below ` +
        'this are noise)',
      );
    }
  } finally {
    restore?.();
    release?.();
  }

  if (
    !stellata.camera.position.equals(startPos) ||
    !stellata.camera.quaternion.equals(startQuat)
  ) {
    console.warn(
      'priceFrame: the camera moved during the sweep — the rows compare ' +
      'different views; hold still and re-run',
    );
  }

  console.table(rows);
  return rows;
}

/** Smoke aid: run the sweep N times and print each pass's savedMs range
 *  across runs — run-to-run agreement is the repeatability check. */
export async function runPriceFrameRepeat(
  stellata: Stellata,
  toggles: readonly PassToggle[],
  runs: number,
  options: PriceFrameOptions = {},
): Promise<PriceFrameRow[][]> {
  const all: PriceFrameRow[][] = [];
  for (let r = 0; r < runs; r++) {
    all.push(await runPriceFrame(stellata, toggles, options));
  }
  const byPass = new Map<string, number[]>();
  for (const rows of all) {
    for (const row of rows) {
      const xs = byPass.get(row.pass) ?? [];
      xs.push(row.savedMs);
      byPass.set(row.pass, xs);
    }
  }
  for (const [pass, xs] of byPass) {
    console.info(
      `priceFrame repeat: ${pass} savedMs ` +
      `${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)} over ${xs.length} runs`,
    );
  }
  return all;
}

export type { PriceFrameRow };
