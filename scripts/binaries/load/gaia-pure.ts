// The binaries' Gaia DR3 tables: the 5p astrometry pull and the NSS two-body orbits.

import type { Declared } from '../../util/sources/source';
import { readTable, type ColumnTable } from '../../util/tsv/table-pure';

/** One row of the binaries' astrometry pull: the 5p solution, the two fit
 *  flags behind the NSS-systemic route, and the photometry. */
export interface GaiaAstrometryRow {
  readonly sourceId: string;
  readonly raDeg: number;
  readonly decDeg: number;
  readonly parallaxMas: number | null;
  readonly parallaxErrorMas: number | null;
  readonly pmraMasyr: number | null;
  readonly pmraErrorMasyr: number | null;
  readonly pmdecMasyr: number | null;
  readonly pmdecErrorMasyr: number | null;
  readonly refEpoch: number;
  readonly ruwe: number | null;
  readonly ipdFracMultiPeak: number | null;
  readonly gMag: number | null;
  readonly bpMag: number | null;
  readonly rpMag: number | null;
}

/** The NSS two-body columns the orbit stages read. */
export interface NssOrbitRow {
  readonly sourceId: string;
  readonly solutionType: string;
  readonly period: number | null;
  readonly tPeriastron: number | null;
  readonly eccentricity: number | null;
  readonly aThieleInnes: number | null;
  readonly bThieleInnes: number | null;
  readonly fThieleInnes: number | null;
  readonly gThieleInnes: number | null;
  readonly inclination: number | null;
  readonly argPeriastron: number | null;
  readonly massRatio: number | null;
}

const ASTROMETRY_COLUMNS = [
  'source_id', 'ra', 'dec', 'parallax', 'parallax_error', 'pmra', 'pmra_error', 'pmdec', 'pmdec_error',
  'ref_epoch', 'ruwe', 'ipd_frac_multi_peak', 'phot_g_mean_mag', 'phot_bp_mean_mag', 'phot_rp_mean_mag',
] as const;

export function parseGaiaAstrometry(text: string, from: Declared): Map<string, GaiaAstrometryRow> {
  const out = new Map<string, GaiaAstrometryRow>();
  for (const row of readTable({ ...from, columns: ASTROMETRY_COLUMNS }, text)) {
    const sourceId = row.sourceId('source_id');
    const raDeg = row.float('ra');
    const decDeg = row.float('dec');
    const refEpoch = row.float('ref_epoch');
    if (sourceId === null || raDeg === null || decDeg === null || refEpoch === null) continue;
    out.set(sourceId, {
      sourceId, raDeg, decDeg, refEpoch,
      parallaxMas: row.float('parallax'),
      parallaxErrorMas: row.float('parallax_error'),
      pmraMasyr: row.float('pmra'),
      pmraErrorMasyr: row.float('pmra_error'),
      pmdecMasyr: row.float('pmdec'),
      pmdecErrorMasyr: row.float('pmdec_error'),
      ruwe: row.float('ruwe'),
      ipdFracMultiPeak: row.float('ipd_frac_multi_peak'),
      gMag: row.float('phot_g_mean_mag'),
      bpMag: row.float('phot_bp_mean_mag'),
      rpMag: row.float('phot_rp_mean_mag'),
    });
  }
  return out;
}

export const ASTROMETRY_EXCLUSION_OUTCOMES = ['kept', 'excluded'] as const;
export type AstrometryExclusionOutcome = (typeof ASTROMETRY_EXCLUSION_OUTCOMES)[number];

/** The pull less the curated exclusions; `outcomes` is one per pulled source. */
export function applyAstrometryExclusions(
  astrometry: ReadonlyMap<string, GaiaAstrometryRow>, exclusions: ReadonlyMap<string, string>,
): { kept: Map<string, GaiaAstrometryRow>; outcomes: readonly AstrometryExclusionOutcome[] } {
  const kept = new Map<string, GaiaAstrometryRow>();
  const outcomes: AstrometryExclusionOutcome[] = [];
  for (const [sourceId, row] of astrometry) {
    const excluded = exclusions.has(sourceId);
    outcomes.push(excluded ? 'excluded' : 'kept');
    if (!excluded) kept.set(sourceId, row);
  }
  return { kept, outcomes };
}

/** What a solution type's columns constrain: `thiele_innes` the photocentre
 *  orbit's A, B, F, G; `eclipsing` a stored inclination and ω; `spectroscopic`
 *  ω at most. */
export type NssSolutionKind = 'thiele_innes' | 'eclipsing' | 'spectroscopic';

