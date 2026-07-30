import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  clearRingSlot,
  type CoverageSource,
  landTransmission,
  measuredSourceCount,
  packRingSlot,
  packSourceTexels,
  type RingOccluder,
} from './coverage-pack-pure';
import { COVERAGE_MAX_SOURCES } from './coverage-pure';
import { footprintRadiusPx, starSourceKey } from '../scene-adaptation-pure';

function source(patch: Partial<CoverageSource> = {}): CoverageSource {
  return {
    sourceKey: 0, screenX: 100, screenY: 200, diameterPx: 8,
    cameraDistancePc: 1e-8, ...patch,
  };
}

const texels = () => new Float32Array(COVERAGE_MAX_SOURCES * 4);
const keys = () => new Int32Array(COVERAGE_MAX_SOURCES);

describe('measuredSourceCount', () => {
  it('caps at the texels the target carries and floors at zero', () => {
    expect(measuredSourceCount(5)).toBe(5);
    expect(measuredSourceCount(COVERAGE_MAX_SOURCES + 40)).toBe(COVERAGE_MAX_SOURCES);
    expect(measuredSourceCount(-1)).toBe(0);
  });
});

describe('packSourceTexels', () => {
  it('writes the layout the shader unpacks', () => {
    const t = texels();
    packSourceTexels(
      [source({ screenX: 12, screenY: 34, diameterPx: 8, cameraDistancePc: 4.8e-6 })],
      1, t, keys());
    expect([...t.slice(0, 4)])
      .toEqual([12, 34, footprintRadiusPx(8), 4.8e-6].map(Math.fround));
  });

  it('takes the TRUE footprint radius, never the widened visibility disc', () => {
    // The shader derives the self-occlusion slack from this channel, and
    // that slack has to be the source's own body — the tap disc's edge-ramp
    // floor is applied shader-side and must not reach here.
    const t = texels();
    packSourceTexels([source({ diameterPx: 0 })], 1, t, keys());
    expect(t[2]).toBe(Math.fround(Math.sqrt(1 / Math.PI)));
  });

  it('files key i against texel i, which is the whole readback contract', () => {
    // The measurement lands after the pool that produced it is gone, so a
    // slipped index hands one source another source\'s throughput.
    const t = texels();
    const k = keys();
    const sources = [
      source({ sourceKey: 3, screenX: 1 }),
      source({ sourceKey: starSourceKey(9), screenX: 2 }),
      source({ sourceKey: 0, screenX: 3 }),
    ];
    packSourceTexels(sources, 3, t, k);
    expect([...k.slice(0, 3)]).toEqual([3, starSourceKey(9), 0]);
    expect([t[0], t[4], t[8]]).toEqual([1, 2, 3]);
  });

  it('leaves slots past the live prefix untouched for the shader to skip', () => {
    const t = texels();
    const k = keys();
    packSourceTexels([source({ sourceKey: 7, screenX: 99 })], 1, t, k);
    packSourceTexels([source({ sourceKey: 8, screenX: 11 })], 1, t, k);
    expect(k[1]).toBe(0);
    expect(t[4]).toBe(0);
  });
});

describe('landTransmission', () => {
  it('files the red channel under the key at the matching index', () => {
    const out = new Map<number, number>();
    const k = Int32Array.from([5, -1, 0]);
    const pixels = Float32Array.from([
      0.25, 0, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    landTransmission(k, pixels, 3, out);
    expect([...out]).toEqual([[5, 0.25], [-1, 1], [0, 0]]);
  });

  it('drops the previous frame entirely, so a departed source cannot linger', () => {
    const out = new Map<number, number>([[42, 0]]);
    landTransmission(Int32Array.from([5]), Float32Array.from([1, 0, 0, 0]), 1, out);
    expect(out.has(42)).toBe(false);
  });
});

describe('ring slots', () => {
  const ring = (patch: Partial<RingOccluder> = {}): RingOccluder => ({
    centreView: new THREE.Vector3(1, 2, -3),
    poleView: new THREE.Vector3(0, 1, 0),
    outerPc: 4.5e-7,
    innerRatio: 0.53,
    alphaScale: 1,
    strip: new THREE.Texture(),
    ...patch,
  });

  it('packs centre/outer and pole/inner into the two vec4s', () => {
    const centre = new THREE.Vector4();
    const pole = new THREE.Vector4();
    packRingSlot(ring(), centre, pole);
    expect([centre.x, centre.y, centre.z, centre.w]).toEqual([1, 2, -3, 4.5e-7]);
    expect([pole.x, pole.y, pole.z, pole.w]).toEqual([0, 1, 0, 0.53]);
  });

  it('clears to the zero-outer-radius sentinel with a unit pole', () => {
    // A stale slot must read as unused rather than as an annulus at the
    // origin, and its pole still has to be safe to divide by.
    const centre = new THREE.Vector4();
    const pole = new THREE.Vector4();
    packRingSlot(ring(), centre, pole);
    clearRingSlot(centre, pole);
    expect(centre.w).toBe(0);
    expect(new THREE.Vector3(pole.x, pole.y, pole.z).length()).toBe(1);
  });
});
