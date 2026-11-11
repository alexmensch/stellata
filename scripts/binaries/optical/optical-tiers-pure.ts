// Stage 5's tiers for one pair: physical or optical, tagged with the tier that decided. See README.md.

import type { Hip2AstrometryRow } from '../../catalog/sources/hip2-source';
import type { WdsPair } from '../../wds/wds-pure';
import { AU_PER_PC, DEG_TO_RAD, KM_S_PER_AU_YR } from '../../../src/astro-core/astronomy-constants';
import type { ComponentAstrometry, PairAstrometry } from '../astrometry/routes-pure';
import type { Parallax, PmAnchor } from '../astrometry/system-anchors-pure';
import type { GaiaAstrometryRow } from '../load/gaia-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import { ORBIT_VIA_ON_FILE, type OrbitVia } from '../multiples-tsv';
import type { DecomposedPair, ResolvedComponent } from '../resolve/components-pure';

/** Each tag, in the cascade's order, and whether it keeps the pair. */
export const OPTICAL_VIA_PROPERTIES = {
  wds_notes_kept: { physical: true },
  wds_notes_rejected: { physical: false },
  orbit_kept: { physical: true },
  sep_limit_rejected: { physical: false },
  gaia_kept: { physical: true },
  gaia_rejected: { physical: false },
  asymm_kept: { physical: true },
  asymm_rejected: { physical: false },
  cpm_baseline_kept: { physical: true },
  cpm_baseline_rejected: { physical: false },
  mag_heuristic_kept: { physical: true },
  mag_heuristic_rejected: { physical: false },
} as const satisfies Record<string, { readonly physical: boolean }>;

export type OpticalVia = keyof typeof OPTICAL_VIA_PROPERTIES;
export const OPTICAL_VIA = Object.keys(OPTICAL_VIA_PROPERTIES) as readonly OpticalVia[];
export const OPTICAL_REJECT_VIA: readonly OpticalVia[] = OPTICAL_VIA.filter((v) => !OPTICAL_VIA_PROPERTIES[v].physical);

const WDS_NOTES_PHYSICAL_CHARS = new Set(['T', 'V', 'Z']);
const WDS_NOTES_OPTICAL_CHARS = new Set(['S', 'U', 'X', 'Y']);

/** The Galactic tidal-disruption limit for field binaries. */
export const SEPARATION_LIMIT_PC = 1.0;
/** A parallax depth gap counts toward 3D separation only past this many σ of the combined error. */
export const RADIAL_SEPARATION_SIGMA = 3.0;
/** The separation gate fires only off an own parallax at least this well measured. */
export const SEPARATION_POE_MIN = 5.0;
export const BOTH_GAIA_PLX_GATE_SIGMA = 3.0;
export const ASYMM_PLX_GATE_SIGMA = 3.0;
export const ESCAPE_VELOCITY_SAFETY_FACTOR = 2.5;
/** Twice Gaia DR3's 1,034-day baseline: a sub-pair this fast averages out of the 5p proper motion. */
export const ESCAPE_GATE_PM_AVERAGING_PERIOD_DAYS = 2.0 * 1034.0;
/** Caps a sub-pair's budget when it states no separation (v_circ → ∞ as r → 0). */
export const ESCAPE_GATE_SUBSYSTEM_FLOOR_SEP_AU = 10.0;
export const ESCAPE_GATE_BUDGET_COLLOCATION_SIGMA = 2.0;
/** Circular speed at 1 AU around 1 M☉: 2π AU/yr. */
export const CIRCULAR_KM_S_1AU_1MSUN = 2.0 * Math.PI * KM_S_PER_AU_YR;
export const CPM_SLIP_MIN_ARCSEC = 10.0;
export const CPM_DRIFT_REJECT_FRACTION = 0.5;
export const CPM_DRIFT_KEEP_FLOOR_ARCSEC = 2.0;
export const MAG_GAP_HEURISTIC_THRESHOLD = 5.0;

