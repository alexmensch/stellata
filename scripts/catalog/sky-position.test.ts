// High-PM sky-position regression harness: catalog.bin directions vs
// J2016.0 (scene-epoch) positions in sky-position-corpus.tsv.
// See scripts/catalog/README.md § Direction resolution.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, it, beforeAll, expect } from 'vitest';
import {
  DEFAULT_CATALOG_MANIFEST,
  type Catalog,
  type CatalogRecord,
  loadCatalog,
  lookupByHip,
  lookupByName,
} from './catalog-lookup';
import { unitVectorFromRaDec, type UnitVector } from './direction-cascade';
import {
  CATALOG_SCENE_EPOCH_JYR,
  advancePositionsToEpoch,
} from '../../src/client/loaders/epoch-advance-pure';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_TSV = resolve(__dirname, 'sky-position-corpus.tsv');

// Same skip-with-hint contract as known-stars.test.ts: plain `npm test`
// in CI has no catalog.bin; the Tier-A corpus CI job runs the suite
// against real artifacts.
const CATALOG_BIN_PRESENT = existsSync(DEFAULT_CATALOG_MANIFEST);
if (!CATALOG_BIN_PRESENT) {
  // eslint-disable-next-line no-console
  console.warn(
    `[sky-position] skipping corpus assertions — catalog.bin MISSING. ` +
    `Run \`npm run build:catalog\` (with LFS pulled) to exercise this suite.`,
  );
}

interface CorpusRow {
  name: string;
  lookupName: string | null;
  hip: number | null;
  raDegJ2016: number;
  decDegJ2016: number;
  tolArcsec: number;
  totalPmMasyr: number | null;
}

function loadCorpus(): CorpusRow[] {
  const rows = parse(readFileSync(CORPUS_TSV, 'utf8'), {
    columns: true,
    delimiter: '\t',
    comment: '#',
    skip_empty_lines: true,
    // The tier-3 row (xi UMa) omits the trailing total_pm_masyr column.
    relax_column_count_less: true,
    cast: false,
  }) as Record<string, string>[];
  return rows.map((r) => ({
    name: r.name,
    lookupName: r.lookup_name || null,
    hip: r.hip ? Number(r.hip) : null,
    raDegJ2016: Number(r.ra_deg_j2016),
    decDegJ2016: Number(r.dec_deg_j2016),
    tolArcsec: Number(r.tol_arcsec),
    totalPmMasyr: r.total_pm_masyr ? Number(r.total_pm_masyr) : null,
  }));
}

const ARCSEC_PER_RAD = (180 * 3600) / Math.PI;

function angSepArcsec(a: UnitVector, b: UnitVector): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(dot) * ARCSEC_PER_RAD;
}

describe.skipIf(!CATALOG_BIN_PRESENT)('sky-position corpus', () => {
  let catalog: Catalog;
  const corpus = loadCorpus();

  beforeAll(async () => {
    catalog = await loadCatalog();
  });

  it('corpus covers the high-PM set plus one pin per non-Gaia tier', () => {
    expect(corpus.map((r) => r.hip ?? r.lookupName)).toEqual([
      87937, 24186, 57939, 104214, 104217, 19849,
      32349, 91262, 'Alula Australis',
    ]);
  });

  for (const row of corpus) {
    it(`${row.name} sits within ${row.tolArcsec}″ of its J2016.0 position`, () => {
      const rec: CatalogRecord | null = row.hip !== null
        ? lookupByHip(catalog, row.hip)
        : lookupByName(catalog, row.lookupName!);
      expect(rec, `${row.name} missing from catalog.bin`).not.toBeNull();
      const dist = Math.hypot(rec!.x, rec!.y, rec!.z);
      expect(dist).toBeGreaterThan(0);
      const dir: UnitVector = {
        x: rec!.x / dist,
        y: rec!.y / dist,
        z: rec!.z / dist,
      };
      const published = unitVectorFromRaDec(row.raDegJ2016, row.decDegJ2016);
      const sep = angSepArcsec(dir, published);
      expect(
        sep,
        `${row.name}: catalog direction is ${sep.toFixed(3)}″ from its J2016.0 position`,
      ).toBeLessThan(row.tolArcsec);
    });
  }

  // End-to-end current-epoch propagation: drive the baked J2016 position +
  // baked velocity through the SAME epoch-advance the runtime calls, then
  // check the on-sky angular displacement matches published total PM × Δt.
  // A wrong tier, distance scale, unit, or sign misses by ≫ tolerance at a
  // 34 yr baseline (Barnard's alone moves ~350″).
  const ADVANCE_EPOCH_JYR = CATALOG_SCENE_EPOCH_JYR + 34; // J2050.0
  const dt = ADVANCE_EPOCH_JYR - CATALOG_SCENE_EPOCH_JYR;
  for (const row of corpus) {
    if (row.totalPmMasyr === null) continue;
    it(`${row.name} advances by its published proper motion (${row.totalPmMasyr} mas/yr) over ${dt} yr`, () => {
      const rec = row.hip !== null
        ? lookupByHip(catalog, row.hip)
        : lookupByName(catalog, row.lookupName!);
      expect(rec, `${row.name} missing from catalog.bin`).not.toBeNull();
      const pos = new Float32Array([rec!.x, rec!.y, rec!.z]);
      const vel = new Float32Array([rec!.vx, rec!.vy, rec!.vz]);
      const j2016Dir: UnitVector = normalize(rec!.x, rec!.y, rec!.z);
      advancePositionsToEpoch(pos, vel, ADVANCE_EPOCH_JYR);
      const advancedDir = normalize(pos[0], pos[1], pos[2]);
      const displacementArcsec = angSepArcsec(j2016Dir, advancedDir);
      const expectedArcsec = (row.totalPmMasyr! / 1000) * dt;
      const relErr = Math.abs(displacementArcsec - expectedArcsec) / expectedArcsec;
      expect(
        relErr,
        `${row.name}: advanced ${displacementArcsec.toFixed(1)}″ over ${dt} yr, ` +
        `expected ~${expectedArcsec.toFixed(1)}″ from published μ (rel err ${(relErr * 100).toFixed(1)}%)`,
      ).toBeLessThan(0.04);
    });
  }
});

function normalize(x: number, y: number, z: number): UnitVector {
  const d = Math.hypot(x, y, z);
  return { x: x / d, y: y / d, z: z / d };
}
