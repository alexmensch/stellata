import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOL_BODIES } from '../../src/client/solar-system/planet-system';
import { reliefHorizonSines } from '../../src/client/solar-system/planets/surface-relief/surface-relief-pure';
import {
  HORIZON_AZIMUTHS,
  HORIZON_SIN_RANGE,
  RELIEF_BODIES,
} from '../../src/client/util/baker-constants';
import { lfsContentReadable } from '../util/paths';
import { webpSize } from './image-header-pure';

// See /data/textures/relief/README.md#cast-shadows--dem-derived-horizon-maps.

const RELIEF = resolve(__dirname, '../../data/textures/relief');

interface HorizonRow {
  width: number;
  azimuths: number;
  medianHorizonDeg: number;
  p99HorizonDeg: number;
  clampedPct: number;
}

const manifest: Record<string, { width: number; horizon?: HorizonRow }> = JSON.parse(
  readFileSync(resolve(RELIEF, 'relief.json'), 'utf-8'),
);

const HALVES = ['a', 'b'] as const;
const planePath = (body: string, half: string) =>
  resolve(RELIEF, `${body}-horizon-${half}.webp`);

const halvesOnDisk = readdirSync(RELIEF).filter((f) =>
  /-horizon-[ab]\.webp$/.test(f),
);
const bodiesWithAnyHalf = [
  ...new Set(halvesOnDisk.map((f) => f.replace(/-horizon-[ab]\.webp$/, ''))),
].sort();
/** Only bodies with BOTH halves, so nothing below reads a file that is not
 *  there — a body holding one half is the assertion's job, not an ENOENT. */
const shipped = bodiesWithAnyHalf.filter((body) =>
  HALVES.every((half) => halvesOnDisk.includes(`${body}-horizon-${half}.webp`)),
);

const mapsArePointers = shipped.some((body) =>
  HALVES.some((half) => !lfsContentReadable(planePath(body, half))),
);
if (mapsArePointers) {
  console.warn(
    '[horizon-map] skipping artifact-header pins — horizon maps are LFS ' +
      'pointers, not WebP. Run `git lfs pull` to exercise them.',
  );
}

const bodyOf = (name: string) => SOL_BODIES.find((b) => b.name.toLowerCase() === name)!;

describe('horizon maps', () => {
  it('ships both halves for exactly the relief bodies', () => {
    // Every azimuth or none: the shader interpolates across the seam between
    // the two planes, so a body with one is a body with a wrong skyline.
    expect(bodiesWithAnyHalf).toEqual(shipped);
    expect(shipped).toEqual(Object.keys(RELIEF_BODIES).sort());
  });

  it('splits the azimuths evenly over the two planes', () => {
    expect(HORIZON_AZIMUTHS % 4).toBe(0);
    expect(HORIZON_AZIMUTHS / 4).toBe(HALVES.length);
  });

  it('reaches past every body limb bound, which is where the floor sits', () => {
    // The negative half of the encoding only has to hold the deepest a skyline
    // can fall, and that is the body's own limb; the positive half is what
    // needs the headroom, for a crater wall seen from the floor.
    for (const [name, body] of Object.entries(RELIEF_BODIES)) {
      const [, none] = reliefHorizonSines(body.elevSpanM, bodyOf(name).radiusKm);
      expect(none, `${name} limb bound`).toBeLessThan(HORIZON_SIN_RANGE);
    }
  });

  it('falls back to the same limb bound the precompute searches to', () => {
    // search_arc IS arccos(r_floor / r_summit), whose sine is the `none at all`
    // bound the shader falls back to — one quantity, so a body that changes its
    // DEM span cannot leave the precompute searching the old distance.
    for (const [name, body] of Object.entries(RELIEF_BODIES)) {
      const [, none] = reliefHorizonSines(body.elevSpanM, bodyOf(name).radiusKm);
      const r = bodyOf(name).radiusKm * 1000;
      const [floor, summit] = body.elevSpanM;
      expect(Math.sin(Math.acos((r + floor) / (r + summit))), name).toBeCloseTo(none, 12);
    }
  });

  it('records the achieved width, azimuths and clamping for every body', () => {
    const pins: Record<string, [number, number, number]> = {
      moon: [0.556, 10.835, 0.0002],
      mercury: [0.057, 4.861, 0.0],
      mars: [-0.141, 3.428, 0.0],
      earth: [-0.088, 1.279, 0.0],
    };
    expect(Object.keys(pins).sort()).toEqual(shipped);
    for (const [name, [median, p99, clamped]] of Object.entries(pins)) {
      const row = manifest[name].horizon!;
      expect(row.width, `${name} width`).toBe(manifest[name].width / 2);
      expect(row.azimuths, `${name} azimuths`).toBe(HORIZON_AZIMUTHS);
      expect(row, `${name} stats`).toMatchObject({
        medianHorizonDeg: median,
        p99HorizonDeg: p99,
        clampedPct: clamped,
      });
    }
  });

  it('keeps the Moon the dominant skyline, as it is the dominant relief', () => {
    const p99 = (name: string) => manifest[name].horizon!.p99HorizonDeg;
    expect(p99('moon')).toBeGreaterThan(2 * p99('mercury'));
    expect(p99('mercury')).toBeGreaterThan(p99('mars'));
  });

  it.skipIf(mapsArePointers)('ships both planes at the width the manifest records', () => {
    for (const body of shipped) {
      const width = manifest[body].horizon!.width;
      for (const half of HALVES) {
        expect(
          webpSize(readFileSync(planePath(body, half)), `${body}-${half}`),
          `${body}-horizon-${half}`,
        ).toEqual({ width, height: width / 2 });
      }
    }
  });
});
