// The requestAnimationFrame loop: every step of a tick, in order, above and
// below the render gate. See README.md.

import * as THREE from 'three';
import type { CameraStep } from '../../camera/camera-step/camera-step';
import type { FocalRides } from '../../camera/focus/focal-ride/focal-rides';
import type { FocusController } from '../../camera/focus/focus-controller';
import type { WarpController } from '../../camera/warp/warp-controller';
import {
  mark as perfMark,
  measure as perfMeasure,
  frame as perfFrame,
} from '../../debug/perf-hud';
import { resolveAndPublishGpuFrame } from '../../debug/gpu-timing/gpu-frame-samples';
import type { FloatingOrigin } from '../../frame/floating-origin';
import { NO_PINNED_STAR, type SharedUniforms } from '../../frame/shared-uniforms';
import type { HdrSeam } from '../../hdr/hdr-seam';
import type { ExposureFrameStep } from '../../hdr/exposure/exposure-frame-step';
import type { LocalDepthPass } from '../../local-depth/local-depth-pass';
import type { OccluderSet } from '../../occlusion/occluder-set';
import type { RenderGate } from '../../render-gate/render-gate';
import type { ClockCadence } from '../../render-gate/cadence/clock-cadence';
import { tToJdUt, type VirtualClock } from '../../solar-system/time/time';
import type { ExtinctionAttachment } from '../../star-pipeline/extinction/extinction-attachment';
import type { StarFrame } from '../../star-pipeline/star-frame/star-frame';
import type { StarPipeline } from '../../star-pipeline/star-pipeline';
import { J2000_JD } from '../../util/astronomy-constants';
import type { Mutable } from '../../util/mutable';
import type { WebGpuSeam } from '../../webgpu/seam';
import { FrameFrustum } from '../contribution/frame-frustum';
import { findGlslResidents } from '../glsl-residents-pure';
import { cameraAbsInto, type FrameCtx, type SceneLayer, type SceneLayerRegistry } from '../scene-layer';

export interface FrameLoopDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbitTarget: THREE.Vector3;
  webgpu: Pick<WebGpuSeam, 'renderer' | 'timestampsAvailable' | 'syncUniformNodes'>;
  hdr: Pick<HdrSeam, 'bind' | 'resolve'>;
  uniforms: SharedUniforms;
  clock: Pick<VirtualClock, 'getT' | 'getRate'>;
  origin: Pick<FloatingOrigin, 'tick' | 'worldOffset'>;
  starFrame: Pick<StarFrame, 'advanceEpochTo' | 'flushLocalPositions' | 'syncPhysSizeWindow'>;
  focalRides: Pick<FocalRides, 'reseedMoving' | 'followEpochStep'>;
  cameraStep: Pick<CameraStep, 'advance'>;
  focus: Pick<FocusController, 'getFocusedStar' | 'pinnedStar'>;
  warp: Pick<WarpController, 'isActive'>;
  layers: Pick<SceneLayerRegistry, 'realtimeFramesNeeded' | 'updateAll'>;
  cadence: Pick<ClockCadence, 'isDue' | 'refresh'>;
  renderGate: Pick<RenderGate, 'tick' | 'invalidate' | 'lastFrameWasCadenceScheduled'>;
  occluders: Pick<OccluderSet, 'beginFrame'>;
  extinction: Pick<ExtinctionAttachment, 'update' | 'refreshPositions'>;
  exposureFrame: Pick<ExposureFrameStep, 'frameExposure' | 'measure' | 'reduce'>;
  starPipeline: Pick<StarPipeline, 'update'>;
  localDepthPass: Pick<LocalDepthPass, 'render'>;
  pxPerRadian: () => number;
  emitFrame: () => void;
}

export class FrameLoop {
  private readonly frameCtx: Mutable<FrameCtx>;
  private readonly epochFollowDelta = new THREE.Vector3();
  private readonly cameraAbs = new THREE.Vector3();
  private realtimeNeeded = false;
  private glslResidentsChecked = false;
  private disposed = false;

  constructor(private readonly deps: FrameLoopDeps) {
    this.frameCtx = {
      camera: deps.camera,
      worldOffset: deps.origin.worldOffset,
      distFromSol: 0,
      t: 0,
      warpActive: false,
      pxPerRadian: 0,
      frustum: new FrameFrustum(),
      exposure: null,
    };
  }

  get realtimeFramesNeeded(): boolean { return this.realtimeNeeded; }

  /** The frame's last camera write, then the frustum refresh every camera
   *  reader below it depends on (README.md#the-frustum). */
  lastCameraWriteEntry(write: () => void): SceneLayer {
    return {
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      update: () => {
        write();
        this.frameCtx.frustum.refresh(this.deps.camera);
      },
      dispose: () => {},
    };
  }

  start(): void {
    this.tick();
  }

  dispose(): void {
    this.disposed = true;
    this.realtimeNeeded = false;
    this.frameCtx.frustum.invalidate();
  }

