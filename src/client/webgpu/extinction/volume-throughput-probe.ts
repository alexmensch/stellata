// Throwaway spike instrument: a compute kernel marching the Edenhofer
// volume a known number of times, so a differential prices WebGPU volume
// fetches. Deleted once the numbers are in docs/science-galactic-structure.md.

import { StorageBufferAttribute, Vector3, type ComputeNode, type WebGPURenderer } from 'three/webgpu';
import {
  Fn, bitAnd, compute, cos, float, floor, instanceIndex, max, sin,
  sqrt, storage, uint, uniform, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { disposeStorageAttribute } from '../tsl/storage-attribute';
import { dustRaymarchAvTsl } from './dust-raymarch-tsl';
import type { ExtinctionNodes } from './extinction-nodes';
import {
  PROBE_AZIMUTH_PERIOD, PROBE_GRID_W, PROBE_RAYS, PROBE_SINK_SLOTS,
  type VolumeProbeSpec,
} from '../../debug/frame-cost/passes/volume-probe-specs';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ARCMIN_RAD = Math.PI / 180 / 60;

/** The froxel fill's ray set. Angular rather than tangent-space on purpose:
 *  a screen grid's off-axis cells are finer than its on-axis one, which
 *  would put a range of pitches under one row's name. Here every
 *  neighbouring pair is `pitchArcmin` apart, so the row measures one. */
function coherentDirection(idx: NF, pitchArcmin: number): N3 {
  const gridH = PROBE_RAYS / PROBE_GRID_W;
  const pitch = pitchArcmin * ARCMIN_RAD;
  const row = floor(idx.div(PROBE_GRID_W));
  const col = idx.sub(row.mul(PROBE_GRID_W));
  const ax = col.sub(PROBE_GRID_W / 2).add(0.5).mul(pitch);
  const ay = row.sub(gridH / 2).add(0.5).mul(pitch);
  return vec3(sin(ax).mul(cos(ay)), sin(ay), cos(ax).mul(cos(ay)).negate());
}

/** The per-star prepass's: a golden-angle spiral over the whole sphere,
 *  where consecutive threads are 137.5° apart in azimuth. */
function scatteredDirection(idx: NF): N3 {
  const z = float(1).sub(idx.add(0.5).div(PROBE_RAYS).mul(2));
  const r = sqrt(max(float(0), float(1).sub(z.mul(z))));
  const period = float(PROBE_AZIMUTH_PERIOD);
  const phi = idx.sub(floor(idx.div(period)).mul(period)).mul(GOLDEN_ANGLE);
  return vec3(r.mul(cos(phi)), r.mul(sin(phi)), z);
}

/** Star distances vary, so the prepass's threads step the volume at
 *  different rates inside one workgroup. The coherent grid marches one
 *  shell and holds its length fixed. */
function scatteredLength(idx: NF, rangePc: number): NF {
  const period = float(PROBE_AZIMUTH_PERIOD);
  const frac = idx.sub(floor(idx.div(period)).mul(period)).div(period);
  return float(rangePc).mul(frac.mul(0.75).add(0.25));
}

export interface VolumeThroughputProbeOptions {
  renderer: WebGPURenderer;
  nodes: SharedUniformNodes;
  slots: ExtinctionNodes;
  spec: VolumeProbeSpec;
}

export class VolumeThroughputProbe {
  readonly key: string;

  private readonly renderer: WebGPURenderer;
  private readonly origin = uniform(new Vector3());
  private sink: StorageBufferAttribute | null;
  private kernel: ComputeNode | null;
  private enabled = true;

  constructor({ renderer, nodes, slots, spec }: VolumeThroughputProbeOptions) {
    this.renderer = renderer;
    this.key = spec.key;
    this.sink = new StorageBufferAttribute(PROBE_SINK_SLOTS, 1);
    const sinkNode = storage(this.sink, 'float', PROBE_SINK_SLOTS);
    const coherent = spec.pattern === 'coherent';
    this.kernel = compute(Fn(() => {
      const idx = float(instanceIndex);
      const dir = coherent
        ? coherentDirection(idx, spec.pitchArcmin)
        : scatteredDirection(idx);
      const lenPc = coherent
        ? float(spec.rangePc)
        : scatteredLength(idx, spec.rangePc);
      const av = dustRaymarchAvTsl(
        nodes, slots.dust, this.origin, this.origin.add(dir.mul(lenPc)));
      sinkNode.element(bitAnd(instanceIndex, uint(PROBE_SINK_SLOTS - 1))).assign(av);
    })(), PROBE_RAYS);
    this.kernel.setName(`volume-throughput-${spec.key}`);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled && this.kernel !== null;
  }

  /** One dispatch, from Sol rather than from the camera: the rate is a
   *  property of the volume and the march, and a fixed origin keeps every
   *  tap inside coverage at every vantage the runner visits. */
  update(): void {
    if (!this.isEnabled()) return;
    this.renderer.compute(this.kernel!);
  }

  dispose(): void {
    this.kernel?.dispose();
    if (this.sink !== null) disposeStorageAttribute(this.renderer, this.sink);
    this.kernel = null;
    this.sink = null;
  }
}
