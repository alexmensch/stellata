// The parallaxes a tier refused, indexed by id, and the test for a pair row re-serving one. See README.md#refused-parallax-refusal.

import type { ParkedReason } from '../../distance/parallax/parked-ledger-pure';

/** Indexed on both ids, siblings included — README.md#refused-parallax-refusal.
 *  Takes the structural minimum, not `ParkedRecord`, so promotion does not
 *  import the walk that produced it. */
export interface ParkedRefusals {
  gaia: ReadonlyMap<string, readonly RefusedParallax[]>;
  hip: ReadonlyMap<number, readonly RefusedParallax[]>;
}

/** One refused parallax, mas, and the origin key of the record it parked. */
export interface RefusedParallax {
  mas: number;
  parked: string;
}

export function emptyParkedRefusals(): ParkedRefusals {
  return { gaia: new Map(), hip: new Map() };
}

export function parkedRefusals(
  parked: readonly {
    gaiaSourceId: string | null;
    hip: number | null;
    reason: ParkedReason;
    refusedPlxMas: readonly number[];
    originKey: string;
  }[],
): ParkedRefusals {
  const gaia = new Map<string, RefusedParallax[]>();
  const hip = new Map<number, RefusedParallax[]>();
  const add = <K>(index: Map<K, RefusedParallax[]>, key: K, refused: readonly RefusedParallax[]) => {
    const held = index.get(key);
    if (held === undefined) index.set(key, [...refused]);
    else held.push(...refused);
  };
  for (const p of parked) {
    if (p.reason !== 'refused_no_defensible_parallax') continue;
    const refused = p.refusedPlxMas.map((mas) => ({ mas, parked: p.originKey }));
    if (p.gaiaSourceId !== null) add(gaia, p.gaiaSourceId, refused);
    if (p.hip !== null && p.hip > 0) add(hip, p.hip, refused);
  }
  return { gaia, hip };
}

/** Calibrated in ../../distance/parallax/README.md#companion-promotion-may-not-walk-a-refused-measurement-back-in.
 *  A relative bound on an absolute rounding: below ~5 pc a four-decimal cell
 *  falls outside it, so re-measure if a refused row's pair ever lands there. */
export const REFUSED_PARALLAX_MATCH_REL_TOL = 1e-5;

/** The parked record's origin key, matched on the stated distance, never the id alone. */
export function refusalStated(
  refusals: ParkedRefusals,
  row: {
    gaiaSourceId: string | null; hip: number | null; distPc: number | null;
  },
): string | null {
  if (row.distPc === null || row.distPc <= 0) return null;
  const refused = [
    ...(row.gaiaSourceId !== null
      ? refusals.gaia.get(row.gaiaSourceId) ?? [] : []),
    ...(row.hip !== null && row.hip > 0 ? refusals.hip.get(row.hip) ?? [] : []),
  ];
  return refused.find(({ mas }) => Math.abs(1000 / mas - row.distPc!)
    <= REFUSED_PARALLAX_MATCH_REL_TOL * row.distPc!)?.parked ?? null;
}
