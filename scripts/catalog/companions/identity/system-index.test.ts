import { describe, expect, it } from 'vitest';
import { makeStar } from '../../parse/star-fixture';
import { multiplesRow } from '../multiples-fixture';
import { SystemIndex } from './system-index';

describe('SystemIndex', () => {
  const primary = makeStar({ gaiaSourceId: '100', hip: 32349, printedName: 'Sirius', x: 2.6 });
  const secondary = makeStar({ gaiaSourceId: '200', x: 2.6 });

  it('matches a secondary on HIP only when it carries no Gaia source', () => {
    const index = new SystemIndex([], [primary, secondary]);
    expect(index.findExisting(multiplesRow({ gaiaSourceId: '999', hip: 32349 }))).toBeNull();
    expect(index.findExisting(multiplesRow({ hip: 32349 }))).toBe(0);
    expect(index.findExisting(multiplesRow({ gaiaSourceId: '200', hip: 32349 }))).toBe(1);
  });

  it('matches a cursor primary on HIP even with an unmatched Gaia source, and on a name only at its position', () => {
    const index = new SystemIndex([], [primary, secondary]);
    expect(index.findExistingPrimary(multiplesRow({ gaiaSourceId: '999', hip: 32349, orbitRole: 'primary' }))).toBe(0);
    expect(index.findExistingPrimary(multiplesRow({ name: 'Sirius', x_pc: 2.6, y_pc: 0, z_pc: 0, orbitRole: 'primary' }))).toBe(0);
    expect(index.findExistingPrimary(multiplesRow({ name: 'Sirius', x_pc: 2.8, y_pc: 0, z_pc: 0, orbitRole: 'primary' }))).toBeNull();
  });

  it('takes the more canonical held primary as the root anchor, and groups rows per system', () => {
    const rows = [
      multiplesRow({ systemId: '00001+0001-AaAb', comp: 'Aa', orbitRole: 'primary', gaiaSourceId: '200' }),
      multiplesRow({ systemId: '00001+0001-AaAb', comp: 'Ab' }),
      multiplesRow({ systemId: '00001+0001-AB', comp: 'A', orbitRole: 'primary', gaiaSourceId: '100' }),
      multiplesRow({ systemId: '00001+0001-AB', comp: 'B' }),
    ];
    const index = new SystemIndex(rows, [primary, secondary]);
    expect(index.rootAnchor('00001+0001')?.catalogIdx).toBe(0);
    expect(index.rootAnchor(null)).toBeUndefined();
    expect([...index.groups.keys()]).toEqual(['00001+0001-AaAb', '00001+0001-AB']);
    expect(index.groups.get('00001+0001-AB')?.secondaries.map((r) => r.comp)).toEqual(['B']);
  });

  it('confirms a compound only from single letters resolved elsewhere in its root', () => {
    const rows = [
      multiplesRow({ systemId: '04153-0739-AB', comp: 'A', orbitRole: 'primary' }),
      multiplesRow({ systemId: '04153-0739-AB', comp: 'B' }),
      multiplesRow({ systemId: '04153-0739-BC', comp: 'B', orbitRole: 'primary' }),
      multiplesRow({ systemId: '04153-0739-BC', comp: 'C' }),
    ];
    const index = new SystemIndex(rows, []);
    expect(index.isUnresolvedCompound('BC', '04153-0739')).toBe(true);
    expect(index.isUnresolvedCompound('BD', '04153-0739')).toBe(false);
    expect(index.isUnresolvedCompound('Aa', '04153-0739')).toBe(false);
  });
});