/** A side with no independent parallax: what the CPM tier exists for. */
const INHERITED_SECONDARY_ASTROMETRY_VIAS: ReadonlySet<ComponentAstrometry['astrometryVia']> = new Set(['unresolved', 'athyg_position']);

type TierVerdict = 'kept' | 'rejected' | null;

function polarToTangent(rhoArcsec: number, thetaDeg: number): readonly [number, number] {
  const th = thetaDeg * DEG_TO_RAD;
  return [rhoArcsec * Math.sin(th), rhoArcsec * Math.cos(th)];
}

export function cpmBaselineVerdict(pair: WdsPair, pmraMasyr: number | null, pmdecMasyr: number | null): TierVerdict {
  const { dateFirst, dateLast, rhoFirst, rhoLast, thetaFirst, thetaLast } = pair;
  if (
    dateFirst === null || dateLast === null || rhoFirst === null || rhoLast === null
    || thetaFirst === null || thetaLast === null || pmraMasyr === null || pmdecMasyr === null
  ) return null;
  const dtYr = dateLast - dateFirst;
  if (dtYr <= 0) return null;
  const predictedSlip = (Math.hypot(pmraMasyr, pmdecMasyr) / 1000.0) * dtYr;
  if (predictedSlip < CPM_SLIP_MIN_ARCSEC) return null;
  const [e0, n0] = polarToTangent(rhoFirst, thetaFirst);
  const [e1, n1] = polarToTangent(rhoLast, thetaLast);
  const observedDrift = Math.hypot(e1 - e0, n1 - n0);
  if (observedDrift >= CPM_DRIFT_REJECT_FRACTION * predictedSlip) return 'rejected';
  if (observedDrift <= CPM_DRIFT_KEEP_FLOOR_ARCSEC) return 'kept';
  return null;
}

function gaiaFor(c: ResolvedComponent, indices: IdentifierIndices): GaiaAstrometryRow | null {
  return c.gaiaSourceId === null ? null : indices.srcToAstrometry.get(c.gaiaSourceId) ?? null;
}

function hip2Anchor(c: ResolvedComponent, indices: IdentifierIndices): Parallax | null {
  const row: Hip2AstrometryRow | undefined = c.hip === null ? undefined : indices.hipToHip2.get(c.hip);
  return row === undefined || row.plxMas === null ? null : { parallaxMas: row.plxMas, parallaxErrorMas: row.plxErrorMas };
}

/** Its Gaia 5p row's positive parallax, else its HIP2 row's. */
function ownParallax(c: ResolvedComponent, indices: IdentifierIndices): Parallax | null {
  const gaia = gaiaFor(c, indices);
  if (gaia !== null && gaia.parallaxMas !== null && gaia.parallaxMas > 0.0) {
    return { parallaxMas: gaia.parallaxMas, parallaxErrorMas: gaia.parallaxErrorMas };
  }
  const hip2 = hip2Anchor(c, indices);
  return hip2 !== null && hip2.parallaxMas > 0.0 ? hip2 : null;
}

/** 3D separation in AU of two positive parallaxes ρ apart on the sky; the depth gap counts only when significant. */
export function separationAu(ref: Parallax, other: Parallax, rhoArcsec: number | null): number {
  const dRefPc = 1000.0 / ref.parallaxMas;
  const projectedAu = (rhoArcsec ?? 0.0) * dRefPc;
  const sigmaCombined = Math.hypot(ref.parallaxErrorMas ?? 0.0, other.parallaxErrorMas ?? 0.0);
  let radialAu = 0.0;
  if (Math.abs(ref.parallaxMas - other.parallaxMas) > RADIAL_SEPARATION_SIGMA * sigmaCombined) {
    const dOtherPc = 1000.0 / other.parallaxMas;
    radialAu = Math.abs(dOtherPc - dRefPc) * AU_PER_PC;
  }
  return Math.hypot(projectedAu, radialAu);
}

export function separationExceedsLimit(ref: Parallax, other: Parallax, rhoArcsec: number | null): boolean {
  return separationAu(ref, other, rhoArcsec) > SEPARATION_LIMIT_PC * AU_PER_PC;
}

