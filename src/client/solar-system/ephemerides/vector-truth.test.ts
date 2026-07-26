// Heliocentric ecliptic positions vs the frozen Horizons state vectors in
// data/horizons/planet-vector-truth.tsv, both sources and the seam between
// them. See README.md § Planet ephemeris.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ELEMENT_TARGETS,
  TABLE_JD_END,
  TABLE_JD_START,
} from '../../../../scripts/ephemerides/planet-element-roster';
import type { PlanetElementTableFile } from '../../../../scripts/ephemerides/planet-element-schema';
import { ARCSEC_TO_RAD, AU_KM, AU_PER_PC, DAYS_PER_JULIAN_YEAR } from '../../util/astronomy-constants';
import { jdTdbToT } from '../time/time';
import { buildElementTable, type PlanetElementTable } from './element-table';
import {
  ELEMENTS,
  J2000_JD,
  PLANET_ORDER,
  resetPositionCache,
  getPlanetPositions,
  installPlanetElementTables,
  planetEclipticAU,
  type PlanetName,
  type Vec3,
} from './ephemeris';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUTH_TSV = resolve(__dirname, '../../../../data/horizons/planet-vector-truth.tsv');
const TABLE_DIR = resolve(__dirname, '../../../../data/ephemerides');

const DEEP_EPOCHS = [807920, 2780270];

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

const tables = new Map<PlanetName, PlanetElementTable>();

beforeAll(() => {
  for (const target of ELEMENT_TARGETS) {
    const file = JSON.parse(
      readFileSync(resolve(TABLE_DIR, `${target.id}.json`), 'utf-8'),
    ) as PlanetElementTableFile;
    tables.set(target.id, buildElementTable(file));
  }
  installPlanetElementTables(tables);
});

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

function standishBudgetAu(body: PlanetName): number {
  if (body === 'pluto') return PLUTO_BUDGET_AU;
  const [lamAsec, phiAsec, rhoKkm] = PUBLISHED_ERROR[body];
  const a = ELEMENTS[PLANET_ORDER.indexOf(body)].a;
  const lam = a * lamAsec * ARCSEC_TO_RAD;
  const phi = a * phiAsec * ARCSEC_TO_RAD;
  const rho = (rhoKkm * 1000) / AU_KM;
  return NOMINAL_SLACK * Math.hypot(lam, phi, rho);
}

/** Standish alone at a TDB epoch, no element table and no seam. */
function standishAu(body: PlanetName, jdTdb: number): Vec3 {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  planetEclipticAU(
    ELEMENTS[PLANET_ORDER.indexOf(body)],
    (jdTdb - J2000_JD) / 36525,
    out,
  );
  return out;
}

/** The production chain at a TDB epoch, back in AU. */
function productionAu(body: PlanetName, jdTdb: number): Vec3 {
  resetPositionCache();
  const pc = getPlanetPositions(jdTdbToT(jdTdb))[body];
  return { x: pc.x * AU_PER_PC, y: pc.y * AU_PER_PC, z: pc.z * AU_PER_PC };
}

const distAu = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('vector truth corpus', () => {
  const rows = loadTruth();

  it('covers 9 bodies at 2 epochs outside the element tables and 5 inside', () => {
    expect(new Set(rows.map((r) => r.body)).size).toBe(9);
    const epochs = [...new Set(rows.map((r) => r.jdTdb))].sort((a, b) => a - b);
    expect(epochs.filter((jd) => jd < TABLE_JD_START || jd > TABLE_JD_END)).toEqual(DEEP_EPOCHS);
    expect(epochs).toHaveLength(7);
    expect(rows).toHaveLength(63);
  });

  it('the in-window epochs sit at interval midpoints of both shipped cadences', () => {
    // The worst case for the interpolation, and epochs no table was fitted to.
    const inWindow = [...new Set(rows.map((r) => r.jdTdb))]
      .filter((jd) => jd > TABLE_JD_START && jd < TABLE_JD_END);
    for (const jd of inWindow) {
      for (const step of new Set(ELEMENT_TARGETS.map((t) => t.stepDays))) {
        expect((jd - TABLE_JD_START) % step).toBe(step / 2);
      }
    }
  });
});

