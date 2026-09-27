// See README.md#the-attachment.

import * as THREE from 'three';
import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import type { SharedUniforms } from '../../frame/shared-uniforms';
import type { Catalog } from '../../loaders/catalog-loader';
import type { DustField } from '../../loaders/dust-loader';
import {
  formatVerifyReports,
  verifyDustChunks,
  type ChunkVerifyReport,
} from '../../loaders/dust-voxel-readback';
import type { MilkyWay } from '../../milkyway/milkyway';
import { cameraAbsInto, type FrameCtx } from '../../scene/scene-layer';
import { LateCell, whenReady } from '../../util/late/late';
import type { StellataRenderer, WebGpuSeam } from '../../webgpu/seam';
import { formatAvParity, type AvParityReport } from './av-parity-pure';
import type { ExtinctionPrepassSeam, ExtinctionView } from './extinction-seam';

export interface ExtinctionAttachmentDeps {
  catalog: Pick<Catalog, 'positions' | 'count' | 'loadedCount'>;
  uniforms: SharedUniforms;
  webgpu: Pick<WebGpuSeam, 'setDustTexture' | 'attachExtinctionPrepass'>;
  milkyway: Pick<MilkyWay, 'attachDust' | 'setExtinctionStrength'>;
  renderer: StellataRenderer;
  camera: THREE.Camera;
  worldOffset: THREE.Vector3;
  invalidate: (reason: string) => void;
}

interface Attached {
  readonly dust: DustField;
  readonly prepass: ExtinctionPrepassSeam;
}

export class ExtinctionAttachment {
  private readonly attached = new LateCell<Attached>();
  private readonly view: ExtinctionView;
  private readonly cameraAbs = new THREE.Vector3();
  private recomputeForced = false;

  constructor(private readonly deps: ExtinctionAttachmentDeps) {
    this.view = { camera: deps.camera, worldOffset: deps.worldOffset };
  }

  /** Settles the slot, once: null (no manifest) concludes it absent. */
  attach(dust: DustField | null): void {
    if (this.attached.state().status !== 'pending') {
      throw new Error('ExtinctionAttachment.attach: the dust slot has already settled');
    }
    if (dust === null) {
      this.attached.conclude();
      return;
    }
    const { deps } = this;
    deps.invalidate('attach:dust');
    const u = deps.uniforms;
    u.uDustTexture.value = dust.texture;
    u.uDustBoundsPc.value = dust.params.boundsHalfPc;
    u.uDustDensityMin.value = dust.params.densityMin;
    u.uDustLogRatio.value = dust.params.logRatio;
    u.uDustAvPerDensityPc.value = dust.params.avPerDensityPerPc;
    u.uDustEnabled.value = 1;
    deps.webgpu.setDustTexture(dust.texture);
    const prepass = deps.webgpu.attachExtinctionPrepass({ catalog: deps.catalog, uniforms: u });
    this.attached.land({ dust, prepass });
    prepass.markDirty();
    // DustField.dispose drops its listeners, and dispose() releases the field
    // with the prepass, so this never reaches a released prepass.
    dust.onProgress(() => {
      prepass.markDirty();
      deps.invalidate('dust-chunk');
    });
    deps.milkyway.attachDust(dust);
  }

  /** Per-frame, between the scene fan-out and the uniform-node sync
   *  (../../webgpu/extinction/refill/README.md#only-what-is-in-frame). */
  update(ctx: FrameCtx): void {
    const s = this.attached.state();
    if (s.status !== 'ready') return;
    const { prepass } = s.value;
    perfMark('extinction.prepass');
    if (this.recomputeForced) prepass.markDirty();
    const abs = cameraAbsInto(ctx, this.cameraAbs);
    prepass.update(abs.x, abs.y, abs.z, this.view);
    perfMeasure('extinction.prepass');
  }

  /** `catalog.positions` was rewritten under the prepass's copy — an epoch
   *  re-advance or a landing chunk (README.md#the-prepass-cache). */
  refreshPositions(): void {
    whenReady(this.attached.state(), (a) => a.prepass.refreshPositions(), undefined);
  }

  /** README.md#the-cancellation-invariant. Independent of attach. */
  setStrength(x: number): void {
    this.deps.uniforms.uExtinctionStrength.value = Math.max(0, x);
    this.deps.milkyway.setExtinctionStrength(x);
  }

  /** README.md#the-prepass-cache, the A/B switch. No-op until dust attaches. */
  setPrepassEnabled(on: boolean): void {
    whenReady(this.attached.state(), (a) => a.prepass.setEnabled(on), undefined);
  }

  isPrepassActive(): boolean {
    return whenReady(this.attached.state(), (a) => a.prepass.isActive(), false);
  }

  /** Frame-cost lever — never leave it on outside a measurement dwell
   *  (../../debug/frame-cost/passes/README.md#the-extinction-rows). */
  setRecomputeForced(on: boolean): void {
    this.recomputeForced = on;
  }

  isRecomputeForced(): boolean {
    return this.recomputeForced;
  }

  /** A pointer event says a pick is coming (README.md#reading-a_v-back-on-the-cpu). */
  warmPickReadback(): void {
    whenReady(this.attached.state(), (a) => a.prepass.warmAvReadback(), undefined);
  }

  /** The A_V the shader applies to this star, in magnitudes; null when there
   *  is no answer — no dust, the A/B fallback, or a cold mirror. */
  avMagAt(idx: number): number | null {
    const raw = whenReady(this.attached.state(), (a) => a.prepass.readAvMag(idx), null);
    if (raw === null) return null;
    const u = this.deps.uniforms;
    return raw * u.uDustEnabled.value * u.uExtinctionStrength.value;
  }

  /** Null until dust attaches and a view has been dispatched. */
  countInFrame(): number | null {
    return whenReady(this.attached.state(), (a) => a.prepass.countInFrame(), null);
  }

  /** `../../loaders/README.md#dust-voxel-readback`. */
  async verifyDust(count?: number): Promise<ChunkVerifyReport[]> {
    const s = this.attached.state();
    if (s.status !== 'ready') {
      warnUnsettled('verifyDust', s.status);
      return [];
    }
    const reports = await verifyDustChunks({ renderer: this.deps.renderer, dust: s.value.dust, count });
    for (const line of formatVerifyReports(reports)) console.log(line);
    return reports;
  }

  /** `../../webgpu/extinction/README.md#the-prepass-kernel`. */
  async verifyParity(): Promise<AvParityReport | null> {
    const s = this.attached.state();
    if (s.status !== 'ready') {
      warnUnsettled('verifyParity', s.status);
      return null;
    }
    const report = await s.value.prepass.verifyParity();
    if (report === null) {
      console.warn('verifyParity: the prepass is parked on the A/B fallback');
      return null;
    }
    console.log(formatAvParity(report));
    return report;
  }

  /** Before the star layer and `WebGpuSeam.dispose` — README.md#the-attachment. */
  dispose(): void {
    whenReady(this.attached.state(), (a) => {
      a.prepass.dispose();
      a.dust.dispose();
    }, undefined);
    this.attached.conclude();
  }
}

function warnUnsettled(check: string, status: 'pending' | 'absent'): void {
  console.warn(status === 'pending'
    ? `${check}: the dust manifest is still loading`
    : `${check}: no dust this session`);
}
