import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseShellObjectsTsv } from '../../../scripts/sid/sid-pure';
import {
  LedgerUnavailableError,
  SHELL_OBJECTS_PATH,
  loadRegistry,
  type Registry,
} from '../../../scripts/sid/registry-io';
import { SHELL_KEYS } from './shell-registry';
import { SHELL_OBJECT_SIDS } from './shell-object-sids';

// The append-only ledger is LFS; in the bare CI `test` job it is a pointer
// stub, so this suite self-skips there and runs for real locally + in the
// lfs-enabled build-catalog job (mirrors sol-object-sids.test.ts).
let registry: Registry | null = null;
try {
  registry = loadRegistry();
} catch (e) {
  if (!(e instanceof LedgerUnavailableError)) throw e;
}

const suite = registry ? describe : describe.skip;

suite('SHELL_OBJECT_SIDS pins against the ledger', () => {
  const bySid = new Map((registry?.ledger ?? []).map((r) => [r.sid, r]));

  it('every entry resolves to the ledger row keyed shell:<key>', () => {
    for (const [key, sid] of Object.entries(SHELL_OBJECT_SIDS)) {
      const row = bySid.get(sid);
      expect(row, `sid ${sid} (shell:${key}) is absent from the ledger`).toBeDefined();
      expect(row!.canonicalKey).toBe(`shell:${key}`);
    }
  });

  it('covers exactly the shell-objects.tsv mint list', () => {
    const mintKeys = parseShellObjectsTsv(readFileSync(SHELL_OBJECTS_PATH, 'utf-8'))
      .map((r) => r.key)
      .sort();
    expect(Object.keys(SHELL_OBJECT_SIDS).sort()).toEqual(mintKeys);
  });

  it('carries a positive SID for every SHELL_KEYS entry', () => {
    for (const key of SHELL_KEYS) {
      expect(SHELL_OBJECT_SIDS[key], `no SID for ${key}`).toBeGreaterThan(0);
    }
  });
});
