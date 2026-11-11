// Stage 4: each pair's orbit, keyed by DecomposedPair, and the counts it completes. See README.md.

import { fold, prefixed } from '../../util/counts/tally-pure';
import type { Orb6Entry } from '../../wds/wds-pure';
import type { Stage3Result } from '../astrometry/attach-astrometry';
import { systemParallaxes } from '../astrometry/system-anchors-pure';
import { canonicalCompLetter, pairRowKey, type PairRowKey } from '../component-tokens-pure';
import { isPlausibleT0Jd } from '../epochs-pure';
import { mscPairKey } from '../load/msc-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import { ORBIT_VIA, ORBIT_VIA_ON_FILE, type OrbitVia } from '../multiples-tsv';
import { groupOrb6ByPair } from '../resolve/cascade-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { selectOrbit, type PairOrbit } from './select-orbit-pure';

export interface Stage4Result {
  /** One per Stage 3 pair. */
  readonly orbits: ReadonlyMap<DecomposedPair, PairOrbit>;
}

function checkedEpoch(p: DecomposedPair, orbit: PairOrbit): PairOrbit {
  if (orbit.orbitVia === 'none') return orbit;
  const { pDays, tJd } = orbit.elements;
  if (pDays !== null && tJd !== null && !isPlausibleT0Jd(tJd)) {
    throw new Error(`Stage 4 periastron epoch out of range for ${p.pair.wdsId}/${p.pair.components} via ${orbit.orbitVia}: T_jd=${tJd}`);
  }
  return Object.freeze({ ...orbit, elements: Object.freeze({ ...orbit.elements }) });
}

/** Throws on an emitted epoch outside the plausible window: every reading refuses one, so it is a bug. */
export function attachStage4(stage3: Stage3Result, reference: ReferenceCatalogs): Stage4Result {
  const orb6ByPair: ReadonlyMap<PairRowKey, readonly Orb6Entry[]> = groupOrb6ByPair(reference.orb6);
  const systemParallax = systemParallaxes(stage3.pairs, stage3.astrometry);
  const { msc, srcToNss } = reference.indices;
  const orbits = new Map<DecomposedPair, PairOrbit>();
  for (const p of stage3.pairs) {
    const [primary, secondary] = p.tokens;
    const candidates = {
      orb6: orb6ByPair.get(pairRowKey(p.pair.wdsId, p.pair.components)) ?? [],
      msc: msc.orbitsByPair.get(mscPairKey(p.pair.wdsId, primary, canonicalCompLetter(primary, secondary)))?.rows ?? [],
      systemParallaxMas: systemParallax.get(p.pair.wdsId) ?? null,
    };
    orbits.set(p, checkedEpoch(p, selectOrbit(p, stage3.astrometry.get(p)!, candidates, srcToNss)));
  }
  return Object.freeze({ orbits });
}

export function orbitTally(result: Stage4Result): Record<OrbitVia, number> {
  return fold(ORBIT_VIA, [...result.orbits.values()], (o) => o.orbitVia);
}

export type Stage4Counts = Record<`orbit_${OrbitVia}`, number>;

export function stage4Counts(result: Stage4Result): Stage4Counts {
  return prefixed('orbit_', orbitTally(result));
}

/** The share of pairs with elements whose elements are Gaia NSS's. */
export function stage4Rates(counts: Stage4Counts): Record<'nss_orbit_rate', number> {
  const onFile = ORBIT_VIA_ON_FILE.reduce((n, v) => n + counts[`orbit_${v}`], 0);
  return { nss_orbit_rate: onFile > 0 ? counts.orbit_gaia_nss / onFile : 0 };
}
