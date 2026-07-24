// Tier-A regression harness driving per-row assertions over
// known-stars.tsv + system-pair-topology.tsv against public/catalog.bin
// and data/binaries/multiples.tsv.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { describe, it, beforeAll, expect } from 'vitest';
import {
  classifyFromSimbad,
  encodeAmpUnits,
  encodePeriodUnits,
  MULTIPLICITY_RESOLVED,
  MULTIPLICITY_SINGLE,
  MULTIPLICITY_UNRESOLVED,
  SPECTRAL_UNKNOWN,
  VAR_TYPE_ECLIPSING,
  VAR_TYPE_OTHER,
  VAR_TYPE_PULSATING,
  VAR_TYPE_UNKNOWN,
  VAR_TYPE_MIRA,
  VAR_TYPE_SEMIREGULAR,
  VAR_TYPE_CEPHEID,
  VAR_TYPE_RR_LYRAE,
  VAR_TYPE_DSCT,
  type SpectralInfo,
} from './catalog-pure';
import {
  DEFAULT_CATALOG_MANIFEST,
  type Catalog,
  type CatalogRecord,
  distancePc,
  loadCatalog,
  lookupByHip,
  lookupByGaiaSourceId,
  lookupByName,
  lookupByRef,
} from './catalog-lookup';
import {
  nonEmpty,
  parseFloatOrNull,
  parseIntOrNull,
  parseOptionalRef,
  type RecordRef,
} from './corpus-tsv';
import { AU_PER_PC } from '../../src/client/util/astronomy-constants';
import { REPO_ROOT } from '../util/paths';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWN_STARS_TSV = resolve(__dirname, 'known-stars.tsv');
const TOPOLOGY_TSV = resolve(__dirname, 'system-pair-topology.tsv');
const MULTIPLES_TSV = resolve(REPO_ROOT, 'data/binaries/multiples.tsv');

