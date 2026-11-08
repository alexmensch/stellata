// The V-stratified SIMBAD sample: its bins, the seeded draw, the derived distance and absolute magnitude, and the pull. See README.md.

import type { DeclaredOutputs } from '../../util/emit-artifacts';
import { mulberry32 } from '../../util/seeded-random-pure';
import type { Row } from '../pull/columns-pure';
import type { SpotRow } from '../pull/gates-pure';
import type { PhasedPull, Phase, WrittenTable } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fetchIdents, oidOf, parseLedger, simbadPhases } from '../simbad/simbad-fetch-pure';
import { countFilled, floorCheck } from '../simbad/simbad-rows-pure';
import { GAIA_DR3, HIP, OID } from '../simbad/simbad-specs-pure';

/** The draw's seed, `YYYYMMDD` of the day the corpus was first cut; a new one redraws every row. */
export const SEED = 20260515;

export interface Bin {
  readonly vMin: number | null;
  readonly vMax: number;
  readonly target: number;
  /** `MOD(oid, modK) = SEED % modK` thins the candidates server-side; 1 asks for all. */
  readonly modK: number;
  /** Oids every draw includes: the table's spot rows, so a re-draw still pins known stars. */
  readonly anchors: readonly number[];
}

/** The V<6 bin's anchors, each with the cells its spot row pins. */
const ANCHOR_PINS = [
  { oid: 38673, mainId: '* alf Lac', v: 3.77, plx: 31.494 },
  { oid: 75118, mainId: '* bet Lac', v: 4.44, plx: 19.301 },
] as const;
const V_WITHIN = 0.02;
const PLX_WITHIN_MAS = 0.2;

export const ANCHORS: readonly number[] = ANCHOR_PINS.map((a) => a.oid);

/** modK keeps each bin's candidates about 3× its target (live populations, 2026-05-18: 5,056 · 125,047 · 1,414,045 · 2,321,952). */
export const BINS: readonly Bin[] = [
  { vMin: null, vMax: 6, target: 5_000, modK: 1, anchors: ANCHORS },
  { vMin: 6, vMax: 9, target: 15_000, modK: 3, anchors: [] },
  { vMin: 9, vMax: 11.5, target: 20_000, modK: 23, anchors: [] },
  { vMin: 11.5, vMax: 15, target: 10_000, modK: 77, anchors: [] },
];

export const SAMPLE_SIZE = BINS.reduce((n, b) => n + b.target, 0);

/** The most candidates a bin may return, over its target: the largest bin answered 3.1× at the last tuning. */
export const CANDIDATE_CEILING = 5;

/** Over the whole sample, not per bin: the V<6 bin alone runs ~94%, since Gaia saturates on the brightest stars. */
export const GAIA_COVERAGE_FLOOR = 0.95;

const CANDIDATE_COLUMNS = [
  ['oid', 'b.oid'], ['main_id', 'b.main_id'], ['ra', 'b.ra'], ['dec', 'b.dec'], ['plx_value', 'b.plx_value'], ['plx_err', 'b.plx_err'],
  ['pmra', 'b.pmra'], ['pmdec', 'b.pmdec'], ['otype', 'b.otype'], ['sp_type', 'b.sp_type'], ['v_mag', 'f."V"'],
] as const;
type CandidateColumn = (typeof CANDIDATE_COLUMNS)[number][0];

/** SIMBAD refuses LIKE on `basic.otype`, so the star branch of `otypedef` is a subquery. */
const STAR_OTYPES = "SELECT otype FROM otypedef WHERE path LIKE '*%'";

export function binPhase(bin: Bin): Phase {
  const conditions = [
    'f."V" IS NOT NULL',
    `f."V" < ${bin.vMax}`,
    ...(bin.vMin === null ? [] : [`f."V" >= ${bin.vMin}`]),
    `b.otype IN (${STAR_OTYPES})`,
    ...(bin.modK > 1 ? [`MOD(b.oid, ${bin.modK}) = ${SEED % bin.modK}`] : []),
  ];
  const [first, ...rest] = CANDIDATE_COLUMNS.map(([name, column]) => ({ name, select: `${column} AS ${name}` }));
  return {
    from: 'basic AS b JOIN allfluxes AS f ON f.oidref = b.oid',
    where: conditions.join(' AND '),
    columns: [first, ...rest],
    scope: { kind: 'whole-table', maxRows: bin.target * CANDIDATE_CEILING },
  };
}

const at = new Map(CANDIDATE_COLUMNS.map(([name], i) => [name, i]));
const cell = (row: Row, column: CandidateColumn): string | null => row[at.get(column) as number];

/** The bin's anchors, then a uniform draw without replacement of the rest of its target from the oid-sorted candidates. */
export function drawBin(candidates: readonly Row[], bin: Bin, random: () => number, label: string): Row[] {
  if (candidates.length < bin.target) {
    throw new Error(`${label}: ${candidates.length} candidates for a target of ${bin.target}; lower modK to widen the candidate set`);
  }
  const sorted = [...candidates].sort((a, b) => oidOf(cell(a, 'oid')) - oidOf(cell(b, 'oid')));
  const anchors = new Set<number>(bin.anchors);
  const picked = sorted.filter((row) => anchors.has(oidOf(cell(row, 'oid'))));
  if (picked.length !== anchors.size) throw new Error(`${label}: an anchor oid of ${bin.anchors.join(', ')} is not among the candidates`);
  const rest = sorted.filter((row) => !anchors.has(oidOf(cell(row, 'oid'))));
  const want = bin.target - picked.length;
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(random() * (rest.length - i));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...picked, ...rest.slice(0, want)];
}

