import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RELIEF_POLE_EPS, reliefNormal } from './surface-relief-pure';

const frag = readFileSync(
  fileURLToPath(new URL('./planet-mesh.frag.glsl', import.meta.url)),
  'utf8',
);

/** Equator at longitude 0 with the pole on +z: east is +y, north is +z. */
const N: readonly [number, number, number] = [1, 0, 0];
const POLE: readonly [number, number, number] = [0, 0, 1];

const encode = (x: number, y: number): [number, number] => [x * 0.5 + 0.5, y * 0.5 + 0.5];
const dot = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const tiltDeg = (r: readonly [number, number, number]): number =>
  (Math.acos(Math.min(1, dot(r, N))) * 180) / Math.PI;

describe('the equirect tangent frame', () => {
  it('leaves the geometric normal alone on flat ground', () => {
    expect(reliefNormal(N, POLE, encode(0, 0))).toEqual([1, 0, 0]);
  });

  it('puts +x on east — the direction of increasing longitude', () => {
    const r = reliefNormal(N, POLE, encode(Math.SQRT1_2, 0));
    expect(r[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r[2]).toBeCloseTo(0, 12);
  });

  it('puts +y on north — the meridian tangent toward the pole', () => {
    const r = reliefNormal(N, POLE, encode(0, Math.SQRT1_2));
    expect(r[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r[1]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(Math.SQRT1_2, 12);
  });

  // dem_relief.py encodes (-dz/du, -dz/dv, 1), so ground RISING toward the
  // east carries a normal leaning WEST. Inverting either channel is the
  // failure with no other symptom: the terrain still shades, and every
  // crater lights from the wrong side.
  it('leans a normal away from the uphill direction', () => {
    const risingEast = reliefNormal(N, POLE, encode(-0.5, 0));
    expect(risingEast[1]).toBeLessThan(0);
    const risingNorth = reliefNormal(N, POLE, encode(0, -0.5));
    expect(risingNorth[2]).toBeLessThan(0);
  });

  it('carries the encoded tilt off the local vertical', () => {
    // The Moon's measured median and p90 (data/textures/README.md).
    for (const deg of [3.27, 11.66, 45]) {
      const rad = (deg * Math.PI) / 180;
      const r = reliefNormal(N, POLE, encode(Math.sin(rad), 0));
      expect(tiltDeg(r)).toBeCloseTo(deg, 10);
    }
  });

  it('stays unit length under an 8-bit encode that overshoots the disc', () => {
    // Round-tripping a steep normal through 8 bits can push x² + y² past 1,
    // which zeroes the reconstructed z; the result must still be a normal.
    const enc: [number, number] = [Math.round(0.99 * 255) / 255, Math.round(0.99 * 255) / 255];
    const r = reliefNormal(N, POLE, enc);
    expect(Math.hypot(...r)).toBeCloseTo(1, 12);
  });

  it('drops the perturbation where the frame degenerates at a pole', () => {
    expect(reliefNormal(POLE, POLE, encode(0.5, 0.5))).toEqual([0, 0, 1]);
    const nearPole: readonly [number, number, number] = [RELIEF_POLE_EPS / 2, 0, 1];
    expect(reliefNormal(nearPole, POLE, encode(0.5, 0.5))).toEqual([...nearPole]);
  });
});

// The shader is the render path and this module is only its mirror, so the
// expression shapes are pinned as source text — there is no GL context here.
describe('the shader mirrors this frame', () => {
  it('builds east and north the same way', () => {
    expect(frag).toContain('vec3 e = cross(pole, n);');
    expect(frag).toContain('vec3 north = cross(n, east);');
    expect(frag).toContain('if (eLen < 1e-6) return n;');
    expect(RELIEF_POLE_EPS).toBe(1e-6);
  });

  it('reconstructs z rather than reading the flat blue channel', () => {
    expect(frag).toContain('vec2 t = enc * 2.0 - 1.0;');
    expect(frag).toContain('n * sqrt(max(1.0 - dot(t, t), 0.0))');
    expect(frag).toContain('texture(uNormalMap, vUvM).rg');
  });
});

// The exposure pin, the closed-form limb mean, solar depression and the
// airlight march geometry all read the GEOMETRIC normal — see README.md
// § Surface relief for what each would break. Relief reaches the direct term
// and nothing else, which is exactly one derived cosine spent in one place.
describe('relief feeds the direct term only', () => {
  it('perturbs nothing but the Lambert cosine', () => {
    expect(frag.match(/nRelief/g)).toHaveLength(2);
    expect(frag.match(/sunCosRelief/g)).toHaveLength(3);
    expect(frag).toContain(
      'float dayside = smoothstep(-w, w, sunCosRelief) * max(sunCosRelief, w);');
  });

  it('leaves the geometric consumers of sunCos untouched', () => {
    expect(frag).toContain('float sunCos = dot(n, uSunDirView);');
    expect(frag).toContain('float lit = step(0.0, sunCos) * step(0.5, shadow);');
    expect(frag).toContain('stellata_skyIrradiance(sunCos, uScaleHeightR,');
    expect(frag).toContain('float ndotv = clamp(dot(n, v), 0.0, 1.0);');
    expect(frag).toContain(
      'vec3 surf = normalize(stellata_scalePolar(normalize(vNormalV), uPoleView, uPolarRadiusR));');
  });
});
