// Console-driven differential frame pricing: dwell on gpu.frame with one
// pass disabled at a time and difference the medians.
// See README.md.

import type { Stellata } from '../../stellata';
import { acquireGpuFrameSampler } from '../perf-hud';
import {
  buildInterleavedRow,
  buildPriceRow,
  fitDwellFrames,
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
   *  recompiles, the previous state's in-flight query results, and the
   *  exposure re-converging after a toggle that reset the statistic. */
  settleFrames?: number;
  /** Frames discarded before the first baseline dwell. Long by default:
   *  an Apple-silicon GPU ramps its clocks under sustained load, and a
   *  sweep started cold walks its frame time down for tens of seconds. */
  warmupFrames?: number;
  /** Re-measure the baseline between every pass and difference each
   *  disabled dwell against the mean of its two neighbours. Costs 2N+1
   *  dwells instead of N+2; the only honest mode on a drifting
   *  instrument. Set false for a fast, drift-exposed sweep. */
  interleave?: boolean;
  /** Pause the simulation clock for the sweep and restore its rate after.
   *  A running clock re-arms the binary orbit field's full per-frame
   *  upload and moves every ephemeris body, both inside the timed scope.
   *  Set false to price the live path instead of a static frame. */
  pauseClock?: boolean;
  /** Whole-sweep wall-clock ceiling. Dwells are shortened to fit it
   *  before the sweep starts; only a sweep that cannot fit even at
   *  `MIN_DWELL_FRAMES` truncates. */
  budgetMs?: number;
  /** Freeze the exposure cut for the sweep, after the warmup has let it
   *  converge. Passes that write the statistic attachment move the cut
   *  when toggled, and the differential then prices a different star
   *  population instead of the pass. Set false to price the live path. */
  pinExposure?: boolean;
}

const DEFAULTS = {
  dwellFrames: 120,
  // Long enough for the exposure to re-converge after a toggle that reset
  // the statistic: the chart-mode park does, and at 12 frames the trailing
  // baseline was still recovering — visible as an 8-14 ms bracketMs on the
  // hdrChain and reduction rows while every other row sat under 4.5.
  settleFrames: 30,
  warmupFrames: 180,
  interleave: true,
  pauseClock: true,
  budgetMs: 180_000,
  pinExposure: true,
} as const;

/** Shortening past this stops buying anything — the medians get noisy
 *  faster than the sweep gets shorter. Below it, truncate instead. */
