// Test-only builders for Stage 6's inputs.

import { wdsPair } from '../../wds/wds-fixture';
import type { WdsPair } from '../../wds/wds-pure';
import type { Stage3Result } from '../astrometry/attach-astrometry';
import type { ComponentAstrometry, MeasuredAstrometry } from '../astrometry/routes-pure';
import type { ComponentKey } from '../component-tokens-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { SimbadWdsXid } from '../load/simbad-pure';
import type { OpticalVia } from '../optical/optical-tiers-pure';
import type { OrbitElements } from '../orbits/nss-elements-pure';
import { NO_ORBIT, type PairOrbit } from '../orbits/select-orbit-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed, indices, type Side } from '../resolve/resolve-fixture';
import { attachStage6, type Stage6Result } from './attach-multiples';

export function measured(over: Partial<MeasuredAstrometry> = {}): MeasuredAstrometry {
  return {
    astrometryVia: 'gaia_5p', raDeg: 100.0, decDeg: 0.0, parallaxMas: 10.0, parallaxErrorMas: 0.05,
    pmraMasyr: 1.0, pmdecMasyr: -1.0, refEpoch: 2016.0, ...over,
  };
}

export function elements(over: Partial<OrbitElements> = {}): OrbitElements {
  return {
    pDays: 365.25, tJd: 2451545.0, e: 0.1, aAu: null, iRad: null, periastronRad: 0.5, nodeRad: null, q: null, distancePc: 10.0,
    ...over,
  };
}

export interface PairSpec {
  readonly pair?: Partial<WdsPair>;
  readonly primary?: Side;
  readonly secondary?: Side;
  readonly astrometry?: readonly [ComponentAstrometry, ComponentAstrometry];
  readonly orbit?: PairOrbit;
  readonly optical?: OpticalVia;
}

/** Stage 6 over `specs`, each a kept pair with two Gaia-5p sides unless it says otherwise. */
export function runStage6(
  specs: readonly PairSpec[], ix: IdentifierIndices = indices(), xids: ReadonlyMap<ComponentKey, SimbadWdsXid> = new Map(),
): Stage6Result {
  const pairs: DecomposedPair[] = specs.map((s) =>
    decomposed(wdsPair(s.pair), { primary: s.primary ?? { resolveVia: 'orb6_hip' }, secondary: s.secondary ?? { resolveVia: 'orb6_hip' } }));
  const stage3: Stage3Result = {
    pairs,
    astrometry: new Map(pairs.map((p, i) => {
      const [primary, secondary] = specs[i].astrometry ?? [measured(), measured()];
      return [p, { primary, secondary }];
    })),
    siblingClaimed: [],
    nssOutcomes: [],
  };
  return attachStage6(
    stage3,
    { orbits: new Map(pairs.map((p, i) => [p, specs[i].orbit ?? NO_ORBIT])) },
    { optical: new Map(pairs.map((p, i) => [p, specs[i].optical ?? 'wds_notes_kept'])) },
    { indices: ix, simbadWdsXids: xids },
  );
}
