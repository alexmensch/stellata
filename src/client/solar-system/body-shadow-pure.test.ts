import { describe, it, expect, beforeEach } from 'vitest';
import { casterShadowFactor, MAX_SHADOW_CASTERS } from './body-shadow-pure';
import { getPlanetPositions, _resetCacheForTests } from './ephemeris';
import { earthMoonSplit, MOON_ELEMENTS, moonOffsetEcliptic } from './moon-ephemeris';
import { eclipseDimFromOffsets } from '../binaries/eclipse-photometry-pure';
import { KM_PC, R_SUN_PC } from '../util/astronomy-constants';

const J2000_UNIX = 946728000;

beforeEach(() => {
  _resetCacheForTests();
});

describe('casterShadowFactor', () => {
  // Sun along +x from the surface point at the origin; caster radius 1.
  const SUN_ANG = 0.001;

  it('full umbra when the caster sits dead on the sun ray', () => {
    expect(casterShadowFactor(0, 0, 0, 1, 0, 0, 100, 0, 0, 1, SUN_ANG)).toBe(0);
  });

  it('no shadow when the caster is behind the surface point (anti-sun)', () => {
    expect(casterShadowFactor(0, 0, 0, 1, 0, 0, -100, 0, 0, 1, SUN_ANG)).toBe(1);
  });

  it('no shadow when the caster misses the ray by far more than its radius', () => {
    expect(casterShadowFactor(0, 0, 0, 1, 0, 0, 100, 50, 0, 1, SUN_ANG)).toBe(1);
  });

  it('penumbra: grazing geometry attenuates partially', () => {
    // Caster centre exactly one radius off the ray: half the penumbra
    // band → smoothstep(-pen, +pen, 0-off-centre) at the midpoint = 0.5.
    const v = casterShadowFactor(0, 0, 0, 1, 0, 0, 100, 1, 0, 1, SUN_ANG);
    expect(v).toBeGreaterThan(0.4);
    expect(v).toBeLessThan(0.6);
  });

  it('penumbra width scales with the host angular radius', () => {
    // Same slightly-off-centre geometry: a bigger sun softens the edge
    // (more light at the same miss distance inside the shadow edge).
    const miss = 0.9;
    const sharp = casterShadowFactor(0, 0, 0, 1, 0, 0, 100, miss, 0, 1, 0.0001);
    const soft = casterShadowFactor(0, 0, 0, 1, 0, 0, 100, miss, 0, 1, 0.02);
    expect(sharp).toBe(0);
    expect(soft).toBeGreaterThan(0);
  });

  it('antumbral (annular) case never reaches full umbra', () => {
    // Caster angular size below the host's: penumbra half-width
    // tAlong·sunAng exceeds the caster radius, so even a dead-centre
    // alignment leaves light (smoothstep over a band straddling 0).
    const v = casterShadowFactor(0, 0, 0, 1, 0, 0, 100, 0, 0, 1, 0.05);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('caster capacity covers the largest in-scope moon family (Saturn: 7)', () => {
    expect(MAX_SHADOW_CASTERS).toBeGreaterThanOrEqual(7);
  });
});

describe('shadow events on the real ephemeris', () => {
  it('Io casts an umbral shadow onto Jupiter within one orbital period', () => {
    // Io orbits in Jupiter's near-equatorial plane, which stays within
    // ~3° of the sun direction, so its shadow crosses the Jovian disc
    // every 1.77-day orbit — a search over one period must find a deep
    // umbra epoch regardless of mean-element phase errors.
    const io = MOON_ELEMENTS.find((m) => m.name === 'Io')!;
    const R_J = 69911 * KM_PC;
    const R_IO = 1821.6 * KM_PC;
    const off = { x: 0, y: 0, z: 0 };
    let minShadow = 1;
    const periodS = io.periodDays * 86400;
    for (let k = 0; k < 720; k++) {
      _resetCacheForTests();
      const t = J2000_UNIX + (k / 720) * periodS;
      const J = getPlanetPositions(t).jupiter;
      moonOffsetEcliptic(io, t, off);
      const ix = J.x + off.x;
      const iy = J.y + off.y;
      const iz = J.z + off.z;
      // Anti-sun ray from Io (sun at the origin): does it hit Jupiter?
      const dIo = Math.hypot(ix, iy, iz);
      const ux = ix / dIo, uy = iy / dIo, uz = iz / dIo;
      const wx = ix - J.x, wy = iy - J.y, wz = iz - J.z;
      const b = 2 * (wx * ux + wy * uy + wz * uz);
      const c = wx * wx + wy * wy + wz * wz - R_J * R_J;
      const disc = b * b - 4 * c;
      if (disc < 0) continue;
      const s = (-b - Math.sqrt(disc)) / 2;
      if (s <= 0) continue;
      const px = ix + s * ux, py = iy + s * uy, pz = iz + s * uz;
      const dP = Math.hypot(px, py, pz);
      const shadow = casterShadowFactor(
        px, py, pz,
        -px / dP, -py / dP, -pz / dP,
        ix, iy, iz,
        R_IO,
        R_SUN_PC / dP,
      );
      if (shadow < minShadow) minShadow = shadow;
    }
    expect(minShadow).toBeLessThan(0.05);
  });

  it("the Moon enters Earth's shadow (eclipse dim < 1) within a year", () => {
    // Eclipse seasons come twice a year when the sun passes the Moon's
    // node; a half-hour sweep over one year must catch at least a
    // partial eclipse — mean elements shift the exact dates but not the
    // node-alignment geometry.
    const moonEl = MOON_ELEMENTS.find((m) => m.name === 'Moon')!;
    const R_E = 6371 * KM_PC;
    const geo = { x: 0, y: 0, z: 0 };
    const earth = { x: 0, y: 0, z: 0 };
    const moon = { x: 0, y: 0, z: 0 };
    let minDim = 1;
    for (let k = 0; k < 17520; k++) {
      _resetCacheForTests();
      const t = J2000_UNIX + k * 1800;
      const bary = getPlanetPositions(t).earth;
      moonOffsetEcliptic(moonEl, t, geo);
      earthMoonSplit(bary, geo, earth, moon);
      // Viewpoint = the Moon; primary = the Sun (origin), secondary =
      // Earth. The dim on the back component (the Sun) is the Moon's
      // illumination factor — the same call the body field makes.
      const r = eclipseDimFromOffsets(
        -moon.x, -moon.y, -moon.z,
        earth.x, earth.y, earth.z,
        R_SUN_PC,
        R_E,
      );
      if (r.front === 'secondary' && r.dim < minDim) minDim = r.dim;
    }
    expect(minDim).toBeLessThan(1);
  });
});
