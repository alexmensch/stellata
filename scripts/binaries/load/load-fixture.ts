// Test-only builders for the Stage 1 row types.

import type { AthygRow } from './athyg-pure';
import type { GaiaAstrometryRow } from './gaia-pure';
import type { MscOrbitRow, MscSystemRow } from './msc-pure';

export const FIXTURE = { file: 'fixture/binaries.tsv', hint: 'h' } as const;

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