/** Distance from a positive parallax, and the absolute V it implies; a parallax ≤ 0 states neither. */
export function derived(plxText: string | null, vText: string): { distancePc: string | null; absmag: string | null } {
  const plx = plxText === null ? NaN : Number(plxText);
  if (!(plx > 0)) return { distancePc: null, absmag: null };
  const distancePc = 1000 / plx;
  return { distancePc: String(distancePc), absmag: String(Number(vText) - 5 * Math.log10(distancePc / 10)) };
}

const fixed = (n: number) => ({ fixed: n });

function anchorSpotRow(a: (typeof ANCHOR_PINS)[number]): SpotRow {
  return {
    key: 'simbad_oid',
    value: String(a.oid),
    cells: { simbad_main_id: a.mainId, v_mag: { near: a.v, within: V_WITHIN }, plx_value: { near: a.plx, within: PLX_WITHIN_MAS } },
  };
}

export const SAMPLE_TABLE: WrittenTable = {
  columns: [
    { name: 'simbad_oid' }, { name: 'simbad_main_id' }, { name: 'hip' }, { name: 'gaia_source_id' },
    { name: 'ra', format: fixed(6) }, { name: 'dec', format: fixed(6) },
    { name: 'plx_value', format: fixed(4) }, { name: 'plx_err', format: fixed(4) },
    { name: 'pmra', format: fixed(4) }, { name: 'pmdec', format: fixed(4) },
    { name: 'v_mag', format: fixed(3) }, { name: 'distance_pc', format: fixed(3) }, { name: 'absmag', format: fixed(3) },
    { name: 'sp_type' }, { name: 'otype' },
  ],
  sortBy: [{ column: 'simbad_oid', as: 'integer' }],
  band: { min: SAMPLE_SIZE, max: SAMPLE_SIZE },
  spotRows: [anchorSpotRow(ANCHOR_PINS[0]), ...ANCHOR_PINS.slice(1).map(anchorSpotRow)],
};

const SAMPLE_PHASES = simbadPhases({ basic: [OID], idents: [HIP, GAIA_DR3] });

export const binName = (i: number): string => `bin${i + 1}`;
export const BIN_PHASES: readonly Phase[] = BINS.map(binPhase);

const GAIA_COLUMN = SAMPLE_TABLE.columns.findIndex((c) => c.name === 'gaia_source_id');

export function samplePull(outputs: DeclaredOutputs<'sample'>): PhasedPull<'sample'> {
  return {
    archive: SIMBAD,
    outputs,
    phases: { ...Object.fromEntries(BIN_PHASES.map((phase, i) => [binName(i), phase])), idents: SAMPLE_PHASES.idents },
    tables: { sample: SAMPLE_TABLE },
    parameters: { seed: SEED, targets: BINS.map((b) => b.target), anchors: BINS.map((b) => b.anchors) },
    async run(ask, log) {
      const random = mulberry32(SEED);
      const drawn: Row[] = [];
      for (const [i, bin] of BINS.entries()) {
        const candidates = await ask(BIN_PHASES[i]);
        drawn.push(...drawBin(candidates, bin, random, binName(i)));
        log(`  ${binName(i)}: ${candidates.length} candidates → drew ${bin.target}`);
      }
      const ledger = parseLedger();
      const idents = await fetchIdents(ask, SAMPLE_PHASES, [HIP, GAIA_DR3], drawn.map((r) => oidOf(cell(r, 'oid'))).sort((a, b) => a - b), ledger);
      const rows = drawn.map((r): Row => {
        const oid = oidOf(cell(r, 'oid'));
        const v = cell(r, 'v_mag');
        if (v === null) throw new Error(`SIMBAD oid ${oid} passed the "V IS NOT NULL" filter with no v_mag`);
        const { distancePc, absmag } = derived(cell(r, 'plx_value'), v);
        const ids = idents.get(oid);
        return [
          String(oid), cell(r, 'main_id'), ids?.get(HIP.name) ?? null, ids?.get(GAIA_DR3.name) ?? null,
          cell(r, 'ra'), cell(r, 'dec'), cell(r, 'plx_value'), cell(r, 'plx_err'), cell(r, 'pmra'), cell(r, 'pmdec'),
          v, distancePc, absmag, cell(r, 'sp_type'), cell(r, 'otype'),
        ];
      });
      const gaia = countFilled(rows, (row) => row[GAIA_COLUMN] !== null);
      return {
        rows: { sample: rows },
        checks: [
          ledger.check('idents'),
          floorCheck('Gaia DR3 ident coverage', gaia / Math.max(1, rows.length), GAIA_COVERAGE_FLOOR, 'SIMBAD\'s ident table or the strata\'s Gaia rate regressed'),
        ],
      };
    },
  };
}
