import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Catalog } from '../../loaders/catalog-loader';
import { makeEmptyCatalog } from '../../loaders/catalog-mock';
import type { FilterState } from '../../filters/filter-state';
import {
  fovMinorRad,
  peakAmplitudeFactor,
  minOrbitDistForStar,
  parkDistForStar,
  renderedSizePx,
  renderedDiscPxAtPeak,
  getChartDiscParams,
  ZOOM_FLOOR_FRACTION,
} from './star-physics';
import { R_SUN_PC, AU_PC } from '../../util/astronomy-constants';

function makeCatalog(
  n: number,
  populate: (cat: Catalog) => void = () => undefined,
): Catalog {
  const cat = makeEmptyCatalog(n);
  populate(cat);
  return cat;
}

function makeFilter(overrides: Partial<FilterState> = {}): FilterState {
  return {
    minDistSol: 0,
    maxDistSol: 1e9,
    maxAppMag: 6,
    spectMask: 0xff,
    highlightCon: -1,
    sizeMin: 1,
    sizeMax: 8,
    sizeSpan: 8,
    activePreset: 'naked-eye',
    sizeMinOverridden: false,
    sizeMaxOverridden: false,
    sizeSpanOverridden: false,
    showConstellation: true,
    showGalacticGrid: true,
    showHud: true,
    showMilkyway: true,
    showLgEmission: true,
    chart: false,
    ...overrides,
  };
}

function makeUniforms(overrides: Partial<{
  uFovYRad: number;
  uViewportX: number;
  uViewportY: number;
  uModelDays: number;
  uModelDaysPerRealSec: number;
  uMinPeriodSec: number;
  uSizeKnee: number;
}> = {}) {
  return {
    uFovYRad: { value: overrides.uFovYRad ?? Math.PI / 3 },           // 60°
    uViewport: { value: new THREE.Vector2(overrides.uViewportX ?? 1920, overrides.uViewportY ?? 1080) },
    uModelDays: { value: overrides.uModelDays ?? 0 },
    // 1× (live) rate by default: model advances 1 day per 86400 real s,
    // so the anti-strobe floor is negligible and every real period rules.
    uModelDaysPerRealSec: { value: overrides.uModelDaysPerRealSec ?? 1 / 86400 },
    uMinPeriodSec: { value: overrides.uMinPeriodSec ?? 4 },
    uSizeKnee: { value: overrides.uSizeKnee ?? 16 },
  };
}

describe('star-physics / constants', () => {
  it('exports the canonical viewport-fraction value', () => {
    expect(ZOOM_FLOOR_FRACTION).toBe(0.9);
  });
});

describe('star-physics / fovMinorRad', () => {
  it('returns fovY for landscape (aspect > 1)', () => {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.001, 1e9);
    expect(fovMinorRad(cam)).toBeCloseTo(Math.PI / 3, 12);
  });

  it('returns fovX for portrait (aspect < 1)', () => {
    const cam = new THREE.PerspectiveCamera(60, 9 / 16, 0.001, 1e9);
    const fovY = Math.PI / 3;
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * (9 / 16));
    expect(fovMinorRad(cam)).toBeCloseTo(fovX, 12);
    expect(fovMinorRad(cam)).toBeLessThan(fovY);
  });

  it('returns fovY for a square viewport (degenerate aspect = 1)', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.001, 1e9);
    expect(fovMinorRad(cam)).toBeCloseTo(Math.PI / 3, 12);
  });
});

