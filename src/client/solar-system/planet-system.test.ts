import { describe, it, expect } from 'vitest';
import { makeEmptyCatalog } from '../loaders/catalog-mock';
import type { Catalog } from '../loaders/catalog-loader';
import {
  SOL_BODIES,
  SOL_MOONS,
  SOL_PLANETS,
  getPlanetSystem,
  hasPlanets,
  systemFamily,
  type Planet,
  type PlanetType,
} from './planet-system';
import { getPlanetPositions, PLANET_ORDER } from './ephemeris';
import { AU_KM, KM_PC } from '../util/astronomy-constants';
import {
  EARTH_PHASE,
  JUPITER_PHASE,
  MARS_PHASE,
  MERCURY_PHASE,
  SATURN_PHASE,
  VENUS_PHASE,
} from './phase-function';

function stubCatalog(solIndex: number, count = Math.max(solIndex + 1, 1)): Catalog {
  const cat = makeEmptyCatalog(count);
  cat.solIndex = solIndex;
  return cat;
}

describe('hasPlanets', () => {
  it('returns true for Sol only', () => {
    const cat = stubCatalog(7);
    expect(hasPlanets(cat, 7)).toBe(true);
    expect(hasPlanets(cat, 0)).toBe(false);
    expect(hasPlanets(cat, 42)).toBe(false);
  });

  it('returns false for null / negative / unfocused', () => {
    const cat = stubCatalog(7);
    expect(hasPlanets(cat, null)).toBe(false);
    expect(hasPlanets(cat, -1)).toBe(false);
  });

  it('returns false when the catalog has no Sol', () => {
    const cat = stubCatalog(-1);
    expect(hasPlanets(cat, -1)).toBe(false);
    expect(hasPlanets(cat, 0)).toBe(false);
  });
});

describe('getPlanetSystem', () => {
  it('resolves with Sol bodies (planets + moons) for the Sol index', async () => {
    const cat = stubCatalog(3);
    const ps = await getPlanetSystem(cat, 3);
    expect(ps).not.toBeNull();
    expect(ps!.hostStarIdx).toBe(3);
    expect(ps!.planets).toBe(SOL_BODIES);
    expect(ps!.planets.length).toBe(SOL_PLANETS.length + SOL_MOONS.length);
  });

  it('resolves to null for any other star', async () => {
    const cat = stubCatalog(3);
    expect(await getPlanetSystem(cat, 0)).toBeNull();
    expect(await getPlanetSystem(cat, 99)).toBeNull();
    expect(await getPlanetSystem(cat, null)).toBeNull();
    expect(await getPlanetSystem(cat, -1)).toBeNull();
  });
});

describe('solPositionsAt moon composition', () => {
  // A fixed epoch inside the Standish window; the concrete instant is
  // irrelevant — the assertions are frame-invariant distance bounds.
  const T_UNIX = 1_700_000_000;
  const planetCount = PLANET_ORDER.length;

  async function positions(): Promise<Float32Array> {
    const cat = stubCatalog(3);
    const ps = await getPlanetSystem(cat, 3);
    const out = new Float32Array(ps!.planets.length * 3);
    ps!.positionsAt!(T_UNIX, out);
    return out;
  }

  const bodyIdx = (name: string) => SOL_BODIES.findIndex((b) => b.name === name);
  const distPc = (out: Float32Array, a: number, b: number) =>
    Math.hypot(
      out[a * 3] - out[b * 3],
      out[a * 3 + 1] - out[b * 3 + 1],
      out[a * 3 + 2] - out[b * 3 + 2],
    );

  it('writes a position for every planet and moon', async () => {
    const out = await positions();
    expect(out.length).toBe((planetCount + SOL_MOONS.length) * 3);
  });

  it('places each moon within its eccentric orbit radius of its parent', async () => {
    const out = await positions();
    for (const moon of SOL_MOONS) {
      const aKm = moon.semiMajorAxisAu * AU_KM;
      const d = distPc(out, bodyIdx(moon.name), bodyIdx(moon.parentName!)) / KM_PC;
      const e = moon.eccentricity;
      // Distance from the parent stays within the apo/peri bounds a(1±e),
      // with a small slack for the reference-plane rotation round-trip.
      expect(d).toBeGreaterThan(aKm * (1 - e) * 0.98);
      expect(d).toBeLessThan(aKm * (1 + e) * 1.02);
    }
  });

  it('splits the Earth–Moon barycentre — Earth ~4700 km off it, Moon opposite', async () => {
    const out = await positions();
    const earthI = bodyIdx('Earth');
    const moonI = bodyIdx('Moon');
    const bary = getPlanetPositions(T_UNIX).earth;
    const earthOffKm = Math.hypot(
      out[earthI * 3] - bary.x,
      out[earthI * 3 + 1] - bary.y,
      out[earthI * 3 + 2] - bary.z,
    ) / KM_PC;
    // Earth's centre lies m_moon/(m_earth+m_moon) ≈ 1.2% of the ~384,400 km
    // geocentric Moon vector back from the barycentre.
    expect(earthOffKm).toBeGreaterThan(4000);
    expect(earthOffKm).toBeLessThan(5500);
    // Earth and Moon straddle the barycentre — geocentric separation ~Moon a.
    expect(distPc(out, earthI, moonI) / KM_PC).toBeGreaterThan(350000);
  });
});