/** Null for a non-positive separation: a collocated pair, treated as bound. */
export function escapeVelocityKmS(mTotalMsun: number, rAu: number): number | null {
  return rAu <= 0.0 ? null : CIRCULAR_KM_S_1AU_1MSUN * Math.sqrt((2.0 * mTotalMsun) / rAu);
}

export function transverseVelocityKmS(dpmMasyr: number, dPc: number): number {
  return KM_S_PER_AU_YR * (dpmMasyr / 1000.0) * dPc;
}

export function pairBeyondSeparationLimit(
  primary: ResolvedComponent, secondary: ResolvedComponent, systemParallax: Parallax | null,
  rhoArcsec: number | null, indices: IdentifierIndices,
): boolean {
  for (const [c, other] of [[primary, secondary], [secondary, primary]] as const) {
    const own = ownParallax(c, indices);
    if (own === null || own.parallaxErrorMas === null || own.parallaxErrorMas <= 0.0) continue;
    if (own.parallaxMas / own.parallaxErrorMas < SEPARATION_POE_MIN) continue;
    const otherPar = ownParallax(other, indices) ?? systemParallax;
    if (otherPar === null || otherPar.parallaxMas <= 0.0) continue;
    if (separationExceedsLimit(own, otherPar, rhoArcsec)) return true;
  }
  return false;
}

/** Both parallaxes positive: their depth gap plus its 2σ falls inside the tidal limit. */
function positivelyCollocated(p: GaiaAstrometryRow, s: GaiaAstrometryRow): boolean {
  const pPlx = p.parallaxMas!;
  const sPlx = s.parallaxMas!;
  const dP = 1000.0 / pPlx;
  const dS = 1000.0 / sPlx;
  const sigmaP = (1000.0 * (p.parallaxErrorMas ?? 0.0)) / pPlx ** 2;
  const sigmaS = (1000.0 * (s.parallaxErrorMas ?? 0.0)) / sPlx ** 2;
  return Math.abs(dP - dS) + ESCAPE_GATE_BUDGET_COLLOCATION_SIGMA * Math.hypot(sigmaP, sigmaS) < SEPARATION_LIMIT_PC;
}

export function bothGaiaVerdict(
  p: GaiaAstrometryRow, s: GaiaAstrometryRow, rhoArcsec: number | null, totalMassMsun: number, orbitalPmBudgetKmS: number,
): TierVerdict {
  if (p.parallaxMas === null || s.parallaxMas === null || p.parallaxErrorMas === null || s.parallaxErrorMas === null) return null;
  const pPar = { parallaxMas: p.parallaxMas, parallaxErrorMas: p.parallaxErrorMas };
  const sPar = { parallaxMas: s.parallaxMas, parallaxErrorMas: s.parallaxErrorMas };
  const nonPositive = p.parallaxMas <= 0.0 || s.parallaxMas <= 0.0;
  const sigmaCombined = Math.hypot(p.parallaxErrorMas, s.parallaxErrorMas);
  if (Math.abs(p.parallaxMas - s.parallaxMas) >= BOTH_GAIA_PLX_GATE_SIGMA * sigmaCombined) {
    if (nonPositive || separationExceedsLimit(pPar, sPar, rhoArcsec)) return 'rejected';
  }
  if (nonPositive) return 'kept';
  if (p.pmraMasyr === null || s.pmraMasyr === null || p.pmdecMasyr === null || s.pmdecMasyr === null) return 'kept';
  const dpm = Math.hypot(p.pmraMasyr - s.pmraMasyr, p.pmdecMasyr - s.pmdecMasyr);
  const dPc = 2000.0 / (p.parallaxMas + s.parallaxMas);
  const vEscape = escapeVelocityKmS(totalMassMsun, separationAu(pPar, sPar, rhoArcsec));
  if (vEscape === null) return 'kept';
  const budget = orbitalPmBudgetKmS > 0.0 && positivelyCollocated(p, s) ? orbitalPmBudgetKmS : 0.0;
  return transverseVelocityKmS(dpm, dPc) > ESCAPE_VELOCITY_SAFETY_FACTOR * vEscape + budget ? 'rejected' : 'kept';
}