describe('star-physics / peakAmplitudeFactor (catalog-indexed)', () => {
  it('returns 1 for non-variables (period=0, amp=0)', () => {
    const cat = makeCatalog(1);
    expect(peakAmplitudeFactor(cat, 0)).toBe(1);
  });

  it('returns 1 for amp>0 but period=0 (irregular — no model)', () => {
    const cat = makeCatalog(1, c => { c.amplitudeMag[0] = 1.5; });
    expect(peakAmplitudeFactor(cat, 0)).toBe(1);
  });

  it('returns 1 for period>0 but amp=0', () => {
    const cat = makeCatalog(1, c => { c.periodDays[0] = 100; });
    expect(peakAmplitudeFactor(cat, 0)).toBe(1);
  });

  it('matches √ρ when both period and amp are positive', () => {
    const cat = makeCatalog(1, c => {
      c.amplitudeMag[0] = 8.5; c.periodDays[0] = 332; c.pulsRho[0] = 1.4;
    });
    expect(peakAmplitudeFactor(cat, 0)).toBeCloseTo(Math.sqrt(cat.pulsRho[0]), 12);
  });
});

describe('star-physics / parkDistForStar', () => {
  // fovMinor used across the parking tests — fovY = 60° at 16:9 aspect.
  const fovMinor = Math.PI / 3;

  it('parks Sol (R=1 Rsol, no variability) at AU_PC + R', () => {
    const cat = makeCatalog(1); // R defaults to 1 Rsol
    // Float32 round-trip rebuilds Reff from cat.physicalRadius[0] (not the
    // float64 literal); use the round-tripped value so the toBe match is
    // bit-exact.
    const Reff = cat.physicalRadius[0] * R_SUN_PC;
    const expected = Math.max(
      AU_PC + Reff,
      Reff / Math.tan((ZOOM_FLOOR_FRACTION * fovMinor) / 2),
    );
    expect(parkDistForStar({ catalog: cat, idx: 0, fovMinorRad: fovMinor })).toBe(expected);
    expect(parkDistForStar({ catalog: cat, idx: 0, fovMinorRad: fovMinor })).toBe(AU_PC + Reff);
  });

  it('parks a supergiant (R=1000 Rsol) on the manual-zoom floor — Reff overwhelms 1 AU', () => {
    const cat = makeCatalog(1, c => { c.physicalRadius[0] = 1000; });
    const Reff = cat.physicalRadius[0] * R_SUN_PC;
    const dMinFloor = Reff / Math.tan((ZOOM_FLOOR_FRACTION * fovMinor) / 2);
    expect(dMinFloor).toBeGreaterThan(AU_PC + Reff); // sanity: floor wins
    expect(parkDistForStar({ catalog: cat, idx: 0, fovMinorRad: fovMinor })).toBe(dMinFloor);
  });

  it('respects peak-amplitude radius for variables (Mira-like: amp=8.5, ρ=1.4)', () => {
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 332;
      c.amplitudeMag[0] = 8.5;
      c.periodDays[0] = 332;
      c.pulsRho[0] = 1.4;
    });
    const Reff = cat.physicalRadius[0] * R_SUN_PC * Math.sqrt(cat.pulsRho[0]);
    const dMinFloor = Reff / Math.tan((ZOOM_FLOOR_FRACTION * fovMinor) / 2);
    expect(parkDistForStar({ catalog: cat, idx: 0, fovMinorRad: fovMinor })).toBe(dMinFloor);
  });

  it('parks a binary primary identically to a non-binary star of the same radius', () => {
    const single = makeCatalog(1);
    const pair = makeCatalog(2, c => {
      c.positions[1 * 3] = 0.01;
      c.companion[0] = 1;
    });
    expect(parkDistForStar({ catalog: pair, idx: 0, fovMinorRad: fovMinor }))
      .toBe(parkDistForStar({ catalog: single, idx: 0, fovMinorRad: fovMinor }));
  });
});

