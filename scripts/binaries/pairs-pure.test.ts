import { describe, expect, it } from 'vitest';

import { NO_PARENT } from '../../src/catalog-format/binaries/binaries-format';
import { multiplesRow } from '../catalog/companions/multiples-fixture';
import { ORBIT, pair } from './pair-fixture';
import { assignParentRelations, pairsFromRows, topologicalWalkOrder } from './pairs-pure';

describe('pairsFromRows', () => {
  it('joins a system’s primary and secondary, the elements from the primary', () => {
    const [p] = pairsFromRows([
      multiplesRow({ systemId: '03082+4057-Aa1,2', comp: 'Aa1', orbitRole: 'primary', hip: 14576, pDays: 2.87 }),
      multiplesRow({ systemId: '03082+4057-Aa1,2', comp: '2', orbitRole: 'secondary', gaiaSourceId: '9' }),
    ]);
    expect(p).toMatchObject({
      primaryComp: 'Aa1', secondaryComp: 'Aa2',
      primaryHip: 14576, secondaryGaia: '9', elements: { pDays: 2.87 },
    });
  });

  it('throws on a system with two rows in one role', () => {
    const row = multiplesRow({ systemId: '00000+0000-AB', comp: 'A', orbitRole: 'primary' });
    expect(() => pairsFromRows([row, { ...row }])).toThrow(/two primary rows/);
  });

  it('skips standalone rows', () => {
    expect(pairsFromRows([multiplesRow({ systemId: '-_C', comp: 'C', orbitRole: 'standalone' })])).toEqual([]);
  });

  it('throws on a system missing a side', () => {
    expect(() => pairsFromRows([multiplesRow({ systemId: '00000+0000-AB', comp: 'A', orbitRole: 'primary' })]))
      .toThrow(/no secondary row/);
    expect(() => pairsFromRows([multiplesRow({ systemId: '00000+0000-AB', comp: 'B', orbitRole: 'secondary' })]))
      .toThrow(/no primary row/);
  });

  it('throws on a system_id with no WDS id', () => {
    expect(() => pairsFromRows([
      multiplesRow({ systemId: 'NODASH', comp: 'A', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'NODASH', comp: 'B', orbitRole: 'secondary' }),
    ])).toThrow(/no WDS id/);
  });
});

describe('assignParentRelations', () => {
  it('a top-level pair has no parent', () => {
    expect(assignParentRelations([pair()])).toEqual([NO_PARENT]);
  });

  it('an inner pair finds the outer pair naming its parent token (Algol)', () => {
    expect(assignParentRelations([pair('03082+4057-Aa,Ab'), pair('03082+4057-Aa1,Aa2')]))
      .toEqual([NO_PARENT, 0]);
  });

  it('nests a WDS-truncated inner pair through its re-anchored tokens', () => {
    expect(assignParentRelations([pair('03082+4057-Aa,Ab'), pair('03082+4057-Aa1,2')]))
      .toEqual([NO_PARENT, 0]);
  });

  it('pairs in different systems are never parents of each other', () => {
    expect(assignParentRelations([pair('00000+0000-AB'), pair('11111+1111-AB')]))
      .toEqual([NO_PARENT, NO_PARENT]);
  });

  it('prefers the bound parent over an element-less wide pair (Castor)', () => {
    // A sits in both the bound AB and the wide AC; Aa,Ab nests under AB. AC
    // comes last so a last-write-wins bucket would pick it.
    const ab = pair('07346+3153-AB', { ...ORBIT, sepArcsec: 5.4 });
    const aaAb = pair('07346+3153-Aa,Ab', { ...ORBIT, sepArcsec: 0 });
    const ac = pair('07346+3153-AC', { sepArcsec: 69.6 });
    expect(assignParentRelations([ab, aaAb, ac])).toEqual([NO_PARENT, 0, NO_PARENT]);
  });
});

describe('topologicalWalkOrder', () => {
  it('roots alone keep input order', () => {
    expect(topologicalWalkOrder([NO_PARENT, NO_PARENT, NO_PARENT])).toEqual([0, 1, 2]);
  });

  it('a parent listed after its child is still emitted first', () => {
    expect(topologicalWalkOrder([1, NO_PARENT])).toEqual([1, 0]);
  });

  it('a dangling parent link falls through as an orphan', () => {
    expect(topologicalWalkOrder([NO_PARENT, 5])).toEqual([0, 1]);
  });

  it('a multi-level chain runs outer to inner', () => {
    expect(topologicalWalkOrder([NO_PARENT, 0, 1])).toEqual([0, 1, 2]);
  });
});