// The corpus needs public/catalog.bin and data/binaries/multiples.tsv —
// the first is generated (gitignored, ~24 MB), the second is LFS-tracked.
// CI's plain `pnpm test` job pulls neither, so the suite skips itself with
// a console hint when either is missing. The .github/workflows/test.yml
// `build-catalog` job runs the full suite after `pnpm run build:catalog`
// + LFS pull, so the assertions execute against real data on every PR.
const CATALOG_BIN_PRESENT = existsSync(DEFAULT_CATALOG_MANIFEST);
const MULTIPLES_PRESENT = existsSync(MULTIPLES_TSV);
const FIXTURES_READY = CATALOG_BIN_PRESENT && MULTIPLES_PRESENT;
if (!FIXTURES_READY) {
  // eslint-disable-next-line no-console
  console.warn(
    `[known-stars] skipping corpus assertions — ` +
    `catalog.bin ${CATALOG_BIN_PRESENT ? 'present' : 'MISSING'}, ` +
    `multiples.tsv ${MULTIPLES_PRESENT ? 'present' : 'MISSING'}. ` +
    `Run \`pnpm run build:catalog\` (with LFS pulled) to exercise this suite.`,
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
const CI_TOLERANCE = 0.03;              // primary_ci — float32 + Ballesteros round-trip headroom
const RADIUS_REL_TOLERANCE = 0.10;      // primary_radius_rsun default, per docs/science-stellar-modelling.md § Physical radius

// ---- TSV row types -----------------------------------------------------

interface CorpusCompanion {
  letter: string;
  hip: number | null;
  gaiaSourceId: string | null;
  absmag: number;
  /** Optional pin: companion's catalog.bin xyz must sit within this
   *  many AU of the primary's catalog.bin xyz. Regression-guards
   *  synth-promoted secondaries whose tangent-projected position
   *  depends on companion-promotion's route-based collocation
   *  detector. */
  maxSepAuFromPrimary: number | null;
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
  primaryCi: number | null;
  primaryRadiusRsun: number | null;
  radiusRelTol: number | null;
  companions: CorpusCompanion[];
  orbitalPeriodDays: number | null;
  varType: keyof typeof VAR_TYPE_TOKENS | null;
  varPeriodDays: number | null;
  varAmpMag: number | null;
  tier: CorpusTier;
  notesSource: string;
}

// Which distance-refinement layer a row regression-guards. Enum-constrained
// in the TSV and rejected at load on an unknown value, so a mistyped tag
// can't silently drop a row out of its partition.
const CORPUS_TIERS = [
  'standard',
  'bj-override',
  'bj-no-degradation',
  'lmc-kinematic-snap',
] as const;
type CorpusTier = (typeof CORPUS_TIERS)[number];

const VAR_TYPE_TOKENS = {
  none: VAR_TYPE_UNKNOWN,
  pulsating: VAR_TYPE_PULSATING,
  eclipsing: VAR_TYPE_ECLIPSING,
  other: VAR_TYPE_OTHER,
  mira: VAR_TYPE_MIRA,
  semiregular: VAR_TYPE_SEMIREGULAR,
  cepheid: VAR_TYPE_CEPHEID,
  rrlyrae: VAR_TYPE_RR_LYRAE,
  dsct: VAR_TYPE_DSCT,
} as const;

interface TopologyRow {
  wdsId: string;
  systemName: string;
  allowedPairs: string[];
  primaryRef: RecordRef | null;
  secondaryRef: RecordRef | null;
  minSepPc: number | null;
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

function parseCompanions(cell: string): CorpusCompanion[] {
  const trimmed = cell.trim();
  if (!trimmed) return [];
  return trimmed.split(';').map(chunk => {
    const parts = chunk.split(':');
    if (parts.length !== 4 && parts.length !== 5) {
      throw new Error(`malformed companion tuple "${chunk}" — expected letter:hip:gaia_id:absmag[:max_sep_au]`);
    }
    const [letter, hipStr, gaiaStr, absmagStr, sepStr] = parts;
    const absmag = Number(absmagStr);
    if (!Number.isFinite(absmag)) {
      throw new Error(`companion "${chunk}" — absmag "${absmagStr}" is not a finite number`);
    }
    let maxSepAuFromPrimary: number | null = null;
    if (sepStr !== undefined && sepStr.trim()) {
      const v = Number(sepStr);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`companion "${chunk}" — max_sep_au "${sepStr}" must be a non-negative number`);
      }
      maxSepAuFromPrimary = v;
    }
    return {
      letter: letter.trim(),
      hip: parseIntOrNull(hipStr),
      gaiaSourceId: nonEmpty(gaiaStr),
      absmag,
      maxSepAuFromPrimary,
    };
  });
}

function parseCorpusRows(text: string): CorpusRow[] {
  const rows = parse(text, {
    delimiter: '\t',
    columns: true,
    skip_empty_lines: true,
    comment: '#',
    trim: false,
  }) as Record<string, string>[];

  return rows.map((row, i) => {
    const name = (row.system_name ?? '').trim();
    const required = (col: string): number => {
      const v = parseFloatOrNull(row[col] ?? '');
      if (v === null) {
        throw new Error(`row ${i + 1} (${name}): missing required numeric column "${col}"`);
      }
      return v;
    };
    const varTypeRaw = nonEmpty(row.var_type);
    if (varTypeRaw !== null && !(varTypeRaw in VAR_TYPE_TOKENS)) {
      throw new Error(
        `row ${i + 1} (${name}): var_type "${varTypeRaw}" — expected one of ${Object.keys(VAR_TYPE_TOKENS).join(' / ')}`,
      );
    }
    const tierRaw = nonEmpty(row.tier);
    if (tierRaw === null || !(CORPUS_TIERS as readonly string[]).includes(tierRaw)) {
      throw new Error(
        `row ${i + 1} (${name}): tier "${row.tier ?? ''}" — expected one of ${CORPUS_TIERS.join(' / ')}`,
      );
    }
    return {
      wdsId: nonEmpty(row.wds_id),
      systemName: name,
      primaryHip: parseIntOrNull(row.primary_hip),
      primaryGaiaSourceId: nonEmpty(row.primary_gaia_source_id),
      primaryDistancePc: required('primary_distance_pc'),
      primaryDistancePcErr: required('primary_distance_pc_err'),
      primaryAbsmag: required('primary_absmag'),
      primarySpectral: (row.primary_spectral ?? '').trim(),
      primaryCi: parseFloatOrNull(row.primary_ci),
      primaryRadiusRsun: parseFloatOrNull(row.primary_radius_rsun),
      radiusRelTol: parseFloatOrNull(row.radius_rel_tol),
      companions: parseCompanions(row.companions ?? ''),
      orbitalPeriodDays: parseFloatOrNull(row.orbital_period_days),
      varType: varTypeRaw as CorpusRow['varType'],
      varPeriodDays: parseFloatOrNull(row.var_period_days),
      varAmpMag: parseFloatOrNull(row.var_amp_mag),
      tier: tierRaw as CorpusTier,
      notesSource: (row.notes_source ?? '').trim(),
    };
  });
}

function loadTopologySync(): TopologyRow[] {
  const text = readFileSync(TOPOLOGY_TSV, 'utf-8');
  const rows = parse(text, {
    delimiter: '\t',
    columns: true,
    skip_empty_lines: true,
    comment: '#',
    trim: false,
  }) as Record<string, string>[];

  return rows.map((row, i) => {
    const name = (row.system_name ?? '').trim() || `row ${i + 1}`;
    const allowedPairs = (row.allowed_pairs ?? '')
      .split(';')
      .map(p => p.trim())
      .filter(p => p.length > 0);
    if (allowedPairs.length === 0) {
      throw new Error(`${name}: allowed_pairs must list at least one pair`);
    }
    const primaryRef = parseOptionalRef(row.primary_ref, name, 'primary_ref');
    const secondaryRef = parseOptionalRef(row.secondary_ref, name, 'secondary_ref');
    const minSepPc = parseFloatOrNull(row.min_sep_pc);
    const sepPinParts = [primaryRef, secondaryRef, minSepPc].filter(p => p !== null).length;
    if (sepPinParts !== 0 && sepPinParts !== 3) {
      throw new Error(`${name}: primary_ref, secondary_ref, min_sep_pc must be set together or not at all`);
    }
    return {
      wdsId: (row.wds_id ?? '').trim(),
      systemName: name,
      allowedPairs,
      primaryRef,
      secondaryRef,
      minSepPc,
      notesSource: (row.notes_source ?? '').trim(),
    };
  });
}

function loadMultiplesIndexSync(): Map<string, MultiplesRow[]> {
  const text = readFileSync(MULTIPLES_TSV, 'utf-8');
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

// ---- Test-collection-time fixtures --------------------------------------
//
// Corpus + multiples load synchronously at module top so `it.each` can
// enumerate per-row tests at collection time (vitest collects tests
// before beforeAll runs). The TSV is always in the repo; multiples.tsv
// is LFS-tracked and gated by FIXTURES_READY. catalog.bin stays async
// because it's a 24 MB binary read.

const CORPUS: CorpusRow[] = parseCorpusRows(readFileSync(KNOWN_STARS_TSV, 'utf-8'));
const TOPOLOGY: TopologyRow[] = loadTopologySync();
const MULTIPLES_BY_WDS: Map<string, MultiplesRow[]> = FIXTURES_READY
  ? loadMultiplesIndexSync()
  : new Map();

const ofTier = (tier: CorpusTier): CorpusRow[] => CORPUS.filter(r => r.tier === tier);

const SINGLES = CORPUS.filter(r => r.companions.length === 0 && r.tier === 'standard');
const BINARIES = CORPUS.filter(r => r.companions.length > 0);
const ORBITED = CORPUS.filter(r => r.orbitalPeriodDays !== null);
const VAR_PINNED = CORPUS.filter(
  r => r.varType !== null || r.varPeriodDays !== null || r.varAmpMag !== null,
);
const BJ_OVERRIDES = ofTier('bj-override');
const BJ_GUARDS = ofTier('bj-no-degradation');
const LMC_SNAPS = ofTier('lmc-kinematic-snap');

let catalog: Catalog;
const multiplesByWds = MULTIPLES_BY_WDS;

beforeAll(async () => {
  // The tier-column cases below run fixture-free; only the corpus
  // assertions need catalog.bin, so loading it must stay gated too.
  if (FIXTURES_READY) catalog = await loadCatalog();
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

  if (row.primaryCi !== null) {
    const ciDiff = Math.abs(record.ci - row.primaryCi);
    expect(
      ciDiff,
      `${row.systemName}: expected ci ${row.primaryCi}, got ${record.ci.toFixed(3)} (diff ${ciDiff.toFixed(3)} > tolerance ${CI_TOLERANCE})`,
    ).toBeLessThanOrEqual(CI_TOLERANCE);
  }
  if (row.primaryRadiusRsun !== null) {
    const relTol = row.radiusRelTol ?? RADIUS_REL_TOLERANCE;
    const rel = Math.abs(record.physicalRadius - row.primaryRadiusRsun) / row.primaryRadiusRsun;
    expect(
      rel,
      `${row.systemName}: expected physicalRadius ${row.primaryRadiusRsun} R☉, got ${record.physicalRadius.toFixed(3)} (relative diff ${(rel * 100).toFixed(1)}% > ${(relTol * 100).toFixed(0)}%)`,
    ).toBeLessThanOrEqual(relTol);
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

function assertCompanion(
  row: CorpusRow,
  companion: CorpusCompanion,
  primary: CatalogRecord,
): void {
  // Two assertion paths. Real-ID companions (Sirius B-shape — own
  // gaia / hip in multiples.tsv) pin against multiples.tsv columns;
  // the corpus absmag is the per-component upstream value.
  // Synth-promoted companions (Algol Ab-shape — opt into the
  // maxSepAuFromPrimary pin) pin against catalog.bin via lookupByName
  // because multiples carries inherited values that don't match the
  // post-imputation record the runtime sees.
  if (companion.maxSepAuFromPrimary !== null) {
    assertSynthPromotedCompanion(row, companion, primary);
    return;
  }
  assertMultiplesCompanion(row, companion);
}

function assertMultiplesCompanion(
  row: CorpusRow,
  companion: CorpusCompanion,
): void {
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

function assertSynthPromotedCompanion(
  row: CorpusRow,
  companion: CorpusCompanion,
  primary: CatalogRecord,
): void {
  // composeCompanionName in scripts/catalog/companion-promotion.ts emits
  // `${base} ${canonicalComp}` where base is the primary's name cell or
  // resolveCompanionNameBase's `HIP <n>` fallback for name-less primaries
  // (AR Cas) — reconstruct the same shape so a naming drift on either
  // side surfaces here as a missing-lookup failure.
  const base = primary.name
    ?? (row.primaryHip !== null ? `HIP ${row.primaryHip}` : null);
  const companionName = base !== null
    ? `${base} ${companion.letter}`
    : null;
  const companionRecord = companionName !== null
    ? lookupByName(catalog, companionName)
    : null;
  expect(
    companionRecord,
    `${row.systemName} companion ${companion.letter}: lookupByName("${companionName}") returned null — companion missing from catalog.bin or naming convention drifted`,
  ).not.toBeNull();
  if (companionRecord === null) return;
  const absmagDiff = Math.abs(companionRecord.absmag - companion.absmag);
  expect(
    absmagDiff,
    `${row.systemName} companion ${companion.letter}: expected absmag ${companion.absmag}, catalog.bin has ${companionRecord.absmag.toFixed(3)} (diff ${absmagDiff.toFixed(3)} > tolerance ${ABSMAG_TOLERANCE})`,
  ).toBeLessThanOrEqual(ABSMAG_TOLERANCE);
  const sepPc = Math.hypot(
    companionRecord.x - primary.x,
    companionRecord.y - primary.y,
    companionRecord.z - primary.z,
  );
  const sepAu = sepPc * AU_PER_PC;
  expect(
    sepAu,
    `${row.systemName} companion ${companion.letter}: catalog.bin xyz sits ${sepAu.toFixed(2)} AU from primary, expected ≤ ${companion.maxSepAuFromPrimary} AU. Companion-promotion's route-based collocation detector likely regressed — secondaries with athyg_position route must tangent-project from the catalog anchor.`,
  ).toBeLessThanOrEqual(companion.maxSepAuFromPrimary as number);
}

function lookupPrimary(row: CorpusRow): CatalogRecord {
  // Sol carries no HIP and no Gaia source_id — the one record
  // addressable only by proper name.
  if (row.primaryHip === null && row.primaryGaiaSourceId === null) {
    const byName = lookupByName(catalog, row.systemName);
    expect(
      byName,
      `${row.systemName}: identifier-less row and lookupByName("${row.systemName}") returned null`,
    ).not.toBeNull();
    return byName as CatalogRecord;
  }
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

describe('corpus tier column', () => {
  // Fixture is the real header + first data row with the tier cell
  // swapped, so the column set can't drift out from under these cases.
  function withTier(tier: string): string {
    const lines = readFileSync(KNOWN_STARS_TSV, 'utf-8')
      .split('\n')
      .filter(l => l.length > 0 && !l.startsWith('#'));
    const cells = lines[1].split('\t');
    cells[lines[0].split('\t').indexOf('tier')] = tier;
    return `${lines[0]}\n${cells.join('\t')}\n`;
  }

  it('accepts every declared tier token', () => {
    for (const tier of CORPUS_TIERS) {
      expect(parseCorpusRows(withTier(tier))[0].tier).toBe(tier);
    }
  });

  it('rejects a mistyped tier rather than dropping the row from its partition', () => {
    expect(() => parseCorpusRows(withTier('B-J Override'))).toThrow(/tier "B-J Override"/);
  });

  it('rejects a blank tier', () => {
    expect(() => parseCorpusRows(withTier(''))).toThrow(/tier ""/);
  });
});

describe.runIf(FIXTURES_READY)('known-stars corpus', () => {
  it('contains at least one row', () => {
    expect(CORPUS.length).toBeGreaterThan(0);
  });

  it('every distance-refinement tier has at least one row', () => {
    for (const tier of CORPUS_TIERS) {
      expect(ofTier(tier).length, `no corpus row carries tier=${tier}`).toBeGreaterThan(0);
    }
  });

  it('every row has a notes_source', () => {
    const missing = CORPUS.filter(r => !r.notesSource);
    expect(
      missing,
      `rows missing notes_source: ${missing.map(r => r.systemName).join(', ')}`,
    ).toHaveLength(0);
  });

  it('every row sets a primary identifier (HIP or Gaia) unless name-addressed (Sol)', () => {
    const orphans = CORPUS.filter(
      r => r.primaryHip === null && r.primaryGaiaSourceId === null
        && r.systemName !== 'Sol',
    );
    expect(
      orphans,
      `rows with no HIP and no Gaia source_id: ${orphans.map(r => r.systemName).join(', ')}`,
    ).toHaveLength(0);
  });

  describe('single stars', () => {
    it.each(SINGLES)('$systemName', (row) => {
      const record = lookupPrimary(row);
      assertPrimary(row, record);
    });
  });

  describe('visual binaries', () => {
    it.each(BINARIES)('$systemName — primary + companions', (row) => {
      const record = lookupPrimary(row);
      assertPrimary(row, record);
      for (const companion of row.companions) {
        assertCompanion(row, companion, record);
      }
    });

    // catalog.bin's `periodDays` field carries GCVS variability periods;
    // ORB6 / Gaia NSS orbital periods land in multiples.tsv (P_days)
    // via build-binaries.py.
    it.each(ORBITED)('$systemName — orbital period matches multiples.tsv P_days', (row) => {
      expect(
        row.wdsId,
        `${row.systemName}: rows with orbital_period_days must set wds_id (multiples.tsv lookup key)`,
      ).not.toBeNull();
      const bucket = multiplesByWds.get(row.wdsId as string) ?? [];
      const expected = row.orbitalPeriodDays as number;
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
    });
  });

  describe('multiplicity status (v9 field)', () => {
    it('64 Vir (HIP 65241) pins unresolved — SIMBAD otype ** with nothing in WDS/CCDM/NSS', () => {
      const r = lookupByHip(catalog, 65241);
      expect(r).not.toBeNull();
      expect(r!.multiplicityStatus).toBe(MULTIPLICITY_UNRESOLVED);
    });

    it('Almach (HIP 9640, γ And multiple) pins resolved', () => {
      const r = lookupByHip(catalog, 9640);
      expect(r).not.toBeNull();
      expect(r!.multiplicityStatus).toBe(MULTIPLICITY_RESOLVED);
    });

    it("Barnard's Star (HIP 87937) pins single", () => {
      const r = lookupByHip(catalog, 87937);
      expect(r).not.toBeNull();
      expect(r!.multiplicityStatus).toBe(MULTIPLICITY_SINGLE);
    });

    it('unresolved population clears the spectroscopic-binary floor', () => {
      let unresolved = 0;
      for (const r of catalog.records()) {
        if (r.multiplicityStatus === MULTIPLICITY_UNRESOLVED) unresolved++;
      }
      expect(unresolved).toBeGreaterThan(500);
    });
  });

  describe('distance-refinement: B-J override re-anchored from catastrophic AT-HYG distance', () => {
    it.each(BJ_OVERRIDES)('$systemName', (row) => {
      const record = lookupPrimary(row);
      assertPrimary(row, record);
    });
  });

  describe('distance-refinement: B-J no-degradation guard (well-measured nearby)', () => {
    it.each(BJ_GUARDS)('$systemName', (row) => {
      const record = lookupPrimary(row);
      assertPrimary(row, record);
    });
  });

  describe('distance-refinement: LMC kinematic snap to Pietrzyński 2019 49.594 kpc', () => {
    it.each(LMC_SNAPS)('$systemName', (row) => {
      const record = lookupPrimary(row);
      assertPrimary(row, record);
      // LMC envelope sanity check on the corpus value itself.
      expect(
        row.primaryDistancePc,
        `${row.systemName}: tagged as LMC kinematic snap but expected distance ${row.primaryDistancePc} pc is outside the LMC envelope`,
      ).toBeGreaterThan(48_000);
    });
  });

  describe('variability (GCVS pins)', () => {
    it('corpus has ≥1 pin per animated class', () => {
      const types = new Set(VAR_PINNED.map(r => r.varType));
      // Pulsators are refined into families; the corpus pins the four
      // archetypes that drive the per-type radius/colour-swing table.
      expect(types.has('mira'), 'expected ≥1 Mira pin').toBe(true);
      expect(types.has('semiregular'), 'expected ≥1 semiregular pin').toBe(true);
      expect(types.has('cepheid'), 'expected ≥1 Cepheid pin').toBe(true);
      expect(types.has('dsct'), 'expected ≥1 DSCT-class pin').toBe(true);
      expect(types.has('eclipsing'), 'expected ≥1 eclipsing pin').toBe(true);
      expect(types.has('none'), 'expected ≥1 none guard').toBe(true);
    });
    it.each(VAR_PINNED)('$systemName', (row) => {
      const record = lookupPrimary(row);
      if (row.varType === 'none') {
        expect(
          [record.varType, record.periodDays, record.amplitudeMag],
          `${row.systemName}: var_type=none demands varType/period/amplitude all zero, got ${record.varType}/${record.periodDays}/${record.amplitudeMag}`,
        ).toEqual([VAR_TYPE_UNKNOWN, 0, 0]);
        return;
      }
      if (row.varType !== null) {
        expect(
          record.varType,
          `${row.systemName}: expected varType ${VAR_TYPE_TOKENS[row.varType]} (${row.varType}), got ${record.varType}`,
        ).toBe(VAR_TYPE_TOKENS[row.varType]);
      }
      if (row.varPeriodDays !== null) {
        const expected = encodePeriodUnits(row.varPeriodDays) * 0.1;
        expect(
          record.periodDays,
          `${row.systemName}: expected GCVS period ${row.varPeriodDays} d → ${expected.toFixed(1)} d after uint16 0.1 d quantisation, got ${record.periodDays.toFixed(1)} d`,
        ).toBeCloseTo(expected, 9);
      }
      if (row.varAmpMag !== null) {
        const expected = encodeAmpUnits(row.varAmpMag) * 0.05;
        expect(
          record.amplitudeMag,
          `${row.systemName}: expected GCVS amplitude ${row.varAmpMag} mag → ${expected.toFixed(2)} after uint8 0.05 mag quantisation, got ${record.amplitudeMag.toFixed(2)}`,
        ).toBeCloseTo(expected, 9);
      }
    });
  });

  describe('system pair topology (kept-pair exact sets)', () => {
    it('every fixture has a notes_source', () => {
      const missing = TOPOLOGY.filter(r => !r.notesSource);
      expect(
        missing.map(r => r.systemName),
        'topology rows missing notes_source',
      ).toHaveLength(0);
    });
    it.each(TOPOLOGY)('$systemName — multiples.tsv emits exactly the allowed pairs', (row) => {
      const bucket = MULTIPLES_BY_WDS.get(row.wdsId) ?? [];
      expect(
        bucket.length,
        `${row.systemName}: no multiples.tsv rows for wds_id=${row.wdsId} — root missing from the build entirely`,
      ).toBeGreaterThan(0);
      const observed = [...new Set(
        bucket
          .map(m => m.systemId.slice(row.wdsId.length + 1))
          .filter(suffix => !suffix.startsWith('_')),
      )].sort();
      expect(
        observed,
        `${row.systemName}: kept-pair set drifted for wds_id=${row.wdsId} — a missing entry is a dropped physical pair, an extra one is a re-leaked optical pair (see notes_source)`,
      ).toEqual([...row.allowedPairs].sort());
    });
    it.each(TOPOLOGY.filter(r => r.minSepPc !== null))(
      '$systemName — rejected-pair members stay ≥ min_sep_pc apart in 3D',
      (row) => {
        const primary = lookupByRef(catalog, row.primaryRef as RecordRef);
        const secondary = lookupByRef(catalog, row.secondaryRef as RecordRef);
        expect(primary, `${row.systemName}: primary_ref not found in catalog.bin`).not.toBeNull();
        expect(secondary, `${row.systemName}: secondary_ref not found in catalog.bin`).not.toBeNull();
        if (!primary || !secondary) return;
        const sepPc = Math.hypot(
          primary.x - secondary.x,
          primary.y - secondary.y,
          primary.z - secondary.z,
        );
        expect(
          sepPc,
          `${row.systemName}: catalog.bin 3D separation ${sepPc.toFixed(2)} pc < ${row.minSepPc} pc — the optical-pair evidence this fixture records has evaporated; re-verify before un-rejecting the pair`,
        ).toBeGreaterThanOrEqual(row.minSepPc as number);
      },
    );
  });
});
