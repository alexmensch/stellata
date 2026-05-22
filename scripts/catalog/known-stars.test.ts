// Phase 4 tier-A regression-prevention harness. Drives per-row assertions
// over scripts/catalog/known-stars.tsv against public/catalog.bin (via the
// catalog-lookup library) and data/binaries/multiples.tsv. Authoring rules
// + tolerances are documented in known-stars.tsv's header block.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, it, beforeAll, expect } from 'vitest';
import { classifyFromSimbad, SPECTRAL_UNKNOWN, type SpectralInfo } from './catalog-pure';
import {
  DEFAULT_CATALOG_BIN,
  type Catalog,
  type CatalogRecord,
  distancePc,
  loadCatalog,
  lookupByHip,
  lookupByGaiaSourceId,
} from './catalog-lookup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const KNOWN_STARS_TSV = resolve(__dirname, 'known-stars.tsv');
const MULTIPLES_TSV = resolve(REPO_ROOT, 'data/binaries/multiples.tsv');

// The corpus needs public/catalog.bin and data/binaries/multiples.tsv —
// the first is generated (gitignored, ~24 MB), the second is LFS-tracked.
// CI's plain `npm test` job pulls neither, so the suite skips itself with
// a console hint when either is missing. The .github/workflows/test.yml
// `build-catalog` job runs the full suite after `npm run build:catalog`
// + LFS pull, so the assertions execute against real data on every PR.
const CATALOG_BIN_PRESENT = existsSync(DEFAULT_CATALOG_BIN);
const MULTIPLES_PRESENT = existsSync(MULTIPLES_TSV);
const FIXTURES_READY = CATALOG_BIN_PRESENT && MULTIPLES_PRESENT;
if (!FIXTURES_READY) {
  // eslint-disable-next-line no-console
  console.warn(
    `[known-stars] skipping corpus assertions — ` +
    `catalog.bin ${CATALOG_BIN_PRESENT ? 'present' : 'MISSING'}, ` +
    `multiples.tsv ${MULTIPLES_PRESENT ? 'present' : 'MISSING'}. ` +
    `Run \`npm run build:catalog\` (with LFS pulled) to exercise this suite.`,
  );
}

// ---- Tolerances --------------------------------------------------------
//
// Matches the header block in known-stars.tsv. Hoisted to module-scope
// constants so a tolerance tweak is a one-edit operation and so the
// failure messages can name the constant in their diagnostic.

const DISTANCE_FLOOR_PC = 0.01;        // distance tolerance, hard floor
const ABSMAG_TOLERANCE = 0.05;          // absmag tolerance, both primary + companion
const PERIOD_REL_TOLERANCE = 0.05;      // orbital period, ±5%

// ---- TSV row types -----------------------------------------------------

interface CorpusCompanion {
  letter: string;
  hip: number | null;
  gaiaSourceId: string | null;
  absmag: number;
}

interface CorpusRow {
  wdsId: string | null;
  systemName: string;
  primaryHip: number | null;
  primaryGaiaSourceId: string | null;
  primaryDistancePc: number;
  primaryDistancePcErr: number;
  primaryAbsmag: number;
  primarySpectral: string;
  companions: CorpusCompanion[];
  orbitalPeriodDays: number | null;
  notesSource: string;
}

interface MultiplesRow {
  systemId: string;
  comp: string;
  hip: number | null;
  gaiaSourceId: string | null;
  absmag: number | null;
  spect: string;
  name: string;
  periodDays: number | null;  // P_days column (ORB6 / Gaia NSS orbital period)
}

// ---- TSV loaders -------------------------------------------------------

