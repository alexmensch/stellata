// Stage 4: each pair's orbit, keyed by DecomposedPair, and the counts it completes. See README.md.

import { fold, share, sumOf, type Share } from '../../util/counts/tally-pure';
import type { Orb6Entry } from '../../wds/wds-pure';
import type { Stage3Result } from '../astrometry/attach-astrometry';
import { systemParallaxAnchors } from '../astrometry/system-anchors-pure';
import { canonicalCompLetter, pairRowKey, type PairRowKey } from '../component-tokens-pure';
import { mscPairKey } from '../load/msc-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import { ORBIT_VIA, ORBIT_VIA_ON_FILE, type OrbitVia } from '../multiples-record-pure';
import { groupOrb6ByPair } from '../resolve/cascade-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { selectOrbit, type OrbitCandidate, type PairOrbit } from './select-orbit-pure';

export interface Stage4Result {
  /** One per Stage 3 pair. */
  readonly orbits: ReadonlyMap<DecomposedPair, PairOrbit>;
  /** Every orbit row each pair's cascade weighed, the chosen one among them. */
  readonly candidates: ReadonlyMap<DecomposedPair, readonly OrbitCandidate[]>;
}

function frozen(orbit: PairOrbit): PairOrbit {
  if (orbit.orbitVia !== 'none') Object.freeze(orbit.elements);
  return Object.freeze(orbit);
}

export function attachStage4(stage3: Stage3Result, reference: ReferenceCatalogs): Stage4Result {
  const orb6ByPair: ReadonlyMap<PairRowKey, readonly Orb6Entry[]> = groupOrb6ByPair(reference.orb6);
  const systemParallax = systemParallaxAnchors(stage3.pairs, stage3.astrometry);
  const { msc, srcToNss } = reference.indices;
  const orbits = new Map<DecomposedPair, PairOrbit>();
  const weighed = new Map<DecomposedPair, readonly OrbitCandidate[]>();
  for (const p of stage3.pairs) {
    const [primary, secondary] = p.tokens;
    const candidates = {
      orb6: orb6ByPair.get(pairRowKey(p.pair.wdsId, p.pair.components)) ?? [],
      msc: msc.orbitsByPair.get(mscPairKey(p.pair.wdsId, primary, canonicalCompLetter(primary, secondary)))?.rows ?? [],
      systemParallaxMas: systemParallax.get(p.pair.wdsId)?.parallaxMas ?? null,
    };
    const decision = selectOrbit(p, stage3.astrometry.get(p)!, candidates, srcToNss);
    orbits.set(p, frozen(decision.orbit));
    weighed.set(p, Object.freeze(decision.candidates.map((c) => Object.freeze(c))));
  }
  return Object.freeze({ orbits, candidates: weighed });
}

export function orbitTally(result: Stage4Result): Record<OrbitVia, number> {
  return fold(ORBIT_VIA, [...result.orbits.values()], (o) => o.orbitVia);
}

export type Stage4Counts = Record<`orbit_${OrbitVia}`, number>;

/** The share of pairs with elements whose elements are Gaia NSS's. */
export function stage4Rates(counts: Stage4Counts): Record<'nss_orbit_rate', Share> {
  const onFile = sumOf(counts, 'orbit_', ORBIT_VIA_ON_FILE);
  return { nss_orbit_rate: share(counts.orbit_gaia_nss, onFile) };
}
