// Per-frame exposure adaptation: turns the reduced statistic attachment
// into one slew-limited exposure cut. See README.md#adaptation--the-frame-measures-itself.

import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import { dimBlendFactor } from '../../binaries/eclipse/eclipse-photometry-pure';
import type { ReducedStatistic } from '../hdr-seam';
import { rescaleToBaseExposure } from './reduction/reduction-pure';
import {
  type AdaptationBranches,
  type AdaptationTuning,
  type FrameStatistic,
  adaptationBranches,
  ADAPT_SLEW_TAU_S,
  L_ADAPT,
  L_TARGET,
  newAdaptationBranches,
  slewDm,
} from './scene-adaptation-pure';
import {
  INITIAL_PARK_STATE,
  type LandedCut,
  type ParkLanding,
  type ParkPhase,
  type ParkState,
  parkTick,
  parkUnderHold,
} from './park/adaptation-park-pure';

interface LandedStatistic extends FrameStatistic {
  from: ReducedStatistic;
}

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
  /** Taken live rather than off the default constant: the display floor is
   *  derived from it, so `DR_MAG` has to reach the floor or the two describe
   *  different display ranges (`README.md#adaptation--the-frame-measures-itself`). */
  whitePoint: () => number;
}

/**
 * The area-weighted mean-luminance measurement
 * (`/docs/science-hdr-pipeline.md#31-adaptation--what-drives-the-cut`), read off the frame the GPU
 * actually drew — so it sees airlight, ring annuli, twilight and every
 * future emitter, none of which a per-source model represented.
 */
export class SceneAdaptation {
  private readonly deps: SceneAdaptationDeps;

  private dm = 0;
  private landed: LandedStatistic | null = null;
  private readonly measured = newAdaptationBranches();
  private park: ParkState = INITIAL_PARK_STATE;
  private readonly landedCut: LandedCut = { measuredDm: 0, regime: 'open' };
  private readonly landing: ParkLanding = { landed: null, appliedDm: 0, probeReady: false };
  private lastNowMs: number | null = null;
  private readonly tuning: AdaptationTuning;
  private slewTauS = ADAPT_SLEW_TAU_S;
  private held = false;
  private parkEnabled = true;

  constructor(deps: SceneAdaptationDeps) {
    this.deps = deps;
    this.tuning = { lAdapt: L_ADAPT, lTarget: L_TARGET, whitePoint: deps.whitePoint() };
  }

  /**
   * Fold this frame's landed measurement into the applied cut, in
   * magnitudes. Chart measures nothing and reports no cut; before the first
   * landing the cut slews toward none. `nowMs` is
   * wall-clock — the slew limit is a render filter, not sim time, so a
   * time-warped frame must not slew faster.
   */
  measure(chart: boolean, nowMs: number): number {
    if (this.held) return this.dm;
    if (chart) return this.reset();
    perfMark('adaptation');
    const reduced = this.deps.reduced();
    const landedFresh = reduced !== null && reduced !== this.landed?.from;
    if (reduced !== null) {
      const base = this.deps.baseExposure();
      // Rescaling the landed median is exact, not an approximation: the
      // divisor is positive, so it orders the tiles the same way and the
      // same tile wins either side of it. No need to rescale per tile.
      const landed = (this.landed ??= { from: reduced, meanL: 0, discL: 0, coverage: 0 });
      landed.from = reduced;
      landed.meanL = rescaleToBaseExposure(reduced.meanL, reduced.renderExposure, base);
      landed.discL = rescaleToBaseExposure(reduced.discL, reduced.renderExposure, base);
      landed.coverage = reduced.coverage;
    }
    const branches = this.branches(this.measured);
    const blend = dimBlendFactor(nowMs, this.lastNowMs, this.slewTauS);
    this.lastNowMs = nowMs;
    this.dm = slewDm(this.dm, branches === null ? 0 : branches.dm, blend);
    if (landedFresh && branches !== null) {
      this.landedCut.measuredDm = branches.dm;
      this.landedCut.regime = branches.regime;
      this.landing.landed = this.landedCut;
    } else {
      this.landing.landed = null;
    }
    this.landing.appliedDm = this.dm;
    this.landing.probeReady = this.deps.measurementReady();
    this.park = this.parkEnabled ? parkTick(this.park, this.landing) : INITIAL_PARK_STATE;
    perfMeasure('adaptation');
    return this.dm;
  }

