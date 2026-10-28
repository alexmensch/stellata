import { describe, expect, it } from 'vitest';

import { SOL_OBJECTS } from '../../../scripts/sid/object-mints-source';
import { LEDGER } from '../../../scripts/sid/ledger-tsv';
import { loadRegistry } from '../../../scripts/sid/registry-io';
import { PROBE_MISSIONS } from '../../../scripts/probes/probe-roster';
import { SOL_BODIES } from './planet-system';
import { SOL_OBJECT_SIDS } from './sol-object-sids';
import { isReadable } from '../../../scripts/util/sources/source';

const registry = isReadable(LEDGER) ? loadRegistry() : null;

const suite = registry ? describe : describe.skip;

suite('SOL_OBJECT_SIDS pins against the ledger', () => {
  // Null-safe at collection time: describe.skip still runs this factory, so
  // it must tolerate a stub ledger (registry === null). The it() bodies only
  // run when the suite is live, where registry is guaranteed non-null.
  const bySid = new Map((registry?.ledger ?? []).map((r) => [r.sid, r]));

  it('every entry resolves to the ledger row keyed sol:<body>', () => {
    for (const [key, sid] of Object.entries(SOL_OBJECT_SIDS)) {
      const row = bySid.get(sid);
      expect(row, `sid ${sid} (sol:${key}) is absent from the ledger`).toBeDefined();
      expect(row!.canonicalKey).toBe(`sol:${key}`);
    }
  });

  it('covers exactly the sol-objects.tsv mint list', () => {
    const mintKeys = SOL_OBJECTS.read()
      .map((r) => r.key)
      .sort();
    expect(Object.keys(SOL_OBJECT_SIDS).sort()).toEqual(mintKeys);
  });

  it('carries a SID for the Sun and every runtime body (planets + moons)', () => {
    expect(SOL_OBJECT_SIDS.sun).toBeGreaterThan(0);
    for (const p of SOL_BODIES) {
      expect(SOL_OBJECT_SIDS[p.name.toLowerCase()], `no SID for ${p.name}`).toBeGreaterThan(0);
    }
  });

  it('carries a SID for every probe, keyed by roster id', () => {
    for (const m of PROBE_MISSIONS) {
      expect(SOL_OBJECT_SIDS[m.id], `no SID for ${m.label}`).toBeGreaterThan(0);
    }
  });

  it('mints the probes with ledger kind probe, not planet', () => {
    for (const m of PROBE_MISSIONS) {
      expect(bySid.get(SOL_OBJECT_SIDS[m.id])!.kind).toBe('probe');
    }
  });
});