describe('star-physics / minOrbitDistForStar', () => {
  const fovMinor = Math.PI / 3;

  it('returns the ZOOM_FLOOR_FRACTION-fill distance for a non-variable single star', () => {
    const cat = makeCatalog(1, c => { c.physicalRadius[0] = 10; });
    const Reff = cat.physicalRadius[0] * R_SUN_PC;
    const expected = Reff / Math.tan((ZOOM_FLOOR_FRACTION * fovMinor) / 2);
    expect(minOrbitDistForStar({ catalog: cat, idx: 0, fovMinorRad: fovMinor })).toBe(expected);
  });

  it('uses peak-amplitude radius for variables so the orbit floor matches the peak disc', () => {
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 100;
      c.amplitudeMag[0] = 2;
      c.periodDays[0] = 50;
      c.pulsRho[0] = 1.15;
    });
    const Reff = cat.physicalRadius[0] * R_SUN_PC * Math.sqrt(cat.pulsRho[0]);
    const expected = Reff / Math.tan((ZOOM_FLOOR_FRACTION * fovMinor) / 2);
    expect(minOrbitDistForStar({ catalog: cat, idx: 0, fovMinorRad: fovMinor })).toBe(expected);
  });

  it('returns the same floor for a binary primary as for a same-radius single star', () => {
    const single = makeCatalog(1, c => { c.physicalRadius[0] = 1; });
    const pair = makeCatalog(2, c => {
      c.physicalRadius[0] = 1;
      c.positions[1 * 3] = 0.005;
      c.companion[0] = 1;
    });
    expect(minOrbitDistForStar({ catalog: pair, idx: 0, fovMinorRad: fovMinor }))
      .toBe(minOrbitDistForStar({ catalog: single, idx: 0, fovMinorRad: fovMinor }));
  });
});

