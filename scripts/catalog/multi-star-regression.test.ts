// Tier-A multi-star geometry corpus: per-pair WDS sep+PA pins against
// catalog.bin xyz, multiples.tsv, and binaries.bin Kepler propagation.
// Row contract + tolerance discipline in multi-star-regression.tsv.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, it, beforeAll, expect } from 'vitest';
import {
  DEFAULT_CATALOG_MANIFEST,
  type Catalog,
  type CatalogRecord,
  distancePc,
  loadCatalog,
  lookupByGaiaSourceId,
  lookupByHip,
  lookupByName,
  lookupByRef,
} from './catalog-lookup';
import { parseFloatOrNull, parseRef, type RecordRef } from './corpus-tsv';
import {
  KM_S_TO_PC_YR,
  VELOCITY_SANITY_CEILING_PC_YR,
} from './direction-cascade';
import {
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_PRIMARY,
  VAR_TYPE_ECLIPSING,
} from './catalog-pure';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  parseBinaries,
  type BinariesData,
  type BinaryRelation,
} from '../../src/client/binaries/binaries-loader';
import * as THREE from 'three';
import {
  buildOrbitRelationCaches,
  evaluateOrbitRelationDeltaPc,
  relationToElements,
} from '../../src/client/binaries/orbit-relation-cache';
import { evaluateOrbitSkyAU } from '../../src/client/binaries/binary-orbit-pure';
import { BinaryOrbitField } from '../../src/client/binaries/binary-orbit-field';
import { AU_PC, AU_PER_PC } from '../../src/client/util/astronomy-constants';
import { readMultiplesTsv, wdsRootOf } from './companion-promotion';
import { REPO_ROOT } from '../util/paths';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_TSV = resolve(__dirname, 'multi-star-regression.tsv');
const MULTIPLES_TSV = resolve(REPO_ROOT, 'data/binaries/multiples.tsv');
const BINARIES_BIN = resolve(REPO_ROOT, 'public/binaries.bin');
const ROW_INDEX_MAP = resolve(REPO_ROOT, 'public/catalog-row-index-map.json');

// Same fixture gate as known-stars.test.ts, plus binaries.bin (also
// generated). CI's plain `npm test` job skips; the build-catalog job
// runs the full corpus against real artifacts.
const FIXTURES_READY =
  existsSync(DEFAULT_CATALOG_MANIFEST) && existsSync(MULTIPLES_TSV)
  && existsSync(BINARIES_BIN) && existsSync(ROW_INDEX_MAP);
