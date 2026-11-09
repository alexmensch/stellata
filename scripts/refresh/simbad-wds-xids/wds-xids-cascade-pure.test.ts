import { describe, expect, it } from 'vitest';

import { parseLedger } from '../simbad/simbad-fetch-pure';
import { HD, HIP } from '../simbad/simbad-specs-pure';
import {
  cascadeCandidates, cascadeRecoveries, catalogueAlias, resolveHip, type CatalogueAlias,
} from './wds-xids-cascade-pure';

const SIRIUS = '06451-1643';
const hip = (number: string, letter: string | null = null): CatalogueAlias => ({ number, letter });

describe('catalogueAlias', () => {
  it('reads an HD number at any padding, with or without a component letter', () => {
    const ledger = parseLedger();
    expect(catalogueAlias(HD, 'HD  48915', ledger)).toEqual({ number: '48915', letter: null });
    expect(catalogueAlias(HD, 'HD  48915B', ledger)).toEqual({ number: '48915', letter: 'B' });
    expect(catalogueAlias(HD, 'HD    113', ledger)).toEqual({ number: '113', letter: null });
    expect(catalogueAlias(HD, 'HD 225220', ledger)).toEqual({ number: '225220', letter: null });
    expect(ledger.check('t').kind).toBe('pass');
  });

  it('reads a HIP letter fused or spaced', () => {
    const ledger = parseLedger();
    expect(catalogueAlias(HIP, 'HIP 32349', ledger)).toEqual(hip('32349'));
    expect(catalogueAlias(HIP, 'HIP 32349B', ledger)).toEqual(hip('32349', 'B'));
    expect(catalogueAlias(HIP, 'HIP 32349 B', ledger)).toEqual(hip('32349', 'B'));
  });

  it('is null for another namespace, and fails the ledger on an id the namespace rules cannot read', () => {
    const ledger = parseLedger();
    expect(catalogueAlias(HIP, 'Gaia DR3 12345', ledger)).toBeNull();
    expect(ledger.check('t').kind).toBe('pass');
    expect(catalogueAlias(HD, 'HD foo', ledger)).toBeNull();
    expect(ledger.check('t').kind).toBe('fail');
  });
});

describe('resolveHip', () => {
  it('takes the bare HIP over a lettered one', () => {
    expect(resolveHip([hip('55203', 'A'), hip('55203')], new Set(['A']))).toBe('55203');
  });

  it('binds a lettered HIP only on a letter the object was resolved as', () => {
    expect(resolveHip([hip('55203', 'A')], new Set(['A']))).toBe('55203');
    expect(resolveHip([hip('55203', 'B')], new Set(['A']))).toBeNull();
    expect(resolveHip([hip('55203', 'A')], new Set())).toBeNull();
  });

  it('binds neither of two different HIPs that both match, and one HIP under two matching letters', () => {
    expect(resolveHip([hip('111', 'A'), hip('222', 'B')], new Set(['A', 'B']))).toBeNull();
    expect(resolveHip([hip('111', 'A'), hip('111', 'B')], new Set(['A', 'B']))).toBe('111');
  });
});

describe('cascadeCandidates', () => {
  const siriusB = { wdsId: SIRIUS, component: 'B' };

  it('asks Sirius B under its CCDM id and its letter on Sirius A\'s HD and HIP', () => {
    const out = cascadeCandidates([siriusB], new Map([[SIRIUS, [8399845]]]), new Map([[8399845, '48915']]), new Map([[8399845, '32349']]));
    expect([...out.keys()].sort()).toEqual(['CCDM J06451-1643B', 'HD  48915B', 'HIP 32349 B', 'HIP 32349B']);
    expect(out.get('HD  48915B')).toEqual({ component: siriusB, strategy: 'HD' });
    expect(out.get('CCDM J06451-1643B')?.strategy).toBe('CCDM');
    expect(out.get('HIP 32349B')?.strategy).toBe('HIP');
  });

  it('asks an id two components share once, and only CCDM where no sibling holds an HD or HIP', () => {
    const shared = cascadeCandidates(
      [siriusB, { wdsId: SIRIUS, component: 'B' }], new Map([[SIRIUS, [1]]]), new Map([[1, '48915']]), new Map(),
    );
    expect([...shared.keys()]).toEqual(['CCDM J06451-1643B', 'HD  48915B']);
    expect([...cascadeCandidates([siriusB], new Map([[SIRIUS, [1]]]), new Map(), new Map()).keys()]).toEqual(['CCDM J06451-1643B']);
    expect([...cascadeCandidates([siriusB], new Map(), new Map(), new Map()).keys()]).toEqual(['CCDM J06451-1643B']);
  });

  it('pads every HD number to SIMBAD\'s seven characters', () => {
    for (const [hd, id] of [['113', 'HD    113A'], ['1202', 'HD   1202A'], ['48915', 'HD  48915A'], ['225220', 'HD 225220A']] as const) {
      const out = cascadeCandidates([{ wdsId: '00000+0000', component: 'A' }], new Map([['00000+0000', [999]]]), new Map([[999, hd]]), new Map());
      expect(out.has(id)).toBe(true);
    }
  });
});

describe('cascadeRecoveries', () => {
  const b = { wdsId: '00000+0000', component: 'B' };
  const candidates = new Map([
    ['HD  12345B', { component: b, strategy: 'HD' as const }],
    ['CCDM J00000+0000B', { component: b, strategy: 'CCDM' as const }],
  ]);

  it('recovers a component onto the object its alias names', () => {
    const out = cascadeRecoveries([{ id: 'HD  12345B', oid: 930049 }], candidates, new Set([8399845]));
    expect([...out.recoveries.values()]).toEqual([{ component: b, oid: 930049 }]);
    expect(out.hits).toEqual({ HD: 1, CCDM: 0, HIP: 0 });
  });

  it('drops an alias naming an object an ident already resolved, and an id nobody asked', () => {
    expect(cascadeRecoveries([{ id: 'HD  12345B', oid: 555 }], candidates, new Set([555])).recoveries.size).toBe(0);
    const stray = cascadeRecoveries([{ id: 'Unexpected', oid: 999 }], candidates, new Set());
    expect(stray.recoveries.size).toBe(0);
    expect(stray.hits).toEqual({ HD: 0, CCDM: 0, HIP: 0 });
  });

  it('keeps the first of two objects and reports the second, uncounted', () => {
    const out = cascadeRecoveries([{ id: 'HD  12345B', oid: 111 }, { id: 'CCDM J00000+0000B', oid: 222 }], candidates, new Set());
    expect([...out.recoveries.values()]).toEqual([{ component: b, oid: 111 }]);
    expect(out.hits).toEqual({ HD: 1, CCDM: 0, HIP: 0 });
    expect(out.conflicts).toEqual(['00000+0000 B: 111, then 222 (CCDM J00000+0000B)']);
  });

  it('counts each agreeing alias against its own strategy', () => {
    const out = cascadeRecoveries([{ id: 'HD  12345B', oid: 111 }, { id: 'CCDM J00000+0000B', oid: 111 }], candidates, new Set());
    expect(out.recoveries.size).toBe(1);
    expect(out.hits).toEqual({ HD: 1, CCDM: 1, HIP: 0 });
  });
});
