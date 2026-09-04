// Per-frame exposure adaptation: turns the reduced statistic attachment
// into one slew-limited exposure cut. See README.md § Adaptation.

import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import { dimBlendFactor } from '../../binaries/eclipse/eclipse-photometry-pure';
import type { ReducedStatistic } from './reduction/reduction-pass';
import { rescaleToBaseExposure } from './reduction/reduction-pure';
import {
  type AdaptationBranches,
  type AdaptationTuning,
  type FrameStatistic,
  adaptationBranches,
  ADAPT_SLEW_TAU_S,
  EMPTY_FRAME_STATISTIC,
  L_ADAPT,
  L_TARGET,
  slewDm,
} from './scene-adaptation-pure';
import {
  INITIAL_PARK_STATE,
  type ParkLanding,
  type ParkPhase,
  type ParkState,
  parkTick,
  parkUnderHold,
} from './park/adaptation-park-pure';

export interface SceneAdaptationDeps {
  /** The instrument's own exposure — no adaptation, no trim. Measuring
   *  against the live scalar would close a feedback loop. */
  baseExposure: () => number;
  /** The frame-late reduction of the HDR target's statistic attachment
   *  (`reduction/README.md`), or null before the first one lands. */
  reduced: () => ReducedStatistic | null;
  /** Whether the reduction can draw this frame — false while a readback is
   *  in flight. Read after `reduced()`, which polls: a probe opened on a
   *  frame the chain sits out pays the statistic writes with nothing
   *  reducing what they wrote. */
  measurementReady: () => boolean;
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
  private stat: FrameStatistic = EMPTY_FRAME_STATISTIC;
  private park: ParkState = INITIAL_PARK_STATE;
  private readonly landing: ParkLanding = {
    fresh: false, measuredDm: 0, appliedDm: 0, regime: 'open', probeReady: false,
  };
  private lastLanded: ReducedStatistic | null = null;
  private lastNowMs: number | null = null;
  private lAdapt = L_ADAPT;
  private lTarget = L_TARGET;
  private slewTauS = ADAPT_SLEW_TAU_S;
  private held = false;

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
    if (this.held) return this.dm;
    if (chart) return this.reset();
    perfMark('adaptation');
    const reduced = this.deps.reduced();
    const landedFresh = reduced !== null && reduced !== this.lastLanded;
    if (reduced !== null) {
      this.lastLanded = reduced;
      const base = this.deps.baseExposure();
      // Rescaling the landed median is exact, not an approximation: the
      // divisor is positive, so it orders the tiles the same way and the
      // same tile wins either side of it. No need to rescale per tile.
      this.stat = {
        meanL: rescaleToBaseExposure(reduced.meanL, reduced.renderExposure, base),
        discL: rescaleToBaseExposure(reduced.discL, reduced.renderExposure, base),
        coverage: reduced.coverage,
      };
    }
    const { dm: measured, regime } = this.branches();
    const blend = warpActive ? 1 : dimBlendFactor(nowMs, this.lastNowMs, this.slewTauS);
    this.lastNowMs = nowMs;
    this.dm = slewDm(this.dm, measured, blend);
    this.landing.fresh = landedFresh;
    this.landing.measuredDm = measured;
    this.landing.appliedDm = this.dm;
    this.landing.regime = regime;
    this.landing.probeReady = this.deps.measurementReady();
    this.park = parkTick(this.park, this.landing);
    perfMeasure('adaptation');
    return this.dm;
  }

  /**
   * True while the measurement is parked: the reduction's draws and the
   * statistic-attachment emitter writes both stop, the clear and the
   * readback fence stay (`park/README.md`). False on
   * a probe frame — a probe reducing the cleared attachment would cost
   * ~3x reducing live content, so its writes must be open.
   */
  isMeasurementParked(): boolean {
    return this.park.phase === 'parked';
  }

  /** The park machine's phase, for the readout. */
  getParkPhase(): ParkPhase {
    return this.park.phase;
  }

  /** The live levels the branches measure against. */
  getTuning(): AdaptationTuning {
    return { lAdapt: this.lAdapt, lTarget: this.lTarget, whitePoint: this.deps.whitePoint() };
  }

  /** This frame's decomposition — the three branch terms and which of them
   *  set the cut. Recomputed on read rather than cached at `measure()`, so
   *  a knob moved between frames shows its effect on the same statistic
   *  instead of one frame late. `dm` here is the *measurement*; the applied
   *  cut is `getDm()`, which trails it by the slew. */
  branches(): AdaptationBranches {
    return adaptationBranches(this.stat, this.getTuning());
  }

  /** Adaptation anchor — `L̄` at which the perception branch's cut is zero.
   *  A debug knob only: ships at `L_ADAPT`, which § 3.1 measured. */
  setLAdapt(l: number): void { this.lAdapt = l; }

  getLAdapt(): number { return this.lAdapt; }

  /** The level the resolved-surface pin holds a dominant lit surface's own
   *  disc mean at — the one knob smoke-tuning moves (§ 3.2). */
  setLTarget(l: number): void { this.lTarget = l; }

  getLTarget(): number { return this.lTarget; }

  /** Time constant of the slew limit on the applied cut, in real seconds.
   *  The only tunable in the transient: the filter is one-pole, and the
   *  staircase a large scene change shows is `LUMA_CEIL`'s convergence
   *  from above rather than anything this reaches
   *  (`reduction/README.md` § Measure at the base exposure). */
  setSlewTauS(tau: number): void { this.slewTauS = tau; }

  getSlewTauS(): number { return this.slewTauS; }

  /**
   * Freeze the applied cut where it stands, measurement and slew both.
   * A frame-cost lever (`../../debug/frame-cost/README.md`): a pass that
   * writes the statistic attachment moves the cut when it is toggled, so
   * the differential would price a scene with a different star population
   * rather than the pass. **Held outranks chart's reset**, or parking the
   * HDR chain would zero the cut and change the scene the same way.
   *
   * Releasing drops `lastNowMs` so the next frame snaps to the live
   * measurement instead of ramping from a cut minutes stale.
   *
   * A hold landing mid-probe collapses the probe back to parked: frozen
   * probing keeps the chain live for the whole hold, so a sweep's rows
   * would price a parked or a live measurement depending on which frame
   * the pin happened to land on.
   */
  setHeld(on: boolean): void {
    this.held = on;
    if (on) this.park = parkUnderHold(this.park);
    if (!on) this.lastNowMs = null;
  }

  isHeld(): boolean { return this.held; }

  /** The cut actually applied this frame — slew-limited, so it trails the
   *  measurement by ~`ADAPT_SLEW_TAU_S`. The readout reports this and not
   *  the raw measurement, so the number on screen matches the frame. */
  getDm(): number {
    return this.dm;
  }

  /** The whole frame statistic at the base exposure: `L̄`, the lit-surface
   *  coverage, and the modal masked surface's own brightness the pin
   *  holds. */
  getStatistic(): FrameStatistic {
    return this.stat;
  }

  /** Chart's bypass, and the slew's own first-frame state: dropping
   *  `lastNowMs` makes the frame that re-enters the scene snap rather than
   *  ramp up from chart's zero cut. */
  private reset(): number {
    this.dm = 0;
    this.stat = EMPTY_FRAME_STATISTIC;
    this.park = INITIAL_PARK_STATE;
    this.lastLanded = null;
    this.lastNowMs = null;
    return 0;
  }
}
