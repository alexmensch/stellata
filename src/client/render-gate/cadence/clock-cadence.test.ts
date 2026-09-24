import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CadenceCtx } from '../../scene/scene-layer';
import { ACCEPTANCE_PX_PER_RADIAN } from '../../scene/frame-ctx-mock';
import { ClockCadence, type CadenceFrame } from './clock-cadence';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_REPORT_STILL,
  cadenceSimBudgetS,
  type CadenceReport,
} from './clock-cadence-pure';
import { CADENCE_TRUST_BACKOFF, CADENCE_TRUST_INITIAL } from './cadence-trust-pure';

const PIXEL_RATIO = 2;

interface Seen {
  readonly frameId: number;
  readonly simDtS: number;
  readonly vel: THREE.Vector3;
  readonly camera: THREE.PerspectiveCamera;
}

function harness(reportFor: () => CadenceReport = () => CADENCE_REPORT_STILL) {
  const camera = new THREE.PerspectiveCamera();
  const seen: Seen[] = [];
  const cadence = new ClockCadence({
    camera,
    collectReport: (cc: CadenceCtx) => {
      seen.push({
        frameId: cc.frameId,
        simDtS: cc.simDtS,
        vel: cc.cameraVelPcPerSimS.clone(),
        camera: cc.camera,
      });
      return reportFor();
    },
  });
  const frame = (t: number, over: Partial<CadenceFrame> = {}): CadenceFrame => ({
    t,
    pxPerRadian: ACCEPTANCE_PX_PER_RADIAN,
    pixelRatio: PIXEL_RATIO,
    cadenceScheduled: false,
    ...over,
  });
  return { camera, cadence, seen, frame };
}

describe('ClockCadence', () => {
  it('is due on the first tick under a running clock, never while paused', () => {
    const { cadence } = harness();
    expect(cadence.isDue(1, 0)).toBe(true);
    expect(cadence.isDue(0, 0)).toBe(false);
  });

  it('idles for the budget the last rendered frame set', () => {
    const { cadence, frame } = harness();
    cadence.refresh(frame(10));
    expect(cadence.debugState.budgetSimS).toBe(CADENCE_CAP_SIM_S);
    expect(cadence.isDue(1, 10 + CADENCE_CAP_SIM_S - 1)).toBe(false);
    expect(cadence.isDue(1, 10 + CADENCE_CAP_SIM_S)).toBe(true);
  });

  it('turns the reported rate into the budget the pure reduction computes', () => {
    const moving = { ...CADENCE_REPORT_STILL, screenPxPerSimS: 3 };
    const { cadence, frame } = harness(() => moving);
    cadence.refresh(frame(0));
    expect(cadence.debugState.budgetSimS)
      .toBe(cadenceSimBudgetS(moving, Number.POSITIVE_INFINITY, PIXEL_RATIO, 1));
    expect(cadence.debugState.report).toBe(moving);
  });

  it('hands every report the camera and a fresh frame id', () => {
    const { camera, cadence, seen, frame } = harness();
    cadence.refresh(frame(0));
    cadence.refresh(frame(1));
    expect(seen.map((s) => s.frameId)).toEqual([1, 2]);
    expect(seen.every((s) => s.camera === camera)).toBe(true);
  });

  it('reads the first frame step as unmeasurable, with no camera velocity', () => {
    const { cadence, seen, frame } = harness();
    cadence.noteRideStep(new THREE.Vector3(1, 0, 0));
    cadence.refresh(frame(5));
    expect(seen[0].simDtS).toBeNaN();
    expect(seen[0].vel.toArray()).toEqual([0, 0, 0]);
  });

  it('divides the frame ride steps by the sim step, then clears them', () => {
    const { cadence, seen, frame } = harness();
    cadence.refresh(frame(0));
    cadence.noteRideStep(new THREE.Vector3(2, 0, 0));
    cadence.noteRideStep(new THREE.Vector3(0, 4, 0));
    cadence.refresh(frame(2));
    expect(seen[1].simDtS).toBe(2);
    expect(seen[1].vel.toArray()).toEqual([1, 2, 0]);
    cadence.refresh(frame(4));
    expect(seen[2].vel.toArray()).toEqual([0, 0, 0]);
  });

  it('reads a zero sim step as no camera velocity rather than dividing by it', () => {
    const { cadence, seen, frame } = harness();
    cadence.refresh(frame(3));
    cadence.noteRideStep(new THREE.Vector3(1, 1, 1));
    cadence.refresh(frame(3));
    expect(seen[1].vel.toArray()).toEqual([0, 0, 0]);
  });

  it('only tightens the pulsation bound, and the budget honours it', () => {
    const { cadence, frame } = harness();
    cadence.tightenPulsationBound(8);
    cadence.tightenPulsationBound(12);
    expect(cadence.debugState.pulsationBudgetS).toBe(8);
    cadence.refresh(frame(0));
    expect(cadence.debugState.budgetSimS).toBe(8);
  });

  it('audits only the frames the cadence scheduled', () => {
    const violating = { ...CADENCE_REPORT_STILL, observedPx: 100 };
    const { cadence, frame } = harness(() => violating);
    cadence.refresh(frame(0, { cadenceScheduled: false }));
    expect(cadence.debugState.trust).toBe(CADENCE_TRUST_INITIAL);
    cadence.refresh(frame(1, { cadenceScheduled: true }));
    expect(cadence.debugState.trust.trust).toBe(CADENCE_TRUST_BACKOFF);
  });

  it('dispose resets every sentinel', () => {
    const violating = { ...CADENCE_REPORT_STILL, observedPx: 100 };
    const { cadence, seen, frame } = harness(() => violating);
    cadence.tightenPulsationBound(8);
    cadence.refresh(frame(0));
    cadence.noteRideStep(new THREE.Vector3(1, 0, 0));
    cadence.refresh(frame(1, { cadenceScheduled: true }));
    cadence.noteRideStep(new THREE.Vector3(1, 0, 0));
    cadence.dispose();
    expect(cadence.debugState).toEqual({
      budgetSimS: 0,
      report: CADENCE_REPORT_STILL,
      observedSimDtS: Number.NaN,
      lastRenderedSimS: Number.NaN,
      pulsationBudgetS: Number.POSITIVE_INFINITY,
      trust: CADENCE_TRUST_INITIAL,
    });
    expect(cadence.isDue(1, 0)).toBe(true);
    cadence.refresh(frame(7));
    expect(seen.at(-1)?.frameId).toBe(1);
    cadence.refresh(frame(8));
    expect(seen.at(-1)?.vel.toArray()).toEqual([0, 0, 0]);
  });
});
