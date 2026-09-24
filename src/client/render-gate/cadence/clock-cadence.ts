// The clock cadence's per-frame state. See README.md § The controller.

import * as THREE from 'three';
import type { CadenceCtx } from '../../scene/scene-layer';
import {
  CADENCE_REPORT_STILL,
  cadenceSimBudgetS,
  clockFrameDue,
  type CadenceReport,
} from './clock-cadence-pure';
import {
  auditCadenceFrame,
  CADENCE_TRUST_INITIAL,
  type CadenceTrustState,
} from './cadence-trust-pure';

export interface ClockCadenceDeps {
  readonly camera: THREE.PerspectiveCamera;
  /** The frame's fastest rate over every `'clock'` layer. */
  readonly collectReport: (ctx: CadenceCtx) => CadenceReport;
}

export interface CadenceFrame {
  /** Sim time this frame drew. */
  readonly t: number;
  readonly pxPerRadian: number;
  readonly pixelRatio: number;
  /** `RenderGate.lastFrameWasCadenceScheduled` — whether the audit applies. */
  readonly cadenceScheduled: boolean;
}

export interface ClockCadenceDebugState {
  readonly budgetSimS: number;
  readonly report: CadenceReport;
  /** Sim seconds the report's OBSERVED channels were measured over —
   *  without it those two numbers are per-gap while `report`'s rate
   *  channels are per-sim-second, and a readout printing both invites
   *  the comparison that units mismatch makes meaningless. */
  readonly observedSimDtS: number;
  readonly lastRenderedSimS: number;
  readonly pulsationBudgetS: number;
  readonly trust: CadenceTrustState;
}

export class ClockCadence {
  private budgetSimS = 0;
  private lastRenderedSimS = Number.NaN;
  private lastReport: CadenceReport = CADENCE_REPORT_STILL;
  private trust: CadenceTrustState = CADENCE_TRUST_INITIAL;
  private pulsationBudgetS = Number.POSITIVE_INFINITY;
  private readonly rideAccum = new THREE.Vector3();
  private frameId = 0;
  private readonly ctx: {
    camera: THREE.PerspectiveCamera;
    frameId: number;
    pxPerRadian: number;
    simDtS: number;
    cameraVelPcPerSimS: THREE.Vector3;
  };

  constructor(private readonly deps: ClockCadenceDeps) {
    this.ctx = {
      camera: deps.camera,
      frameId: 0,
      pxPerRadian: 0,
      simDtS: Number.NaN,
      cameraVelPcPerSimS: new THREE.Vector3(),
    };
  }

  isDue(clockRate: number, simNowS: number): boolean {
    return clockFrameDue(clockRate, simNowS, this.lastRenderedSimS, this.budgetSimS);
  }

  noteRideStep(delta: Readonly<THREE.Vector3>): void {
    this.rideAccum.add(delta);
  }

  tightenPulsationBound(budgetS: number): void {
    this.pulsationBudgetS = Math.min(this.pulsationBudgetS, budgetS);
  }

  /** Once per rendered frame, after every ride and layer update. */
  refresh(frame: CadenceFrame): void {
    const simDtS = frame.t - this.lastRenderedSimS;
    this.lastRenderedSimS = frame.t;
    this.frameId++;
    const ctx = this.ctx;
    ctx.frameId = this.frameId;
    ctx.pxPerRadian = frame.pxPerRadian;
    ctx.simDtS = simDtS;
    if (Number.isFinite(simDtS) && simDtS !== 0) {
      ctx.cameraVelPcPerSimS.copy(this.rideAccum).divideScalar(simDtS);
    } else {
      ctx.cameraVelPcPerSimS.set(0, 0, 0);
    }
    this.rideAccum.set(0, 0, 0);
    const report = this.deps.collectReport(ctx);
    this.lastReport = report;
    this.trust = auditCadenceFrame(this.trust, {
      cadenceScheduled: frame.cadenceScheduled,
      observedPx: report.observedPx,
      observedFluxFrac: report.observedFluxFrac,
      pixelRatio: frame.pixelRatio,
    });
    this.budgetSimS = cadenceSimBudgetS(
      report, this.pulsationBudgetS, frame.pixelRatio, this.trust.trust,
    );
  }

  get debugState(): ClockCadenceDebugState {
    return {
      budgetSimS: this.budgetSimS,
      report: this.lastReport,
      observedSimDtS: this.ctx.simDtS,
      lastRenderedSimS: this.lastRenderedSimS,
      pulsationBudgetS: this.pulsationBudgetS,
      trust: this.trust,
    };
  }

  dispose(): void {
    this.budgetSimS = 0;
    this.lastRenderedSimS = Number.NaN;
    this.lastReport = CADENCE_REPORT_STILL;
    this.trust = CADENCE_TRUST_INITIAL;
    this.pulsationBudgetS = Number.POSITIVE_INFINITY;
    this.rideAccum.set(0, 0, 0);
    this.frameId = 0;
    this.ctx.simDtS = Number.NaN;
    this.ctx.cameraVelPcPerSimS.set(0, 0, 0);
  }
}
