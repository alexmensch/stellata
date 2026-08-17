import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SOL_BODIES } from '../../planet-system';
import {
  HORIZON_AZIMUTHS,
  HORIZON_SIN_RANGE,
  RELIEF_ELEV_SPAN_M,
  RELIEF_POLE_EPS,
  horizonSin,
  reliefHorizonSines,
  reliefNormal,
  tangentFrame,
} from './surface-relief-pure';

const frag = readFileSync(
  fileURLToPath(new URL('../planet-mesh.frag.glsl', import.meta.url)),
  'utf8',
);
/** Counting identifiers over the raw source would fail the moment a comment
 *  named one of them, which is a spurious failure with a confusing message. */
const fragCode = frag.replace(/\/\/[^\n]*/g, '');

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
    expect(tangentFrame(POLE, POLE)).toBeNull();
  });

  it('hands both consumers the one frame', () => {
    const frame = tangentFrame(N, POLE)!;
    expect(frame.east).toEqual([0, 1, 0]);
    expect(frame.north).toEqual([0, 0, 1]);
  });
});

// Azimuth 0 is east and they run toward north, so the eight channels of the
// two maps concatenated are E, NE, N, NW, W, SW, S, SE.
describe('the horizon lookup', () => {
  const enc = Array.from({ length: HORIZON_AZIMUTHS }, (_, k) => (k + 1) / 16);
  const decode = (v: number) => (v * 2 - 1) * HORIZON_SIN_RANGE;
  const diag = Math.SQRT1_2;

  it('reads a half-scale texel as a skyline at the geometric horizon', () => {
    expect(horizonSin(new Array(HORIZON_AZIMUTHS).fill(0.5), 1, 0)).toBe(0);
  });

  it('decodes full scale to the encoding range, both signs', () => {
    expect(horizonSin(new Array(HORIZON_AZIMUTHS).fill(1), 1, 0)).toBeCloseTo(
      HORIZON_SIN_RANGE, 12);
    expect(horizonSin(new Array(HORIZON_AZIMUTHS).fill(0), 1, 0)).toBeCloseTo(
      -HORIZON_SIN_RANGE, 12);
  });

  it('lands each compass direction on its own channel', () => {
    for (const [i, [e, n]] of ([
      [1, 0], [diag, diag], [0, 1], [-diag, diag],
      [-1, 0], [-diag, -diag], [0, -1], [diag, -diag],
    ] as const).entries()) {
      expect(horizonSin(enc, e, n), `azimuth ${i}`).toBeCloseTo(decode(enc[i]), 12);
    }
  });

  it('interpolates between the two channels bracketing the direction', () => {
    const half = Math.PI / HORIZON_AZIMUTHS;
    expect(horizonSin(enc, Math.cos(half), Math.sin(half))).toBeCloseTo(
      decode((enc[0] + enc[1]) / 2), 12);
    // The wrap is the case a plain index would miss: last channel back to first.
    expect(horizonSin(enc, Math.cos(-half), Math.sin(-half))).toBeCloseTo(
      decode((enc[7] + enc[0]) / 2), 12);
  });

  it('stays in range when the turn fraction rounds to a whole turn', () => {
    // A small enough negative azimuth makes 1 - turn round to exactly 1, which
    // puts the channel index one past the last — the wrap is load-bearing, not
    // defensive, and the same edge exists in the GLSL's fract().
    expect(horizonSin(enc, 1, -1e-30)).toBeCloseTo(decode(enc[0]), 12);
  });
});

// The shader is the render path and this module is only its mirror, so the
// expression shapes are pinned as source text — there is no GL context here.
describe('the shader mirrors this frame', () => {
  it('builds east and north the same way', () => {
    expect(frag).toContain('vec3 e = cross(pole, n);');
    expect(frag).toContain('north = cross(n, east);');
    expect(frag).toContain('if (eLen < 1e-6) return false;');
    expect(RELIEF_POLE_EPS).toBe(1e-6);
  });

  it('reconstructs z rather than reading the flat blue channel', () => {
    expect(frag).toContain('vec2 t = enc * 2.0 - 1.0;');
    expect(frag).toContain('n * sqrt(max(1.0 - dot(t, t), 0.0))');
    expect(frag).toContain('texture(uNormalMap, vUvM).rg');
  });

  it('carries the same azimuth count and encoding scale', () => {
    expect(frag).toContain(
      `const int STELLATA_HORIZON_AZIMUTHS = ${HORIZON_AZIMUTHS};`);
    expect(frag).toContain(
      `const float STELLATA_HORIZON_SIN_RANGE = ${HORIZON_SIN_RANGE};`);
  });

  it('walks the two maps in one azimuth order', () => {
    expect(frag).toContain('float[STELLATA_HORIZON_AZIMUTHS](a.r, a.g, a.b, a.a, b.r, b.g, b.b, b.a)');
    expect(frag).toContain('int i0 = int(base) % STELLATA_HORIZON_AZIMUTHS;');
    expect(frag).toContain('int i1 = (i0 + 1) % STELLATA_HORIZON_AZIMUTHS;');
  });
});

