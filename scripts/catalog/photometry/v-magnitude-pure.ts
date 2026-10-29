// Johnson V resolution from Gaia DR3 photometry, printed Hipparcos V,
// Tycho-2's BT/VT and Gliese's printed Vmag. See README.md.

import {
  calibratedPhotometry,
  polynomial,
  type GaiaPhotometry,
  type GatedValue,
  type PhotometryRefusal,
} from './gaia-photometry-pure';
import type { CascadeResult, UniformValues } from '../cascade-result';
import { lookupGliese, type GlieseIndex } from '../gliese-parse';
import { printedByHip } from './hip-photometry-parse';
import type { Tycho2Row } from '../tycho2-parse';

/** Riello 2021 (/data/papers/index.md#riello2021) App. C,
 *  Table C.2 — `G − V` as a cubic in `BP − RP`. Ascending powers. The DR3 photometry is unchanged from EDR3, so the EDR3 calibration
 *  is the one that applies. */
export const RIELLO_G_MINUS_V_COEFFS = [
  -0.02704, 0.01424, -0.2156, 0.01426,
] as const;

/** Published residual scatter of the relation above (mag). Not applied — kept
 *  so a consumer weighing transformed against printed V has the published
 *  uncertainty rather than a guess. */
export const RIELLO_G_MINUS_V_SIGMA = 0.03017;

/** Colour range Riello 2021 (/data/papers/index.md#riello2021) Table C.1
 *  states the relation over. Outside it the cubic diverges fast, so this is a validity gate rather than a quality hint. */
export const RIELLO_BP_RP_MIN = -0.5;
export const RIELLO_BP_RP_MAX = 5.0;

/** ESA 1997 (/data/papers/index.md#esa1997) SP-1200 Sect. 1.3's linear
 *  reduction of Tycho `VT` to Johnson `V`, `V = VT − 0.090·(BT−VT)`, published
 *  over −0.2 < `BT−VT` < 1.8. The MIN/MAX below are wider than that, with no
 *  recorded source (open: README.md#the-tycho-2-tier-runs-outside-its-published-colour-range),
 *  and {@link tycho2VMagnitude} counts rows outside them rather than gating. */
export const TYCHO2_V_FROM_VT_COEFF = 0.090;
export const TYCHO2_BT_MINUS_VT_MIN = -0.25;
export const TYCHO2_BT_MINUS_VT_MAX = 2.0;

/** The cascade's printed tiers, in cascade order — the one statement of that
 *  order. Each publishes one magnitude per catalogue entry, which is why every
 *  one of them is a system blend (`vTierIsSystemBlend`). */
export const PRINTED_V_TIERS = ['printed_hip', 'tycho2', 'gliese'] as const;
export type PrintedVVia = (typeof PRINTED_V_TIERS)[number];

export function isPrintedVVia(via: string | null): via is PrintedVVia {
  return (PRINTED_V_TIERS as readonly (string | null)[]).includes(via);
}

export const V_VIA_VALUES = ['gaia_riello', ...PRINTED_V_TIERS, 'curated', 'none'] as const;
export type VVia = (typeof V_VIA_VALUES)[number];

/** The Riello relation refusing the row's Gaia photometry. */
export interface VMagnitudeRefusal {
  tier: 'gaia_riello';
  reason: PhotometryRefusal;
}

/** Johnson V. `none` is a row no tier lights — a /docs/catalog-driver.md#61-record-parity park. */
export type VMagnitudeResolution = CascadeResult<UniformValues<VVia, number>, VMagnitudeRefusal>;

export interface VMagnitudeSources {
  photometry: GaiaPhotometry | null;
  printed: PrintedV | null;
  /** Sol only: it carries no identifier any tier above can key on, and V is a
   *  membership gate. See `SOL_APPARENT_V_MAGNITUDE`. */
  curatedV: number | null;
}

/** `G − V` from the Riello cubic — the algebra alone, ungated. Callers want
 *  {@link rielloVMagnitude}, which applies the relation's validity range. */
export function rielloGMinusV(bpMinusRp: number): number {
  return polynomial(RIELLO_G_MINUS_V_COEFFS, bpMinusRp);
}

/** Johnson V transformed from a Gaia photometry row, or the gate that refused
 *  it: a band missing or non-finite, or G below the saturation bound
 *  (`uncalibrated`), or the colour outside the published range. */
export function rielloVMagnitude(photometry: GaiaPhotometry): GatedValue {
  const calibrated = calibratedPhotometry(photometry);
  if (calibrated === null) return { kind: 'refused', reason: 'uncalibrated' };
  const { gMag, bpMinusRp } = calibrated;
  if (bpMinusRp < RIELLO_BP_RP_MIN || bpMinusRp > RIELLO_BP_RP_MAX) {
    return { kind: 'refused', reason: 'colour_out_of_range' };
  }
  return { kind: 'value', value: gMag - rielloGMinusV(bpMinusRp) };
}

export interface Tycho2VResolution {
  /** Johnson V, or null where the row carries fewer than both bands. */
  v: number | null;
  /** Whether `BT−VT` sat outside the range ESA 1997
   *  (/data/papers/index.md#esa1997) SP-1200 publishes the reduction
   *  over. The transform runs anyway — nothing below this tier could serve
   *  the row, and V is a membership gate, so gating would cost it its record
   *  (README.md#the-tycho-2-tier-runs-outside-its-published-colour-range).
   *  Pinned as `vTycho2OutsideBtVtRange` so an upstream shift is reviewed. */
  outsideRange: boolean;
}

/** Johnson V reduced from a Tycho-2 row's `BT`/`VT`, with the colour-range
 *  verdict the count needs — one read of the two bands, not two. */
