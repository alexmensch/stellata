// Test-only builders for the Stage 1 row types.

import type { AthygRow } from './athyg-pure';
import type { GaiaAstrometryRow } from './gaia-pure';
import type { MscOrbitRow, MscSystemRow } from './msc-pure';
import type { Orb6Entry, WdsPair } from './wds-pure';

export const FIXTURE = { file: 'fixture/binaries.tsv', hint: 'h' } as const;

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

export function mscSystem(over: Partial<MscSystemRow> = {}): MscSystemRow {
  return {
    wdsId: '10000+0000', prim: 'A', sec: 'B', parent: '*', obsType: '',
    vmag1: null, spt1: '', vmag2: null, spt2: '',
    ...over,
  };
}

export function mscOrbit(over: Partial<MscOrbitRow> = {}): MscOrbitRow {
  return {
    wdsId: '10000+0000', syst: 'Aa,Ab', per: 6.0663, perUnit: 'd', t0: 40087.19, e: 0.25,
    aArcsec: null, nodeDeg: null, longpDeg: 31.4, inclDeg: null, note: '',
    ...over,
  };
}

export function athygRow(over: Partial<AthygRow> = {}): AthygRow {
  return {
    hip: null, tyc: null, gaia: null, hd: null, raDeg: 0, decDeg: 0, xPc: 0, yPc: 0, zPc: 0,
    distPc: 1, vMag: null, absmag: 5, ci: null, spect: '', proper: '', pmRaMasyr: null, pmDecMasyr: null,
    ...over,
  };
}

export function gaiaAstrometryRow(over: Partial<GaiaAstrometryRow> = {}): GaiaAstrometryRow {
  return {
    sourceId: '1', raDeg: 0, decDeg: 0, parallaxMas: 10, parallaxErrorMas: 0.05,
    pmraMasyr: 0, pmraErrorMasyr: 0.05, pmdecMasyr: 0, pmdecErrorMasyr: 0.05, refEpoch: 2016,
    ruwe: 1.0, ipdFracMultiPeak: 0, gMag: null, bpMag: null, rpMag: null,
    ...over,
  };
}
