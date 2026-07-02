// Tier-A multi-star geometry corpus: per-pair WDS sep+PA pins against
// catalog.bin xyz, multiples.tsv, and binaries.bin Kepler propagation.
// Row contract + tolerance discipline in multi-star-regression.tsv.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, it, beforeAll, expect } from 'vitest';
import {
  DEFAULT_CATALOG_BIN,
  type Catalog,
  type CatalogRecord,
  distancePc,
  loadCatalog,
  lookupByHip,
  lookupByGaiaSourceId,
  lookupByName,
} from './catalog-lookup';
import { FLAG_BINARY_COMPANION_ONLY } from './catalog-pure';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  parseBinaries,
  type BinariesData,
  type BinaryRelation,
} from '../../src/client/binaries/binaries-loader';
import { relationToElements } from '../../src/client/binaries/orbit-relation-cache';
import { evaluateOrbitSkyAU } from '../../src/client/binaries/binary-orbit-pure';
import { AU_PER_PC } from '../../src/client/util/astronomy-constants';
import { REPO_ROOT } from '../util/paths';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_TSV = resolve(__dirname, 'multi-star-regression.tsv');
const MULTIPLES_TSV = resolve(REPO_ROOT, 'data/binaries/multiples.tsv');
const BINARIES_BIN = resolve(REPO_ROOT, 'public/binaries.bin');

// Same fixture gate as known-stars.test.ts, plus binaries.bin (also
// generated). CI's plain `npm test` job skips; the build-catalog job
// runs the full corpus against real artifacts.
const FIXTURES_READY =
  existsSync(DEFAULT_CATALOG_BIN) && existsSync(MULTIPLES_TSV) && existsSync(BINARIES_BIN);
if (!FIXTURES_READY) {
  // eslint-disable-next-line no-console
  console.warn(
    `[multi-star-regression] skipping corpus assertions — ` +
    `catalog.bin ${existsSync(DEFAULT_CATALOG_BIN) ? 'present' : 'MISSING'}, ` +
    `multiples.tsv ${existsSync(MULTIPLES_TSV) ? 'present' : 'MISSING'}, ` +
    `binaries.bin ${existsSync(BINARIES_BIN) ? 'present' : 'MISSING'}. ` +
    `Run \`npm run build:catalog\` + \`npm run build:binaries-runtime\` (with LFS pulled).`,
  );
}

// ---- Tolerances shared across rows --------------------------------------
//
// Per-pair geometry tolerances live in the TSV (curated per row); the
// constants below gate exact-copy pins where the corpus value and the
// pipeline value should be the same number modulo float encoding.

const MULT_SEP_TOL_ARCSEC = 0.011;   // multiples.tsv sep vs curated
const MULT_PA_TOL_DEG = 0.01;        // multiples.tsv pa vs curated
const EPOCH_TOL_DAYS = 0.5;          // sep_pa_epoch_jd vs curated (f32 offset)
const PERIOD_REL_TOLERANCE = 1e-3;   // stored P vs curated ORB6 P

// Ratchet for the promoted-companion HIP round-trip sweep. 26 promoted
// records currently carry a HIP that first-seen hipToIndex resolves to
// a DIFFERENT record, so a shared URL focused on them restores onto
// the wrong star. Pinned exactly so new violations fail immediately;
// the companion-promotion identifier fix drops this to 0.
const KNOWN_HIP_ROUNDTRIP_VIOLATIONS = 26;

// ---- Corpus row types ----------------------------------------------------

type RefKind = 'hip' | 'gaia' | 'name';
interface RecordRef { kind: RefKind; value: string }

interface CorpusPair {
  wdsId: string;
  pair: string;
  pairName: string;
  primaryRef: RecordRef;
  secondaryRef: RecordRef;
  sepArcsec: number;
  paDeg: number;
  epochJd: number;
  xyzSepTolAu: number | null;
  xyzPaTolDeg: number | null;
  orbitPDays: number | null;
  orbitTJd: number | null;
  orbitSepTolArcsec: number | null;
  orbitPaTolDeg: number | null;
  notesSource: string;
}