  /**
   * Keep the measurement live whatever the regime — a frame-cost lever, never
   * a shipped state (`park/README.md#the-lever`). Disabling unparks on the
   * same call rather than a frame later, so a sweep set up after the machine
   * has already parked still prices live writes.
   */
  setParkEnabled(on: boolean): void {
    this.parkEnabled = on;
    if (!on) this.park = INITIAL_PARK_STATE;
  }

  isParkEnabled(): boolean { return this.parkEnabled; }

  /**
   * True while the measurement is parked: the reduction's draws and the
   * statistic-attachment emitter writes both stop, the clear and the
   * readback stay (`park/README.md`). False on
   * a probe frame — a probe reducing the cleared attachment would cost
   * ~3x reducing live content, so its writes must be open.
   */
  isMeasurementParked(): boolean {
    return this.park.phase === 'parked';
  }

  getParkPhase(): ParkPhase {
    return this.park.phase;
  }

  /** The live levels the branches measure against. The one object is
   *  rewritten in place, so read it within the frame; never hold it. */
  getTuning(): Readonly<AdaptationTuning> {
    this.tuning.whitePoint = this.deps.whitePoint();
    return this.tuning;
  }

  /** This frame's decomposition — the three branch terms and which of them
   *  set the cut — or null where no reduction has landed. Recomputed on read
   *  rather than cached at `measure()`, so a knob moved between frames shows
   *  its effect on the same statistic instead of one frame late. `dm` here is
   *  the *measurement*; the applied cut is `getDm()`, which trails it by the
   *  slew. */
  branches(out?: AdaptationBranches): AdaptationBranches | null {
    return this.landed === null ? null : adaptationBranches(this.landed, this.getTuning(), out);
  }

  /** Adaptation anchor — `L̄` at which the perception branch's cut is zero.
   *  A debug knob only: ships at `L_ADAPT`, which the adaptation section (/docs/science-hdr-pipeline.md#31-adaptation--what-drives-the-cut) measured. */
  setLAdapt(l: number): void { this.tuning.lAdapt = l; }

  getLAdapt(): number { return this.tuning.lAdapt; }

  /** The level the resolved-surface pin holds a dominant lit surface's own
   *  disc mean at — the one knob smoke-tuning moves (/docs/science-hdr-pipeline.md#32-what-the-model-does-and-does-not-fix). */
  setLTarget(l: number): void { this.tuning.lTarget = l; }

  getLTarget(): number { return this.tuning.lTarget; }

  /** Time constant of the slew limit on the applied cut, in real seconds.
   *  The only tunable in the transient: the filter is one-pole, and the
   *  staircase a large scene change shows is `LUMA_CEIL`'s convergence
   *  from above rather than anything this reaches
   *  (`reduction/README.md#measure-at-the-base-exposure-not-the-live-one`). */
  setSlewTauS(tau: number): void { this.slewTauS = tau; }

  getSlewTauS(): number { return this.slewTauS; }

  /**
   * Freeze the applied cut where it stands, measurement and slew both — a
   * frame-cost lever (`../../debug/frame-cost/README.md`). It outranks both
   * chart's reset and the park, and a hold landing mid-probe collapses the
   * probe back to parked, so a sweep prices one state throughout rather than
   * whichever the pin happened to land on.
   *
   * Releasing drops `lastNowMs`, so the next frame snaps instead of ramping
   * from a stale cut.
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

  /** The whole frame statistic at the base exposure — `L̄`, the lit-surface
   *  coverage, and the modal masked surface's own brightness the pin holds —
   *  or **null** where none has landed: before the first reduction, and
   *  after chart's reset. A genuinely dark frame also measures `L̄` = 0, and
   *  the brightness skip's rule 2 cannot be evaluated without a real `L̄`
   *  (`/docs/science-hdr-pipeline.md#35-skipping-a-diffuse-emitter-the-display-cannot-show--the-share-bound`). */
  getLandedStatistic(): FrameStatistic | null {
    return this.landed;
  }

  /** Chart's bypass, and the slew's own first-frame state: dropping
   *  `lastNowMs` makes the frame that re-enters the scene snap rather than
   *  ramp up from chart's zero cut. */
  private reset(): number {
    this.dm = 0;
    this.park = INITIAL_PARK_STATE;
    this.landed = null;
    this.lastNowMs = null;
    return 0;
  }
}
