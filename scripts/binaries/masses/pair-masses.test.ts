import { describe, expect, it } from 'vitest';
import { wdsPair } from '../../wds/wds-fixture';
import { componentKey } from '../component-tokens-pure';
import { athygRow } from '../load/load-fixture';
import { decomposed, indices, resolved } from '../resolve/resolve-fixture';
import { athygRowFor, resolveSpect } from './component-spect-pure';
import { massFromSpectralClass } from './mass-estimate-pure';
import { pairMasses, UNKNOWN_COMPONENT_MASS_MSUN } from './pair-masses';

const W = '10000+0000';
const key = (c: string) => componentKey(W, c);

describe('resolveSpect', () => {
  const ix = indices({
    componentSptypeOverrides: new Map([[key('A'), 'K0IV']]),
    simbadWdsSpectra: new Map([[key('A'), 'G2V'], [key('B'), 'DA2']]),
    mscSpectByComp: new Map([[key('B'), 'A6'], [key('C'), 'A6']]),
  });
  const row = athygRow({ spect: 'F0V' });

  it('takes curated, then SIMBAD, then the MSC, then AT-HYG', () => {
    expect(resolveSpect(W, 'A', row, ix)).toEqual({ spect: 'K0IV', spectVia: 'curated' });
    expect(resolveSpect(W, 'B', row, ix)).toEqual({ spect: 'DA2', spectVia: 'simbad' });
    expect(resolveSpect(W, 'C', row, ix)).toEqual({ spect: 'A6', spectVia: 'msc' });
    expect(resolveSpect(W, 'D', row, ix)).toEqual({ spect: 'F0V', spectVia: 'athyg' });
  });

  it('is none with no row, and with a row stating no type', () => {
    expect(resolveSpect(W, 'D', null, ix)).toEqual({ spect: '', spectVia: 'none' });
    expect(resolveSpect(W, 'D', athygRow(), ix)).toEqual({ spect: '', spectVia: 'none' });
  });
});

describe('athygRowFor', () => {
  const byGaia = athygRow({ gaia: '7', spect: 'G' });
  const byHip = athygRow({ hip: 9, spect: 'H' });
  const ix = indices({ athyg: [byGaia, byHip] });
  const own = athygRow({ spect: 'own' });

  it('takes the position-matched row, then the Gaia source\'s, then the HIP\'s', () => {
    expect(athygRowFor(resolved({ athygRow: own, gaiaSourceId: '7', hip: 9 }), ix)).toBe(own);
    expect(athygRowFor(resolved({ gaiaSourceId: '7', hip: 9 }), ix)).toBe(byGaia);
    expect(athygRowFor(resolved({ gaiaSourceId: '8', hip: 9 }), ix)).toBe(byHip);
    expect(athygRowFor(resolved({ gaiaSourceId: '8' }), ix)).toBeNull();
  });
});

describe('pairMasses', () => {
  it('sums both sides, an unknown type at the generous default', () => {
    const ix = indices({ simbadWdsSpectra: new Map([[key('A'), 'G2V'], [key('B'), '???']]) });
    const p = decomposed(wdsPair({ wdsId: W, components: 'AB' }));
    expect(pairMasses([p], ix).get(p)).toBe(massFromSpectralClass('G2V')! + UNKNOWN_COMPONENT_MASS_MSUN);
  });
});