export function tycho2VMagnitude(
  btMag: number | null,
  vtMag: number | null,
): Tycho2VResolution {
  if (
    btMag === null || vtMag === null
    || !Number.isFinite(btMag) || !Number.isFinite(vtMag)
  ) {
    return { v: null, outsideRange: false };
  }
  const colour = btMag - vtMag;
  return {
    v: vtMag - TYCHO2_V_FROM_VT_COEFF * colour,
    outsideRange:
      colour < TYCHO2_BT_MINUS_VT_MIN || colour > TYCHO2_BT_MINUS_VT_MAX,
  };
}

/** What each printed tier is keyed on: a HIP, a TYC, a GJ cell. */
interface PrintedVKey {
  printed_hip: number;
  tycho2: string;
  gliese: string;
}

/** Every printed tier bound to its parsed table. One bundle covering all three,
 *  because a site supplying only some of them silently narrows a binding gate
 *  to evidence the other side can still see (`/docs/catalog-driver.md#4-how-hd-reaches-gaia`). */
export type PrintedVLookups = {
  readonly [V in PrintedVVia]: (key: PrintedVKey[V]) => PrintedVAnswer[V] | null;
};

/** What a tier answers for one key. Tycho-2's reduction also says whether
 *  BT − VT sat outside the published range, which only that tier can know. */
interface PrintedVAnswer {
  printed_hip: { vMag: number };
  tycho2: { vMag: number; outsideRange: boolean };
  gliese: { vMag: number };
}

/** The keys a row offers each printed tier. */
export type PrintedVKeys = { readonly [V in PrintedVVia]: Iterable<PrintedVKey[V]> };

/** The printed V a row resolved to, the tier that supplied it, and the key
 *  that tier answered on. */
export type PrintedV = {
  [V in PrintedVVia]: { vVia: V; key: PrintedVKey[V] } & PrintedVAnswer[V];
}[PrintedVVia];

export function printedVLookups(
  hipVMag: ReadonlyMap<number, number>,
  tycho2: ReadonlyMap<string, Pick<Tycho2Row, 'btMag' | 'vtMag'>>,
  gliese: GlieseIndex,
): PrintedVLookups {
  const answer = (vMag: number | null) => (vMag === null ? null : { vMag });
  return {
    printed_hip: (hip) => answer(printedByHip(hipVMag, hip)),
    tycho2: (tyc) => {
      const row = tycho2.get(tyc);
      if (row === undefined) return null;
      const { v, outsideRange } = tycho2VMagnitude(row.btMag, row.vtMag);
      return v === null ? null : { vMag: v, outsideRange };
    },
    gliese: (gj) => answer(lookupGliese(gliese, gj)?.vMag ?? null),
  };
}

function brightestOnTier<V extends PrintedVVia>(
  vVia: V, keys: PrintedVKeys, lookups: PrintedVLookups,
): PrintedV | null {
  let best: (PrintedVAnswer[V] & { key: PrintedVKey[V] }) | null = null;
  for (const key of keys[vVia]) {
    const a = lookups[vVia](key);
    if (a !== null && Number.isFinite(a.vMag) && (best === null || a.vMag < best.vMag)) {
      best = { ...a, key };
    }
  }
  return best === null ? null : ({ vVia, ...best } as PrintedV);
}

/** The first printed tier that answers for any of a row's keys, in
 *  `PRINTED_V_TIERS` order — the V cascade's printed tiers and both binding
 *  gates read a printed V through this alone.
 *
 *  **Lists, not cells.** A spine row states one key per tier, but an overlay
 *  entry is keyed on a Gaia source that several HIPs or Tycho entries may route
 *  to, and the brightest of them is the one saturation is a property of. */
export function printedV(keys: PrintedVKeys, lookups: PrintedVLookups): PrintedV | null {
  for (const vVia of PRINTED_V_TIERS) {
    const found = brightestOnTier(vVia, keys, lookups);
    if (found !== null) return found;
  }
  return null;
}

/** V through the cascade: Riello-transformed Gaia photometry, else the
 *  printed V `printedV` resolved, else curated. Tier rationale — why the bright
 *  tier is a condition rather than a magnitude cut, and why there is no SIMBAD
 *  tier — in README.md#the-v-cascade. */
export function resolveVMagnitude(
  { photometry, printed, curatedV }: VMagnitudeSources,
): VMagnitudeResolution {
  const refusals: VMagnitudeRefusal[] = [];
  if (photometry !== null) {
    const transformed = rielloVMagnitude(photometry);
    if (transformed.kind === 'value') {
      return { via: 'gaia_riello', value: transformed.value, refusals };
    }
    refusals.push({ tier: 'gaia_riello', reason: transformed.reason });
  }
  if (printed !== null) {
    return { via: printed.vVia, value: printed.vMag, refusals };
  }
  if (curatedV !== null && Number.isFinite(curatedV)) {
    return { via: 'curated', value: curatedV, refusals };
  }
  return { via: 'none', refusals };
}

/** Whether a V from this tier is the whole SYSTEM's blended magnitude — every
 *  component the source catalogue failed to resolve, summed into one value.
 *  True for the printed tiers; `null` is a record no cascade ran on (a
 *  minted companion), per-component by construction. Which tiers blend and
 *  why: README.md#which-tiers-give-a-system-blend--vtierissystemblend.
 *
 *  Subtracting a companion's flux from a record double-counts unless gated on
 *  this — ../companions/README.md#anchor-flux-conservation-post-pass. */
export function vTierIsSystemBlend(via: VVia | null): boolean {
  return isPrintedVVia(via);
}