describe('SOL_PLANETS data', () => {
  const expectedNames = [
    'Mercury', 'Venus', 'Earth', 'Mars',
    'Jupiter', 'Saturn', 'Uranus', 'Neptune',
    'Pluto',
  ];

  it('lists all nine bodies in heliocentric order (eight planets + Pluto)', () => {
    expect(SOL_PLANETS.map(p => p.name)).toEqual(expectedNames);
  });

  it('semi-major axes are strictly increasing (sanity check on order)', () => {
    for (let i = 1; i < SOL_PLANETS.length; i++) {
      expect(SOL_PLANETS[i].semiMajorAxisAu)
        .toBeGreaterThan(SOL_PLANETS[i - 1].semiMajorAxisAu);
    }
  });

  it('every body has a positive radius and orbit', () => {
    for (const p of SOL_PLANETS) {
      expect(p.radiusKm).toBeGreaterThan(0);
      expect(p.semiMajorAxisAu).toBeGreaterThan(0);
    }
  });

  it('eccentricities are in [0, 1); Pluto is most eccentric, Mercury second', () => {
    const sorted = [...SOL_PLANETS].sort((a, b) => b.eccentricity - a.eccentricity);
    for (const p of SOL_PLANETS) {
      expect(p.eccentricity).toBeGreaterThanOrEqual(0);
      expect(p.eccentricity).toBeLessThan(1);
    }
    expect(sorted[0].name).toBe('Pluto');
    expect(sorted[1].name).toBe('Mercury');
  });

  it('classifies inner four as rocky, two gas giants, two ice giants, Pluto rocky', () => {
    const types = SOL_PLANETS.map(p => p.type);
    expect(types.slice(0, 4)).toEqual(['rocky', 'rocky', 'rocky', 'rocky']);
    expect(types[4]).toBe('gas_giant');
    expect(types[5]).toBe('gas_giant');
    expect(types[6]).toBe('ice_giant');
    expect(types[7]).toBe('ice_giant');
    expect(types[8]).toBe('rocky');
  });

  it('colour channels are normalised RGB triples in [0,1]', () => {
    for (const p of SOL_PLANETS) {
      expect(p.colour).toHaveLength(3);
      for (const c of p.colour) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every body has a published geometric albedo in (0, 1)', () => {
    // Mallama 2018 + NASA fact-sheet values; pinned here so an
    // accidental edit doesn't silently drift the apparent-magnitude
    // calculation.
    const expected: Record<string, number> = {
      Mercury: 0.142, Venus: 0.689, Earth: 0.434, Mars: 0.170,
      Jupiter: 0.538, Saturn: 0.499, Uranus: 0.488, Neptune: 0.442,
      Pluto: 0.49,
    };
    for (const p of SOL_PLANETS) {
      expect(p.albedo).toBeGreaterThan(0);
      expect(p.albedo).toBeLessThan(1);
      expect(p.albedo).toBeCloseTo(expected[p.name], 3);
    }
  });

  it('every Mallama-published planet carries the matching phase coefficients', () => {
    // Mallama 2018 publishes phase-angle polynomials for Mercury,
    // Venus, Earth, Mars, Jupiter and Saturn. Uranus, Neptune and
    // Pluto have no published phase polynomial — Uranus and Neptune
    // because their max α from Earth is "negligible" so the paper
    // models latitude/temporal effects instead, Pluto because the
    // paper doesn't cover it. All three fall back to Lambertian.
    const expected: Record<string, unknown> = {
      Mercury: MERCURY_PHASE,
      Venus: VENUS_PHASE,
      Earth: EARTH_PHASE,
      Mars: MARS_PHASE,
      Jupiter: JUPITER_PHASE,
      Saturn: SATURN_PHASE,
    };
    const lambertianFallback = new Set(['Uranus', 'Neptune', 'Pluto']);
    for (const p of SOL_PLANETS) {
      if (lambertianFallback.has(p.name)) {
        expect(p.phaseCoefficients).toBeUndefined();
      } else {
        expect(p.phaseCoefficients).toBe(expected[p.name]);
      }
    }
  });

  it('radii match published equatorial / mean values (within 1 km)', () => {
    const expected: Record<string, number> = {
      Mercury: 2440, Venus: 6052, Earth: 6371, Mars: 3390,
      Jupiter: 69911, Saturn: 58232, Uranus: 25362, Neptune: 24622,
      Pluto: 1188,
    };
    for (const p of SOL_PLANETS) {
      expect(p.radiusKm).toBeCloseTo(expected[p.name], 0);
    }
  });
});

describe('Planet / PlanetType type surface', () => {
  it('PlanetType is one of the three documented categories', () => {
    const valid: PlanetType[] = ['rocky', 'gas_giant', 'ice_giant'];
    for (const p of SOL_PLANETS) {
      expect(valid).toContain(p.type as PlanetType);
    }
    // Compile-time assertion — if this stops type-checking, the enum widened.
    const t: Planet = SOL_PLANETS[0];
    expect(t.name).toBeTruthy();
  });
});

describe('terminatorSoftness seeds', () => {
  const byName = new Map(SOL_BODIES.map((p) => [p.name, p]));
  const w = (name: string) => byName.get(name)!.terminatorSoftness ?? 0;

  it('airless bodies keep the hard cut (0 / undefined)', () => {
    for (const name of ['Mercury', 'Pluto', 'Moon', 'Io', 'Europa', 'Triton']) {
      expect(w(name)).toBe(0);
    }
  });

  it('Venus carries the widest band; Earth and Titan share the next tier', () => {
    expect(w('Venus')).toBe(0.08);
    expect(w('Earth')).toBe(0.05);
    expect(w('Titan')).toBe(0.05);
    for (const name of ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
      expect(w(name)).toBeGreaterThan(0);
      expect(w(name)).toBeLessThan(w('Earth'));
    }
  });
});

describe('systemFamily', () => {
  it('maps every SOL body to its parent and children consistently', () => {
    const family = systemFamily(SOL_BODIES);
    expect(family.parentIdx.length).toBe(SOL_BODIES.length);
    for (let i = 0; i < SOL_BODIES.length; i++) {
      const body = SOL_BODIES[i];
      if (body.parentName) {
        expect(SOL_BODIES[family.parentIdx[i]].name).toBe(body.parentName);
        expect(family.childIdxs[i]).toEqual([]);
      } else {
        expect(family.parentIdx[i]).toBe(-1);
        for (const c of family.childIdxs[i]) {
          expect(SOL_BODIES[c].parentName).toBe(body.name);
        }
      }
    }
    const jupiter = SOL_BODIES.findIndex((p) => p.name === 'Jupiter');
    const saturn = SOL_BODIES.findIndex((p) => p.name === 'Saturn');
    expect(family.childIdxs[jupiter].length).toBe(4);
    expect(family.childIdxs[saturn].length).toBe(7);
  });

  it('memoises on the array identity', () => {
    expect(systemFamily(SOL_BODIES)).toBe(systemFamily(SOL_BODIES));
  });
});

describe('atmosphere shells', () => {
  it('exactly Venus, Earth, Mars, and Titan carry an atmosphere', () => {
    const withAtmo = SOL_BODIES.filter((b) => b.atmosphere).map((b) => b.name);
    expect(withAtmo).toEqual(['Venus', 'Earth', 'Mars', 'Titan']);
  });

  it('shell heights are the true scattering extents, km', () => {
    const heights = Object.fromEntries(
      SOL_BODIES.filter((b) => b.atmosphere).map((b) => [b.name, b.atmosphere!.heightKm]),
    );
    expect(heights).toEqual({ Venus: 90, Earth: 100, Mars: 60, Titan: 300 });
  });

  it('Titan carries the proportionally largest shell (~12% of R)', () => {
    const titan = SOL_BODIES.find((b) => b.name === 'Titan')!;
    expect(titan.atmosphere!.heightKm / titan.radiusKm).toBeCloseTo(0.117, 2);
  });

  it('Earth Rayleigh scatter is blue-heavy (1/λ⁴), zero aerosol absorption', () => {
    const earth = SOL_BODIES.find((b) => b.name === 'Earth')!.atmosphere!;
    expect(earth.rayleighCoeff[2]).toBeGreaterThan(earth.rayleighCoeff[0]);
    expect(earth.absorbCoeff).toEqual([0, 0, 0]);
  });

  it('Mars and Titan absorb blue most (butterscotch / orange, not blue)', () => {
    for (const name of ['Mars', 'Titan']) {
      const atmo = SOL_BODIES.find((b) => b.name === name)!.atmosphere!;
      expect(atmo.absorbCoeff[2]).toBeGreaterThan(atmo.absorbCoeff[0]);
    }
  });
});