// The exposure pin, the closed-form limb mean, solar depression and the
// airlight march geometry all read the GEOMETRIC normal — see README.md for
// what each would break. Relief reaches the direct term
// and nothing else, which is exactly one derived cosine spent in one place.
describe('relief feeds the direct term only', () => {
  it('perturbs nothing but the Lambert cosine', () => {
    expect(fragCode.match(/nRelief/g)).toHaveLength(2);
    expect(fragCode.match(/sunCosRelief/g)).toHaveLength(3);
    expect(frag).toContain(
      'smoothstep(-w, w, sunCosRelief) * max(sunCosRelief, w) * horizonGate;');
  });

  it('bounds the term at the body, on the geometric cosine', () => {
    expect(frag).toContain(
      'smoothstep(-uReliefHorizon.y, -uReliefHorizon.x, sunCos)');
  });

  it('leaves the geometric consumers of sunCos untouched', () => {
    expect(frag).toContain('float sunCos = dot(n, uSunDirView);');
    expect(frag).toContain('float lit = step(0.0, sunCos) * step(0.5, shadow);');
    expect(frag).toContain('stellata_skyIrradiance(sunCos, uScaleHeightR,');
    // Narrow enough to survive an argument-list reflow in the atmosphere
    // march: what matters is which normal goes in, not the whole call.
    expect(frag).toMatch(/float ndotv = clamp\(dot\(n, v\)/);
    expect(frag).toMatch(/vec3 surf = normalize\(stellata_scalePolar\(normalize\(vNormalV\)/);
  });
});

// The frame above calls cross(pole, n) east and cross(n, east) north, and the
// map is authored positive-east left-to-right with v increasing northward
// (data/textures/README.md § Artifact contract). Nothing pinned that the
// RENDERED sphere agrees — and it is the one disagreement with no other
// symptom: relief would shade real terrain lit from the wrong side and look
// entirely plausible doing it. Pure geometry, so the IAU rotation chain on top
// cannot change the answer: a rotation carries a cross product with it.
describe('the mesh geometry the frame is built on', () => {
  const W = 128;
  const H = 64;
  const geometry = new THREE.SphereGeometry(1, W, H);
  const uv = geometry.attributes.uv;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const POLE_Y = new THREE.Vector3(0, 1, 0);
  const at = (ix: number, iy: number) => iy * (W + 1) + ix;
  const vec = (
    attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    i: number,
  ) => new THREE.Vector3().fromBufferAttribute(attr, i);

  // Rows 0 and H carry three.js's pole-seam u offset; the map's own longitude
  // derivative is zeroed past ±85° anyway, so relief never leans on them.
  it('steps toward cross(pole, n) as u increases — the map east', () => {
    for (const iy of [16, 32, 48]) {
      const a = at(40, iy);
      const b = at(41, iy);
      expect(uv.getY(b), `row ${iy} is one row`).toBeCloseTo(uv.getY(a), 12);
      expect(uv.getX(b), `row ${iy} steps +u`).toBeGreaterThan(uv.getX(a));
      const east = new THREE.Vector3()
        .crossVectors(POLE_Y, vec(normal, a))
        .normalize();
      const step = vec(position, b).sub(vec(position, a));
      expect(step.dot(east), `row ${iy} east`).toBeGreaterThan(0);
    }
  });

  it('steps toward the +Y pole as v increases — the map north', () => {
    const a = at(40, 33);
    const b = at(40, 32);
    expect(uv.getY(b)).toBeGreaterThan(uv.getY(a));
    expect(vec(position, b).sub(vec(position, a)).dot(POLE_Y)).toBeGreaterThan(0);
  });
});

const degOf = (sin: number): number => (Math.asin(sin) * 180) / Math.PI;
const bodyOf = (name: string) =>
  SOL_BODIES.find((b) => b.name.toLowerCase() === name)!;
const boundsOf = (name: string) =>
  reliefHorizonSines(RELIEF_ELEV_SPAN_M[name], bodyOf(name).radiusKm);

describe('the limb bound on how far relief may light', () => {
  it('gives each body a bound off its own DEM span and radius', () => {
    // Solar depression in degrees. The Moon's 19.9 km of relief over a 1737 km
    // radius is the widest of the three; Mercury's 9.9 km over 2440 km the
    // narrowest, less than half the Moon's.
    const pins: Record<string, [number, number]> = {
      moon: [6.3603, 8.6469],
      mercury: [3.4694, 5.1479],
      mars: [6.3956, 7.5316],
    };
    expect(Object.keys(pins).sort()).toEqual(Object.keys(RELIEF_ELEV_SPAN_M).sort());
    for (const [name, [full, none]] of Object.entries(pins)) {
      const [fullSin, noneSin] = boundsOf(name);
      expect(degOf(fullSin), `${name} full`).toBeCloseTo(full, 2);
      expect(degOf(noneSin), `${name} none`).toBeCloseTo(none, 2);
    }
  });

  it('opens before it closes, on every body', () => {
    for (const name of Object.keys(RELIEF_ELEV_SPAN_M)) {
      const [fullSin, noneSin] = boundsOf(name);
      expect(noneSin, `${name}`).toBeGreaterThan(fullSin);
    }
  });

  it('never reaches the terminator the smooth sphere lights on its own', () => {
    // The gate multiplies `dayside` whole, so it has to be saturated across the
    // terminator band or it would dim light relief never added — including the
    // by-eye softness widening an atmospheric body carries.
    for (const name of Object.keys(RELIEF_ELEV_SPAN_M)) {
      const [fullSin] = boundsOf(name);
      expect(fullSin, `${name} vs its softness band`).toBeGreaterThan(
        bodyOf(name).terminatorSoftness ?? 0,
      );
    }
  });

  it('is the body that bounds it, not the slope', () => {
    // Flat ground on a body with no elevation at all sees the sun exactly to
    // the geometric terminator, however the map tilts its normal there.
    expect(reliefHorizonSines([0, 0], 1737.4)).toEqual([0, 0]);
    // Doubling the radius under the same relief narrows the bound.
    const [, near] = reliefHorizonSines([-9110, 10760], 1737.4);
    const [, far] = reliefHorizonSines([-9110, 10760], 3474.8);
    expect(far).toBeLessThan(near);
  });
});
