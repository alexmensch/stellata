// The frame's near-solid-body set, and the anchor query over it.

import type * as THREE from 'three';
import { sphereHidesPoint } from './occlusion-pure';

/** The read half, which is all a label surface needs. */
export interface OccluderQuery {
  hides(pos: Readonly<THREE.Vector3>, cameraPos: Readonly<THREE.Vector3>): boolean;
}

export class OccluderSet implements OccluderQuery {
  private readonly cx: number[] = [];
  private readonly cy: number[] = [];
  private readonly cz: number[] = [];
  private readonly r: number[] = [];
  private n = 0;

  /** Runs once per frame ahead of the scene-layer fan-out; every
   *  provider republishes inside it. */
  beginFrame(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, radiusPc: number): void {
    const i = this.n++;
    this.cx[i] = x;
    this.cy[i] = y;
    this.cz[i] = z;
    this.r[i] = radiusPc;
  }

  hides(pos: Readonly<THREE.Vector3>, cameraPos: Readonly<THREE.Vector3>): boolean {
    for (let i = 0; i < this.n; i++) {
      if (sphereHidesPoint(
        cameraPos.x, cameraPos.y, cameraPos.z,
        pos.x, pos.y, pos.z,
        this.cx[i], this.cy[i], this.cz[i], this.r[i],
      )) return true;
    }
    return false;
  }

  get count(): number {
    return this.n;
  }
}