describe('star-physics / renderedSizePx', () => {
  // Sirius-like row at 2.64 pc (AT-HYG roughly): absmag = 1.4, R = 1.7 Rsol,
  // sized so the camera sits some practical distance away. The numeric
  // pins below derive from the formula directly so the test fails on any
  // shader-formula drift, not just rounding.
  function sirius() {
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 1.7;
      c.absmag[0] = 1.4;
    });
    // Camera 5 pc away along +x.
    const camPos = new THREE.Vector3(5, 0, 0);
    // Star at origin (localPositions = 0,0,0 by default).
    return { catalog: cat, camPos, localPositions: cat.positions };
  }

  it('returns the `appSize` floor for a far-away, non-variable, bright-enough row', () => {
    const { catalog, camPos, localPositions } = sirius();
    const uniforms = makeUniforms();
    const filter = makeFilter({ sizeMin: 1.5, sizeMax: 6, sizeSpan: 8, maxAppMag: 6 });
    // dCam = 5; appMag = catalog.absmag[0] + 5*(log10(5) - 1).
    // brightness = clamp01((maxAppMag - appMag) / sizeSpan).
    // appSize = sizeMin + sqrt(brightness) * (sizeMax - sizeMin).
    // Float32 round-trip on absmag is the precision-leaking step; compute
    // expected via the rounded value so the toBe is bit-exact.
    const got = renderedSizePx({ catalog, idx: 0, camPos, localPositions, uniforms, filter });
    const appMag = catalog.absmag[0] + 5 * (Math.log10(5) - 1);
    const brightness = Math.max(0, Math.min(1, (6 - appMag) / 8));
    const appSize = 1.5 + Math.sqrt(brightness) * (6 - 1.5);
    expect(got).toBe(appSize);
  });

  it('grows past sizeMax through the soft knee when Δm exceeds sizeSpan', () => {
    // Bright supergiant-like row: Δm = maxAppMag − appMag lands well past
    // sizeSpan, where the shader's Michaelis–Menten knee keeps the disc
    // growing. The old CPU mirror hard-clamped at sizeMax here.
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 1;
      c.absmag[0] = -5;
    });
    const camPos = new THREE.Vector3(5, 0, 0);
    const uniforms = makeUniforms();
    const filter = makeFilter({ sizeMin: 1.5, sizeMax: 6, sizeSpan: 8, maxAppMag: 6 });
    const got = renderedSizePx({
      catalog: cat, idx: 0, camPos, localPositions: cat.positions, uniforms, filter,
    });
    const appMag = cat.absmag[0] + 5 * (Math.log10(5) - 1);
    const dM = 6 - appMag;
    const over = dM - 8;
    const dMEff = 8 + (16 * over) / Math.max(16 + over, 1e-6);
    const expected = 1.5 + Math.sqrt(dMEff / 8) * (6 - 1.5);
    expect(dM).toBeGreaterThan(8);
    expect(got).toBe(expected);
    expect(got).toBeGreaterThan(filter.sizeMax);
  });

  it('recovers the hard clamp at sizeMax when uSizeKnee = 0', () => {
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 1;
      c.absmag[0] = -5;
    });
    const camPos = new THREE.Vector3(5, 0, 0);
    const uniforms = makeUniforms({ uSizeKnee: 0 });
    const filter = makeFilter({ sizeMin: 1.5, sizeMax: 6, sizeSpan: 8, maxAppMag: 6 });
    const got = renderedSizePx({
      catalog: cat, idx: 0, camPos, localPositions: cat.positions, uniforms, filter,
    });
    expect(got).toBe(filter.sizeMax);
  });

  it('returns the physSize (up-clamped to the viewport fraction) when R/d dominates', () => {
    const { catalog, localPositions } = sirius();
    const uniforms = makeUniforms();
    const filter = makeFilter();
    // Camera 0.01 AU away → R/d is huge → physSize wins, then hits the
    // uMaxPhysFrac up-clamp (mirrors star.vert.glsl).
    const camPos = new THREE.Vector3(0.01 * AU_PC, 0, 0);
    const got = renderedSizePx({ catalog, idx: 0, camPos, localPositions, uniforms, filter });
    // Reconstruct via the float32-rounded catalog value so the pin is exact.
    const dCam = Math.abs(catalog.positions[0] - camPos.x); // 0.01 AU_PC
    const R = catalog.physicalRadius[0] * R_SUN_PC;
    const fovY = Math.PI / 3;
    const viewportY = 1080;
    const expectedPhys = 2 * Math.atan(R / dCam) * (viewportY / fovY);
    const maxPhys = ZOOM_FLOOR_FRACTION * Math.min(1920, viewportY);
    expect(got).toBe(Math.min(expectedPhys, maxPhys));
  });

  it('modulates on the model clock: φ = 0 (max light) is largest, φ = ½ (min) smallest', () => {
    // Algol-ish: 2.87 d, 1.27 mag amp (period suppression aside — this row
    // isn't flagged eclipsing here, so it pulsates). Model phase = φ →
    // uModelDays = φ · period (the 1× anti-strobe floor is negligible).
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 2.9;
      c.absmag[0] = -0.15;
      c.amplitudeMag[0] = 1.27;
      c.periodDays[0] = 2.87;
    });
    const camPos = new THREE.Vector3(28, 0, 0);
    const localPositions = cat.positions;
    const filter = makeFilter({ sizeMin: 1, sizeMax: 8, sizeSpan: 8, maxAppMag: 6 });
    const at = (phase: number) => renderedSizePx({
      catalog: cat, idx: 0, camPos, localPositions,
      uniforms: makeUniforms({ uModelDays: phase * 2.87 }), filter,
    });
    // φ=0 = maximum light → brightest + largest; φ=½ = minimum → smallest;
    // φ=¼ = mean → in between. The cos convention (φ=0=max) is what the
    // GCVS M0-anchoring folds onto.
    const maxLight = at(0);
    const mean = at(0.25);
    const minLight = at(0.5);
    expect(maxLight).toBeGreaterThan(mean);
    expect(mean).toBeGreaterThan(minLight);
  });

  it('anti-strobe floor caps the effective period under heavy time-warp', () => {
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 2.9;
      c.absmag[0] = -0.15;
      c.amplitudeMag[0] = 1.27;
      c.periodDays[0] = 0.5; // RR-Lyrae-ish short period
    });
    const camPos = new THREE.Vector3(28, 0, 0);
    const localPositions = cat.positions;
    const filter = makeFilter({ sizeMin: 1, sizeMax: 8, sizeSpan: 8, maxAppMag: 6 });
    // Heavy warp: 1e6× → uModelDaysPerRealSec = 1e6/86400 ≈ 11.57; floor =
    // 11.57 × 4 s ≈ 46.3 model-days ≫ the 0.5 d period, so the effective
    // period is the floor. At uModelDays = floor/2 the star is at φ=½ (min);
    // without the floor it would be at φ = (floor/2)/0.5 = many cycles.
    const rate = 1e6 / 86400;
    const floorDays = rate * 4;
    const min = renderedSizePx({
      catalog: cat, idx: 0, camPos, localPositions,
      uniforms: makeUniforms({ uModelDays: floorDays / 2, uModelDaysPerRealSec: rate }),
      filter,
    });
    const max = renderedSizePx({
      catalog: cat, idx: 0, camPos, localPositions,
      uniforms: makeUniforms({ uModelDays: floorDays, uModelDaysPerRealSec: rate }),
      filter,
    });
    // With the floor engaged, φ=1 (== φ=0, max) is larger than φ=½ (min).
    expect(max).toBeGreaterThan(min);
  });
});

