// Heliocentric ecliptic positions vs the frozen Horizons state vectors in
// data/horizons/planet-vector-truth.tsv. Epochs are JD TDB fed straight to
// the element evaluation, so no clock or frame rotation enters.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCSEC_TO_RAD, AU_KM } from '../../util/astronomy-constants';
import {
  ELEMENTS,
  J2000_JD,
  PLANET_ORDER,
  planetEclipticAU,
  type PlanetName,
  type Vec3,
} from './ephemeris';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../../data/horizons/planet-vector-truth.tsv');

interface TruthRow {
  body: PlanetName;
  jdTdb: number;
  au: Vec3;
}

function loadTruth(): TruthRow[] {
  return readFileSync(TRUTH_TSV, 'utf-8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [body, jd, x, y, z] = line.split('\t');
      return {
        body: body as PlanetName,
        jdTdb: Number(jd),
        au: { x: Number(x), y: Number(y), z: Number(z) },
      };
    });
}

/** Standish's published nominal errors for the 3000 BC – 3000 AD elements
 *  (approx_pos.html § Accuracy): heliocentric longitude λ and latitude φ in
 *  arcsec, distance ρ in 1000 km. Combined at the body's semi-major axis
 *  these give a position budget in AU. */
const PUBLISHED_ERROR: Record<string, readonly [number, number, number]> = {
  mercury: [20, 15, 1],
  venus: [40, 30, 8],
  earth: [40, 15, 15],
  mars: [100, 40, 30],
  jupiter: [600, 100, 1000],
  saturn: [1000, 100, 4000],
  uranus: [2000, 30, 8000],
  neptune: [400, 15, 4000],
};

/** Pluto is absent from the accuracy table — JPL dropped its row with the
 *  IAU reclassification. Measured max |Δr| against DE441 over the whole
 *  clamp (100 d step) with the Table 2a row the ephemeris carries. */
const PLUTO_BUDGET_AU = 0.13;

/** The published figures are nominal, not worst-case; measured |Δr| at
 *  these epochs runs to ~1.3× them. */
const NOMINAL_SLACK = 2;

function budgetAu(body: PlanetName): number {
  if (body === 'pluto') return PLUTO_BUDGET_AU;
  const [lamAsec, phiAsec, rhoKkm] = PUBLISHED_ERROR[body];
  const a = ELEMENTS[PLANET_ORDER.indexOf(body)].a;
  const lam = a * lamAsec * ARCSEC_TO_RAD;
  const phi = a * phiAsec * ARCSEC_TO_RAD;
  const rho = (rhoKkm * 1000) / AU_KM;
  return NOMINAL_SLACK * Math.hypot(lam, phi, rho);
}

function standishErrorAu(row: TruthRow): number {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  planetEclipticAU(ELEMENTS[PLANET_ORDER.indexOf(row.body)], (row.jdTdb - J2000_JD) / 36525, out);
  return Math.hypot(out.x - row.au.x, out.y - row.au.y, out.z - row.au.z);
}

describe('deep-time vectors vs JPL Horizons (DE441)', () => {
  const rows = loadTruth();

  it('fixture covers 9 bodies × 2 deep epochs outside 1900–2100', () => {
    expect(rows.length).toBe(18);
    expect(new Set(rows.map((r) => r.body)).size).toBe(9);
    expect(new Set(rows.map((r) => r.jdTdb))).toEqual(new Set([807920, 2780270]));
  });

  for (const row of rows) {
    const budget = budgetAu(row.body);
    it(`${row.body} @ JD ${row.jdTdb} within ${budget.toExponential(1)} AU`, () => {
      expect(standishErrorAu(row)).toBeLessThan(budget);
    });
  }
});
