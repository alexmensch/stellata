import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOL_BODIES } from '../../src/client/solar-system/planet-system';
import { RELIEF_ELEV_SPAN_M } from '../../src/client/solar-system/planets/surface-relief/surface-relief-pure';
import { lfsContentReadable } from '../util/paths';
import { webpSize } from './image-header-pure';

// dem_relief.py cannot import these tables, so it keeps its own copies of the
// map centre and radius; this pins them back against the originals, along with
// the committed manifest and the shipped maps. Why it matters:
// data/textures/relief/README.md § Surface relief.

const TEXTURES = resolve(__dirname, '../../data/textures');
const RELIEF = resolve(TEXTURES, 'relief');

interface ReliefRow {
  medianTiltDeg: number;
  p90TiltDeg: number;
  width: number;
}

const manifest: Record<string, ReliefRow> = JSON.parse(
  readFileSync(resolve(RELIEF, 'relief.json'), 'utf-8'),
);

const pySource = readFileSync(resolve(__dirname, 'dem_relief.py'), 'utf-8');

interface DemSpec {
  src: string;
  demCenterLon: number;
  mapCenterLon: number;
  radiusKm: number;
  spanM: [number, number];
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
    const span = block.match(/"span_m": \((-?\d+), (-?\d+)\)/);
    expect(span, `${name}.span_m`).not.toBeNull();
    out[name] = {
      src: src![1],
      demCenterLon: num('dem_center_lon'),
      mapCenterLon: num('map_center_lon'),
      radiusKm: num('radius_km'),
      spanM: [Number(span![1]), Number(span![2])],
    };
  }
  return out;
}

const demBodies = pyDemBodies();

const bodyOf = (name: string) =>
  SOL_BODIES.find((b) => b.name.toLowerCase() === name);

const shippedNormalMaps = readdirSync(RELIEF)
  .filter((f) => f.endsWith('-normal.webp'))
  .map((f) => f.replace('-normal.webp', ''))
  .sort();

const normalMap = (name: string) =>
  readFileSync(resolve(RELIEF, `${name}-normal.webp`));

// These maps ride LFS, and the Unit tests job does not pull it — a checkout
// without the objects leaves pointer stubs whose first bytes are text. Anything
// reading pixels or headers self-skips there, the way the catalogue corpora do,
// and says so rather than passing quietly.
const mapsArePointers = shippedNormalMaps.some(
  (name) => !lfsContentReadable(resolve(RELIEF, `${name}-normal.webp`)),
);
if (mapsArePointers) {
  console.warn(
    '[dem-relief] skipping artifact-header pins — normal maps are LFS ' +
      'pointers, not WebP. Run `git lfs pull` to exercise them.',
  );
}

describe('surface-relief normal maps', () => {
  it('parses every DEM body out of dem_relief.py', () => {
    expect(Object.keys(demBodies).sort()).toEqual(['mars', 'mercury', 'moon']);
  });

  it('ships exactly the bodies the build script claims', () => {
    expect(shippedNormalMaps).toEqual(Object.keys(demBodies).sort());
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(demBodies).sort());
  });

  it('registers each normal map to its colour map, not to the DEM source', () => {
    // Mercury is the live case — the only body whose DEM needs the roll.
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

  it('hands the renderer the same elevation span the reduction asserted', () => {
    // The shader fences relief lighting at the depression the body's own limb
    // allows, which is a function of this span — so the client keeps a copy of
    // it, and reduce_dem.py checks the span against the downloaded original.
    expect(Object.keys(RELIEF_ELEV_SPAN_M).sort()).toEqual(
      Object.keys(demBodies).sort(),
    );
    for (const [name, spec] of Object.entries(demBodies)) {
      expect(RELIEF_ELEV_SPAN_M[name], `${name} span`).toEqual(spec.spanM);
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
        .map((f) => f.replace(/-\d+\.jpg$/, '')),
    );
    for (const name of shippedNormalMaps) {
      expect(colourMaps.has(name), `${name} colour map`).toBe(true);
    }
  });

  it('ships none for the cloud, haze and giant bodies', () => {
    // Relief applies only where the rendered texture IS the solid surface —
    // per-body reasoning in data/textures/relief/README.md § Surface relief.
    for (const name of ['venus', 'titan', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      expect(shippedNormalMaps).not.toContain(name);
    }
  });

  it('pins the measured tilt of every shipped map', () => {
    // Area-weighted off the local vertical, over the same ±85° window the
    // east-west derivative is valid in — the quantity that modulates the
    // lighting. A source swap, a dropped cos-latitude correction, or a lossy
    // re-encode all move these.
    const pins: Record<string, [number, number]> = {
      moon: [3.273, 11.656],
      mercury: [1.138, 3.938],
      mars: [0.443, 2.577],
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
      expect(row.width, `${name} manifest width`).toBe(Number(target![1]));
    }
  });

  it.skipIf(mapsArePointers)('ships artifacts at that same width', () => {
    // The manifest is written by the same call that writes the image, so it
    // can only disagree with the artifact through a hand-edit or a bad merge.
    // Read the shipped file's own header so the pin survives that.
    const width = Number(pySource.match(/DEM_TARGET_W = (\d+)/)![1]);
    for (const name of shippedNormalMaps) {
      expect(webpSize(normalMap(name), name), `${name} artifact`).toEqual({
        width,
        height: width / 2,
      });
    }
  });

  it('encodes the unused third channel as +1, never 0', () => {
    // Blue carries no signal, but it is still read: a consumer that samples
    // all three and skips the sqrt(1 - x² - y²) reconstruction gets a shallow
    // normal from 255 and an INVERTED one from 0. Costs ~1% of file size.
    expect(pySource).toMatch(/np\.full\(\(h, w, 3\), 255, dtype=np\.uint8\)/);
    expect(pySource).toMatch(/rgb\[\.\.\., :2\] = /);
  });
});