if (!FIXTURES_READY) {
  // eslint-disable-next-line no-console
  console.warn(
    `[multi-star-regression] skipping corpus assertions — ` +
    `catalog.bin ${existsSync(DEFAULT_CATALOG_MANIFEST) ? 'present' : 'MISSING'}, ` +
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

// Ratchet for the promoted-companion HIP round-trip sweep. A handful of
// promoted records carry a HIP that first-seen hipToIndex resolves to a
// DIFFERENT record, so a shared URL focused on them restores onto the
// wrong star. Pinned exactly so new violations fail immediately; the
// companion-promotion identifier fix drops this to 0. Dropped 4 → 3 when
// the separation-sanity gate retired a leaked NSS orbit, letting Stage 5
// reclassify one colliding companion's wide pair as an optical double.
// The 3 → 2 step is Stage-2 binding-integrity enforcement: a contested
// source geometry proved was bound to the wrong sibling letter is unbound,
// so its HIP no longer round-trips onto a colliding record.
// The 2 → 0 step is the own-gaia-miss HIP dedup in companion promotion:
// a row whose gaia misses the existing index but whose HIP names a
// non-anchor record IS that record, so no colliding twin is minted.
const KNOWN_HIP_ROUNDTRIP_VIOLATIONS = 0;

// Corpus-wide count of non-collocated Tier-1 pairs whose baked catalog
// placement disagrees with the elements-alone R(epoch) by more than half
// the semi-major axis. The runtime renders R(t) regardless of the baked
// placement now, so this is a data-curation signal, not a render defect:
// the tangent-only WDS bake can't carry R(epoch)'s radial term, so most
// inclined pairs land here (plus quadrant-ambiguity cases like Algol).
// Pinned so a NEW disagreement fails; the count ratchets DOWN as baked
// placements are curated toward R(epoch). The 541 → 702 step is the
// gaia_nss population that gained a Kepler-estimated semi-major axis
// (a_via=kepler_mass_estimate) and started animating: blended tight
// pairs whose NSS ω is the photocentre's (π off the relative orbit's
// when the primary dominates the flux), so R(epoch) routinely lands
// opposite the measured WDS quadrant. The 702 → 705 step is orbit-
// bearing inner pairs that re-anchored onto their correct system star
// once the Stage 2 ORB6-HIP coordinate gate rejected typo'd HIPs — the
// same sub-resolution tangent-bake-vs-R(epoch) class, now placed right.
// The 705 → 566 step is the Stage 4 separation-sanity gate: NSS orbits
// that had leaked onto wide visual pairs of a blended primary lose their
// elements, so those pairs no longer render an R(epoch) that disagrees
// with the baked WDS placement.
// The 566 → 568 step is the J2016.0 scene-epoch shift: primary positions
// moved to J2016 (single stars) as did HIP2-fit secondaries (24.75 yr),
// rotating a few tangent-projection anchors / repositioning baked
// offsets enough for two borderline pairs to cross the half-a threshold.
// The 568 → 559 step is the Stage 5 physical-boundness optical gate +
// Sirius B astrometry exclusion: line-of-sight optical doubles drop out
// (no longer baked), and Sirius B's blended DR3 solution no longer bakes
// a disagreeing placement.
// The 559 → 555 step is Stage-2 binding-integrity enforcement: unbinding
// geometry-refuted sibling bindings re-homes a handful of pairs off the
// wrong anchor, so their baked placement no longer disagrees with R(epoch).
// The 564 → 563 step is the ORB6 slice widening + HIP-xwalk magnitude
// gate: a corrected period/binding brings one pair's R(epoch) back into
// agreement with its baked placement.
// The 563 → 566 step is the HD-keyed identifier backfill: three HD-only
// AT-HYG primaries (ξ UMa, ξ Sco, HD 75632) became addressable, so their
// long-period ORB6 visual pairs render for the first time and enter the
// sweep with athyg-print baked placements — new coverage, not placement
// regressions.
// The 566 → 1498 step is the blank-components rescue tier: ~1.7k
// previously-dropped WDS pairs (Antares and other studied binaries with
// an ORB6 orbit or SIMBAD xid) now decompose, and their WDS static
// placement disagrees with the orbit-derived R(epoch) by >0.5·a — new
// coverage entering the sweep, not a regression on existing pairs.
// Curating these baked placements toward R(epoch) is follow-up work.
const KNOWN_BAKED_VS_ELEMENTS_DISAGREEMENTS = 1498;

// ---- Corpus row types ----------------------------------------------------

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
  const record = lookupByRef(catalog, ref);
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

  describe('space-motion velocity — no artifact survives into binaries.bin members', () => {
    // Full systemic-velocity coherence for binaries.bin's authoritative
    // pairing (incl. Tier-3 static) is stellata-zau1 (deferred — it must run
    // in the binaries pipeline where the pairing is known). What the catalog
    // build DOES guarantee and this pins: every pair member's baked velocity
    // is physically sane (the sanity clamp caught every PM×distance
    // artifact), so no member streaks under the epoch-advance.
    it('every pair member is below the velocity sanity ceiling', () => {
      let checked = 0;
      for (const rel of BINARIES!.relations) {
        for (const idx of [rel.primaryIdx, rel.secondaryIdx]) {
          const r = catalog.record(idx);
          checked++;
          const speed = Math.hypot(r.vx, r.vy, r.vz);
          expect(
            speed,
            `pair member #${idx} (${r.name ?? r.i}) velocity ${(speed / KM_S_TO_PC_YR).toFixed(0)} km/s exceeds the sanity ceiling`,
          ).toBeLessThanOrEqual(VELOCITY_SANITY_CEILING_PC_YR);
        }
      }
      expect(checked, 'expected pair members in binaries.bin').toBeGreaterThan(0);
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

  describe('runtime render geometry — elements-alone offset', () => {
    it('every cached relation renders on its orbit: |baseDiffPc + ΔR(t)| ∈ [a(1−e), a(1+e)]·AU_PC', () => {
      // The regression that would have caught the displaced-centre bug:
      // sweep every relation the runtime caches from the shipped
      // artifacts and confirm the rendered relative offset never leaves
      // the orbit shell. baseDiffPc + ΔR = R(t) is an exact float64
      // identity after the fix (projection is an isometry), so the bound
      // holds to float64 epsilon regardless of the baked placement.
      const abs = catalogAbsolutePositions(catalog);
      const caches = buildOrbitRelationCaches(BINARIES!, abs);
      expect(caches.length, 'expected cached Kepler relations from binaries.bin').toBeGreaterThan(0);
      const PHASES = 48;
      const REL_EPS = 1e-6;
      const sys = { x: 0, y: 0, z: 0 };
      let worst = 0;
      let worstLabel = '';
      for (const rc of caches) {
        const r = BINARIES!.relations[rc.relationIdx];
        const pBase = r.primaryIdx * 3;
        sys.x = abs[pBase]; sys.y = abs[pBase + 1]; sys.z = abs[pBase + 2];
        const lo = rc.elements.a * (1 - rc.elements.e) * AU_PC;
        const hi = rc.elements.a * (1 + rc.elements.e) * AU_PC;
        for (let k = 0; k < PHASES; k++) {
          const tJd = rc.elements.T + (rc.elements.P * k) / PHASES;
          const d = evaluateOrbitRelationDeltaPc(rc, tJd, sys);
          const mag = Math.hypot(
            rc.baseDiffPc.x + d.x, rc.baseDiffPc.y + d.y, rc.baseDiffPc.z + d.z,
          );
          const err = Math.max((lo - mag) / hi, (mag - hi) / hi);
          if (err > worst) { worst = err; worstLabel = `secondaryIdx ${r.secondaryIdx}, phase ${k}`; }
        }
      }
      expect(worst, `worst relative bound violation at ${worstLabel}`).toBeLessThan(REL_EPS);
    });

    it.each([{ label: 'focal = Aa (primary)', kind: 'primary' as const },
             { label: 'focal = Ab (secondary)', kind: 'secondary' as const }])(
      'Algol Aa,Ab walk stays on-orbit through a period ($label)',
      ({ kind }) => {
        // Full BinaryOrbitField walk against the real buffers with the
        // floating origin parked on the primary (the focus regime — local
        // slots sit near 0 so the pair offset reads at full float32
        // precision). Focus exempts the LOD gates, so Kepler runs at every
        // phase and the rendered separation must track the orbit.
        const primary = lookupByHip(catalog, 14576);
        const secondary = lookupByName(catalog, 'Algol Ab');
        expect(primary, 'Algol Aa (HIP 14576) in catalog.bin').not.toBeNull();
        expect(secondary, 'Algol Ab in catalog.bin').not.toBeNull();
        if (!primary || !secondary) return;
        const relation = findRelation(secondary.i);
        expect(relation, 'Algol Aa,Ab relation in binaries.bin').not.toBeNull();
        if (!relation) return;

        const abs = catalogAbsolutePositions(catalog);
        const local = new Float32Array(abs);
        const suppress = new Float32Array(catalog.count);
        const field = new BinaryOrbitField({
          binaries: BINARIES!,
          absolutePositions: abs,
          absoluteMags: catalogAbsoluteMags(catalog),
          localPositions: local,
          compositeSuppress: suppress,
          iPositionAttr: new THREE.InstancedBufferAttribute(local, 3),
          iCompositeSuppressAttr: new THREE.InstancedBufferAttribute(suppress, 1),
        });
        field.recenter(new THREE.Vector3(primary.x, primary.y, primary.z));
        const focalIdx = kind === 'primary' ? primary.i : secondary.i;
        const camera = new THREE.Vector3(1e-4, 0, 0);
        const pBase = relation.primaryIdx * 3;
        const sBase = secondary.i * 3;
        const lo = relation.aAU * (1 - relation.e);
        const hi = relation.aAU * (1 + relation.e);
        // float32 + the inner Aa1,Aa2 pair's ~0.03 AU wobble on the shared primary.
        const TOL_AU = 0.05;
        for (let k = 0; k < 48; k++) {
          const tJd = relation.tJd + (relation.pDays * k) / 48;
          field.update((tJd - 2440587.5) * 86400, camera, 15, 1080, 0.8, focalIdx);
          const sepAu = Math.hypot(
            local[sBase] - local[pBase],
            local[sBase + 1] - local[pBase + 1],
            local[sBase + 2] - local[pBase + 2],
          ) / AU_PC;
          expect(sepAu, `phase ${k}: rendered sep ${sepAu.toFixed(3)} AU outside [${lo.toFixed(3)}, ${hi.toFixed(3)}]`)
            .toBeGreaterThanOrEqual(lo - TOL_AU);
          expect(sepAu).toBeLessThanOrEqual(hi + TOL_AU);
        }
      },
    );

    it('WDS baked placement vs elements-alone R(epoch): disagreements stay at the known count (ratchet)', () => {
      const abs = catalogAbsolutePositions(catalog);
      const caches = buildOrbitRelationCaches(BINARIES!, abs);
      const disagreeing = new Set<number>();
      for (const rc of caches) {
        if (rc.tier !== 1) continue;
        const r = BINARIES!.relations[rc.relationIdx];
        const pBase = r.primaryIdx * 3, sBase = r.secondaryIdx * 3;
        const bx = abs[sBase] - abs[pBase];
        const by = abs[sBase + 1] - abs[pBase + 1];
        const bz = abs[sBase + 2] - abs[pBase + 2];
        if (bx === 0 && by === 0 && bz === 0) continue; // collocated bake — no measured placement
        const corr = Math.hypot(
          rc.baseDiffPc.x - bx, rc.baseDiffPc.y - by, rc.baseDiffPc.z - bz,
        );
        if (corr > 0.5 * rc.elements.a * AU_PC) disagreeing.add(r.secondaryIdx);
      }
      // The two showcase pairs must surface: quadrant ambiguity (Algol Aa,Ab)
      // and the tangent-only bake missing R(epoch)'s radial term (Eta Ori Aa,Ab).
      const algolAb = lookupByName(catalog, 'Algol Ab');
      const etaOriAb = lookupByName(catalog, 'Eta Ori Ab');
      expect(algolAb, 'Algol Ab in catalog.bin').not.toBeNull();
      expect(etaOriAb, 'Eta Ori Ab in catalog.bin').not.toBeNull();
      expect(disagreeing.has((algolAb as CatalogRecord).i), 'Algol Aa,Ab expected in the disagreement set').toBe(true);
      expect(disagreeing.has((etaOriAb as CatalogRecord).i), 'Eta Ori Aa,Ab expected in the disagreement set').toBe(true);
      expect(
        disagreeing.size,
        `non-collocated Tier-1 pairs where |bakedDiff − R(epoch)| > 0.5·a. ` +
        `Above the pin = a new disagreement (curate the baked placement or re-confirm the orbit); ` +
        `below = placements curated toward R(epoch) — drop the pin to the new count.`,
      ).toBe(KNOWN_BAKED_VS_ELEMENTS_DISAGREEMENTS);
    });
  });
});

describe.runIf(FIXTURES_READY)('eclipsing-binary variability honesty', () => {
  it('every VAR_TYPE_ECLIPSING record carries FLAG_BINARY_PRIMARY (wings, not a ring)', () => {
    let eclipsers = 0;
    const missing: number[] = [];
    for (const r of catalog.records()) {
      if (r.varType !== VAR_TYPE_ECLIPSING) continue;
      eclipsers++;
      if ((r.flags & FLAG_BINARY_PRIMARY) === 0) missing.push(r.i);
    }
    expect(eclipsers, 'catalog carries eclipsing binaries').toBeGreaterThan(0);
    expect(
      missing,
      `eclipsing records missing the wings bit (indices): ${missing.slice(0, 10).join(', ')}`,
    ).toEqual([]);
  });

  it('Algol surfaces as an eclipsing multi-star (varType eclipsing + wings bit)', () => {
    const algol = lookupByName(catalog, 'Algol');
    expect(algol, 'Algol in catalog.bin').not.toBeNull();
    const a = algol as CatalogRecord;
    expect(a.varType).toBe(VAR_TYPE_ECLIPSING);
    expect(a.flags & FLAG_BINARY_PRIMARY).not.toBe(0);
  });
});

describe.runIf(FIXTURES_READY)('blended-sibling slot minting (Acrux B showcase)', () => {
  it('mints Acrux B off the Stage-5-rejected AB geometry and anchors BC on it', () => {
    const a = lookupByName(catalog, 'Acrux');
    const b = lookupByName(catalog, 'Acrux B');
    expect(a, 'Acrux in catalog.bin').not.toBeNull();
    expect(b, 'Acrux B in catalog.bin').not.toBeNull();
    if (a === null || b === null) return;
    // 3.5″ off A at A's ~99 pc — a genuine V≈1.6 star, never collocated.
    const sepAu = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * AU_PER_PC;
    const expectedAu = 3.5 * distancePc(a);
    expect(sepAu).toBeGreaterThan(expectedAu * 0.95);
    expect(sepAu).toBeLessThan(expectedAu * 1.05);
    expect(b.flags & FLAG_BINARY_COMPANION_ONLY).not.toBe(0);
    // Both wide pairs render, each from its own true primary: A→C and B→C.
    const priIdx = new Set(
      BINARIES!.relations.filter(
        r => r.primaryIdx === a.i || r.primaryIdx === b.i,
      ).map(r => r.primaryIdx),
    );
    expect(priIdx.has(a.i), 'A→C relation emits').toBe(true);
    expect(priIdx.has(b.i), 'B→C relation emits (re-homed onto B)').toBe(true);
  });
});

describe.runIf(FIXTURES_READY)('CCDM optical-double suppression', () => {
  const winged = (hip: number) => {
    const r = lookupByHip(catalog, hip);
    expect(r, `HIP ${hip} in catalog.bin`).not.toBeNull();
    return ((r as CatalogRecord).flags & FLAG_BINARY_PRIMARY) !== 0;
  };

  it('keeps wings on physical pairs whose CCDM group also holds a wide optical sibling', () => {
    // η Cas (Achird A) and β¹ Cyg (Albireo) are the bead's regression
    // guards: both are genuine close binaries in multiples.tsv, so the
    // physical-evidence gate keeps their wings even though their CCDM
    // groups contain a wide line-of-sight sibling.
    expect(winged(3821), 'η Cas / Achird A').toBe(true);
    expect(winged(95947), 'β¹ Cyg / Albireo').toBe(true);
  });

  it('suppresses wings on a genuinely optical CCDM double (ν¹ CMa)', () => {
    // ν¹ CMa (HIP 31564, ~87 pc) shares a CCDM identifier with HIP 31560
    // (~102 pc) — a line-of-sight optical pair from the ν CMa asterism,
    // >1 pc apart at Gaia-quality distances with no bound companion.
    expect(winged(31564), 'ν¹ CMa optical double').toBe(false);
  });
});

describe.runIf(FIXTURES_READY)('renderable-companion wings', () => {
  const winged = (hip: number) => {
    const r = lookupByHip(catalog, hip);
    expect(r, `HIP ${hip} in catalog.bin`).not.toBeNull();
    return ((r as CatalogRecord).flags & FLAG_BINARY_PRIMARY) !== 0;
  };

  it('wings a wide physical pair the geometric/CCDM/eclipsing passes miss, not an optical double', () => {
    // 16 Cyg A: promoted placement exceeds the 0.005 pc geometric cell,
    // not CCDM C/G/O, not eclipsing — wingRenderablePrimaries recovers it.
    expect(winged(96895), '16 Cygni A / HIP 96895').toBe(true);
    // Canopus's sole WDS companion is a 999.9-overflow optical double.
    // With the overflow sentinel nulled at parse it no longer projects to
    // a spurious 0.46 pc placement, so the companion drops at promotion —
    // an optical pair must not earn a physical-companion glyph.
    expect(winged(30438), 'Canopus / HIP 30438').toBe(false);
  });

  it('every system rendering a companion in binaries.bin carries the wings bit', () => {
    // Ground truth for the TS wingRenderablePrimaries mirror: binaries.bin IS
    // the set of rendered pairs, and the wings contract is one glyph per
    // physical system on the brightest participant. A "system" is the union of
    // (a) catalog rows sharing a WDS root — one glyph covers a root's disjoint
    // top-level pairs — and (b) the two ends of every rendered pair, which ties
    // in promoted companions whose synth key was minted under a sibling WDS
    // designation. Assert every component that renders a pair carries the bit
    // somewhere. A gap means a system renders a companion with no glyph — the
    // failure mode the mirror's resolve_idx + synth retries exist to prevent —
    // and catches drift in either the TS mirror or the Python resolver.
    const parent = new Map<number, number>();
    const add = (x: number) => { if (!parent.has(x)) parent.set(x, x); };
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      for (let c = x; c !== r;) { const n = parent.get(c)!; parent.set(c, r); c = n; }
      return r;
    };
    const union = (a: number, b: number) => { add(a); add(b); parent.set(find(a), find(b)); };

    // (a) WDS-root co-membership. Id-bearing rows resolve through catalog.bin's
    // own byGaia → byHip chain (a member's catalog gaia can differ from the
    // WDS-listed one, leaving HIP the only hit); promoted companions carry no
    // id (a blended secondary shares its primary's gaia) so they come from the
    // build's own bySynth artifact, whose `synth-<wds_root>-<comp>` key names
    // the root. Both are independent of the wings resolver under test.
    const rootToIndices = new Map<string, number[]>();
    const bindRoot = (root: string, idx: number) => {
      const g = rootToIndices.get(root);
      if (g) g.push(idx); else rootToIndices.set(root, [idx]);
    };
    for (const row of readMultiplesTsv(MULTIPLES_TSV)) {
      const root = wdsRootOf(row.systemId);
      if (root === null) continue;
      let rec = row.gaiaSourceId ? lookupByGaiaSourceId(catalog, row.gaiaSourceId) : null;
      if (rec === null && row.hip !== null && row.hip > 0) rec = lookupByHip(catalog, row.hip);
      if (rec !== null) bindRoot(root, rec.i);
    }
    const bySynth = (JSON.parse(readFileSync(ROW_INDEX_MAP, 'utf-8')) as
      { bySynth: Record<string, number> }).bySynth;
    for (const [key, idx] of Object.entries(bySynth)) {
      const body = key.slice('synth-'.length);
      const dash = body.lastIndexOf('-');
      if (dash > 0) bindRoot(body.slice(0, dash), idx);
    }
    for (const idxs of rootToIndices.values()) {
      for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i]);
    }

    // (b) rendered-pair connectivity. Roots are read AFTER every union so no
    // component id goes stale under a later merge.
    for (const rel of BINARIES!.relations) union(rel.primaryIdx, rel.secondaryIdx);
    const renders = new Set<number>();
    for (const rel of BINARIES!.relations) renders.add(find(rel.primaryIdx));

    const wingedComponents = new Set<number>();
    for (const idx of parent.keys()) {
      if ((catalog.record(idx).flags & FLAG_BINARY_PRIMARY) !== 0) wingedComponents.add(find(idx));
    }
    const unwinged: number[][] = [];
    for (const root of renders) {
      if (wingedComponents.has(root)) continue;
      unwinged.push([...parent.keys()].filter((i) => find(i) === root));
    }
    expect(
      unwinged,
      `systems that render a companion but carry no wings bit on any member ` +
      `(catalog indices):\n${unwinged.slice(0, 10).map((s) => `{${s.join(', ')}}`).join('\n')}`,
    ).toEqual([]);
  });
});

function buildFirstSeenHipIndex(): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of catalog.records()) {
    if (r.hip !== null && !m.has(r.hip)) m.set(r.hip, r.i);
  }
  return m;
}

function catalogAbsolutePositions(cat: Catalog): Float32Array {
  const abs = new Float32Array(cat.count * 3);
  for (const r of cat.records()) {
    abs[r.i * 3] = r.x; abs[r.i * 3 + 1] = r.y; abs[r.i * 3 + 2] = r.z;
  }
  return abs;
}

function catalogAbsoluteMags(cat: Catalog): Float32Array {
  const mags = new Float32Array(cat.count);
  for (const r of cat.records()) mags[r.i] = r.absmag;
  return mags;
}