describe('element tables vs JPL Horizons (DE441), inside 1900–2100', () => {
  const rows = loadTruth().filter((r) => !DEEP_EPOCHS.includes(r.jdTdb));

  for (const row of rows) {
    it(`${row.body} @ JD ${row.jdTdb} holds its file's tolerance`, () => {
      const budget = tables.get(row.body)!.positionToleranceAu;
      expect(distAu(productionAu(row.body, row.jdTdb), row.au)).toBeLessThan(budget);
    });
  }

  it('beats the Standish series everywhere, by 3–4 orders at Jupiter and beyond', () => {
    // Mercury is the shallow end at ~3×: Standish is already within 2e-5 AU
    // there, because a 20″ longitude error at 0.39 AU is a small distance.
    // What the tables are for is Saturn outward, where the same series is off
    // by 0.05 AU and the camera can stand inside that.
    const OUTER: PlanetName[] = ['jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    for (const row of rows) {
      const gain = distAu(standishAu(row.body, row.jdTdb), row.au)
        / distAu(productionAu(row.body, row.jdTdb), row.au);
      expect(gain).toBeGreaterThan(OUTER.includes(row.body) ? 400 : 3);
    }
  });
});

describe('Standish fallback outside the element tables', () => {
  const rows = loadTruth().filter((r) => DEEP_EPOCHS.includes(r.jdTdb));

  for (const row of rows) {
    const budget = standishBudgetAu(row.body);
    it(`${row.body} @ JD ${row.jdTdb} within ${budget.toExponential(1)} AU`, () => {
      expect(distAu(standishAu(row.body, row.jdTdb), row.au)).toBeLessThan(budget);
    });
  }

  it('the tables do not leak past their span — deep time is Standish', () => {
    for (const row of rows) {
      // Only the AU → parsec → AU round trip separates the two paths here.
      expect(distAu(productionAu(row.body, row.jdTdb), standishAu(row.body, row.jdTdb)))
        .toBeLessThan(1e-12);
    }
  });
});

describe('the seam at each end of the element tables', () => {
  // Saturn and Uranus are where the two models disagree most, so they are the
  // bodies a missing blend would visibly pop.
  const SEAM_BODIES: PlanetName[] = ['saturn', 'uranus'];
  const HALF_SECOND_D = 0.5 / 86400;

  it('the two models really do disagree by tens of thousands of km here', () => {
    for (const body of SEAM_BODIES) {
      const jd = TABLE_JD_START + DAYS_PER_JULIAN_YEAR;
      expect(distAu(standishAu(body, jd), productionAu(body, jd))).toBeGreaterThan(0.01);
    }
  });

  it('crossing either edge produces no step', () => {
    for (const body of SEAM_BODIES) {
      for (const edge of [TABLE_JD_START, TABLE_JD_END]) {
        const step = distAu(
          productionAu(body, edge - HALF_SECOND_D),
          productionAu(body, edge + HALF_SECOND_D),
        );
        // A second of Saturn's own motion is ~6e-8 AU; the un-blended step
        // would be the models' whole 0.03 AU disagreement.
        expect(step).toBeLessThan(1e-6);
      }
    }
  });

  it('the blend runs monotonically from one model to the other', () => {
    for (const body of SEAM_BODIES) {
      let previous = -Infinity;
      for (let f = 0; f <= 1.0001; f += 0.1) {
        const jd = TABLE_JD_START + f * DAYS_PER_JULIAN_YEAR;
        const towardTable = distAu(productionAu(body, jd), standishAu(body, jd));
        expect(towardTable).toBeGreaterThanOrEqual(previous);
        previous = towardTable;
      }
    }
  });

  it('past the seam the table is fully in, at its own tolerance', () => {
    const rows = loadTruth().filter((r) => !DEEP_EPOCHS.includes(r.jdTdb));
    for (const row of rows) {
      const intoWindow = Math.min(row.jdTdb - TABLE_JD_START, TABLE_JD_END - row.jdTdb);
      expect(intoWindow).toBeGreaterThan(DAYS_PER_JULIAN_YEAR);
    }
  });
});
