import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOL_BODIES } from '../../src/client/solar-system/planet-system';

// Pin of the committed relief manifest (data/textures/relief.json, written by
// build-textures.py) and of the cross-language registration contract.
// dem_relief.py can't import the TS tables, so it carries its own map-centre
// and radius copies; either drifting ships a normal map whose slopes sit on
// the wrong features, and nothing about the render says so.

const TEXTURES = resolve(__dirname, '../../data/textures');

interface ReliefRow {
  medianTiltDeg: number;
  p90TiltDeg: number;
  width: number;
}

const manifest: Record<string, ReliefRow> = JSON.parse(
  readFileSync(resolve(TEXTURES, 'relief.json'), 'utf-8'),
);

const pySource = readFileSync(resolve(__dirname, 'dem_relief.py'), 'utf-8');

interface DemSpec {
  src: string;
  demCenterLon: number;
  mapCenterLon: number;
  radiusKm: number;
}

function pyDemBodies(): Record<string, DemSpec> {
  const table = pySource.match(/DEM_BODIES = \{\n([\s\S]*?)\n\}/);
  expect(table).not.toBeNull();
  const out: Record<string, DemSpec> = {};
  for (const [, name, block] of table![1].matchAll(
    /"([a-z]+)": \{\n([\s\S]*?)\n {4}\},/g,
  )) {
    const num = (key: string) => {
      const m = block.match(new RegExp(`"${key}": (-?[\\d.]+)`));
      expect(m, `${name}.${key}`).not.toBeNull();
      return Number(m![1]);
    };
    const src = block.match(/"src": "([^"]+)"/);
    expect(src, `${name}.src`).not.toBeNull();
    out[name] = {
      src: src![1],
      demCenterLon: num('dem_center_lon'),
      mapCenterLon: num('map_center_lon'),
      radiusKm: num('radius_km'),
    };
  }
  return out;
}

const demBodies = pyDemBodies();

const bodyOf = (name: string) =>
  SOL_BODIES.find((b) => b.name.toLowerCase() === name);

const shippedNormalMaps = readdirSync(TEXTURES)
  .filter((f) => f.endsWith('-normal.webp'))
  .map((f) => f.replace('-normal.webp', ''))
  .sort();

describe('surface-relief normal maps', () => {
  it('parses every DEM body out of dem_relief.py', () => {
    expect(Object.keys(demBodies).sort()).toEqual(['mars', 'mercury', 'moon']);
  });

  it('ships exactly the bodies the build script claims', () => {
    expect(shippedNormalMaps).toEqual(Object.keys(demBodies).sort());
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(demBodies).sort());
  });

  it('registers each normal map to its colour map, not to the DEM source', () => {
    // Mercury is the live case: the MESSENGER DEM is centred on 180°E while
    // PIA15063 is centred on 0°, so the build rolls it. Reading the DEM's own
    // convention straight through would put Caloris half a world away.
    expect(demBodies.mercury.demCenterLon).toBe(180);
    expect(demBodies.mercury.mapCenterLon).toBe(0);
    for (const [name, spec] of Object.entries(demBodies)) {
      const body = bodyOf(name);
      expect(body, `unknown body "${name}"`).toBeDefined();
      expect(body!.rotation?.mapCenterLonDeg ?? 0, `${name} map centre`).toBe(
        spec.mapCenterLon,
      );
    }
  });

  it('shades each body at the radius it is drawn at', () => {
    for (const [name, spec] of Object.entries(demBodies)) {
      expect(bodyOf(name)!.radiusKm, `${name} radius`).toBe(spec.radiusKm);
    }
  });

  it('never ships relief without the colour map it modulates', () => {
    const colourMaps = new Set(
      readdirSync(TEXTURES)
        .filter((f) => f.endsWith('.jpg'))
        .map((f) => f.replace('.jpg', '')),
    );
    for (const name of shippedNormalMaps) {
      expect(colourMaps.has(name), `${name} colour map`).toBe(true);
    }
  });

  it('ships none for the cloud, haze and giant bodies', () => {
    // Relief applies only where the rendered texture IS the solid surface.
    // Venus is the cloud deck by design, Titan's 938 nm map is surface seen
    // THROUGH the haze whose appearance dominates, and the giants have no
    // surface at all.
    for (const name of ['venus', 'titan', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      expect(shippedNormalMaps).not.toContain(name);
    }
  });

  it('pins the measured tilt of every shipped map', () => {
    // Area-weighted off the local vertical, poles past ±88° excluded — the
    // quantity that modulates the lighting. A source swap, a dropped
    // cos-latitude correction, or a lossy re-encode all move these.
    const pins: Record<string, [number, number]> = {
      moon: [3.269, 11.648],
      mercury: [1.136, 3.933],
      mars: [0.442, 2.572],
    };
    for (const [name, [median, p90]] of Object.entries(pins)) {
      expect(manifest[name].medianTiltDeg, `${name} median`).toBe(median);
      expect(manifest[name].p90TiltDeg, `${name} p90`).toBe(p90);
    }
  });

  it('keeps the Moon the dominant relief body at equal width', () => {
    // The measured ordering Moon >> Mercury > Mars holds at every map width,
    // and is why the Moon is the body the relief work is scoped around.
    expect(manifest.moon.p90TiltDeg).toBeGreaterThan(2 * manifest.mercury.p90TiltDeg);
    expect(manifest.mercury.p90TiltDeg).toBeGreaterThan(manifest.mars.p90TiltDeg);
  });

  it('builds every map at the declared target width', () => {
    const target = pySource.match(/DEM_TARGET_W = (\d+)/);
    expect(target).not.toBeNull();
    for (const [name, row] of Object.entries(manifest)) {
      expect(row.width, `${name} width`).toBe(Number(target![1]));
    }
  });
});
