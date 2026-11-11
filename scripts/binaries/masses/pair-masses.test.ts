import { describe, expect, it } from 'vitest';
import { wdsPair } from '../../wds/wds-fixture';
import { componentKey } from '../component-tokens-pure';
import { decomposed, indices } from '../resolve/resolve-fixture';
import { massFromSpectralClass } from './mass-estimate-pure';
import { pairMasses, UNKNOWN_COMPONENT_MASS_MSUN } from './pair-masses';

const W = '10000+0000';
const key = (c: string) => componentKey(W, c);

describe('pairMasses', () => {
  it('sums both sides, an unknown type at the generous default', () => {
    const ix = indices({ simbadWdsSpectra: new Map([[key('A'), 'G2V'], [key('B'), '???']]) });
    const p = decomposed(wdsPair({ wdsId: W, components: 'AB' }));
    expect(pairMasses([p], ix).get(p)).toBe(massFromSpectralClass('G2V')! + UNKNOWN_COMPONENT_MASS_MSUN);
  });
});
