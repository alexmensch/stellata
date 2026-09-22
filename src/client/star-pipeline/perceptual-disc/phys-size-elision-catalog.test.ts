// The elision's margin over the built catalog: how much sits inside the
// window, how far the worst gated star moves its exponent. Self-skips
// without public/catalog.bin, as the other artifact-backed suites do.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_CATALOG_MANIFEST,
  DEFAULT_CONSTELLATIONS_JSON,
  readCatalogBuffer,
} from '../../../../scripts/catalog/catalog-lookup';
import { peakAmplitudeFactor } from '../../camera/controls/star-geometry';
import { DEFAULT_INSTRUMENT, STAR_RENDER_DEFAULTS, starPxSizes } from '../../filters/filter-state';
import { parseBinary, type Catalog } from '../../loaders/catalog-loader';
import { MIN_PHYSICAL_RADIUS_R_SUN, R_SUN_PC } from '../../util/astronomy-constants';
import { discWindowPc } from '../local-pass/star-local-cluster-pure';
import { perceptualDiscExponent } from './perceptual-disc-pure';
import { DISC_EXPONENT_TOLERANCE, physSizeElisionBoundPx } from './phys-size-elision-pure';

const ROOT = resolve(__dirname, '../../../..');
const skip = !existsSync(resolve(ROOT, 'public/catalog-manifest.json'));

const FOV_DEG = 50;
const FOV_Y_RAD = (FOV_DEG * Math.PI) / 180;
const VIEWPORT_H = 1000;
const { sizeMinPx: SIZE_MIN } = starPxSizes(DEFAULT_INSTRUMENT, FOV_DEG, VIEWPORT_H, 1);
const { distNMin: DIST_N_MIN, distNMax: DIST_N_MAX } = STAR_RENDER_DEFAULTS;

let catalog: Catalog;

describe.skipIf(skip)('the physical-size elision over the built catalog', () => {
  beforeAll(async () => {
    const [ab, conText, manifestText] = await Promise.all([
      readCatalogBuffer(DEFAULT_CATALOG_MANIFEST),
      readFile(DEFAULT_CONSTELLATIONS_JSON, 'utf-8'),
      readFile(DEFAULT_CATALOG_MANIFEST, 'utf-8'),
    ]);
    catalog = parseBinary(ab, JSON.parse(conText), JSON.parse(manifestText).sidSuccessors);
  }, 120000);

  it('admits 163 of 983,068 records at a Sol vantage, and gates the rest', () => {
    const { window, inside } = measure();
    expect(catalog.count).toBe(983068);
    expect(window).toBeCloseTo(7.1211, 4);
    expect(inside).toBe(163);
  });

  it('leaves the worst gated star three orders inside the tolerance', () => {
    const { worstPhysSizePx, worstExponentMove } = measure();
    expect(worstPhysSizePx).toBeCloseTo(2.139e-4, 7);
    expect(worstExponentMove).toBeCloseTo(2.897e-7, 10);
    expect(worstExponentMove).toBeLessThan(DISC_EXPONENT_TOLERANCE / 1000);
  });
});

function measure() {
  const bound = physSizeElisionBoundPx(SIZE_MIN, DIST_N_MIN, DIST_N_MAX);
  const angularToPx = VIEWPORT_H / FOV_Y_RAD;

  let maxRadiusRSun = 0;
  for (let i = 0; i < catalog.count; i++) {
    const r = Math.max(catalog.physicalRadius[i], MIN_PHYSICAL_RADIUS_R_SUN)
      * peakAmplitudeFactor(catalog.pulsRho[i], catalog.amplitudeMag[i], catalog.periodDays[i]);
    if (r > maxRadiusRSun) maxRadiusRSun = r;
  }
  const window = discWindowPc(maxRadiusRSun * R_SUN_PC, bound, FOV_Y_RAD, VIEWPORT_H);

  let inside = 0;
  let worstPhysSizePx = 0;
  for (let i = 0; i < catalog.count; i++) {
    const x = catalog.positions[i * 3];
    const y = catalog.positions[i * 3 + 1];
    const z = catalog.positions[i * 3 + 2];
    const d = Math.max(Math.sqrt(x * x + y * y + z * z), 1e-30);
    if (d <= window) { inside++; continue; }
    const r = Math.max(catalog.physicalRadius[i], MIN_PHYSICAL_RADIUS_R_SUN)
      * peakAmplitudeFactor(catalog.pulsRho[i], catalog.amplitudeMag[i], catalog.periodDays[i]);
    const physSizePx = Math.atan((r * R_SUN_PC) / d) * 2 * angularToPx;
    if (physSizePx > worstPhysSizePx) worstPhysSizePx = physSizePx;
  }

  // uSizeMin is the floor routeAppSize can take, so it is the largest
  // physRatio the worst gated physSize can produce.
  const ratio = worstPhysSizePx / SIZE_MIN;
  const gated = perceptualDiscExponent(0, 0, DIST_N_MIN, DIST_N_MAX, 1, 1);
  const truth = perceptualDiscExponent(0, ratio, DIST_N_MIN, DIST_N_MAX, 1, 1);
  return { window, inside, worstPhysSizePx, worstExponentMove: truth / gated - 1 };
}
