// Johnson V resolution from Gaia DR3 photometry, printed Hipparcos V,
// Tycho-2's BT/VT and Gliese's printed Vmag. See README.md.

import {
  calibratedPhotometry,
  polynomial,
  type GaiaPhotometry,
} from './gaia-photometry-pure';
import { lookupGliese, type GlieseIndex } from '../gliese-parse';
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

export const V_VIA_VALUES = ['gaia_riello', ...PRINTED_V_TIERS, 'curated', 'none'] as const;
export type VVia = (typeof V_VIA_VALUES)[number];

export interface VMagnitudeResolution {
  /** Johnson V, or null when no tier could supply one. */
  v: number | null;
  via: VVia;
}

/** `G − V` from the Riello cubic — the algebra alone, ungated. Callers want
 *  {@link rielloVMagnitude}, which applies the relation's validity range. */
export function rielloGMinusV(bpMinusRp: number): number {
  return polynomial(RIELLO_G_MINUS_V_COEFFS, bpMinusRp);
}

/** Johnson V transformed from a Gaia photometry row, or null when the Riello
 *  relation does not apply to it: a band missing or non-finite, G below the
 *  saturation bound, or the colour outside the published range. */
export function rielloVMagnitude(photometry: GaiaPhotometry | null): number | null {
  const calibrated = calibratedPhotometry(photometry);
  if (calibrated === null) return null;
  const { gMag, bpMinusRp } = calibrated;
  if (bpMinusRp < RIELLO_BP_RP_MIN || bpMinusRp > RIELLO_BP_RP_MAX) return null;
  return gMag - rielloGMinusV(bpMinusRp);
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
  readonly [V in PrintedVVia]: (key: PrintedVKey[V]) => number | null;
};

/** The keys a row offers each printed tier. */
export type PrintedVKeys = { readonly [V in PrintedVVia]: Iterable<PrintedVKey[V]> };

/** The printed V a row resolved to, the tier that supplied it, and the key
 *  that tier answered on. */
export type PrintedV = {
  [V in PrintedVVia]: { vVia: V; vMag: number; key: PrintedVKey[V] };
}[PrintedVVia];

export function printedVLookups(
  hipVMag: ReadonlyMap<number, number>,
  tycho2: ReadonlyMap<string, Pick<Tycho2Row, 'btMag' | 'vtMag'>>,
  gliese: GlieseIndex,
): PrintedVLookups {
  return {
    printed_hip: (hip) => hipVMag.get(hip) ?? null,
    tycho2: (tyc) => {
      const row = tycho2.get(tyc);
      return row === undefined ? null : tycho2VMagnitude(row.btMag, row.vtMag).v;
    },
    gliese: (gj) => lookupGliese(gliese, gj)?.vMag ?? null,
  };
}

function brightestOnTier<V extends PrintedVVia>(
  vVia: V, keys: PrintedVKeys, lookups: PrintedVLookups,
): PrintedV | null {
  let best: { vMag: number; key: PrintedVKey[V] } | null = null;
  for (const key of keys[vVia]) {
    const v = lookups[vVia](key);
    if (v !== null && Number.isFinite(v) && (best === null || v < best.vMag)) {
      best = { vMag: v, key };
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
  photometry: GaiaPhotometry | null,
  printed: PrintedV | null,
  curatedV: number | null = null,
): VMagnitudeResolution {
  const transformed = rielloVMagnitude(photometry);
  if (transformed !== null) {
    return { v: transformed, via: 'gaia_riello' };
  }
  if (printed !== null) {
    return { v: printed.vMag, via: printed.vVia };
  }
  // Sol only: it carries no identifier any tier above can key on, and V is a
  // membership gate. See `SOL_APPARENT_V_MAGNITUDE`.
  if (curatedV !== null && Number.isFinite(curatedV)) {
    return { v: curatedV, via: 'curated' };
  }
  return { v: null, via: 'none' };
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
  return (PRINTED_V_TIERS as readonly (VVia | null)[]).includes(via);
}
