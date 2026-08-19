import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HORIZON_AZIMUTHS,
  SKY_VIEW_RANGE,
  decodeSkyView,
} from '../../src/client/solar-system/planets/surface-relief/surface-relief-pure';
import { lfsContentReadable } from '../util/paths';
import { webpSize } from './image-header-pure';

// sky_view.py cannot import the runtime tables, so this pins its encoding
// range against the shader that decodes it, and both against the shipped
// artifacts. Why the map exists at all, and why it is not the horizon pair's
// job: data/textures/relief/README.md § Sky view factor.

const RELIEF = resolve(__dirname, '../../data/textures/relief');
const MESH_FRAG = resolve(
  __dirname,
  '../../src/client/solar-system/planets/planet-mesh.frag.glsl',
);
const pySource = readFileSync(resolve(__dirname, 'sky_view.py'), 'utf-8');
const horizonSource = readFileSync(resolve(__dirname, 'horizon_map.py'), 'utf-8');
const layer = readFileSync(
  resolve(
    __dirname,
    '../../src/client/solar-system/planets/planet-mesh-layer.ts',
  ),
  'utf-8',
);

interface SkyViewRow {
  width: number;
  azimuths: number;
  range: number;
  medianFactor: number;
  p99Factor: number;
  maxFactor: number;
  clampedPct: number;
}

const manifest: Record<string, { skyView?: SkyViewRow; horizon?: { width: number } }> =
  JSON.parse(readFileSync(resolve(RELIEF, 'relief.json'), 'utf-8'));

describe('sky view factor map', () => {
  it('shares its encoding range with the shader that decodes it', () => {
    // A range the three disagree on scales every shadow by the ratio, which
    // reads as "the fill term is mistuned" rather than as an encoding bug.
    expect(pySource).toContain(`SKY_VIEW_RANGE = ${SKY_VIEW_RANGE}`);
    expect(readFileSync(MESH_FRAG, 'utf-8')).toContain(
      `const float STELLATA_SKY_VIEW_RANGE = ${SKY_VIEW_RANGE};`,
    );
  });

  it('decodes a raw channel the way the shader multiplies it', () => {
    expect(decodeSkyView(0)).toBe(0);
    expect(decodeSkyView(1)).toBe(SKY_VIEW_RANGE);
    expect(readFileSync(MESH_FRAG, 'utf-8')).toContain(
      'texture(uSkyView, vUvM).r * STELLATA_SKY_VIEW_RANGE',
    );
  });

  it('marches from one DEM texel, inside the shadow march it is not', () => {
    // The whole reason for a second artifact. The horizon pair starts
    // HORIZON_MARCH_START_TEXELS OUTPUT texels out because a nearer caster
    // throws an undrawable shadow; sky occlusion has no such requirement, and
    // the near field is where a crater floor loses most of its sky.
    expect(pySource).toContain('return 2 * np.pi / w_dem');
    expect(horizonSource).toContain('HORIZON_MARCH_START_TEXELS = 2.0');
    expect(pySource).toContain('near_bound(w_dem), search_arc(spec)');
  });

  it('shares the horizon pair grid, so both sample at one UV', () => {
    expect(pySource).toContain('return horizon_target_w(spec)');
  });

  it('records the achieved factor for every body that ships one', () => {
    const pins: Record<string, [number, number, number]> = {
      moon: [0.00239, 0.0445, 0.14236],
      mercury: [0.00021, 0.01136, 0.10688],
      mars: [0.00003, 0.00824, 0.07813],
      earth: [0, 0.00206, 0.04629],
    };
    // Every body that ships relief ships this map too — a body silently
    // missing one would fall back to the horizon planes and read half the
    // fill, which looks like a tuning problem rather than a missing artifact.
    expect(Object.keys(pins).sort()).toEqual(
      Object.keys(manifest).filter(b => manifest[b].horizon).sort(),
    );
    for (const [name, [median, p99, max]] of Object.entries(pins)) {
      const row = manifest[name]?.skyView;
      expect(row, `${name} skyView row`).toBeDefined();
      expect(row!.width, `${name} width`).toBe(manifest[name]!.horizon!.width);
      expect(row!.azimuths, `${name} azimuths`).toBe(HORIZON_AZIMUTHS);
      expect(row!.range, `${name} range`).toBe(SKY_VIEW_RANGE);
      expect(row, `${name} stats`).toMatchObject({
        medianFactor: median,
        p99Factor: p99,
        maxFactor: max,
      });
    }
  });

  it('never clamps, so the range is not throwing signal away', () => {
    // 0.25 clears the Moon's 0.142 — the highest any shipped map reaches — with
    // room to spare, and one code is 0.001 of sky, two orders under the
    // faintest shadow the tone-map shows.
    for (const [name, row] of Object.entries(manifest)) {
      if (!row.skyView) continue;
      expect(row.skyView.clampedPct, `${name} clamped`).toBe(0);
      expect(row.skyView.maxFactor, `${name} max`).toBeLessThan(SKY_VIEW_RANGE);
    }
  });

  it('keeps the Moon the deepest sky occlusion, as it is the deepest relief', () => {
    const p99 = (name: string) => manifest[name]!.skyView!.p99Factor;
    expect(p99('moon')).toBeGreaterThan(2 * p99('mercury'));
  });

  it('ships a map whose header matches the row it claims', () => {
    for (const [name, row] of Object.entries(manifest)) {
      if (!row.skyView) continue;
      const file = resolve(RELIEF, `${name}-skyview.webp`);
      if (!lfsContentReadable(file)) {
        console.warn(`sky-view: skipping ${name}, LFS object not pulled`);
        continue;
      }
      const size = webpSize(readFileSync(file), `${name}-skyview`);
      expect(size.width, `${name} width`).toBe(row.skyView.width);
      expect(size.height, `${name} height`).toBe(row.skyView.width / 2);
    }
  });

  it('uploads as R8 and falls back to the horizon planes until it lands', () => {
    // One scalar per texel, so three of four channels would be VRAM for
    // nothing; and the fallback has to stay the byte-identical old path, or
    // a body would darken between the horizon pair landing and this map.
    expect(layer).toContain('ext: \'webp\', format: THREE.RedFormat,');
    const frag = readFileSync(MESH_FRAG, 'utf-8');
    expect(frag).toContain('uHasSkyView > 0.5');
    expect(frag).toContain(': stellataTerrainViewFactor(enc);');
  });
});
