// Packed instanced geometry for the reflected-glare billboard — exactly
// the 8 guaranteed vertex buffers (README.md § The glare packs).

import * as THREE from 'three';
import { STAR_QUAD_CORNERS, STAR_QUAD_INDEX } from '../../star-pipeline/star-pipeline';
import type {
  PlanetGlareBuffers,
} from '../../solar-system/planets/planet-body-field';

export type {
  PlanetGlareBuffers, PlanetGlareSources,
} from '../../solar-system/planets/planet-body-field';

export interface PlanetGlareBuild {
  geometry: THREE.InstancedBufferGeometry;
  /** The three packed attributes. The four whose layout already matches
   *  ride the source arrays directly and appear only in the flag lists. */
  colourSolidity: THREE.InstancedBufferAttribute;
  body: THREE.InstancedBufferAttribute;
  dyn: THREE.InstancedBufferAttribute;
  /** Attributes the field only rewrites when a body attaches, detaches or
   *  the arrays grow — re-packed and re-uploaded on a `layoutVersion`
   *  change, never per frame. */
  perLayout: THREE.InstancedBufferAttribute[];
  /** Attributes that carry a new value every rendered frame: the ephemeris
   *  walk's `iLocalRel`, the ring-flux / eclipse-dim pair, and
   *  `iHostLocalPos` — which a floating-origin recentre rewrites WITHOUT
   *  bumping `layoutVersion`, so it cannot ride the list above. */
  perFrame: THREE.InstancedBufferAttribute[];
  /** Slot capacity the arrays were built at — a grow changes it. */
  capacity: number;
}

/**
 * Interleave `colour.rgb + solidity` and `radius, albedo, hostAbsmag, c7`
 * into their vec4s. Every scalar here is written by the field's
 * `writeHostStaticAttributes` alone, so this runs on a layout change only.
 *
 * Packing exists because the billboard's 13 attributes exceed WebGPU's 8
 * vertex buffers; these carry the scalars, while `iHostLocalPos`,
 * `iLocalRel`, `iPhaseCoefsA` and `iPhaseCoefsB` already have a vec3/vec4
 * layout and ride their source arrays with no copy at all.
 */
export function packGlareLayout(
  build: PlanetGlareBuild,
  bufs: PlanetGlareBuffers,
  count: number,
): void {
  const cs = build.colourSolidity.array as Float32Array;
  const body = build.body.array as Float32Array;
  for (let i = 0; i < count; i++) {
    cs[i * 4 + 0] = bufs.colour[i * 3 + 0];
    cs[i * 4 + 1] = bufs.colour[i * 3 + 1];
    cs[i * 4 + 2] = bufs.colour[i * 3 + 2];
    cs[i * 4 + 3] = bufs.solidity[i];
    body[i * 4 + 0] = bufs.radius[i];
    body[i * 4 + 1] = bufs.albedo[i];
    body[i * 4 + 2] = bufs.hostAbsmag[i];
    // Only Mercury carries a degree-7 term; the other three phaseC slots
    // are reserved, so the coefficient rides here and the whole attribute
    // goes away.
    body[i * 4 + 3] = bufs.phaseC[i * 4];
  }
}

/** `ringFlux, eclipseDim` into its vec2 — the only pack the frame pays. */
export function packGlareFrame(
  build: PlanetGlareBuild,
  bufs: PlanetGlareBuffers,
  count: number,
): void {
  const dyn = build.dyn.array as Float32Array;
  for (let i = 0; i < count; i++) {
    dyn[i * 2 + 0] = bufs.ringFlux[i];
    dyn[i * 2 + 1] = bufs.eclipseDim[i];
  }
}

export function buildPlanetGlareGeometry(
  bufs: PlanetGlareBuffers,
  capacity: number,
): PlanetGlareBuild {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(STAR_QUAD_CORNERS, 2));
  geometry.setIndex(STAR_QUAD_INDEX);

  const shared = (name: string, array: Float32Array, dims: number) => {
    const attr = new THREE.InstancedBufferAttribute(array, dims);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    return attr;
  };
  const packed = (name: string, dims: number) =>
    shared(name, new Float32Array(capacity * dims), dims);

  // Four whose layout already matches: a fresh attribute over the SAME
  // array, so nothing is copied and the field's writes land here too.
  const hostLocalPos = shared('iHostLocalPos', bufs.hostLocalPos, 3);
  const localRel = shared('iLocalRel', bufs.localRel, 3);
  const phaseA = shared('iPhaseCoefsA', bufs.phaseA, 4);
  const phaseB = shared('iPhaseCoefsB', bufs.phaseB, 4);
  const colourSolidity = packed('iColourSolidity', 4);
  const body = packed('iBody', 4);
  const dyn = packed('iDyn', 2);

  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return {
    geometry,
    colourSolidity,
    body,
    dyn,
    perLayout: [phaseA, phaseB, colourSolidity, body],
    perFrame: [hostLocalPos, localRel, dyn],
    capacity,
  };
}
