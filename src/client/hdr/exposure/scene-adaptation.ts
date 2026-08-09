// Per-frame exposure adaptation: turns the reduced statistic attachment
// into one slew-limited exposure cut. See README.md § Adaptation.

import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import { dimBlendFactor } from '../../binaries/eclipse/eclipse-photometry-pure';
import type { ReducedStatistic } from './reduction/reduction-pass';
import { rescaleToBaseExposure } from './reduction/reduction-pure';
import {
  type AdaptationBranches,
  type AdaptationTuning,
  adaptationBranches,
  ADAPT_SLEW_TAU_S,
  L_ADAPT,
  L_CAP,
  slewDm,
} from './scene-adaptation-pure';

export interface SceneAdaptationDeps {
  /** The instrument's own exposure — no adaptation, no trim. Measuring
   *  against the live scalar would close a feedback loop. */
  baseExposure: () => number;
  /** The frame-late reduction of the HDR target's statistic attachment
   *  (`reduction/README.md`), or null before the first one lands. */
  reduced: () => ReducedStatistic | null;
  /** The operator's live white point. The display floor is derived from
   *  it, so `DR_MAG` has to reach the floor or the two describe different
   *  display ranges (`README.md` § Adaptation). */
  whitePoint: () => number;
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
  private lAdapt = L_ADAPT;
  private lCap = L_CAP;
  private slewTauS = ADAPT_SLEW_TAU_S;

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
    const measured = this.branches().dm;
    const blend = warpActive ? 1 : dimBlendFactor(nowMs, this.lastNowMs, this.slewTauS);
    this.lastNowMs = nowMs;
    this.dm = slewDm(this.dm, measured, blend);
    perfMeasure('adaptation');
    return this.dm;
  }

  /** The live levels the branches measure against. */
  getTuning(): AdaptationTuning {
    return { lAdapt: this.lAdapt, lCap: this.lCap, whitePoint: this.deps.whitePoint() };
  }

  /** This frame's decomposition — the three branch terms and which of them
   *  set the cut. Recomputed on read rather than cached at `measure()`, so
   *  a knob moved between frames shows its effect on the same statistic
   *  instead of one frame late. `dm` here is the *measurement*; the applied
   *  cut is `getDm()`, which trails it by the slew. */
  branches(): AdaptationBranches {
    return adaptationBranches(this.meanL, this.peakL, this.getTuning());
  }

  /** Adaptation anchor — `L̄` at which the perception branch's cut is zero.
   *  A debug knob only: ships at `L_ADAPT`, which § 3.1 measured. */
  setLAdapt(l: number): void { this.lAdapt = l; }

  /** The ceiling the highlight guard pins the frame's brightest pixel at —
   *  the one knob smoke-tuning moves (§ 3.2). */
  setLCap(l: number): void { this.lCap = l; }

  /** Time constant of the slew limit on the applied cut, in real seconds.
   *  The only tunable in the transient: the filter is one-pole, and the
   *  staircase a large scene change shows is `LUMA_CEIL`'s convergence
   *  from above rather than anything this reaches
   *  (`reduction/README.md` § Measure at the base exposure). */
  setSlewTauS(tau: number): void { this.slewTauS = tau; }

  getSlewTauS(): number { return this.slewTauS; }

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
