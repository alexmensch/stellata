import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOL_BODIES } from '../../src/client/solar-system/planet-system';
import {
  HORIZON_AZIMUTHS,
  HORIZON_SIN_RANGE,
  RELIEF_ELEV_SPAN_M,
  reliefHorizonSines,
} from '../../src/client/solar-system/planets/surface-relief/surface-relief-pure';
import {
  LIMB_EXP,
  LIMB_FLOOR,
} from '../../src/client/solar-system/planets/emission/mesh-surface-pure';
import { isLfsPointer, webpSize } from './webp-header-pure';

// horizon_map.py cannot import the runtime tables, so this pins its constants
// back against the shader's mirror of them, and both against the shipped
// artifacts. Why it matters: data/textures/README.md § Cast shadows.

const TEXTURES = resolve(__dirname, '../../data/textures');
const MESH_FRAG = resolve(
  __dirname,
  '../../src/client/solar-system/planets/planet-mesh.frag.glsl',
);
const pySource = readFileSync(resolve(__dirname, 'horizon_map.py'), 'utf-8');
const buildSource = readFileSync(resolve(__dirname, 'build-textures.py'), 'utf-8');

interface HorizonRow {
  width: number;
  azimuths: number;
  medianHorizonDeg: number;
  p99HorizonDeg: number;
  clampedPct: number;
}

const manifest: Record<string, { horizon?: HorizonRow }> = JSON.parse(
  readFileSync(resolve(TEXTURES, 'relief.json'), 'utf-8'),
);

const pyNumber = (name: string): number => {
  const m = pySource.match(new RegExp(`^${name} = ([\\d.]+)$`, 'm'));
  expect(m, name).not.toBeNull();
  return Number(m![1]);
};

const HALVES = ['a', 'b'] as const;
const planePath = (body: string, half: string) =>
  resolve(TEXTURES, `${body}-horizon-${half}.webp`);

const halvesOnDisk = readdirSync(TEXTURES).filter((f) =>
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
  HALVES.some((half) => isLfsPointer(readFileSync(planePath(body, half)))),
);
if (mapsArePointers) {
  console.warn(
    '[horizon-map] skipping artifact-header pins — horizon maps are LFS ' +
      'pointers, not WebP. Run `git lfs pull` to exercise them.',
  );
}