describe('star-physics / renderedDiscPxAtPeak', () => {
  it('matches the un-modulated physSize for a non-variable star', () => {
    const cat = makeCatalog(1, c => { c.physicalRadius[0] = 1; });
    const camPos = new THREE.Vector3(AU_PC * 100, 0, 0);
    const uniforms = makeUniforms();
    const got = renderedDiscPxAtPeak({ catalog: cat, idx: 0, camPos, localPositions: cat.positions, uniforms });
    const dCam = camPos.x; // star at origin
    const R = cat.physicalRadius[0] * R_SUN_PC;
    const fovY = Math.PI / 3;
    const expected = 2 * Math.atan(R / dCam) * (1080 / fovY);
    expect(got).toBe(expected);
  });

  it('uses peak-amplitude radius for variables (Mira: amp=8.5, ρ=1.4)', () => {
    const cat = makeCatalog(1, c => {
      c.physicalRadius[0] = 1;
      c.amplitudeMag[0] = 8.5;
      c.periodDays[0] = 332;
      c.pulsRho[0] = 1.4;
    });
    const camPos = new THREE.Vector3(AU_PC * 100, 0, 0);
    const uniforms = makeUniforms();
    const got = renderedDiscPxAtPeak({ catalog: cat, idx: 0, camPos, localPositions: cat.positions, uniforms });
    const dCam = camPos.x;
    const R = cat.physicalRadius[0] * R_SUN_PC;
    const peak = Math.sqrt(cat.pulsRho[0]);
    const fovY = Math.PI / 3;
    const expected = 2 * Math.atan((R * peak) / dCam) * (1080 / fovY);
    expect(got).toBe(expected);
  });

  it('floors dCam at DCAM_LOG_FLOOR_PC so a camera at the star centre does not blow up', () => {
    const cat = makeCatalog(1, c => { c.physicalRadius[0] = 1; });
    const camPos = new THREE.Vector3(0, 0, 0); // identical to star pos
    const uniforms = makeUniforms();
    const got = renderedDiscPxAtPeak({ catalog: cat, idx: 0, camPos, localPositions: cat.positions, uniforms });
    expect(Number.isFinite(got)).toBe(true);
  });
});

describe('star-physics / getChartDiscParams', () => {
  it('reads the three uniform values verbatim', () => {
    const u = {
      uChartDiscMaxPx: { value: 12 },
      uChartDiscMinPx: { value: 1.5 },
      uChartMagBright: { value: 4 },
    };
    expect(getChartDiscParams(u)).toEqual({ maxPx: 12, minPx: 1.5, magBright: 4 });
  });
});