export function asymmGaiaVerdict(gaia: GaiaAstrometryRow, anchor: Parallax, rhoArcsec: number | null): TierVerdict {
  if (gaia.parallaxMas === null || gaia.parallaxErrorMas === null) return null;
  const sigmaCombined = Math.hypot(gaia.parallaxErrorMas, anchor.parallaxErrorMas ?? 0.0);
  if (Math.abs(gaia.parallaxMas - anchor.parallaxMas) < ASYMM_PLX_GATE_SIGMA * sigmaCombined) return 'kept';
  if (gaia.parallaxMas <= 0.0 || anchor.parallaxMas <= 0.0) return 'rejected';
  const own = { parallaxMas: gaia.parallaxMas, parallaxErrorMas: gaia.parallaxErrorMas };
  return separationExceedsLimit(anchor, own, rhoArcsec) ? 'rejected' : 'kept';
}

export interface PairContext {
  readonly orbitVia: OrbitVia;
  readonly astrometry: PairAstrometry;
  readonly systemParallax: Parallax | null;
  readonly systemPm: PmAnchor | null;
  readonly totalMassMsun: number;
  readonly orbitalPmBudgetKmS: number;
}

const ORBIT_ON_FILE: ReadonlySet<OrbitVia> = new Set(ORBIT_VIA_ON_FILE);

/** The tiers in order; the first verdict wins. */
export function classifyPairOptical(p: DecomposedPair, ctx: PairContext, indices: IdentifierIndices): OpticalVia {
  const { pair, primary, secondary } = p;
  const notes = [...pair.notes.toUpperCase()];
  if (notes.some((ch) => WDS_NOTES_OPTICAL_CHARS.has(ch))) return 'wds_notes_rejected';
  if (notes.some((ch) => WDS_NOTES_PHYSICAL_CHARS.has(ch))) return 'wds_notes_kept';

  if (ORBIT_ON_FILE.has(ctx.orbitVia)) return 'orbit_kept';

  if (pairBeyondSeparationLimit(primary, secondary, ctx.systemParallax, pair.rhoLast, indices)) return 'sep_limit_rejected';

  const pGaia = gaiaFor(primary, indices);
  const sGaia = gaiaFor(secondary, indices);
  if (pGaia !== null && sGaia !== null) {
    const v = bothGaiaVerdict(pGaia, sGaia, pair.rhoLast, ctx.totalMassMsun, ctx.orbitalPmBudgetKmS);
    if (v !== null) return `gaia_${v}`;
  }

  for (const [gaia, saturatedGaia, saturated] of [[sGaia, pGaia, primary], [pGaia, sGaia, secondary]] as const) {
    if (gaia === null || saturatedGaia !== null) continue;
    const anchor = hip2Anchor(saturated, indices);
    if (anchor === null) continue;
    const v = asymmGaiaVerdict(gaia, anchor, pair.rhoLast);
    if (v !== null) return `asymm_${v}`;
  }

  const { primary: pAst, secondary: sAst } = ctx.astrometry;
  if (INHERITED_SECONDARY_ASTROMETRY_VIAS.has(sAst.astrometryVia)) {
    let pmra = pAst.astrometryVia === 'unresolved' ? null : pAst.pmraMasyr;
    let pmdec = pAst.astrometryVia === 'unresolved' ? null : pAst.pmdecMasyr;
    if (pmra === null && pmdec === null && ctx.systemPm !== null) ({ pmraMasyr: pmra, pmdecMasyr: pmdec } = ctx.systemPm);
    const v = cpmBaselineVerdict(pair, pmra, pmdec);
    if (v !== null) return `cpm_baseline_${v}`;
  }

  if (pair.magPri !== null && pair.magSec !== null && Math.abs(pair.magPri - pair.magSec) > MAG_GAP_HEURISTIC_THRESHOLD) {
    return 'mag_heuristic_rejected';
  }
  return 'mag_heuristic_kept';
}