const MIN_DWELL_FRAMES = 30;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** The passes the 2026-08 audit prices. hdrChain (the chart-mode
 *  park) also stops writing the statistic attachment, flips emitters to
 *  inline tone-mapping and parks the reduction — its row is the whole
 *  target chain against direct-to-canvas, not the resolve draw alone.
 *  The four rows after it decompose that aggregate (README.md § Priced
 *  passes). extinctionPrepass reports the consumer A/B: disabling ADDS
 *  the in-vertex raymarch, so its savedMs is normally negative (what the
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
      // The park drops the statistic, so `measure()` stops being called at
      // all and the frame loses its only ANGLE submission barrier — the
      // same defect the reduction row was fixed for. Hold the fence across
      // the park so the row prices the chain, not the barrier.
      disable: () => {
        stellata.reduction.fenceWhileParked = true;
        stellata.hdr.setChartMode(true);
        return () => {
          stellata.hdr.setChartMode(false);
          stellata.reduction.fenceWhileParked = false;
        };
      },
    },
    {
      key: 'tonemapOp',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setTonemapEnabled(on)),
    },
    {
      key: 'statisticWrites',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setStatisticWritesEnabled(on)),
    },
    {
      key: 'summation',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setSummationEnabled(on)),
    },
    {
      key: 'mrtAttachments',
      present: () => stellata.hdr.statisticTexture() !== null,
      // Dropping to a single attachment parks the statistic, so hold the
      // fence for the same reason the hdrChain row does.
      disable: () => {
        stellata.reduction.fenceWhileParked = true;
        stellata.hdr.setExtraAttachmentsEnabled(false);
        return () => {
          stellata.hdr.setExtraAttachmentsEnabled(true);
          stellata.reduction.fenceWhileParked = false;
        };
      },
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
 * against baselines measured either side of it. One pass at a time —
 * differentials are the only honest per-pass price on ANGLE/Metal
 * (README.md § GPU timing).
 *
 * Timer-query where the driver has one; rAF-delta fallback otherwise
 * (Safari), where a differential smaller than the vsync quantum reads as
 * zero unless the frame is already over budget.
 *
 * Pauses the simulation clock for the duration and restores its rate,
 * and sizes the dwells to the time budget once the first one has shown
 * what a frame costs here.
 */
export async function runPriceFrame(
  stellata: Stellata,
  toggles: readonly PassToggle[],
  options: PriceFrameOptions = {},
): Promise<PriceFrameRow[]> {
  let dwellFrames = options.dwellFrames ?? DEFAULTS.dwellFrames;
  const settleFrames = options.settleFrames ?? DEFAULTS.settleFrames;
  const warmupFrames = options.warmupFrames ?? DEFAULTS.warmupFrames;
  const interleave = options.interleave ?? DEFAULTS.interleave;
  const pauseClock = options.pauseClock ?? DEFAULTS.pauseClock;
  const pinExposure = options.pinExposure ?? DEFAULTS.pinExposure;
  const deadline = performance.now() + (options.budgetMs ?? DEFAULTS.budgetMs);

  if (stellata.rendererGL === null) {
    console.warn(
      'priceFrame: the pricing harness reads WebGL2 timer queries — not ' +
      'ported to the WebGPU boot yet',
    );
    return [];
  }
  const gl = stellata.rendererGL.getContext() as WebGL2RenderingContext;
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

  const clock = stellata.timeClock;
  const startRate = clock.getRate();
  if (pauseClock && startRate !== 0) {
    clock.setRate(0);
    console.info(
      `priceFrame: clock paused for the sweep (rate ${startRate}× restored ` +
      'after). Pass { pauseClock: false } to price the live path instead.',
    );
  }

  const dwell = async (): Promise<DwellStats | null> => {
    for (let f = 0; f < settleFrames; f++) await nextFrame();
    sink.length = 0;
    const frames = dwellFrames;
    const readbacksBefore = stellata.reduction.readbackRequests;
    if (method === 'timer-query') {
      for (let f = 0; f < frames; f++) await nextFrame();
    } else {
      let last = performance.now();
      for (let f = 0; f < frames; f++) {
        await nextFrame();
        const now = performance.now();
        sink.push(now - last);
        last = now;
      }
    }
    const readbacks = stellata.reduction.readbackRequests - readbacksBefore;
    return summarizeDwell(sink, {
      readbackPerFrame: readbacks / frames,
      effectiveLimitMag: stellata.exposure.getEffectiveLimitMag(),
    });
  };

  const fitDwellToBudget = (firstDwellMs: number): void => {
    const affordableMs = deadline - performance.now();
    const fit = fitDwellFrames({
      firstDwellMs,
      dwellFrames,
      settleFrames,
      remainingDwells: interleave ? 2 * eligible.length : eligible.length + 1,
      affordableMs,
      minDwellFrames: MIN_DWELL_FRAMES,
    });
    if (fit.willTruncate) {
      console.warn(
        `priceFrame: ${Math.round(fit.neededMs / 1000)} s needed against a ` +
        `${Math.round(affordableMs / 1000)} s budget, and shortening cannot ` +
        'close that. The sweep WILL truncate. Split the roster with ' +
        '{ passes: [...] }, or raise { budgetMs }.',
      );
    } else if (fit.shortened) {
      console.info(
        `priceFrame: ${Math.round(fit.perFrameMs)} ms/frame here — dwells ` +
        `shortened ${dwellFrames} → ${fit.frames} frames to fit the ` +
        `${Math.round(affordableMs / 1000)} s budget. Medians get noisier; ` +
        'read noiseMs. Raise { budgetMs } for full-length dwells.',
      );
    }
    dwellFrames = fit.frames;
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
  const releaseRenderHold = stellata.renderGate.hold();
  try {
    for (let f = 0; f < warmupFrames; f++) await nextFrame();
    // After the warmup, so the cut is pinned where it converged rather
    // than wherever it happened to be when the sweep was called.
    if (pinExposure) {
      stellata.adaptation.setHeld(true);
      console.info(
        `priceFrame: exposure pinned at dm ${stellata.adaptation.getDm().toFixed(3)} ` +
        `(effective limit ${stellata.exposure.getEffectiveLimitMag().toFixed(2)} mag) — ` +
        'every row now prices its pass against the same star population. ' +
        'Pass { pinExposure: false } to price the live path.',
      );
    }
    const baselineStartedMs = performance.now();
    const firstBaseline = await dwell();
    fitDwellToBudget(performance.now() - baselineStartedMs);
    if (firstBaseline === null) {
      console.warn(
        'priceFrame: no baseline samples — the query slot was taken ' +
        'mid-run (debug panel opened?) or the context is lost',
      );
      return [];
    }
    let baseline = firstBaseline;

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
      if (!interleave) {
        rows.push(buildPriceRow(toggle.key, method, baseline, disabled));
        continue;
      }
      const after = await dwell();
      if (after === null) {
        console.warn(
          `priceFrame: no trailing baseline after '${toggle.key}' — row dropped`,
        );
        continue;
      }
      rows.push(buildInterleavedRow(toggle.key, method, baseline, after, disabled));
      // The trailing baseline is the next row's leading one: 2N+1 dwells,
      // not 3N.
      baseline = after;
    }

    const recheck = interleave ? baseline : await dwell();
    if (recheck !== null) {
      const driftMs = recheck.medianMs - firstBaseline.medianMs;
      console.info(
        `priceFrame: baseline ${firstBaseline.medianMs.toFixed(3)} ms, ` +
        `re-measured ${recheck.medianMs.toFixed(3)} ms ` +
        `(drift ${driftMs.toFixed(3)} ms over the sweep` +
        (interleave
          ? '; bracketed rows already absorb it — read each row\'s bracketMs)'
          : ' — differentials near or below this are noise)'),
      );
    }
  } finally {
    restore?.();
    release?.();
    releaseRenderHold();
    if (pinExposure) stellata.adaptation.setHeld(false);
    if (pauseClock && clock.getRate() !== startRate) clock.setRate(startRate);
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

  const bufferMpx =
    Number(((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(3));
  const stamped = rows.map((row) => ({ ...row, bufferMpx }));
  console.info(
    `priceFrame: drawing buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} ` +
    `(${bufferMpx} Mpx) — both dominant passes scale with it, so only compare ` +
    'tables at the same buffer size.',
  );
  console.table(stamped);
  return stamped;
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
