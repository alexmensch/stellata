// Throwaway spike instrument: a compute kernel marching the Edenhofer
// volume a known number of times, so a differential prices WebGPU volume
// fetches. Deleted once the numbers are in docs/science-galactic-structure.md.

import { StorageBufferAttribute, Vector3, type ComputeNode, type WebGPURenderer } from 'three/webgpu';
import {
  Fn, bitAnd, compute, cos, float, floor, instanceIndex, max, normalize, sin,
  sqrt, storage, uint, uniform, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { disposeStorageAttribute } from '../tsl/storage-attribute';
import { dustRaymarchAvTsl } from './dust-raymarch-tsl';
import type { ExtinctionNodes } from './extinction-nodes';
import {
  PROBE_AZIMUTH_PERIOD, PROBE_FOV_DEG, PROBE_RANGE_PC, PROBE_SINK_SLOTS,
  type VolumeProbeSpec,
} from '../../debug/frame-cost/passes/volume-probe-specs';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TAN_HALF_FOV = Math.tan((PROBE_FOV_DEG * Math.PI) / 180 / 2);

/** The froxel fill's ray set: a screen-space grid over the default frustum,
 *  so consecutive threads are adjacent on the sky. */
function coherentDirection(idx: NF, gridW: number, gridH: number): N3 {
  const row = floor(idx.div(gridW));
  const col = idx.sub(row.mul(gridW));
  const x = col.add(0.5).div(gridW).mul(2).sub(1).mul(TAN_HALF_FOV);
  const y = row.add(0.5).div(gridH).mul(2).sub(1).mul(TAN_HALF_FOV);
  return normalize(vec3(x, y, float(-1)));
}

/** The per-star prepass's: a golden-angle spiral over the whole sphere,
 *  where consecutive threads are 137.5° apart in azimuth. */
function scatteredDirection(idx: NF, rays: number): N3 {
  const z = float(1).sub(idx.add(0.5).div(rays).mul(2));
  const r = sqrt(max(float(0), float(1).sub(z.mul(z))));
  const period = float(PROBE_AZIMUTH_PERIOD);
  const phi = idx.sub(floor(idx.div(period)).mul(period)).mul(GOLDEN_ANGLE);
  return vec3(r.mul(cos(phi)), r.mul(sin(phi)), z);
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
    const gridH = spec.rays / spec.gridW;
    this.kernel = compute(Fn(() => {
      const idx = float(instanceIndex);
      const dir = spec.pattern === 'coherent'
        ? coherentDirection(idx, spec.gridW, gridH)
        : scatteredDirection(idx, spec.rays);
      // Scattered rays vary in length the way star distances do, so threads
      // in a workgroup step the volume at different rates.
      const lenPc = spec.pattern === 'coherent'
        ? float(PROBE_RANGE_PC)
        : float(PROBE_RANGE_PC).mul(
          idx.sub(floor(idx.div(PROBE_AZIMUTH_PERIOD)).mul(PROBE_AZIMUTH_PERIOD))
            .div(PROBE_AZIMUTH_PERIOD).mul(0.75).add(0.25));
      const av = dustRaymarchAvTsl(
        nodes, slots.dust, this.origin, this.origin.add(dir.mul(lenPc)));
      sinkNode.element(bitAnd(instanceIndex, uint(PROBE_SINK_SLOTS - 1))).assign(av);
    })(), spec.rays);
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
