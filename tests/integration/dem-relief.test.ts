import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RELIEF_BODIES } from '../../src/astro-core/baker-constants';
import { lfsContentReadable } from '../../scripts/util/paths';
import { webpSize } from '../../scripts/textures/image-header-pure';

// The committed manifest and the shipped maps against the relief bodies the
// shared constants declare. Why it matters:
// /data/textures/relief/README.md#surface-relief--dem-derived-normal-maps.

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

const reliefBodies = Object.keys(RELIEF_BODIES).sort();

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
  it('ships exactly the relief bodies', () => {
    expect(reliefBodies).toEqual(['earth', 'mars', 'mercury', 'moon']);
    expect(shippedNormalMaps).toEqual(reliefBodies);
    expect(Object.keys(manifest).sort()).toEqual(reliefBodies);
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
    // per-body reasoning in /data/textures/relief/README.md#surface-relief--dem-derived-normal-maps.
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
      // Earth's row is NOT comparable to the other three: 70.7% of its
      // surface is ocean clamped flat, which is what pulls the median to
      // exactly 0 and the p90 to 0.521. Over land alone the same map
      // measures median 0.265 / p90 2.157 — the figure the 8192 width was
      // chosen on (/data/textures/relief/README.md#surface-relief--dem-derived-normal-maps).
      earth: [0.0, 0.521],
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

  it.skipIf(mapsArePointers)('ships artifacts at the width the manifest records', () => {
    // The manifest is written by the same call that writes the image, so it
    // can only disagree with the artifact through a hand-edit or a bad merge.
    // Read the shipped file's own header so the pin survives that.
    for (const name of shippedNormalMaps) {
      const width = manifest[name].width;
      expect(webpSize(normalMap(name), name), `${name} artifact`).toEqual({
        width,
        height: width / 2,
      });
    }
  });
});
