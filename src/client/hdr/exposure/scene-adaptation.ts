// Per-frame exposure adaptation: turns the reduced statistic attachment
// into one slew-limited exposure cut. See README.md § Adaptation.

import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import { dimBlendFactor } from '../../binaries/eclipse/eclipse-photometry-pure';
import type { ReducedStatistic } from './reduction/reduction-pass';
import { rescaleToBaseExposure } from './reduction/reduction-pure';
import {
  adaptationDm,
  ADAPT_SLEW_TAU_S,
  slewDm,
} from './scene-adaptation-pure';

export interface SceneAdaptationDeps {
  /** The instrument's own exposure — no adaptation, no trim. Measuring
   *  against the live scalar would close a feedback loop. */
  baseExposure: () => number;
  /** The frame-late reduction of the HDR target's statistic attachment
   *  (`reduction/README.md`), or null before the first one lands. */
  reduced: () => ReducedStatistic | null;
}

/**
 * The area-weighted mean-luminance measurement
 * (`docs/science-hdr-pipeline.md` § 3.1), read off the frame the GPU
 * actually drew — so it sees airlight, ring annuli, twilight and every
 * future emitter, none of which a per-source model represented.
 */
export class SceneAdaptation {
  private readonly deps: SceneAdaptationDeps;

  private dm = 0;
  private meanL = 0;
  private peakL = 0;
  private lastNowMs: number | null = null;

  constructor(deps: SceneAdaptationDeps) {
    this.deps = deps;
  }

  /**
   * Fold this frame's landed measurement into the applied cut, in
   * magnitudes. Chart measures nothing and reports no cut. `nowMs` is
   * wall-clock — the slew limit is a render filter, not sim time, so a
   * time-warped frame must not slew faster; warp itself snaps.
   */
  measure(chart: boolean, nowMs: number, warpActive: boolean): number {
    if (chart) return this.reset();
    perfMark('adaptation');
    const reduced = this.deps.reduced();
    if (reduced !== null) {
      const base = this.deps.baseExposure();
      this.meanL = rescaleToBaseExposure(reduced.meanL, reduced.renderExposure, base);
      this.peakL = rescaleToBaseExposure(reduced.peakL, reduced.renderExposure, base);
    }
    const measured = adaptationDm(this.meanL, this.peakL);
    const blend = warpActive ? 1 : dimBlendFactor(nowMs, this.lastNowMs, ADAPT_SLEW_TAU_S);
    this.lastNowMs = nowMs;
    this.dm = slewDm(this.dm, measured, blend);
    perfMeasure('adaptation');
    return this.dm;
  }

  /** The cut actually applied this frame — slew-limited, so it trails the
   *  measurement by ~`ADAPT_SLEW_TAU_S`. The readout reports this and not
   *  the raw measurement, so the number on screen matches the frame. */
  getDm(): number {
    return this.dm;
  }

  /** `L̄` itself — the debug panel's row. */
  getMeanLuminance(): number {
    return this.meanL;
  }

  /** The frame's brightest per-pixel luminance — the statistic the
   *  highlight guard reads, and the debug row beside `L̄`. */
  getPeakLuminance(): number {
    return this.peakL;
  }

  /** Chart's bypass, and the slew's own first-frame state: dropping
   *  `lastNowMs` makes the frame that re-enters the scene snap rather than
   *  ramp up from chart's zero cut. */
  private reset(): number {
    this.dm = 0;
    this.meanL = 0;
    this.peakL = 0;
    this.lastNowMs = null;
    return 0;
  }
}
