// Tycho-2's two tables filtered to the TYCs the manifest and IV/25 mention and the manifest's HIPs: the request set, the TYC1 bands, the phased pull and its cover gate. See README.md.

import { compareCodeUnits } from '../../../src/astro-core/order-pure';
import type { Check, DeclaredOutputs } from '../../util/emit-artifacts';
import { cellReader, type Row, type SortKey } from '../pull/columns-pure';
import { near, type RowBand, type SpotRow } from '../pull/gates-pure';
import type { Phase, PhasedPull, WrittenTable } from '../pull/pull';
import { VIZIER } from '../pull/tap-pure';
import { DOUBLE, FLOAT, vizierColumn, vizierQuery, vizierRelease, type VizierColumn } from '../vizier/vizier-pure';

export type Tyc = readonly [number, number, number];

/** `3694-2544-1` → [3694, 2544, 1]; null for anything else. */
export function parseTyc(text: string): Tyc | null {
  const parts = text.trim().split('-');
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** One spelling per entry, so a manifest cell and an IV/25 row naming it differently collapse to one key. */
export const tycKey = ([tyc1, tyc2, tyc3]: Tyc): string => `${tyc1}-${tyc2}-${tyc3}`;

export interface ManifestEntry {
  readonly tyc: string | null;
  readonly hip: number | null;
}

export interface Tycho2Request {
  /** The manifest's TYCs, whose cover the pull gates. */
  readonly membership: ReadonlySet<string>;
  /** The manifest's TYCs and IV/25's: what the pull keeps. */
  readonly mentioned: ReadonlySet<string>;
  /** The manifest's HIPs: a row whose `hip` names one is kept too, so both entries of a pair stay. */
  readonly hips: ReadonlySet<string>;
}

/** README.md#the-request-set. */
export function tycho2Request(manifest: Iterable<ManifestEntry>, iv25Tycs: Iterable<Tyc>): Tycho2Request {
  const membership = new Set<string>();
  const hips = new Set<string>();
  for (const entry of manifest) {
    const tyc = entry.tyc === null ? null : parseTyc(entry.tyc);
    if (tyc !== null) membership.add(tycKey(tyc));
    if (entry.hip !== null) hips.add(String(entry.hip));
  }
  const mentioned = new Set(membership);
  for (const tyc of iv25Tycs) mentioned.add(tycKey(tyc));
  return { membership, mentioned, hips };
}

export const requestLines = (request: Tycho2Request): string[] => [...request.mentioned].sort(compareCodeUnits);

export const tycho2RequestLines = (request: Tycho2Request): string[] => [
  ...requestLines(request),
  ...[...request.hips].sort(compareCodeUnits).map((hip) => `HIP ${hip}`),
];

export const TYC1_MIN = 1;
export const TYC1_MAX = 9537;
const TYC1_PER_QUERY = 400;
/** The most rows one band holds, over both tables: 155,282 measured (8401–8800, I/259/tyc2, CfA mirror, 2026-11-15). */
export const TYC1_BAND_ROWS = 160_000;

/** Contiguous TYC1 bands covering [TYC1_MIN, TYC1_MAX], each scanned by one query. */
export function tyc1Bands(perQuery = TYC1_PER_QUERY): Array<readonly [number, number]> {
  const bands: Array<readonly [number, number]> = [];
  for (let lo = TYC1_MIN; lo <= TYC1_MAX; lo += perQuery) bands.push([lo, Math.min(lo + perQuery - 1, TYC1_MAX)]);
  return bands;
}

/** The TYCs whose TYC1 no band scans, which would otherwise read as entries Tycho-2 lacks. */
export function unscannable(mentioned: Iterable<string>): string[] {
  return [...mentioned].filter((key) => {
    const tyc1 = Number(key.split('-')[0]);
    return tyc1 < TYC1_MIN || tyc1 > TYC1_MAX;
  }).sort(compareCodeUnits);
}

const tycColumns: readonly [VizierColumn, VizierColumn, VizierColumn] = [
  vizierColumn('TYC1', 'tyc1'), vizierColumn('TYC2', 'tyc2'), vizierColumn('TYC3', 'tyc3'),
];
const SORT_BY: readonly [SortKey, ...SortKey[]] = [
  { column: 'tyc1', as: 'integer' }, { column: 'tyc2', as: 'integer' }, { column: 'tyc3', as: 'integer' },
];
const photometry: readonly VizierColumn[] = [
  vizierColumn('BTmag', 'bt_mag', FLOAT), vizierColumn('e_BTmag', 'e_bt_mag', FLOAT),
  vizierColumn('VTmag', 'vt_mag', FLOAT), vizierColumn('e_VTmag', 'e_vt_mag', FLOAT),
  vizierColumn('prox', 'prox'), vizierColumn('HIP', 'hip'),
];
const motion: readonly VizierColumn[] = [
  vizierColumn('pmRA', 'pm_ra', FLOAT), vizierColumn('pmDE', 'pm_de', FLOAT),
  vizierColumn('e_pmRA', 'e_pm_ra', FLOAT), vizierColumn('e_pmDE', 'e_pm_de', FLOAT),
];
const icrs: readonly VizierColumn[] = [vizierColumn('RA(ICRS)', 'ra_icrs', DOUBLE), vizierColumn('DE(ICRS)', 'de_icrs', DOUBLE)];

interface Tycho2Table {
  readonly vizierId: string;
  readonly columns: readonly [VizierColumn, ...VizierColumn[]];
  /** Kept rows as a share of the mentioned TYCs, so the band moves with the request set. */
  readonly keptShare: { readonly min: number; readonly max: number };
  readonly spotRows: readonly [SpotRow, ...SpotRow[]];
}

/** RAmdeg/DEmdeg vs RA(ICRS), and why `pflag='X'` rows need both: /data/tycho2/README.md#which-position-to-propagate-from. */
export const MAIN: Tycho2Table = {
  vizierId: 'I/259/tyc2',
  columns: [
    ...tycColumns, vizierColumn('pflag', 'pflag'),
    vizierColumn('RAmdeg', 'ra_mdeg', DOUBLE), vizierColumn('DEmdeg', 'de_mdeg', DOUBLE),
    vizierColumn('EpRAm', 'ep_ra', FLOAT), vizierColumn('EpDEm', 'ep_de', FLOAT),
    ...motion, ...icrs, ...photometry,
  ],
  keptShare: { min: 0.98, max: 1 },
  spotRows: [{
    key: 'ra_mdeg',
    value: '34.60250679',
    cells: {
      tyc1: '3694', tyc2: '2544', tyc3: '1', de_mdeg: near(56.55991447, 1e-6), ep_ra: near(1991.07, 0.01), ep_de: near(1991, 0.01),
      pm_ra: near(341.5, 0.05), pm_de: near(-223.6, 0.05), vt_mag: near(8.354, 0.001),
    },
  }],
};

export const SUPPL1: Tycho2Table = {
  vizierId: 'I/259/suppl_1',
  columns: [...tycColumns, vizierColumn('flag', 'flag'), ...icrs, ...motion, ...photometry],
  keptShare: { min: 0.004, max: 0.012 },
  spotRows: [{ key: 'hip', value: '6', cells: { tyc1: '4', tyc2: '1130', tyc3: '1', flag: 'H', vt_mag: near(12.449, 0.001) } }],
};

export const TABLES = { main: MAIN, suppl1: SUPPL1 } as const;
export type Tycho2Key = keyof typeof TABLES;

/** Floored, both ends. */
export function keptBand(share: Tycho2Table['keptShare'], mentioned: number): RowBand {
  return { min: Math.floor(share.min * mentioned), max: Math.floor(share.max * mentioned) };
}

export function bandPhase(table: Tycho2Table, [lo, hi]: readonly [number, number]): Phase {
  const { asu, ...query } = vizierQuery(table.vizierId, table.columns, { column: 'TYC1', min: lo, max: hi });
  return { ...query, scope: { kind: 'whole-table', maxRows: TYC1_BAND_ROWS, asu } };
}

/** The row's TYC when the request keeps it, else null. */
function keptTyc(table: Tycho2Table, request: Tycho2Request): (row: Row) => string | null {
  const cells = cellReader(table.columns, table.vizierId);
  return (row) => {
    const cell = cells(row);
    const tyc = tycKey([Number(cell('tyc1')), Number(cell('tyc2')), Number(cell('tyc3'))]);
    return request.mentioned.has(tyc) || request.hips.has(cell('hip') ?? '') ? tyc : null;
  };
}

/** A component IV/25 resolves that Tycho-2 merged into its pair's TYC3=1 entry, so it never had a row to pull. */
export function pairCarriedAsOneStar(key: string, reached: ReadonlySet<string>): boolean {
  const [tyc1, tyc2, tyc3] = key.split('-').map(Number);
  return tyc3 > 1 && reached.has(tycKey([tyc1, tyc2, 1]));
}

const SHOWN = 10;
const sample = (keys: readonly string[]): string => `${keys.slice(0, SHOWN).join(', ')}${keys.length > SHOWN ? ' …' : ''}`;

/** Every manifest TYC reaches a table row, or its pair's entry does: README.md#gates. */
export function membershipCover(membership: ReadonlySet<string>, reached: ReadonlySet<string>): Check {
  const missing = [...membership].filter((key) => !reached.has(key));
  const merged = missing.filter((key) => pairCarriedAsOneStar(key, reached));
  const report = `manifest TYCs reached: ${membership.size - missing.length}/${membership.size}, plus ${merged.length} carried by a pair entry`;
  const unresolved = missing.filter((key) => !pairCarriedAsOneStar(key, reached)).sort(compareCodeUnits);
  if (unresolved.length === 0) return { kind: 'pass', report };
  return {
    kind: 'fail',
    report,
    message: `${unresolved.length} manifest TYC(s) reach neither I/259 table, and no pair entry of theirs was reached either (${sample(unresolved)}) `
      + '— adjudicate as a membership event before committing this pull. A component\'s pair entry is visible here only when the request set names it too.',
  };
}

export interface Tycho2Inputs {
  readonly request: Tycho2Request;
  /** The files the request is read off, which order the pull after their writers. */
  readonly requestFrom: readonly string[];
}

export function tycho2Pull(outputs: DeclaredOutputs<Tycho2Key>, { request, requestFrom }: Tycho2Inputs): PhasedPull<Tycho2Key> {
  const keys = Object.keys(TABLES) as Tycho2Key[];
  const bands = tyc1Bands();
  const phases = new Map(keys.flatMap((key) => bands.map((band) => [`${key} ${band[0]}-${band[1]}`, { key, phase: bandPhase(TABLES[key], band) }] as const)));
  const tables = Object.fromEntries(keys.map((key): [Tycho2Key, WrittenTable] => {
    const { columns, keptShare, spotRows } = TABLES[key];
    return [key, { columns, sortBy: SORT_BY, band: keptBand(keptShare, request.mentioned.size), spotRows }];
  })) as Record<Tycho2Key, WrittenTable>;

  return {
    archive: VIZIER,
    outputs,
    phases: Object.fromEntries([...phases].map(([name, { phase }]) => [name, phase])),
    tables,
    release: vizierRelease(keys.map((key) => TABLES[key])),
    request: { request: tycho2RequestLines(request), requestFrom },
    async run(ask, log) {
      if (request.mentioned.size === 0) throw new Error(`${requestFrom.join(' and ')} name no TYC between them, so there is nothing to pull`);
      const outside = unscannable(request.mentioned);
      if (outside.length > 0) {
        throw new Error(`${outside.length} mentioned TYC(s) fall outside the scanned TYC1 span [${TYC1_MIN}, ${TYC1_MAX}] `
          + `(${sample(outside)}); widen the span or fix the request set`);
      }
      log(`mentioned TYCs: ${request.mentioned.size} (manifest ${request.membership.size} ∪ IV/25 ${request.mentioned.size - request.membership.size} new), plus rows naming one of ${request.hips.size} manifest HIPs`);
      const kept = { main: new Map<string, Row>(), suppl1: new Map<string, Row>() };
      const keep = { main: keptTyc(MAIN, request), suppl1: keptTyc(SUPPL1, request) };
      for (const { key, phase } of phases.values()) {
        for (const row of await ask(phase)) {
          const tyc = keep[key](row);
          if (tyc !== null) kept[key].set(tyc, row);
        }
      }
      for (const key of keys) {
        log(`  ${key}: kept ${kept[key].size} of ${request.mentioned.size} mentioned TYCs (${(100 * kept[key].size / request.mentioned.size).toFixed(2)}%)`);
      }
      const reached = new Set([...kept.main.keys(), ...kept.suppl1.keys()]);
      return {
        rows: { main: [...kept.main.values()], suppl1: [...kept.suppl1.values()] },
        checks: [membershipCover(request.membership, reached)],
      };
    },
  };
}
