// The frame's near-solid-body set, and the anchor query over it.

import type * as THREE from 'three';
import { spheroidHidesPoint } from './occlusion-pure';

/** The read half, which is all a label surface needs. */
export interface OccluderQuery {
  hides(pos: Readonly<THREE.Vector3>, cameraPos: Readonly<THREE.Vector3>): boolean;
}

// Inert at polarRatio 1, where no direction is special.
const SPHERE_POLE = { x: 0, y: 1, z: 0 } as const;

export class OccluderSet implements OccluderQuery {
  private readonly cx: number[] = [];
  private readonly cy: number[] = [];
  private readonly cz: number[] = [];
  private readonly rEq: number[] = [];
  private readonly ratio: number[] = [];
  private readonly px: number[] = [];
  private readonly py: number[] = [];
  private readonly pz: number[] = [];
  private n = 0;

  /** Runs once per frame ahead of the scene-layer fan-out; every
   *  provider republishes inside it. */
  beginFrame(): void {
    this.n = 0;
  }

  /**
   * Publish a body the renderer draws as a **round** disc — round at every
   * camera angle, not merely from here. A star qualifies. A body with a
   * published flattening does not, and must come through `addSpheroid` or
   * its mask over-reaches the limb actually drawn by the whole flattening.
   */
  addSphere(x: number, y: number, z: number, radiusPc: number): void {
    this.addSpheroid(x, y, z, radiusPc, 1, SPHERE_POLE);
  }

  /**
   * Publish a body the renderer draws squashed along `pole`.
   * `equatorialRadiusPc` is its widest radius and `polarRatio` its polar
   * radius in equatorial radii — **both as the draw call uses them**. For a
   * planet or moon that ratio is
   * `../solar-system/planets/spheroid-pure.ts:polarRadiusRatio`; deriving
   * `1 - flattening` here instead is how the mask and the mesh drift apart.
   */
  addSpheroid(
    x: number, y: number, z: number,
    equatorialRadiusPc: number,
    polarRatio: number,
    pole: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    const i = this.n++;
    this.cx[i] = x;
    this.cy[i] = y;
    this.cz[i] = z;
    this.rEq[i] = equatorialRadiusPc;
    this.ratio[i] = polarRatio;
    this.px[i] = pole.x;
    this.py[i] = pole.y;
    this.pz[i] = pole.z;
  }

  hides(pos: Readonly<THREE.Vector3>, cameraPos: Readonly<THREE.Vector3>): boolean {
    for (let i = 0; i < this.n; i++) {
      if (spheroidHidesPoint(
        cameraPos.x, cameraPos.y, cameraPos.z,
        pos.x, pos.y, pos.z,
        this.cx[i], this.cy[i], this.cz[i],
        this.rEq[i], this.ratio[i],
        this.px[i], this.py[i], this.pz[i],
      )) return true;
    }
    return false;
  }

  get count(): number {
    return this.n;
  }
}
