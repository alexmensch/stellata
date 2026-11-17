import { describe, expect, it } from 'vitest';
import { componentKey } from '../component-tokens-pure';
import { orb6Entry, wdsPair } from '../../wds/wds-fixture';
import { componentsOf, type DecomposedPair } from './components-pure';
import { decomposed, indices, xid } from './resolve-fixture';
import { refuseHipsOfDisjointStars } from './sibling-identity-pure';

const WDS = '08159-3056';
const A_SOURCE = '5548310466041819392';
const B_SOURCE = '5548310466056188416';
const HIP = 40476;
const row = (components: string) => wdsPair({ wdsId: WDS, discoverer: 'BU  454', components });
const parentB = { kind: 'inherited', from: 'B', how: 'parent' } as const;

function hd69445(b: { gaiaSourceId: string | null; hip: number | null }) {
  return [
    decomposed(row('AB'), {
      primary: { gaiaSourceId: A_SOURCE },
      secondary: { ...b, hipOrigin: { kind: 'inherited', from: 'Bb', how: 'letter' } },
    }),
    decomposed(row('Ba,Bb'), {
      primary: { gaiaSourceId: B_SOURCE, resolveVia: 'position_pm' },
      secondary: { gaiaSourceId: b.gaiaSourceId, gaiaOrigin: parentB, hip: b.hip, hipOrigin: parentB },
    }),
  ];
}

const hips = (pairs: readonly DecomposedPair[]) =>
  componentsOf(pairs).map((c) => `${c.component}:${c.hip?.value ?? '-'}`);

describe('refuseHipsOfDisjointStars', () => {
  it('takes HIP 40476 off HD 69445 B and Bb, which hold B\'s own source while A holds the HIP\'s', () => {
    const r = refuseHipsOfDisjointStars(
      hd69445({ gaiaSourceId: B_SOURCE, hip: HIP }), indices({ hipToGaia: new Map([[HIP, A_SOURCE]]) }), new Map(), [],
    );
    expect(hips(r.pairs)).toEqual(['A:-', 'B:-', 'Ba:-', 'Bb:-']);
    expect(r.refused.map((x) => [x.gate, x.pair.components, x.component, x.hip])).toEqual([
      ['hip_of_disjoint_star', 'AB', 'B', HIP],
      ['hip_of_disjoint_star', 'Ba,Bb', 'Bb', HIP],
    ]);
  });

  it('reads the manifest\'s source for a HIP the cross-walk misses', () => {
    const r = refuseHipsOfDisjointStars(
      hd69445({ gaiaSourceId: B_SOURCE, hip: HIP }), indices({ hipToManifestGaia: new Map([[HIP, A_SOURCE]]) }), new Map(), [],
    );
    expect(r.refused).toHaveLength(2);
  });

  it('keeps the HIP where SIMBAD puts it on the component\'s parent letter', () => {
    const r = refuseHipsOfDisjointStars(
      hd69445({ gaiaSourceId: B_SOURCE, hip: HIP }), indices({ hipToGaia: new Map([[HIP, A_SOURCE]]) }),
      new Map([[componentKey(WDS, 'B'), xid(WDS, 'B', B_SOURCE, HIP)]]), [],
    );
    expect(r.refused).toEqual([]);
  });

  it('keeps 36 Oph A\'s HIP, which ORB6 names on A while Gaia\'s cross-walk puts it on B\'s source', () => {
    const oph = '17153-2636';
    const pairs = [decomposed(wdsPair({ wdsId: oph, components: 'AB' }), {
      primary: { gaiaSourceId: '4109030160308320128', hip: 84405 }, secondary: { gaiaSourceId: '4109030160308317312' },
    })];
    const r = refuseHipsOfDisjointStars(
      pairs, indices({ hipToGaia: new Map([[84405, '4109030160308317312']]) }), new Map(),
      [orb6Entry({ wdsId: oph, components: 'AB', hip: 84405 })],
    );
    expect(r.refused).toEqual([]);
  });

  it('keeps the HIP on a component Gaia does not separate from the HIP\'s star', () => {
    const r = refuseHipsOfDisjointStars(
      hd69445({ gaiaSourceId: A_SOURCE, hip: HIP }), indices({ hipToGaia: new Map([[HIP, A_SOURCE]]) }), new Map(), [],
    );
    expect(r.refused).toEqual([]);
  });

  it('keeps the HIP on a component with no Gaia source', () => {
    const r = refuseHipsOfDisjointStars(
      hd69445({ gaiaSourceId: null, hip: HIP }), indices({ hipToGaia: new Map([[HIP, A_SOURCE]]) }), new Map(), [],
    );
    expect(hips(r.pairs)).toEqual(['A:-', 'B:40476', 'Ba:-', 'Bb:40476']);
  });

  it('keeps the HIP when only a compound containing the component holds its source', () => {
    const pairs = [
      decomposed(row('AB,C'), { primary: { gaiaSourceId: A_SOURCE }, secondary: { gaiaSourceId: '7' } }),
      decomposed(row('AB'), { primary: { gaiaSourceId: '8' }, secondary: { gaiaSourceId: B_SOURCE, hip: HIP } }),
    ];
    const r = refuseHipsOfDisjointStars(pairs, indices({ hipToGaia: new Map([[HIP, A_SOURCE]]) }), new Map(), []);
    expect(r.refused).toEqual([]);
  });

  it('keeps the HIP when no letter of the system holds its source', () => {
    const r = refuseHipsOfDisjointStars(
      hd69445({ gaiaSourceId: B_SOURCE, hip: HIP }), indices({ hipToGaia: new Map([[HIP, '9']]) }), new Map(), [],
    );
    expect(r.refused).toEqual([]);
  });
});
