import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Pin of the committed calibration manifest (data/textures/
// calibration.json, written by build-textures.py): every calibrated
// artifact's sphere-weighted mean chromaticity sits on its
// index-derived target, and the index table itself matches the
// adopted Mallama, Krobusek & Pavlov 2017 values. A retune of
// texture_calibration.py that drifts either fails here until the
// artifacts are rebuilt and recommitted.

interface CalibrationRow {
  bv: number;
  vrc: number;
  target: [number, number, number];
  meanBefore: [number, number, number];
  achieved: [number, number, number];
  gains: [number, number, number];
}

const manifest: Record<string, CalibrationRow> = JSON.parse(
  readFileSync(resolve(__dirname, '../../data/textures/calibration.json'), 'utf-8'),
);

// (B−V, V−Rc) per body — Mallama et al. 2017, Table 3 reference rows
// (Saturn V−Rc from its internally-consistent synthetic pair).
const INDICES: Record<string, [number, number]> = {
  mercury: [0.97, 0.52],
  venus: [0.7, 0.35],
  earth: [0.47, 0.29],
  mars: [1.36, 0.82],
  jupiter: [0.86, 0.35],
  saturn: [1.07, 0.51],
  neptune: [0.39, -0.33],
};

const SUN_BV = 0.653;
const SUN_VRC = 0.352;

describe('texture colour calibration manifest', () => {
  it('covers exactly the bodies with a shipped map AND a published index', () => {
    // Uranus ships no map; Pluto has no index row (New Horizons colour
    // trusted as-is); earth-night is emissive, not reflectance.
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(INDICES).sort());
  });

  it('each body pins the adopted Mallama 2017 indices', () => {
    for (const [body, [bv, vrc]] of Object.entries(INDICES)) {
      expect(manifest[body].bv, body).toBe(bv);
      expect(manifest[body].vrc, body).toBe(vrc);
    }
  });

  it('targets are the solar-relative flux ratios of the indices', () => {
    for (const [body, row] of Object.entries(manifest)) {
      const expectedR = 10 ** (0.4 * (row.vrc - SUN_VRC));
      const expectedB = 10 ** (-0.4 * (row.bv - SUN_BV));
      expect(row.target[0], body).toBeCloseTo(expectedR, 3);
      expect(row.target[1], body).toBe(1);
      expect(row.target[2], body).toBeCloseTo(expectedB, 3);
    }
  });

  it('achieved mean chromaticity lands on target (within LUT/clip tolerance)', () => {
    // The gain algebra is exact; residuals come from 8-bit LUT
    // rounding and highlight clipping — Earth's blue gain clips on
    // its bright cloud/ice fields, the largest case at ~0.021.
    for (const [body, row] of Object.entries(manifest)) {
      for (const c of [0, 1, 2]) {
        expect(
          Math.abs(row.achieved[c] - row.target[c]),
          `${body} channel ${c}`,
        ).toBeLessThan(0.03);
      }
    }
  });

  it('documents the corrections it exists to make', () => {
    // The Viking Mars mosaic's blue boost is strongly dimmed…
    expect(manifest.mars.gains[2]).toBeLessThan(0.7);
    // …and the 1989 Voyager-era Neptune azure pales toward the
    // measured (Irwin-consistent) tone.
    expect(manifest.neptune.meanBefore[2]).toBeGreaterThan(1.5);
    expect(manifest.neptune.achieved[2]).toBeLessThan(1.35);
  });
});