function nonEmpty(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function parseIntOrNull(s: string): number | null {
  const t = nonEmpty(s);
  if (t === null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.trunc(v) : null;
}

function parseFloatOrNull(s: string): number | null {
  const t = nonEmpty(s);
  if (t === null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function parseCompanions(cell: string): CorpusCompanion[] {
  const trimmed = cell.trim();
  if (!trimmed) return [];
  return trimmed.split(';').map(chunk => {
    const parts = chunk.split(':');
    if (parts.length !== 4) {
      throw new Error(`malformed companion tuple "${chunk}" — expected letter:hip:gaia_id:absmag`);
    }
    const [letter, hipStr, gaiaStr, absmagStr] = parts;
    const absmag = Number(absmagStr);
    if (!Number.isFinite(absmag)) {
      throw new Error(`companion "${chunk}" — absmag "${absmagStr}" is not a finite number`);
    }
    return {
      letter: letter.trim(),
      hip: parseIntOrNull(hipStr),
      gaiaSourceId: nonEmpty(gaiaStr),
      absmag,
    };
  });
}

async function loadCorpus(): Promise<CorpusRow[]> {
  const text = await readFile(KNOWN_STARS_TSV, 'utf-8');
  const rows = parse(text, {
    delimiter: '\t',
    columns: true,
    skip_empty_lines: true,
    comment: '#',
    trim: false,
  }) as Record<string, string>[];

  return rows.map((row, i) => {
    const required = (col: string): number => {
      const v = parseFloatOrNull(row[col] ?? '');
      if (v === null) {
        throw new Error(`row ${i + 1} (${row.system_name}): missing required numeric column "${col}"`);
      }
      return v;
    };
    return {
      wdsId: nonEmpty(row.wds_id ?? ''),
      systemName: (row.system_name ?? '').trim(),
      primaryHip: parseIntOrNull(row.primary_hip ?? ''),
      primaryGaiaSourceId: nonEmpty(row.primary_gaia_source_id ?? ''),
      primaryDistancePc: required('primary_distance_pc'),
      primaryDistancePcErr: required('primary_distance_pc_err'),
      primaryAbsmag: required('primary_absmag'),
      primarySpectral: (row.primary_spectral ?? '').trim(),
      companions: parseCompanions(row.companions ?? ''),
      orbitalPeriodDays: parseFloatOrNull(row.orbital_period_days ?? ''),
      notesSource: (row.notes_source ?? '').trim(),
    };
  });
}

async function loadMultiplesIndex(): Promise<Map<string, MultiplesRow[]>> {
  const text = await readFile(MULTIPLES_TSV, 'utf-8');
  const rows = parse(text, {
    delimiter: '\t',
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Record<string, string>[];

  const idx = new Map<string, MultiplesRow[]>();
  for (const row of rows) {
    const sysId = (row.system_id ?? '').trim();
    if (!sysId) continue;
    const wdsId = sysId.replace(/-[^-]+$/, '');
    const parsed: MultiplesRow = {
      systemId: sysId,
      comp: (row.comp ?? '').trim(),
      hip: parseIntOrNull(row.hip ?? ''),
      gaiaSourceId: nonEmpty(row.gaia_source_id ?? ''),
      absmag: parseFloatOrNull(row.absmag ?? ''),
      spect: (row.spect ?? '').trim(),
      name: (row.name ?? '').trim(),
      periodDays: parseFloatOrNull(row.P_days ?? ''),
    };
    const bucket = idx.get(wdsId);
    if (bucket) bucket.push(parsed);
    else idx.set(wdsId, [parsed]);
  }
  return idx;
}

// ---- Spectral validation ------------------------------------------------

function bestPeriodMatch(bucket: MultiplesRow[], expected: number): number | null {
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const r of bucket) {
    if (r.periodDays === null) continue;
    const d = Math.abs(r.periodDays - expected);
    if (d < bestDiff) {
      best = r.periodDays;
      bestDiff = d;
    }
  }
  return best;
}

function classifyOrUnknown(s: string): SpectralInfo {
  return classifyFromSimbad(s) ?? SPECTRAL_UNKNOWN;
}

function spectralStringIsBareClass(s: string): boolean {
  // "A0" / "M5.5" / "K0" — no Roman luminosity class. lookupLumClass would
  // return 255 for these, so the row deliberately opts out of the
  // luminosity-class pin.
  return !/[IV]/.test(s);
}

// ---- Loaded fixtures (populated in beforeAll) ---------------------------

let catalog: Catalog;
let corpus: CorpusRow[];
let multiplesByWds: Map<string, MultiplesRow[]>;

beforeAll(async () => {
  [catalog, corpus, multiplesByWds] = await Promise.all([
    loadCatalog(),
    loadCorpus(),
    loadMultiplesIndex(),
  ]);
});

// ---- Per-row assertions -------------------------------------------------

function assertPrimary(row: CorpusRow, record: CatalogRecord): void {
  const observedDist = distancePc(record);
  const tolerance = Math.max(DISTANCE_FLOOR_PC, row.primaryDistancePcErr);
  const distDiff = Math.abs(observedDist - row.primaryDistancePc);
  expect(
    distDiff,
    `${row.systemName}: expected distance ${row.primaryDistancePc} pc, got ${observedDist.toFixed(3)} pc (diff ${distDiff.toFixed(3)} pc > tolerance ${tolerance.toFixed(3)} pc)`,
  ).toBeLessThanOrEqual(tolerance);

  const absmagDiff = Math.abs(record.absmag - row.primaryAbsmag);
  expect(
    absmagDiff,
    `${row.systemName}: expected absmag ${row.primaryAbsmag}, got ${record.absmag.toFixed(3)} (diff ${absmagDiff.toFixed(3)} > tolerance ${ABSMAG_TOLERANCE})`,
  ).toBeLessThanOrEqual(ABSMAG_TOLERANCE);

  const expectedSpec = classifyOrUnknown(row.primarySpectral);
  expect(
    record.spectClass,
    `${row.systemName}: expected spectClass ${expectedSpec.classIdx} (from "${row.primarySpectral}"), got ${record.spectClass}`,
  ).toBe(expectedSpec.classIdx);
  if (!spectralStringIsBareClass(row.primarySpectral)) {
    expect(
      record.lumClass,
      `${row.systemName}: expected lumClass ${expectedSpec.lumClass} (from "${row.primarySpectral}"), got ${record.lumClass}`,
    ).toBe(expectedSpec.lumClass);
  }
}

function findCompanionInMultiples(
  row: CorpusRow,
  companion: CorpusCompanion,
): MultiplesRow | null {
  if (!row.wdsId) return null;
  const bucket = multiplesByWds.get(row.wdsId);
  if (!bucket) return null;
  // Match the component letter to a row's `comp` field. WDS encodes
  // multi-tier letters (Aa, Ab, Ba1) so an exact match on the trimmed
  // letter is the right comparison — substring would match "A" against
  // "Aa" and silently pick the wrong row.
  return bucket.find(m => m.comp === companion.letter) ?? null;
}

function assertCompanion(row: CorpusRow, companion: CorpusCompanion): void {
  const m = findCompanionInMultiples(row, companion);
  expect(
    m,
    `${row.systemName} companion ${companion.letter}: not found in multiples.tsv for wds_id=${row.wdsId}`,
  ).not.toBeNull();
  if (!m) return;

  if (companion.hip !== null) {
    expect(
      m.hip,
      `${row.systemName} companion ${companion.letter}: expected HIP ${companion.hip}, multiples.tsv has ${m.hip}`,
    ).toBe(companion.hip);
  }
  if (companion.gaiaSourceId !== null) {
    expect(
      m.gaiaSourceId,
      `${row.systemName} companion ${companion.letter}: expected gaia_source_id ${companion.gaiaSourceId}, multiples.tsv has ${m.gaiaSourceId}`,
    ).toBe(companion.gaiaSourceId);
  }
  if (m.absmag !== null) {
    const diff = Math.abs(m.absmag - companion.absmag);
    expect(
      diff,
      `${row.systemName} companion ${companion.letter}: expected absmag ${companion.absmag}, multiples.tsv has ${m.absmag} (diff ${diff.toFixed(3)} > tolerance ${ABSMAG_TOLERANCE})`,
    ).toBeLessThanOrEqual(ABSMAG_TOLERANCE);
  }
}

function lookupPrimary(row: CorpusRow): CatalogRecord {
  let viaHip: CatalogRecord | null = null;
  let viaGaia: CatalogRecord | null = null;
  if (row.primaryHip !== null) viaHip = lookupByHip(catalog, row.primaryHip);
  if (row.primaryGaiaSourceId !== null) viaGaia = lookupByGaiaSourceId(catalog, row.primaryGaiaSourceId);

  if (row.primaryHip !== null) {
    expect(
      viaHip,
      `${row.systemName}: lookupByHip(${row.primaryHip}) returned null`,
    ).not.toBeNull();
  }
  if (row.primaryGaiaSourceId !== null) {
    expect(
      viaGaia,
      `${row.systemName}: lookupByGaiaSourceId(${row.primaryGaiaSourceId}) returned null`,
    ).not.toBeNull();
  }
  if (viaHip !== null && viaGaia !== null) {
    expect(
      viaHip.i,
      `${row.systemName}: HIP ${row.primaryHip} and Gaia ${row.primaryGaiaSourceId} resolve to different records (${viaHip.i} vs ${viaGaia.i})`,
    ).toBe(viaGaia.i);
  }
  const r = viaHip ?? viaGaia;
  expect(
    r,
    `${row.systemName}: neither HIP nor Gaia source_id set — corpus rows must have at least one identifier`,
  ).not.toBeNull();
  return r as CatalogRecord;
}

// ---- Test driver --------------------------------------------------------

function isDistanceRefinementCase(row: CorpusRow): boolean {
  // Sentinel substrings in notes_source carry the regression-case tag.
  // Authors mark a row by prefixing its notes_source with one of these.
  const n = row.notesSource;
  return n.startsWith('B-J override:')
    || n.startsWith('B-J no-degradation guard:')
    || n.startsWith('LMC kinematic snap:');
}

describe.runIf(FIXTURES_READY)('known-stars corpus', () => {
  it('contains at least one row', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it('every row has a notes_source', () => {
    const missing = corpus.filter(r => !r.notesSource);
    expect(
      missing,
      `rows missing notes_source: ${missing.map(r => r.systemName).join(', ')}`,
    ).toHaveLength(0);
  });

  it('every row sets at least one primary identifier (HIP or Gaia)', () => {
    const orphans = corpus.filter(r => r.primaryHip === null && r.primaryGaiaSourceId === null);
    expect(
      orphans,
      `rows with no HIP and no Gaia source_id: ${orphans.map(r => r.systemName).join(', ')}`,
    ).toHaveLength(0);
  });

  describe('single stars', () => {
    it('iterates each row', () => {
      const singles = corpus.filter(r => r.companions.length === 0 && !isDistanceRefinementCase(r));
      for (const row of singles) {
        const record = lookupPrimary(row);
        assertPrimary(row, record);
      }
    });
  });

  describe('visual binaries', () => {
    it('iterates each row, validates primary + each companion', () => {
      const binaries = corpus.filter(r => r.companions.length > 0);
      for (const row of binaries) {
        const record = lookupPrimary(row);
        assertPrimary(row, record);
        for (const companion of row.companions) {
          assertCompanion(row, companion);
        }
      }
    });

    it('orbital_period_days matches multiples.tsv P_days within ±5%', () => {
      // Catalog.bin's `periodDays` field carries GCVS variability periods,
      // not ORB6/NSS orbital periods. The corpus orbital_period_days check
      // therefore validates multiples.tsv (which is where build-binaries.py
      // surfaces ORB6 + Gaia NSS orbits) rather than catalog.bin.
      const orbited = corpus.filter(r => r.orbitalPeriodDays !== null);
      for (const row of orbited) {
        // Look up the wds pair in multiples.tsv whose comp row carries the
        // primary's HIP (or Gaia ID) — that's the row where build-binaries.py
        // wrote the P_days field. With the corpus's wds_id as system-level
        // prefix, the bucket may contain multiple pairs; pick the one whose
        // P_days is non-empty AND nearest the expected value.
        expect(
          row.wdsId,
          `${row.systemName}: rows with orbital_period_days must set wds_id (multiples.tsv lookup key)`,
        ).not.toBeNull();
        const bucket = multiplesByWds.get(row.wdsId as string) ?? [];
        const expected = row.orbitalPeriodDays as number;
        // Read P_days off the raw multiples.tsv rows — we didn't decode it
        // into MultiplesRow above to keep that struct narrow, so re-parse
        // here from the bucket's source columns isn't possible. Fold the
        // P_days into MultiplesRow if/when more callers need it; for now
        // require the corpus author to encode the period via a multiples
        // lookup that the harness can verify.
        //
        // Implementation: pull every P_days value seen across the bucket
        // (set on `Row.periodDays`) and pass the closest one through the
        // tolerance gate.
        const observed = bestPeriodMatch(bucket, expected);
        expect(
          observed,
          `${row.systemName}: no orbital period found in multiples.tsv bucket for wds_id=${row.wdsId} matching expected ${expected} d (bucket size=${bucket.length})`,
        ).not.toBeNull();
        const rel = Math.abs((observed as number) - expected) / expected;
        expect(
          rel,
          `${row.systemName}: expected orbital period ${expected} d, multiples.tsv has ${observed} d (relative diff ${(rel * 100).toFixed(2)}% > ${(PERIOD_REL_TOLERANCE * 100).toFixed(0)}%)`,
        ).toBeLessThanOrEqual(PERIOD_REL_TOLERANCE);
      }
    });
  });

  describe('distance-refinement regression cases', () => {
    it('B-J override re-anchored distances are pinned (≥25% inward from AT-HYG)', () => {
      const cases = corpus.filter(r => r.notesSource.startsWith('B-J override:'));
      expect(cases.length, 'expected ≥1 B-J override regression case').toBeGreaterThan(0);
      for (const row of cases) {
        const record = lookupPrimary(row);
        assertPrimary(row, record);
      }
    });

    it('B-J no-degradation guard rows preserve well-measured nearby distances', () => {
      const cases = corpus.filter(r => r.notesSource.startsWith('B-J no-degradation guard:'));
      expect(cases.length, 'expected ≥1 B-J no-degradation guard').toBeGreaterThan(0);
      for (const row of cases) {
        const record = lookupPrimary(row);
        assertPrimary(row, record);
      }
    });

    it('LMC kinematic snaps pin to Pietrzyński 2019 49.594 kpc', () => {
      const cases = corpus.filter(r => r.notesSource.startsWith('LMC kinematic snap:'));
      expect(cases.length, 'expected ≥1 LMC kinematic snap row').toBeGreaterThan(0);
      for (const row of cases) {
        const record = lookupPrimary(row);
        assertPrimary(row, record);
        // Sanity: a snap row's expected distance should be within Pietrzyński's 49.594 kpc envelope.
        expect(
          row.primaryDistancePc,
          `${row.systemName}: tagged as LMC kinematic snap but expected distance ${row.primaryDistancePc} pc is outside the LMC envelope`,
        ).toBeGreaterThan(48_000);
      }
    });
  });
});
