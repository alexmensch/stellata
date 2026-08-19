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
    // trusted as-is).
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

  it('achieved mean chromaticity lands on target (within LUT tolerance)', () => {
    // The gain algebra is exact and the gains never exceed 1, so nothing
    // clips and the only residual is 8-bit LUT rounding. The bound is
    // 0.003 rather than the old 0.03 BECAUSE of that normalisation: while
    // gains could amplify, Earth's 1.34x blue pinned its snow and ice at
    // 255 and landed 0.124 off target — forty times this tolerance, and
    // under the old bound it still passed.
    for (const [body, row] of Object.entries(manifest)) {
      for (const c of [0, 1, 2]) {
        expect(
          Math.abs(row.achieved[c] - row.target[c]),
          `${body} channel ${c}`,
        ).toBeLessThan(0.003);
      }
    }
  });

  it('never amplifies: no gain exceeds 1, and each body has one at 1', () => {
    // The normalisation that makes clipping structurally impossible. The
    // triple is scaled so its largest member is exactly 1, so a body is
    // only ever darkened — and only the ratios reach the screen, since the
    // renderer divides each map's own mean luminance back out.
    for (const [body, row] of Object.entries(manifest)) {
      expect(Math.max(...row.gains), body).toBeCloseTo(1, 4);
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

  it('pins the committed gains + achieved of the correction bodies', () => {
    // The loose "landed on target" / "documents the corrections" checks pass
    // for any recalibration under tolerance; these pin the actual committed
    // numbers, so a silent retune (or source-image swap) that leaves the
    // artifacts stale fails until they are rebuilt and recommitted.
    const pins: Record<string, { gains: [number, number, number]; achievedB: number }> = {
      mars: { gains: [0.9256, 1.0, 0.5417], achievedB: 0.5214 },
      neptune: { gains: [0.8043, 1.0, 0.6585], achievedB: 1.2742 },
      venus: { gains: [0.4411, 0.5713, 1.0], achievedB: 0.9577 },
    };
    for (const [body, { gains, achievedB }] of Object.entries(pins)) {
      for (const c of [0, 1, 2]) {
        expect(manifest[body].gains[c], `${body} gain ${c}`).toBeCloseTo(gains[c], 4);
      }
      expect(manifest[body].achieved[2], `${body} achieved B`).toBeCloseTo(achievedB, 4);
    }
  });
});
