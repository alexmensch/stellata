// `debug.capture()` — drive the camera and the clock through a repeatable
// take for screen recording. See README.md.

import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import {
  type DecodedView,
  type IdMaps,
  applyDecodedView,
  decodeBlob,
  viewPose,
} from '../../util/url-state';
import { shareBlobFrom } from '../../util/url-state/share-path-pure';
import { parseJumpEntry } from '../../solar-system/time/time';
import {
  type CapturePose,
  type EaseName,
  type TakePhase,
  type TakeShape,
  anchorPose,
  capturePose,
  frameMismatch,
  lerpPose,
  planClock,
  takeFrameAt,
} from './capture-pure';

export interface CaptureOptions {
  /** Start view: a share blob, a whole share URL, or a `v=<blob>` fragment. */
  start: string;
  /** End view, same forms. Omitted holds the start pose for the whole take. */
  end?: string;
  /** Length of the camera move. Default 5. */
  seconds?: number;
  /** Simulation time to start at: Unix seconds, or any string the scrubber's
   *  jump field accepts (`2026-09-17 21:30`, `JD 2451545.0`). */
  startTime?: number | string;
  /** Simulation time to land on as the move ends. Solves the clock rate. */
  endTime?: number | string;
  /** Clock rate when no `endTime` solves one. Default 1, 0 freezes the sky. */
  rate?: number;
  /** Default 'smooth' — quintic, still at both ends. */
  ease?: EaseName;
  /** Seconds to hold the start view before moving. Default 0. */
  delay?: number;
  /** Seconds to hold the end view after arriving. Default 0. */
  hold?: number;
}

export type CaptureRun = Promise<void> & { cancel(): void };

const DEFAULT_SECONDS = 5;

function decodeInput(input: string, which: string): DecodedView {
  const blob = shareBlobFrom(input);
  if (blob === null) throw new Error(`capture: ${which} carries no view blob`);
  return decodeBlob(blob).view;
}

function resolveTime(value: number | string | undefined, which: string): number | null {
  if (value === undefined) return null;
  const t = typeof value === 'number' ? value : parseJumpEntry(value);
  if (!Number.isFinite(t)) {
    throw new Error(
      `capture: ${which} "${value}" is neither Unix seconds nor a date the jump `
      + 'field accepts (YYYY-MM-DD HH:MM:SS, or a Julian Date)',
    );
  }
  return t;
}

let cancelActive: (() => void) | null = null;

export function runCapture(
  stellata: Stellata, idMaps: IdMaps, options: CaptureOptions,
): CaptureRun {
  const startView = decodeInput(options.start, 'start');
  const endView = options.end === undefined ? startView : decodeInput(options.end, 'end');
  const mismatch = frameMismatch(startView, endView);
  if (mismatch !== null) throw new Error(`capture: ${mismatch}`);

  const seconds = options.seconds ?? DEFAULT_SECONDS;
  if (!(seconds > 0)) throw new Error('capture: seconds must be positive');
  const startT = resolveTime(options.startTime, 'startTime');
  const endT = resolveTime(options.endTime, 'endTime');
  const ease = options.ease ?? 'smooth';
  const shape: TakeShape = {
    delayMs: (options.delay ?? 0) * 1000,
    moveMs: seconds * 1000,
    holdMs: (options.hold ?? 0) * 1000,
  };

  const from = capturePose(viewPose(startView));
  const to = capturePose(viewPose(endView));
  const live: CapturePose = {
    cam: new THREE.Vector3(), tgt: new THREE.Vector3(), up: new THREE.Vector3(), fov: from.fov,
  };
  const ridden: CapturePose = {
    cam: new THREE.Vector3(), tgt: new THREE.Vector3(), up: new THREE.Vector3(), fov: from.fov,
  };
  const anchor = new THREE.Vector3();

  cancelActive?.();

  // README.md § Calling it — a take opens in navigate whatever preceded it.
  if (stellata.focus.getCameraMode() === 'observe') {
    stellata.observe.setMode('navigate', { animate: false });
  }
  applyDecodedView(stellata, startView, idMaps);

  const clock = stellata.timeClock;
  // Solve against the applied view's clock, not the caller's — a start blob
  // carrying a pinned `t` has just moved it.
  const plan = planClock({
    startT, endT, rate: options.rate ?? 1, seconds, currentT: stellata.getT(),
  });
  if (plan.startT !== null) clock.setTimeAbsolute(plan.startT);
  clock.setRate(plan.idleRate);
  stellata.notifyClockJumped();

  console.log(
    `capture: ${seconds}s, ${from.cam.distanceTo(from.tgt).toPrecision(3)} → `
    + `${to.cam.distanceTo(to.tgt).toPrecision(3)} pc from target, clock ×${plan.moveRate}`,
  );

  const release = stellata.renderGate.hold();
  const controlsWere = stellata.controls.enabled;
  stellata.controls.enabled = false;

  let closed = false;
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    // README.md § What a take holds for its duration, last paragraph.
    let settleFrames = 2;
    let takeStartMs = 0;
    let phase: TakePhase = 'delay';

    // A zero anchor is a soft or absent focus — README.md § The take rides
    // the focal object.
    const focalAnchor = (): THREE.Vector3 => {
      const focal = stellata.focus.getFocusedHardTarget();
      const resolved = focal !== null
        && stellata.focusables[focal.kind].localPositionInto(focal.idx, anchor);
      return resolved ? anchor : anchor.set(0, 0, 0);
    };

    const writePose = (pose: CapturePose) => {
      const p = anchorPose(pose, focalAnchor(), ridden);
      stellata.camera.position.copy(p.cam);
      stellata.controls.target.copy(p.tgt);
      stellata.camera.up.copy(p.up);
      if (p.fov !== stellata.camera.fov) stellata.setCameraFov(p.fov);
    };

    const onFrame = () => {
      if (settleFrames > 0) {
        settleFrames -= 1;
        writePose(from);
        if (settleFrames === 0) takeStartMs = performance.now();
        return;
      }
      const frame = takeFrameAt(shape, performance.now() - takeStartMs, ease);
      if (frame.phase !== phase) {
        const landed = phase === 'delay' || phase === 'move';
        if (frame.phase === 'move') clock.setRate(plan.moveRate);
        else if (landed) {
          if (plan.endT !== null) clock.setTimeAbsolute(plan.endT);
          clock.setRate(plan.idleRate);
          stellata.notifyClockJumped();
        }
        phase = frame.phase;
      }
      if (frame.s === 0) writePose(from);
      else if (frame.s === 1) writePose(to);
      else writePose(lerpPose(from, to, frame.s, live));
      if (frame.phase === 'done') finish();
    };

    const unsubscribe = stellata.on('frame', onFrame);
    finish = () => {
      if (closed) return;
      closed = true;
      if (cancelActive === finish) cancelActive = null;
      unsubscribe();
      release();
      stellata.controls.enabled = controlsWere;
      console.log(`capture: ${phase === 'done' ? 'landed' : 'cancelled'}`);
      resolve();
    };
    cancelActive = finish;
  });

  const run = done as CaptureRun;
  run.cancel = finish;
  return run;
}