/** Which of a source's solutions binaries keeps, best first. ../README.md#gaia-nss-one-solution-per-source */
export const NSS_PICK_TIERS = ['astrometric', 'double_lined', 'single_lined', 'eclipse_only'] as const;
export type NssPickTier = (typeof NSS_PICK_TIERS)[number];

export interface NssSolutionType {
  readonly kind: NssSolutionKind;
  readonly tier: NssPickTier;
}

export const NSS_SOLUTION_TYPES: ReadonlyMap<string, NssSolutionType> = new Map([
  ['Orbital', { kind: 'thiele_innes', tier: 'astrometric' }],
  ['OrbitalAlternative', { kind: 'thiele_innes', tier: 'astrometric' }],
  ['OrbitalAlternativeValidated', { kind: 'thiele_innes', tier: 'astrometric' }],
  ['OrbitalTargetedSearch', { kind: 'thiele_innes', tier: 'astrometric' }],
  ['OrbitalTargetedSearchValidated', { kind: 'thiele_innes', tier: 'astrometric' }],
  ['AstroSpectroSB1', { kind: 'thiele_innes', tier: 'astrometric' }],
  ['EclipsingBinary', { kind: 'eclipsing', tier: 'eclipse_only' }],
  ['EclipsingSpectro', { kind: 'eclipsing', tier: 'double_lined' }],
  ['SB1', { kind: 'spectroscopic', tier: 'single_lined' }],
  ['SB1C', { kind: 'spectroscopic', tier: 'single_lined' }],
  ['SB2', { kind: 'spectroscopic', tier: 'double_lined' }],
  ['SB2C', { kind: 'spectroscopic', tier: 'double_lined' }],
]);

const NSS_COLUMNS = [
  'source_id', 'nss_solution_type', 'period', 't_periastron', 'eccentricity',
  'a_thiele_innes', 'b_thiele_innes', 'f_thiele_innes', 'g_thiele_innes',
  'inclination', 'arg_periastron', 'mass_ratio', 'significance',
] as const;

interface NssCandidate {
  readonly row: NssOrbitRow;
  readonly significance: number | null;
}

/** NSS_PICK_TIERS index, or the reason the type cannot be ranked. */
function pickTierIndex(c: NssCandidate): number | string {
  const type = NSS_SOLUTION_TYPES.get(c.row.solutionType);
  return type === undefined ? `"${c.row.solutionType}" is not a known nss_solution_type` : NSS_PICK_TIERS.indexOf(type.tier);
}

/** The better of two solutions for one source, or the reason the rule cannot order them. */
function betterNssSolution(a: NssCandidate, b: NssCandidate): NssCandidate | string {
  const ta = pickTierIndex(a);
  const tb = pickTierIndex(b);
  if (typeof ta === 'string') return ta;
  if (typeof tb === 'string') return tb;
  if (ta !== tb) return ta < tb ? a : b;
  if (a.significance === null || b.significance === null || a.significance === b.significance) {
    return `${a.row.solutionType} and ${b.row.solutionType} share a tier with no greater significance between them`;
  }
  return a.significance > b.significance ? a : b;
}

/** source_id → its orbit. ../README.md#gaia-nss-one-solution-per-source */
export function parseNssOrbits(table: ColumnTable): Map<string, NssOrbitRow> {
  const picked = new Map<string, NssCandidate>();
  for (const row of table(NSS_COLUMNS)) {
    const sourceId = row.sourceId('source_id');
    if (sourceId === null) continue;
    const candidate: NssCandidate = {
      significance: row.float('significance'),
      row: {
        sourceId,
        solutionType: row.text('nss_solution_type') ?? '',
        period: row.float('period'),
        tPeriastron: row.float('t_periastron'),
        eccentricity: row.float('eccentricity'),
        aThieleInnes: row.float('a_thiele_innes'),
        bThieleInnes: row.float('b_thiele_innes'),
        fThieleInnes: row.float('f_thiele_innes'),
        gThieleInnes: row.float('g_thiele_innes'),
        inclination: row.float('inclination'),
        argPeriastron: row.float('arg_periastron'),
        massRatio: row.float('mass_ratio'),
      },
    };
    const held = picked.get(sourceId);
    const kept = held === undefined ? candidate : betterNssSolution(held, candidate);
    picked.set(sourceId, typeof kept === 'string'
      ? row.fail(`source ${sourceId} has several solutions the pick rule cannot order: ${kept}`)
      : kept);
  }
  return new Map([...picked].map(([sourceId, c]) => [sourceId, c.row]));
}