  private tick = () => {
    if (this.disposed) return;
    const d = this.deps;
    perfMark('frame.total');
    // One wall-clock read per tick: every reader must agree on this frame.
    const nowMs = performance.now();
    this.maybeReAdvanceEpoch();
    if (d.origin.tick()) d.focalRides.reseedMoving();
    // Before anything reads localPositions.
    d.starFrame.flushLocalPositions();
    perfMark('controls.update');
    const cameraAnimating = d.cameraStep.advance(nowMs);
    perfMeasure('controls.update');
    // Above the gate: README.md#above-the-gate.
    this.refreshFrameCtx();
    this.realtimeNeeded = d.layers.realtimeFramesNeeded(this.frameCtx);
    // ../../render-gate/README.md#the-clock-cadence
    const continuous = cameraAnimating || this.realtimeNeeded;
    const cadenceDue = d.cadence.isDue(d.clock.getRate(), this.frameCtx.t);
    if (!d.renderGate.tick(
      d.camera, d.orbitTarget, d.origin.worldOffset,
      { continuous, cadenceDue, nowMs },
    )) {
      requestAnimationFrame(this.tick);
      return;
    }
    perfMark('pre-render');
    d.uniforms.uCameraPos.value.copy(d.camera.position);
    d.uniforms.uPinFocusToCenter.value = d.focus.pinnedStar() ?? NO_PINNED_STAR;
    d.uniforms.uModelDays.value = tToJdUt(d.clock.getT()) - J2000_JD;
    d.uniforms.uModelDaysPerRealSec.value = Math.abs(d.clock.getRate()) / 86400;
    // Here, not by either publisher: each would drop the other's entries.
    d.occluders.beginFrame();
    d.layers.updateAll(this.frameCtx);
    d.extinction.update(this.frameCtx);
    d.cadence.refresh({
      t: this.frameCtx.t,
      pxPerRadian: this.frameCtx.pxPerRadian,
      pixelRatio: d.uniforms.uPixelRatio.value,
      cadenceScheduled: d.renderGate.lastFrameWasCadenceScheduled,
    });
    // After the fan-out and before the first draw, so measurement and frame
    // are never one frame apart.
    const measurementParked = d.exposureFrame.measure(nowMs, this.frameCtx.warpActive);
    perfMeasure('pre-render');
    perfMark('submit.main');
    d.hdr.bind();
    // Ahead of the node sync that copies it.
    d.starFrame.syncPhysSizeWindow();
    d.webgpu.syncUniformNodes();
    // Between the sync it reads and the draws it feeds
    // (../../webgpu/star/compaction/README.md).
    perfMark('star.compaction');
    d.starPipeline.update(d.camera);
    perfMeasure('star.compaction');
    this.checkGlslResidentsOnce();
    d.webgpu.renderer.render(d.scene, d.camera);
    perfMeasure('submit.main');
    perfMark('submit.localDepth');
    d.localDepthPass.render(d.webgpu.renderer, d.camera);
    perfMeasure('submit.localDepth');
    perfMark('submit.tonemap');
    d.hdr.resolve();
    perfMeasure('submit.tonemap');
    // After the resolve, so it never delays the frame it measures.
    perfMark('submit.reduction');
    d.exposureFrame.reduce(measurementParked);
    perfMeasure('submit.reduction');
    // After the LAST pass, listened to or not: an unresolved pool overruns.
    resolveAndPublishGpuFrame(d.webgpu.renderer, d.webgpu.timestampsAvailable);
    perfMark('frame.handlers');
    d.emitFrame();
    perfMeasure('frame.handlers');
    perfMeasure('frame.total');
    perfFrame();
    requestAnimationFrame(this.tick);
  };

  private maybeReAdvanceEpoch(): void {
    const d = this.deps;
    const delta = this.epochFollowDelta;
    if (!d.starFrame.advanceEpochTo(d.clock.getT(), d.focus.getFocusedStar(), delta)) return;
    d.renderGate.invalidate('epoch-bucket');
    d.extinction.refreshPositions();
    d.focalRides.followEpochStep(delta);
  }

  private refreshFrameCtx(): void {
    const d = this.deps;
    this.frameCtx.distFromSol = cameraAbsInto(this.frameCtx, this.cameraAbs).length();
    this.frameCtx.t = d.clock.getT();
    this.frameCtx.warpActive = d.warp.isActive();
    this.frameCtx.pxPerRadian = d.pxPerRadian();
    this.frameCtx.exposure = d.exposureFrame.frameExposure();
    // Refreshed after the frame's last camera write.
    this.frameCtx.frustum.invalidate();
  }

  // ../README.md#no-glsl-material-may-reach-a-webgpu-boot
  private checkGlslResidentsOnce(): void {
    if (this.glslResidentsChecked) return;
    this.glslResidentsChecked = true;
    const residents = findGlslResidents(this.deps.scene);
    if (residents.length > 0) {
      console.error(
        'GLSL materials in the rendered scene — the submit '
        + `will draw nothing: ${residents.join(', ')}`,
      );
    }
  }
}
