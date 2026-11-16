import { describe, expect, it } from 'vitest';

import { HD, HIP } from '../simbad/simbad-specs-pure';
import { REACHED_CLASSES, WHOLE_SKY_CLASSES, identsByOid, identsRows } from './simbad-idents-pure';

describe('identsByOid', () => {
  it('collapses SIMBAD\'s padding and keeps only the asked classes', () => {
    const held = identsByOid([['7', '*  39 Psc'], ['7', 'HD   1352'], ['8', 'NAME Elnath']], WHOLE_SKY_CLASSES);
    expect(held).toEqual(new Map([[7, new Set(['* 39 Psc'])], [8, new Set(['NAME Elnath'])]]));
  });

  it('reads a double-star ident as its own class, not the Bayer/Flamsteed one', () => {
    expect(identsByOid([['9', '** STF 2398A']], WHOLE_SKY_CLASSES)).toEqual(new Map());
    expect(identsByOid([['9', '** STF 2398A']], REACHED_CLASSES)).toEqual(new Map([[9, new Set(['** STF 2398A'])]]));
  });
});

describe('identsRows', () => {
  it('writes one row per object in oid order, keys numerically ordered and idents by code unit', () => {
    const keys = new Map([[3, new Map([[HIP.name, new Set(['100', '20'])], [HD.name, new Set(['5'])]])]]);
    const rows = identsRows(new Map([[3, new Set(['NAME b', '* a'])], [1, new Set(['Ross 128'])]]), keys, new Map([[3, { main_id: 'x' }]]));
    expect(rows).toEqual([
      ['1', null, null, null, null, null, 'Ross 128'],
      ['3', 'x', '20|100', '5', null, null, '* a|NAME b'],
    ]);
  });
});
