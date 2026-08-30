// Named solar and lunar eclipses from NASA's Five Millennium Canon,
// reproduced end-to-end by the model. See README.md.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findGreatestLunarEclipse,
  findGreatestSolarEclipse,
  lunarEclipseAt,
  solarEclipseAt,
} from './eclipse-circumstances';
import {
  installPlanetElementTables,
  type PlanetName,
} from '../../ephemerides/ephemeris';
import { buildElementTable, type PlanetElementTable } from '../../ephemerides/element-table';
import { ELEMENT_TARGETS } from '../../../../../scripts/ephemerides/planet-element-roster';
import type { PlanetElementTableFile } from '../../../../../scripts/ephemerides/planet-element-schema';
import { jdTdbToT } from '../../time/time';
import { deltaTSeconds } from '../../time/delta-t-pure';
import { J2000_JD } from '../../../util/astronomy-constants';
import { wrapDegrees } from '../../../util/angles';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANON_DIR = resolve(__dirname, '../../../../../data/eclipse-canon');
const TABLE_DIR = resolve(__dirname, '../../../../../data/ephemerides');

function loadCanon(file: string): Record<string, string>[] {
  const lines = readFileSync(resolve(CANON_DIR, file), 'utf-8').trim().split('\n');
  const head = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

const SOLAR = loadCanon('solar-eclipse-canon.tsv');
const LUNAR = loadCanon('lunar-eclipse-canon.tsv');

const KM_PER_DEG = 111.32;
const MODERN_JD_HALF_SPAN = 36525; // 1900–2100, the element tables' window.

/** Great-circle-ish offset (km) between a model ground point and the
 *  canon's, which is tabulated to whole degrees — so ~55 km of any
 *  residual here is the catalogue's own rounding, not the model. */
function groundOffsetKm(
  model: { latDeg: number; lonEastDeg: number },
  latDeg: number,
  lonEastDeg: number,
): number {
  const dLat = model.latDeg - latDeg;
  const dLon = wrapDegrees(model.lonEastDeg - lonEastDeg) * Math.cos((latDeg * Math.PI) / 180);
  return Math.hypot(dLat, dLon) * KM_PER_DEG;
}

beforeAll(() => {
  // The app installs these at runtime, so the test measures the shipped
  // configuration. Outside 1900–2100 the ephemeris falls back to Standish
  // on its own, exactly as it does for a user scrubbing to 1200 BC.
  const tables = new Map<PlanetName, PlanetElementTable>();
  for (const target of ELEMENT_TARGETS) {
    const file = JSON.parse(
      readFileSync(resolve(TABLE_DIR, `${target.id}.json`), 'utf-8'),
    ) as PlanetElementTableFile;
    tables.set(target.id, buildElementTable(file));
  }
  installPlanetElementTables(tables);
});

interface SolarResult {
  row: Record<string, string>;
  jdTt: number;
  offsetS: number;
  offsetKm: number;
  magnitude: number;
  shadowFactor: number;
  gamma: number;
}

const solarResults: SolarResult[] = [];

beforeAll(() => {
  for (const row of SOLAR) {
    const jdTt = Number(row.jd_tt);
    const tCanon = jdTdbToT(jdTt);
    const tModel = findGreatestSolarEclipse(tCanon);
    const e = solarEclipseAt(tModel);
    solarResults.push({
      row,
      jdTt,
      offsetS: tModel - tCanon,
      offsetKm: e.ground
        ? groundOffsetKm(e.ground, Number(row.lat_deg), Number(row.lon_east_deg))
        : Infinity,
      magnitude: e.magnitude,
      shadowFactor: e.shadowFactor,
      gamma: e.axisMissEarthRadii,
    });
  }
});

describe('the canon corpus', () => {
  it('spans four millennia and both eclipse kinds', () => {
    expect(SOLAR.length).toBe(23);
    expect(LUNAR.length).toBe(12);
    const jds = SOLAR.map((r) => Number(r.jd_tt));
    expect(Math.min(...jds)).toBeLessThan(J2000_JD - 39 * 36525);
    expect(Math.max(...jds)).toBeGreaterThan(J2000_JD + 9 * 36525);
  });

  it('carries central eclipses, where the umbra reaching Earth is a real claim', () => {
    // |γ| < 1 means the axis passes inside Earth at all. A corpus of
    // grazing events would pass the assertions below without saying
    // anything about the shadow landing where it should.
    for (const row of SOLAR) {
      expect(Math.abs(Number(row.gamma)), row.date).toBeLessThan(0.95);
    }
  });
});

describe('solar eclipses vs the Five Millennium Canon', () => {
  it('puts the Moon\'s shadow axis on Earth at every canon epoch', () => {
    for (const r of solarResults) {
      expect(r.gamma, r.row.date).toBeLessThan(1);
      expect(r.offsetKm, r.row.date).toBeLessThan(Infinity);
    }
  });

  it('reaches a full umbra for every total eclipse and never for an annular one', () => {
    // The physical discriminator is the ratio of apparent diameters, not
    // the renderer's soft-edged shadow factor.
    for (const r of solarResults) {
      const type = r.row.type[0];
      if (type === 'T') expect(r.magnitude, r.row.date).toBeGreaterThan(1);
      if (type === 'A') expect(r.magnitude, r.row.date).toBeLessThan(1);
      if (type === 'H') {
        // A hybrid is total at greatest eclipse and annular towards the
        // ends of its path, so it sits just the total side of unity —
        // the canon's own magnitudes here are 1.0024 and 1.0174.
        expect(r.magnitude, r.row.date).toBeGreaterThan(1);
        expect(r.magnitude, r.row.date).toBeLessThan(1.05);
      }
    }
  });

  it('draws a full umbra on the surface for every total eclipse', () => {
    // The bead's actual symptom: the renderer's own shadow math must
    // bottom out at zero on Earth's surface, not merely graze a penumbra.
    for (const r of solarResults) {
      if (r.row.type[0] !== 'T') continue;
      expect(r.shadowFactor, r.row.date).toBe(0);
    }
  });

  it('matches the canon eclipse magnitude to 0.01', () => {
    for (const r of solarResults) {
      expect(Math.abs(r.magnitude - Number(r.row.magnitude)), r.row.date)
        .toBeLessThan(0.01);
    }
  });

  it('matches γ to 0.01 Earth radii', () => {
    for (const r of solarResults) {
      expect(Math.abs(r.gamma - Math.abs(Number(r.row.gamma))), r.row.date)
        .toBeLessThan(0.01);
    }
  });

  it('lands greatest eclipse within 10 s across 1900–2100', () => {
    const modern = solarResults.filter((r) => Math.abs(r.jdTt - J2000_JD) < MODERN_JD_HALF_SPAN);
    expect(modern.length).toBe(9);
    for (const r of modern) {
      expect(Math.abs(r.offsetS), r.row.date).toBeLessThan(10);
    }
  });

  it('lands greatest eclipse within 70 s from 600 BC to 2100 AD', () => {
    for (const r of solarResults) {
      if (r.jdTt < J2000_JD - 26 * 36525 || r.jdTt > J2000_JD + 36525) continue;
      expect(Math.abs(r.offsetS), r.row.date).toBeLessThan(70);
    }
  });

  it('lands greatest eclipse within 7 minutes over the whole corpus', () => {
    // At the 2000 BC end the residual is the canon's distance from DE441
    // (README.md § Where the remaining error is), far inside the ±hours
    // ΔT uncertainty on the real event.
    for (const r of solarResults) {
      expect(Math.abs(r.offsetS), r.row.date).toBeLessThan(420);
    }
  });

  it('puts greatest eclipse on the right part of the globe', () => {
    // The deep-time worst case (198 km, -1977) is the canon-agreement
    // floor, not the model's accuracy: at that epoch the chain sits
    // within 6″ of DE441 in Moon−Sun elongation while the canon's
    // ELP2000-85 Moon drifts ~160″ from DE441 by 2000 BC. See README.md
    // § Where the remaining error is.
    for (const r of solarResults) {
      expect(r.offsetKm, r.row.date).toBeLessThan(200);
    }
  });

  it('puts modern greatest eclipse within 70 km, most of which is canon rounding', () => {
    for (const r of solarResults) {
      if (Math.abs(r.jdTt - J2000_JD) > MODERN_JD_HALF_SPAN) continue;
      expect(r.offsetKm, r.row.date).toBeLessThan(70);
    }
  });
});

describe('named solar eclipses', () => {
  const named = (date: string): SolarResult => {
    const r = solarResults.find((x) => x.row.date === date);
    if (!r) throw new Error(`corpus is missing ${date}`);
    return r;
  };

  it('2017 Aug 21 — totality over southern Illinois', () => {
    const r = named('2017 Aug 21');
    expect(r.row.type[0]).toBe('T');
    expect(Math.abs(r.offsetS)).toBeLessThan(10);
    expect(r.offsetKm).toBeLessThan(70);
  });

  it('2024 Apr 08 — totality over Mexico and the US', () => {
    const r = named('2024 Apr 08');
    expect(r.magnitude).toBeGreaterThan(1);
    expect(Math.abs(r.offsetS)).toBeLessThan(10);
  });

  it('2026 Aug 12 — the total eclipse this bug was reported against', () => {
    // The original report: shadow factor 1.000 over Earth's whole sunlit
    // hemisphere at this epoch, because the fixed J2000 node put the Moon
    // 2° from the Sun. The canon puts greatest eclipse off Iceland.
    const r = named('2026 Aug 12');
    expect(r.shadowFactor).toBe(0);
    expect(r.magnitude).toBeGreaterThan(1);
    expect(Number(r.row.lat_deg)).toBeGreaterThan(60);
    expect(r.offsetKm).toBeLessThan(70);
  });

  it('1919 May 29 — Eddington\'s eclipse', () => {
    const r = named('1919 May 29');
    expect(r.shadowFactor).toBe(0);
    expect(Math.abs(r.offsetS)).toBeLessThan(10);
  });

  it('-0584 May 28 — the eclipse of Thales, 2600 years back', () => {
    const r = named('-0584 May 28');
    expect(r.shadowFactor).toBe(0);
    expect(Math.abs(r.offsetS)).toBeLessThan(70);
    expect(r.offsetKm).toBeLessThan(120);
  });
});

describe('lunar eclipses vs the Five Millennium Canon', () => {
  interface LunarResult {
    row: Record<string, string>;
    offsetS: number;
    umbralMagnitude: number;
  }
  const results: LunarResult[] = [];

  beforeAll(() => {
    for (const row of LUNAR) {
      const tCanon = jdTdbToT(Number(row.jd_tt));
      const tModel = findGreatestLunarEclipse(tCanon);
      results.push({
        row,
        offsetS: tModel - tCanon,
        umbralMagnitude: lunarEclipseAt(tModel).umbralMagnitude,
      });
    }
  });

  it('puts the Moon fully inside Earth\'s umbra at every canon total eclipse', () => {
    for (const r of results) {
      expect(r.umbralMagnitude, r.row.date).toBeGreaterThan(1);
    }
  });

  it('matches the canon umbral magnitude to 0.04', () => {
    // The canons enlarge Earth's shadow ~2 % for the atmosphere, which
    // the model mirrors; what is left is the model's own geometry.
    for (const r of results) {
      expect(Math.abs(r.umbralMagnitude - Number(r.row.umbral_magnitude)), r.row.date)
        .toBeLessThan(0.04);
    }
  });

  it('lands greatest eclipse within 15 s across 1900–2100', () => {
    for (const r of results) {
      if (Math.abs(Number(r.row.jd_tt) - J2000_JD) > MODERN_JD_HALF_SPAN) continue;
      expect(Math.abs(r.offsetS), r.row.date).toBeLessThan(15);
    }
  });

  it('lands greatest eclipse within 7 minutes over the whole corpus', () => {
    for (const r of results) {
      expect(Math.abs(r.offsetS), r.row.date).toBeLessThan(420);
    }
  });
});

describe('ΔT against the canon\'s own column', () => {
  it('agrees within 2 s at every canon epoch, from 2000 BC on', () => {
    // Espenak tabulates the ΔT he used per eclipse. Reproducing it is a
    // direct check on delta-t-pure.ts against the same authority the
    // ground tracks are being checked against. The bound is absolute:
    // a relative one cannot tell "reproduces Espenak" from "reproduces
    // Espenak minus a systematic 200 s". What is left (≤1.2 s measured)
    // is the canon column's integer rounding plus the calendar-year vs
    // Julian-year argument.
    for (const row of [...SOLAR, ...LUNAR]) {
      const canon = Number(row.delta_t_s);
      const model = deltaTSeconds(Number(row.jd_tt));
      expect(Math.abs(model - canon), row.date).toBeLessThan(2);
    }
  });
});