describe('horizon maps', () => {
  it('ships both halves for exactly the relief bodies', () => {
    // Every azimuth or none: the shader interpolates across the seam between
    // the two planes, so a body with one is a body with a wrong skyline.
    expect(bodiesWithAnyHalf).toEqual(shipped);
    expect(shipped).toEqual(Object.keys(RELIEF_ELEV_SPAN_M).sort());
  });

  it('splits the azimuths evenly over the two planes', () => {
    expect(pyNumber('HORIZON_AZIMUTHS')).toBe(HORIZON_AZIMUTHS);
    expect(HORIZON_AZIMUTHS % 4).toBe(0);
    expect(HORIZON_AZIMUTHS / 4).toBe(HALVES.length);
  });

  it('encodes the sine on the scale the shader decodes with', () => {
    expect(pyNumber('HORIZON_SIN_RANGE')).toBe(HORIZON_SIN_RANGE);
  });

  it('reaches past every body limb bound, which is where the floor sits', () => {
    // The negative half of the encoding only has to hold the deepest a skyline
    // can fall, and that is the body's own limb; the positive half is what
    // needs the headroom, for a crater wall seen from the floor.
    for (const name of Object.keys(RELIEF_ELEV_SPAN_M)) {
      const body = SOL_BODIES.find((b) => b.name.toLowerCase() === name)!;
      const [, none] = reliefHorizonSines(RELIEF_ELEV_SPAN_M[name], body.radiusKm);
      expect(none, `${name} limb bound`).toBeLessThan(HORIZON_SIN_RANGE);
    }
  });

  it('searches exactly as far as that same limb bound', () => {
    // search_arc IS arccos(r_floor / r_summit), whose sine is the `none at all`
    // bound the shader falls back to — one quantity, so a body that changes its
    // DEM span cannot leave the precompute searching the old distance.
    expect(pySource).toContain(
      'np.arccos((r + spec["span_m"][0]) / (r + spec["span_m"][1]))');
    for (const name of Object.keys(RELIEF_ELEV_SPAN_M)) {
      const body = SOL_BODIES.find((b) => b.name.toLowerCase() === name)!;
      const [, none] = reliefHorizonSines(RELIEF_ELEV_SPAN_M[name], body.radiusKm);
      const r = body.radiusKm * 1000;
      const span = RELIEF_ELEV_SPAN_M[name];
      const arc = Math.acos((r + span[0]) / (r + span[1]));
      expect(Math.sin(arc), `${name}`).toBeCloseTo(none, 12);
    }
  });

  it('steps the ray at the DEM resolution, not the output grid', () => {
    // Stepping at the output texel drops the horizon's own curvature drop over
    // that first step — half an output texel of solar depression, 0.09° here,
    // which measured as 15.8% of area lit just past the terminator against a
    // true 8.4% (README.md § Cast shadows).
    expect(pySource).toContain('step = 2 * np.pi / w_d');
    expect(pySource).toContain('steps = max(1, int(np.ceil(psi_max / step)))');
  });

  it('registers each map to the colour map, like its normal map', () => {
    expect(pySource).toContain('elev = roll_to_map_centre(elev, spec)');
  });

  it('merges both halves of a body relief row instead of replacing it', () => {
    // The normal map and the horizon pair sit behind separate up-to-date gates
    // with different dependency sets, so either can be skipped while the other
    // runs. An assignment on either side drops the skipped half's stats from
    // relief.json, and the manifest pins below are what would then fail.
    expect(buildSource).toContain('relief.setdefault(name, {}).update(stats)');
    expect(buildSource).toContain('relief.setdefault(name, {})["horizon"] = stats');
    expect(buildSource).not.toMatch(/^\s*rgb, relief\[name\] = /m);
  });

  it('writes the planes with libwebp exact, so alpha cannot eat RGB', () => {
    // Without it libwebp is free to rewrite RGB wherever alpha is 0, which here
    // is one azimuth's skyline silently overwriting three others.
    expect(buildSource).toContain('out_path, "WEBP", lossless=True, exact=True');
  });

  it('records the achieved width, azimuths and clamping for every body', () => {
    const pins: Record<string, [number, number, number]> = {
      moon: [1.158, 14.858, 0.0575],
      mercury: [0.333, 6.87, 0.0018],
      mars: [0.037, 5.339, 0.0002],
    };
    const width = pyNumber('HORIZON_TARGET_W');
    expect(Object.keys(pins).sort()).toEqual(shipped);
    for (const [name, [median, p99, clamped]] of Object.entries(pins)) {
      const row = manifest[name].horizon!;
      expect(row.width, `${name} width`).toBe(width);
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

  it('measures the disc against the shading the renderer actually does', () => {
    // measure_relief_lighting.py integrates the disc to decide whether relief
    // needs a flux renormalisation (../../src/client/solar-system/planets/
    // emission/README.md). Its own copies of the limb constants drifting from
    // the shader's would answer that question about a different body.
    const measure = readFileSync(resolve(__dirname, 'measure_relief_lighting.py'), 'utf-8');
    expect(measure).toContain(`LIMB_FLOOR = ${LIMB_FLOOR}`);
    expect(measure).toContain(`LIMB_EXP = ${LIMB_EXP}`);
    // The third mirrored constant is a shader literal rather than a TS export,
    // so it pins against the GLSL directly instead of an import.
    const floor = measure.match(/^TERM_SOFTNESS_FLOOR = (\S+)$/m);
    expect(floor, 'TERM_SOFTNESS_FLOOR').not.toBeNull();
    expect(readFileSync(MESH_FRAG, 'utf-8')).toContain(
      `max(uTermSoftness, ${floor![1]})`);
  });

  it.skipIf(mapsArePointers)('ships both planes at the declared width', () => {
    const width = pyNumber('HORIZON_TARGET_W');
    for (const body of shipped) {
      for (const half of HALVES) {
        expect(
          webpSize(readFileSync(planePath(body, half)), `${body}-${half}`),
          `${body}-horizon-${half}`,
        ).toEqual({ width, height: width / 2 });
      }
    }
  });
});
