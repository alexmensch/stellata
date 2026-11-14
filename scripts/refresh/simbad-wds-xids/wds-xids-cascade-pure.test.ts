import { describe, expect, it } from 'vitest';

import { parseLedger } from '../simbad/simbad-fetch-pure';
import { HD, HIP } from '../simbad/simbad-specs-pure';
import {
  cascadeCandidates, cascadeRecoveries, catalogueAlias, replyKey, resolveHip, type CatalogueAlias,
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
  const asked = (out: ReturnType<typeof cascadeCandidates>): string[] => [...out.values()].map((c) => c.id).sort();

  it('asks Sirius B under its CCDM id and its letter on Sirius A\'s HD and HIP, one spelling each', () => {
    const out = cascadeCandidates([siriusB], new Map([[SIRIUS, [8399845]]]), new Map([[8399845, '48915']]), new Map([[8399845, '32349']]));
    expect(asked(out)).toEqual(['CCDM J06451-1643B', 'HD 48915B', 'HIP 32349B']);
    const key = (id: string): string | null => replyKey(id, parseLedger());
    expect(out.get(key('HD  48915B') ?? '')).toEqual({ id: 'HD 48915B', component: siriusB, strategy: 'HD' });
    expect(out.get(key('CCDM J06451-1643B') ?? '')?.strategy).toBe('CCDM');
    expect(out.get(key('HIP 32349 B') ?? '')?.strategy).toBe('HIP');
  });

  it('asks a component no HD or HIP id can letter under its CCDM id only, so Algol\'s 2 never asks HD 193562', () => {
    for (const component of ['2', 'Aa1']) {
      const c = { wdsId: '03082+4057', component };
      const out = cascadeCandidates([c], new Map([[c.wdsId, [1]]]), new Map([[1, '19356']]), new Map([[1, '14576']]));
      expect(asked(out)).toEqual([`CCDM J03082+4057${component}`]);
    }
  });

  it('asks an id two components share once, and only CCDM where no sibling holds an HD or HIP', () => {
    const shared = cascadeCandidates([siriusB, { wdsId: SIRIUS, component: 'B' }], new Map([[SIRIUS, [1]]]), new Map([[1, '48915']]), new Map());
    expect(asked(shared)).toEqual(['CCDM J06451-1643B', 'HD 48915B']);
    expect(asked(cascadeCandidates([siriusB], new Map([[SIRIUS, [1]]]), new Map(), new Map()))).toEqual(['CCDM J06451-1643B']);
    expect(asked(cascadeCandidates([siriusB], new Map(), new Map(), new Map()))).toEqual(['CCDM J06451-1643B']);
  });
});

describe('cascadeRecoveries', () => {
  const b = { wdsId: '00000+0000', component: 'B' };
  const candidates = cascadeCandidates([b], new Map([[b.wdsId, [1]]]), new Map([[1, '12345']]), new Map());

  it('joins a reply in SIMBAD\'s stored spelling back to the id asked, whatever its whitespace', () => {
    const out = cascadeRecoveries([{ id: 'HD  12345B', oid: 930049 }], candidates, new Set([8399845]), parseLedger());
    expect([...out.recoveries.values()]).toEqual([{ component: b, oid: 930049 }]);
    expect(out.hits).toEqual({ HD: 1, CCDM: 0, HIP: 0 });
  });

  it('refuses an HD reply naming a bare number, and an id nobody asked', () => {
    const ledger = parseLedger();
    expect(() => cascadeRecoveries([{ id: 'HD 12345', oid: 111 }], candidates, new Set(), ledger)).toThrow(/HD 12345, which names no alias the cascade asked/);
    expect(ledger.check('t').kind).toBe('pass');
    expect(() => cascadeRecoveries([{ id: 'Unexpected', oid: 999 }], candidates, new Set(), parseLedger())).toThrow(/Unexpected, which names no alias/);
  });

  it('drops a reply whose letter differs only in case, naming it, and fails the ledger on an HD reply it cannot read', () => {
    const out = cascadeRecoveries([{ id: 'CCDM J00000+0000b', oid: 222 }, { id: 'HD  12345b', oid: 111 }], candidates, new Set(), parseLedger());
    expect(out.recoveries.size).toBe(0);
    expect(out.folded).toEqual(['CCDM J00000+0000b → 222', 'HD  12345b → 111']);
    const ledger = parseLedger();
    expect(cascadeRecoveries([{ id: 'HD 12345 B?', oid: 111 }], candidates, new Set(), ledger).recoveries.size).toBe(0);
    expect(ledger.check('t').kind).toBe('fail');
  });

  it('drops an alias naming an object an ident already resolved', () => {
    const out = cascadeRecoveries([{ id: 'HD 12345B', oid: 555 }], candidates, new Set([555]), parseLedger());
    expect(out.recoveries.size).toBe(0);
    expect(out.hits).toEqual({ HD: 0, CCDM: 0, HIP: 0 });
  });

  it('binds neither of two objects one component\'s aliases name, whichever order they answer in', () => {
    const hits = [{ id: 'HD  12345B', oid: 111 }, { id: 'CCDM J00000+0000B', oid: 222 }];
    for (const order of [hits, [...hits].reverse()]) {
      const out = cascadeRecoveries(order, candidates, new Set(), parseLedger());
      expect(out.recoveries.size).toBe(0);
      expect(out.hits).toEqual({ HD: 0, CCDM: 0, HIP: 0 });
      expect(out.conflicts).toEqual(['00000+0000 B: 111 (HD  12345B), 222 (CCDM J00000+0000B)']);
    }
  });

  it('counts each agreeing alias against its own strategy', () => {
    const out = cascadeRecoveries([{ id: 'HD  12345B', oid: 111 }, { id: 'CCDM J00000+0000B', oid: 111 }], candidates, new Set(), parseLedger());
    expect(out.recoveries.size).toBe(1);
    expect(out.hits).toEqual({ HD: 1, CCDM: 1, HIP: 0 });
  });
});
