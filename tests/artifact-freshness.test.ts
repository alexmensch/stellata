// Built-artifact coherence guard. The binaries.bin-dependent suites
// (multi-star regression, parts of Tier A) self-skip when the artifact
// is absent — so "npm test green" after rebuilding the catalog but not
// binaries.bin silently under-tests, and the count drift only surfaces
// in CI. This test FAILS in that state instead: a local catalog build
// must be accompanied by a binaries.bin built from the current inputs.
//
// Self-skips only when nothing is built (fresh clone, unit-only run) or
// when data/binaries/multiples.tsv is an LFS pointer stub (bare CI test
// job) — mirroring sid-ledger-guard's skip contract.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../scripts/util/paths';
import { changedSince, readStamp, stampPath } from '../scripts/util/build-stamp';
import { DEFAULT_CATALOG_MANIFEST } from '../scripts/catalog/catalog-lookup';

const MULTIPLES_TSV = resolve(REPO_ROOT, 'data/binaries/multiples.tsv');
const BINARIES_BIN = resolve(REPO_ROOT, 'public/binaries.bin');
const BINARIES_BIN_STAMP = stampPath('binaries-bin');
const REBUILD = 'pnpm run build:binaries-runtime';

const catalogBuilt = existsSync(DEFAULT_CATALOG_MANIFEST);
const skip = !catalogBuilt || !lfsContentReadable(MULTIPLES_TSV);

describe.skipIf(skip)('built-artifact coherence (public/ + build/)', () => {
  it('binaries.bin exists whenever the catalog has been built', () => {
    expect(
      existsSync(BINARIES_BIN),
      'public/catalog-manifest.json exists but public/binaries.bin is missing — '
        + 'the binaries-dependent suites would silently self-skip. '
        + `Run: ${REBUILD}`,
    ).toBe(true);
  });

  it.skipIf(!existsSync(BINARIES_BIN))(
    'binaries.bin was built from every input and output its stamp records',
    () => {
      const recorded = readStamp(BINARIES_BIN_STAMP);
      expect(recorded, `${BINARIES_BIN_STAMP} is missing — rebuild with: ${REBUILD}`).not.toBeNull();
      expect(
        changedSince({ ...recorded?.inputs, ...recorded?.outputs }),
        `public/binaries.bin is stale against these files — rebuild with: ${REBUILD}`,
      ).toEqual([]);
    },
  );
});
