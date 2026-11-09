// Test-only builders for the WDS summary and ORB6 row types.

import type { Orb6Entry, WdsPair } from './wds-pure';

export function wdsPair(over: Partial<WdsPair> = {}): WdsPair {
  return {
    wdsId: 'WDS-1', discoverer: 'TST   1', components: 'AB',
    dateLast: 2020, rhoLast: 5.0, thetaLast: 90.0, magPri: 4.0, magSec: 6.0,
    spectral: '', notes: '    ', precise: { raDeg: 100.0, decDeg: 0.0 },
    nObs: null, dateFirst: null, thetaFirst: null, rhoFirst: null,
    ...over,
  };
}

export function blankPair(wdsId: string, discoverer = 'TST   1'): WdsPair {
  return wdsPair({
    wdsId, discoverer, components: '', dateLast: null, rhoLast: null, thetaLast: null,
    magPri: null, magSec: null, precise: null,
  });
}

export function orb6Entry(over: Partial<Orb6Entry> = {}): Orb6Entry {
  return {
    wdsId: '00000+0000', discoverer: 'TST   1', components: 'AB', hd: null, hip: null,
    pVal: 50.0, pUnit: 'y', aVal: 1.0, aUnit: 'a', iDeg: 90.0, nodeDeg: 45.0, periastronDeg: 30.0,
    e: 0.5, t0Val: 1990.0, t0Unit: 'y', grade: 2, ref: 'Ref2020', precise: null,
    ...over,
  };
}
