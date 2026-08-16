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

// Dimensions straight out of the lossless-WebP (VP8L) header, so the pin reads
// the artifact rather than the manifest written beside it: 14-bit width-1 and
// height-1 packed little-endian after the 0x2f signature byte.
function webpSize(name: string): { width: number; height: number } {
  const buf = readFileSync(resolve(TEXTURES, `${name}-normal.webp`));
  expect(buf.subarray(0, 4).toString('ascii'), `${name} RIFF`).toBe('RIFF');
  expect(buf.subarray(12, 16).toString('ascii'), `${name} lossless`).toBe('VP8L');
  const bits = buf.readUInt32LE(21);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
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
    const width = Number(target![1]);
    for (const [name, row] of Object.entries(manifest)) {
      expect(row.width, `${name} manifest width`).toBe(width);
    }
    // The manifest is written by the same call that writes the image, so it
    // can only disagree with the artifact through a hand-edit or a bad merge.
    // Read the shipped file's own header so the pin survives that.
    for (const name of shippedNormalMaps) {
      expect(webpSize(name), `${name} artifact`).toEqual({
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
