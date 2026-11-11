// Each WDS system's first measured parallax and proper motion, read off Stage 3's astrometry. See README.md.

import type { DecomposedPair } from '../resolve/components-pure';
import type { ComponentAstrometry, MeasuredAstrometry, PairAstrometry } from './routes-pure';

/** Null for an unresolved side and for a non-positive parallax, which maps to no distance. */
export function positiveParallaxMas(a: ComponentAstrometry): number | null {
  return a.astrometryVia !== 'unresolved' && a.parallaxMas !== null && a.parallaxMas > 0 ? a.parallaxMas : null;
}

export interface ParallaxAnchor {
  readonly parallaxMas: number;
  /** Null where the catalogue states none (some HIP2 rows). */
  readonly parallaxErrorMas: number | null;
}

export interface PmAnchor {
  readonly pmraMasyr: number;
  readonly pmdecMasyr: number;
}

/** README.md#system-anchors */
function firstPerSystem<T>(
  pairs: readonly DecomposedPair[],
  astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>,
  extract: (a: MeasuredAstrometry) => T | null,
): ReadonlyMap<string, T> {
  const out = new Map<string, T>();
  for (const p of pairs) {
    const wdsId = p.pair.wdsId;
    if (out.has(wdsId)) continue;
    const { primary, secondary } = astrometry.get(p)!;
    for (const a of [primary, secondary]) {
      const value = a.astrometryVia === 'unresolved' ? null : extract(a);
      if (value !== null) {
        out.set(wdsId, value);
        break;
      }
    }
  }
  return out;
}

export function systemParallaxAnchors(
  pairs: readonly DecomposedPair[], astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>,
): ReadonlyMap<string, ParallaxAnchor> {
  return firstPerSystem(pairs, astrometry, (a) => {
    const parallaxMas = positiveParallaxMas(a);
    return parallaxMas === null ? null : { parallaxMas, parallaxErrorMas: a.parallaxErrorMas };
  });
}

export function systemPmAnchors(
  pairs: readonly DecomposedPair[], astrometry: ReadonlyMap<DecomposedPair, PairAstrometry>,
): ReadonlyMap<string, PmAnchor> {
  return firstPerSystem(pairs, astrometry, (a) =>
    a.pmraMasyr === null || a.pmdecMasyr === null ? null : { pmraMasyr: a.pmraMasyr, pmdecMasyr: a.pmdecMasyr });
}