interface MultiplesGeomRow {
  comp: string;
  sepArcsec: number | null;
  paDeg: number | null;
  epochJd: number | null;
  pDays: number | null;
  tJd: number | null;
}

// ---- Loaders --------------------------------------------------------------

function nonEmpty(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length === 0 ? null : t;
}

function parseFloatOrNull(s: string | undefined): number | null {
  const t = nonEmpty(s);
  if (t === null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function parseRef(cell: string, rowName: string, col: string): RecordRef {
  const idx = cell.indexOf(':');
  const kind = idx > 0 ? cell.slice(0, idx) : '';
  const value = cell.slice(idx + 1).trim();
  if ((kind !== 'hip' && kind !== 'gaia' && kind !== 'name') || !value) {
    throw new Error(`${rowName}: malformed ${col} "${cell}" — expected hip:<n> | gaia:<id> | name:<name>`);
  }
  return { kind, value };
}

function loadCorpusSync(): CorpusPair[] {
  const rows = parse(readFileSync(CORPUS_TSV, 'utf-8'), {
    delimiter: '\t',
    columns: true,
    skip_empty_lines: true,
    comment: '#',
    trim: false,
    quote: null,
  }) as Record<string, string>[];

  return rows.map((row, i) => {
    const pairName = (row.pair_name ?? '').trim();
    const name = pairName || `row ${i + 1}`;
    const required = (col: string): number => {
      const v = parseFloatOrNull(row[col]);
      if (v === null) throw new Error(`${name}: missing required numeric column "${col}"`);
      return v;
    };
    const xyzSepTolAu = parseFloatOrNull(row.xyz_sep_tol_au);
    const xyzPaTolDeg = parseFloatOrNull(row.xyz_pa_tol_deg);
    if ((xyzSepTolAu === null) !== (xyzPaTolDeg === null)) {
      throw new Error(`${name}: xyz_sep_tol_au and xyz_pa_tol_deg must be set (or empty) together`);
    }
    const orbitPDays = parseFloatOrNull(row.orbit_p_days);
    const orbitTJd = parseFloatOrNull(row.orbit_t_jd);
    const orbitSepTolArcsec = parseFloatOrNull(row.orbit_sep_tol_arcsec);
    const orbitPaTolDeg = parseFloatOrNull(row.orbit_pa_tol_deg);
    if (orbitPDays !== null && orbitTJd === null) {
      throw new Error(`${name}: orbit_p_days requires orbit_t_jd`);
    }
    if (orbitPDays === null && (orbitTJd !== null || orbitSepTolArcsec !== null || orbitPaTolDeg !== null)) {
      throw new Error(`${name}: orbit columns set without orbit_p_days`);
    }
    return {
      wdsId: (row.wds_id ?? '').trim(),
      pair: (row.pair ?? '').trim(),
      pairName,
      primaryRef: parseRef((row.primary_ref ?? '').trim(), name, 'primary_ref'),
      secondaryRef: parseRef((row.secondary_ref ?? '').trim(), name, 'secondary_ref'),
      sepArcsec: required('sep_arcsec'),
      paDeg: required('pa_deg'),
      epochJd: required('epoch_jd'),
      xyzSepTolAu,
      xyzPaTolDeg,
      orbitPDays,
      orbitTJd,
      orbitSepTolArcsec,
      orbitPaTolDeg,
      notesSource: (row.notes_source ?? '').trim(),
    };
  });
}

function loadMultiplesGeomSync(): Map<string, MultiplesGeomRow[]> {
  const rows = parse(readFileSync(MULTIPLES_TSV, 'utf-8'), {
    delimiter: '\t',
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Record<string, string>[];
  const idx = new Map<string, MultiplesGeomRow[]>();
  for (const row of rows) {
    const sysId = (row.system_id ?? '').trim();
    if (!sysId) continue;
    const parsed: MultiplesGeomRow = {
      comp: (row.comp ?? '').trim(),
      sepArcsec: parseFloatOrNull(row.sep_arcsec),
      paDeg: parseFloatOrNull(row.pa_deg),
      epochJd: parseFloatOrNull(row.sep_pa_epoch_jd),
      pDays: parseFloatOrNull(row.P_days),
      tJd: parseFloatOrNull(row.T_jd),
    };
    const bucket = idx.get(sysId);
    if (bucket) bucket.push(parsed);
    else idx.set(sysId, [parsed]);
  }
  return idx;
}

function loadBinariesSync(): BinariesData {
  const buf = readFileSync(BINARIES_BIN);
  return parseBinaries(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

// ---- Geometry helpers ------------------------------------------------------

/** Decompose the catalog Δxyz between two records into the WDS-comparable
 *  sky-tangent frame at the primary: separation (AU) + position angle
 *  (deg E of N) in the tangent plane, plus the line-of-sight component.
 *  Inverse of companion-promotion's `projectFromSepPa` / the runtime's
 *  `projectSkyToICRS` — same north/east basis. */
function skySeparationAtPrimary(
  primary: CatalogRecord,
  secondary: CatalogRecord,
): { sepAu: number; paDeg: number; radialAu: number } {
  const d = distancePc(primary);
  const ra = Math.atan2(primary.y, primary.x);
  const dec = Math.asin(primary.z / d);
  const sinRa = Math.sin(ra), cosRa = Math.cos(ra);
  const sinDec = Math.sin(dec), cosDec = Math.cos(dec);
  const dx = secondary.x - primary.x;
  const dy = secondary.y - primary.y;
  const dz = secondary.z - primary.z;
  const north = dx * (-sinDec * cosRa) + dy * (-sinDec * sinRa) + dz * cosDec;
  const east = dx * -sinRa + dy * cosRa;
  const radial = dx * (cosDec * cosRa) + dy * (cosDec * sinRa) + dz * sinDec;
  return {
    sepAu: Math.hypot(north, east) * AU_PER_PC,
    paDeg: (Math.atan2(east, north) * (180 / Math.PI) + 360) % 360,
    radialAu: radial * AU_PER_PC,
  };
}

function circularDiffDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// ---- Fixtures at collection time ------------------------------------------

const CORPUS: CorpusPair[] = loadCorpusSync();
const MULTIPLES_BY_SYSTEM: Map<string, MultiplesGeomRow[]> = FIXTURES_READY
  ? loadMultiplesGeomSync()
  : new Map();
const BINARIES: BinariesData | null = FIXTURES_READY ? loadBinariesSync() : null;

const XYZ_PINNED = CORPUS.filter(r => r.xyzSepTolAu !== null);
const ORBIT_PINNED = CORPUS.filter(r => r.orbitPDays !== null);

let catalog: Catalog;

beforeAll(async () => {
  catalog = await loadCatalog();
});

function resolveRef(ref: RecordRef, label: string): CatalogRecord {
  const record =
    ref.kind === 'hip' ? lookupByHip(catalog, Number(ref.value))
    : ref.kind === 'gaia' ? lookupByGaiaSourceId(catalog, ref.value)
    : lookupByName(catalog, ref.value);
  expect(record, `${label}: ${ref.kind}:${ref.value} not found in catalog.bin`).not.toBeNull();
  return record as CatalogRecord;
}

function findRelation(secondaryIdx: number): BinaryRelation | null {
  const i = BINARIES!.secondaryIdxToRelation.get(secondaryIdx);
  return i === undefined ? null : BINARIES!.relations[i];
}

// ---- Test driver -----------------------------------------------------------

describe.runIf(FIXTURES_READY)('multi-star regression corpus', () => {
  it('contains rows with every pin class', () => {
    expect(CORPUS.length).toBeGreaterThan(0);
    expect(XYZ_PINNED.length, 'expected ≥1 xyz-pinned pair').toBeGreaterThan(0);
    expect(ORBIT_PINNED.length, 'expected ≥1 orbit-propagation pair').toBeGreaterThan(0);
    const missing = CORPUS.filter(r => !r.notesSource);
    expect(missing.map(r => r.pairName), 'rows missing notes_source').toHaveLength(0);
  });

  describe('multiples.tsv geometry columns match the curated WDS pins', () => {
    it.each(CORPUS)('$pairName', (row) => {
      const sysId = `${row.wdsId}-${row.pair}`;
      const bucket = MULTIPLES_BY_SYSTEM.get(sysId) ?? [];
      expect(
        bucket.length,
        `${row.pairName}: expected the two component rows for system_id=${sysId} in multiples.tsv`,
      ).toBeGreaterThanOrEqual(2);
      for (const m of bucket) {
        expect(m.sepArcsec, `${row.pairName} comp ${m.comp}: sep_arcsec empty`).not.toBeNull();
        expect(
          Math.abs((m.sepArcsec as number) - row.sepArcsec),
          `${row.pairName} comp ${m.comp}: sep_arcsec ${m.sepArcsec} vs curated ${row.sepArcsec}`,
        ).toBeLessThanOrEqual(MULT_SEP_TOL_ARCSEC);
        expect(m.paDeg, `${row.pairName} comp ${m.comp}: pa_deg empty`).not.toBeNull();
        expect(
          circularDiffDeg(m.paDeg as number, row.paDeg),
          `${row.pairName} comp ${m.comp}: pa_deg ${m.paDeg} vs curated ${row.paDeg}`,
        ).toBeLessThanOrEqual(MULT_PA_TOL_DEG);
        expect(m.epochJd, `${row.pairName} comp ${m.comp}: sep_pa_epoch_jd empty`).not.toBeNull();
        expect(
          Math.abs((m.epochJd as number) - row.epochJd),
          `${row.pairName} comp ${m.comp}: sep_pa_epoch_jd ${m.epochJd} vs curated ${row.epochJd}`,
        ).toBeLessThanOrEqual(EPOCH_TOL_DAYS);
        if (row.orbitPDays !== null) {
          expect(m.pDays, `${row.pairName} comp ${m.comp}: P_days empty but corpus pins an orbit`).not.toBeNull();
          const rel = Math.abs((m.pDays as number) - row.orbitPDays) / row.orbitPDays;
          expect(
            rel,
            `${row.pairName} comp ${m.comp}: P_days ${m.pDays} vs curated ${row.orbitPDays}`,
          ).toBeLessThanOrEqual(PERIOD_REL_TOLERANCE);
          expect(m.tJd, `${row.pairName} comp ${m.comp}: T_jd empty but corpus pins an orbit`).not.toBeNull();
          expect(
            Math.abs((m.tJd as number) - (row.orbitTJd as number)),
            `${row.pairName} comp ${m.comp}: T_jd ${m.tJd} vs curated ${row.orbitTJd} — ` +
            `a ~2.4e6-day gap means an ORB6 truncated-JD epoch shipped un-normalised`,
          ).toBeLessThanOrEqual(EPOCH_TOL_DAYS);
        }
      }
    });
  });

  describe('catalog.bin per-component xyz reproduces the WDS sep+PA at the record epoch', () => {
    it.each(XYZ_PINNED)('$pairName', (row) => {
      const primary = resolveRef(row.primaryRef, row.pairName);
      const secondary = resolveRef(row.secondaryRef, row.pairName);
      expect(
        secondary.i,
        `${row.pairName}: primary and secondary resolve to the same record ${primary.i}`,
      ).not.toBe(primary.i);
      const obs = skySeparationAtPrimary(primary, secondary);
      const expectedSepAu = row.sepArcsec * distancePc(primary);
      const sepDiff = Math.abs(obs.sepAu - expectedSepAu);
      expect(
        sepDiff,
        `${row.pairName}: tangential separation ${obs.sepAu.toFixed(2)} AU vs WDS ${expectedSepAu.toFixed(2)} AU ` +
        `(diff ${sepDiff.toFixed(2)} > tol ${row.xyzSepTolAu}; radial ${obs.radialAu.toFixed(2)} AU unpinned)`,
      ).toBeLessThanOrEqual(row.xyzSepTolAu as number);
      const paDiff = circularDiffDeg(obs.paDeg, row.paDeg);
      expect(
        paDiff,
        `${row.pairName}: tangential PA ${obs.paDeg.toFixed(1)}° vs WDS ${row.paDeg}° (diff ${paDiff.toFixed(1)}° > tol ${row.xyzPaTolDeg}°)`,
      ).toBeLessThanOrEqual(row.xyzPaTolDeg as number);
    });
  });

  describe('binaries.bin Tier-1 elements propagate to the stored WDS sep+PA at sep_pa_epoch_jd', () => {
    it.each(ORBIT_PINNED)('$pairName', (row) => {
      const primary = resolveRef(row.primaryRef, row.pairName);
      const secondary = resolveRef(row.secondaryRef, row.pairName);
      const relation = findRelation(secondary.i);
      expect(
        relation,
        `${row.pairName}: no binaries.bin relation with secondaryIdx=${secondary.i}`,
      ).not.toBeNull();
      if (!relation) return;
      expect(
        relation.primaryIdx,
        `${row.pairName}: relation primaryIdx ${relation.primaryIdx} ≠ resolved primary ${primary.i}`,
      ).toBe(primary.i);
      expect(
        relation.flags & (FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION),
        `${row.pairName}: expected Tier-1 flags (has_orbit + has_inclination), got flags=${relation.flags}`,
      ).toBe(FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION);

      const pRel = Math.abs(relation.pDays - (row.orbitPDays as number)) / (row.orbitPDays as number);
      expect(
        pRel,
        `${row.pairName}: relation P ${relation.pDays} d vs curated ORB6 ${row.orbitPDays} d`,
      ).toBeLessThanOrEqual(PERIOD_REL_TOLERANCE);
      expect(
        Math.abs(relation.tJd - (row.orbitTJd as number)),
        `${row.pairName}: relation T ${relation.tJd} vs curated ORB6 ${row.orbitTJd} — ` +
        `a ~2.4e6-day gap means an ORB6 truncated-JD epoch shipped un-normalised`,
      ).toBeLessThanOrEqual(EPOCH_TOL_DAYS);

      // The stored baseline epoch must be the pair's measurement epoch —
      // a J2000 fallback here silently re-introduces the epoch-baseline
      // bug the runtime cache was fixed for.
      expect(
        Math.abs(relation.sepPaEpochJd - row.epochJd),
        `${row.pairName}: sep_pa_epoch_jd ${relation.sepPaEpochJd} vs curated ${row.epochJd}`,
      ).toBeLessThanOrEqual(EPOCH_TOL_DAYS);
      expect(
        Math.abs(relation.sepArcsec - row.sepArcsec),
        `${row.pairName}: relation sep ${relation.sepArcsec}" vs curated ${row.sepArcsec}"`,
      ).toBeLessThanOrEqual(MULT_SEP_TOL_ARCSEC);
      expect(
        circularDiffDeg(relation.paDeg, row.paDeg),
        `${row.pairName}: relation PA ${relation.paDeg}° vs curated ${row.paDeg}°`,
      ).toBeLessThanOrEqual(MULT_PA_TOL_DEG);

      // Same eval path the runtime cache uses for its ΔR baseline.
      const sky = evaluateOrbitSkyAU(relationToElements(relation), relation.sepPaEpochJd);
      const sepArcsec = Math.hypot(sky.northAU, sky.eastAU) / distancePc(primary);
      const paDeg = (Math.atan2(sky.eastAU, sky.northAU) * (180 / Math.PI) + 360) % 360;
      if (row.orbitSepTolArcsec !== null) {
        const sepDiff = Math.abs(sepArcsec - row.sepArcsec);
        expect(
          sepDiff,
          `${row.pairName}: propagated separation ${sepArcsec.toFixed(3)}" vs WDS ${row.sepArcsec}" at epoch ` +
          `JD ${row.epochJd} (diff ${sepDiff.toFixed(3)} > tol ${row.orbitSepTolArcsec})`,
        ).toBeLessThanOrEqual(row.orbitSepTolArcsec);
      }
      if (row.orbitPaTolDeg !== null) {
        const paDiff = circularDiffDeg(paDeg, row.paDeg);
        expect(
          paDiff,
          `${row.pairName}: propagated PA ${paDeg.toFixed(1)}° vs WDS ${row.paDeg}° at epoch JD ${row.epochJd} ` +
          `(diff ${paDiff.toFixed(1)}° > tol ${row.orbitPaTolDeg}°)`,
        ).toBeLessThanOrEqual(row.orbitPaTolDeg);
      }
    });
  });

  describe('identifier integrity across corpus components', () => {
    it('no two distinct corpus records share a HIP', () => {
      const hipToRecord = new Map<number, { i: number; name: string }>();
      for (const row of CORPUS) {
        for (const ref of [row.primaryRef, row.secondaryRef]) {
          const record = resolveRef(ref, row.pairName);
          if (record.hip === null) continue;
          const prior = hipToRecord.get(record.hip);
          if (prior) {
            expect(
              prior.i,
              `HIP ${record.hip} claimed by two distinct records: ${prior.i} (${prior.name}) and ${record.i} (${row.pairName})`,
            ).toBe(record.i);
          } else {
            hipToRecord.set(record.hip, { i: record.i, name: row.pairName });
          }
        }
      }
    });

    it('every corpus record round-trips through the URL star-ref encoding', () => {
      // Simulates url-state's refFromIndex → resolveStarRef: a record
      // with a HIP encodes as kind:'hip' and must resolve back through
      // first-seen hipToIndex (main.ts IdMaps semantics) to ITSELF; a
      // record without one encodes as kind:'index' (trivially stable).
      const firstSeenHip = buildFirstSeenHipIndex();
      for (const row of CORPUS) {
        for (const ref of [row.primaryRef, row.secondaryRef]) {
          const record = resolveRef(ref, row.pairName);
          if (record.hip === null) continue;
          expect(
            firstSeenHip.get(record.hip),
            `${row.pairName}: HIP ${record.hip} on record ${record.i} resolves to a different record — ` +
            `a shared URL focused on this component restores onto the wrong star`,
          ).toBe(record.i);
        }
      }
    });

    it(`promoted-companion HIP round-trip violations stay at the known count (ratchet)`, () => {
      const firstSeenHip = buildFirstSeenHipIndex();
      const violations: number[] = [];
      for (const r of catalog.records()) {
        if ((r.flags & FLAG_BINARY_COMPANION_ONLY) === 0) continue;
        if (r.hip === null) continue;
        if (firstSeenHip.get(r.hip) !== r.i) violations.push(r.i);
      }
      expect(
        violations.length,
        `promoted companions whose HIP resolves to a different record (URL focus lands on the wrong star): ` +
        `records [${violations.slice(0, 8).join(', ')}${violations.length > 8 ? ', …' : ''}]. ` +
        `A count above the pin is a new companion-promotion identifier collision; ` +
        `below it, the fix landed — drop the pin to the new count (target 0).`,
      ).toBe(KNOWN_HIP_ROUNDTRIP_VIOLATIONS);
    });
  });
});

function buildFirstSeenHipIndex(): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of catalog.records()) {
    if (r.hip !== null && !m.has(r.hip)) m.set(r.hip, r.i);
  }
  return m;
}
