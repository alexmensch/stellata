import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseSolObjectsTsv } from '../../../scripts/sid/sid-pure';
import {
  LedgerUnavailableError,
  SOL_OBJECTS_PATH,
  loadRegistry,
  type Registry,
} from '../../../scripts/sid/registry-io';
import { SOL_BODIES } from './planet-system';
import { SOL_OBJECT_SIDS } from './sol-object-sids';

// The append-only ledger is LFS; in the bare CI `test` job it is a pointer
// stub, so this suite self-skips there and runs for real locally + in the
// lfs-enabled build-catalog job (mirrors tests/sid-ledger-guard.test.ts).
let registry: Registry | null = null;
try {
  registry = loadRegistry();
} catch (e) {
  if (!(e instanceof LedgerUnavailableError)) throw e;
}

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
    const mintKeys = parseSolObjectsTsv(readFileSync(SOL_OBJECTS_PATH, 'utf-8'))
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
});
