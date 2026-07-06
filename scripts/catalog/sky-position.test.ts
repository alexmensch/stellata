// High-PM sky-position regression harness: catalog.bin directions vs
// J2016.0 (scene-epoch) positions in sky-position-corpus.tsv.
// See scripts/catalog/README.md § Direction resolution.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, it, beforeAll, expect } from 'vitest';
import {
  DEFAULT_CATALOG_BIN,
  type Catalog,
  type CatalogRecord,
  loadCatalog,
  lookupByHip,
  lookupByName,
} from './catalog-lookup';
import { unitVectorFromRaDec, type UnitVector } from './direction-cascade';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_TSV = resolve(__dirname, 'sky-position-corpus.tsv');

// Same skip-with-hint contract as known-stars.test.ts: plain `npm test`
// in CI has no catalog.bin; the build-catalog CI job runs the suite
// against real data.
const CATALOG_BIN_PRESENT = existsSync(DEFAULT_CATALOG_BIN);
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
}

function loadCorpus(): CorpusRow[] {
  const rows = parse(readFileSync(CORPUS_TSV, 'utf8'), {
    columns: true,
    delimiter: '\t',
    comment: '#',
    skip_empty_lines: true,
    cast: false,
  }) as Record<string, string>[];
  return rows.map((r) => ({
    name: r.name,
    lookupName: r.lookup_name || null,
    hip: r.hip ? Number(r.hip) : null,
    raDegJ2016: Number(r.ra_deg_j2016),
    decDegJ2016: Number(r.dec_deg_j2016),
    tolArcsec: Number(r.tol_arcsec),
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
});
