// Built-artifact coherence guard. The binaries.bin-dependent suites
// (multi-star regression, parts of Tier A) self-skip when the artifact
// is absent — so "npm test green" after rebuilding the catalog but not
// binaries.bin silently under-tests, and the count drift only surfaces
// in CI. This test FAILS in that state instead: a local catalog build
// must be accompanied by a binaries.bin at least as fresh as its inputs.
//
// Self-skips only when nothing is built (fresh clone, unit-only run) or
// when data/binaries/multiples.tsv is an LFS pointer stub (bare CI test
// job) — mirroring sid-ledger-guard's skip contract.

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { lfsContentReadable } from '../scripts/util/paths';

const ROOT = resolve(__dirname, '..');
const MULTIPLES_TSV = resolve(ROOT, 'data/binaries/multiples.tsv');
const CATALOG_MANIFEST = resolve(ROOT, 'public/catalog-manifest.json');
const ROW_INDEX_MAP = resolve(ROOT, 'public/catalog-row-index-map.json');
const BINARIES_BIN = resolve(ROOT, 'public/binaries.bin');

const catalogBuilt = existsSync(CATALOG_MANIFEST);
const skip = !catalogBuilt || !lfsContentReadable(MULTIPLES_TSV);

describe.skipIf(skip)('built-artifact coherence (public/)', () => {
  it('binaries.bin exists whenever the catalog has been built', () => {
    expect(
      existsSync(BINARIES_BIN),
      'public/catalog-manifest.json exists but public/binaries.bin is missing — '
        + 'the binaries-dependent suites would silently self-skip. '
        + 'Run: npm run build:binaries-runtime',
    ).toBe(true);
  });

  it.skipIf(!existsSync(BINARIES_BIN))(
    'binaries.bin is at least as fresh as its inputs',
    () => {
      const binMtime = statSync(BINARIES_BIN).mtimeMs;
      for (const input of [MULTIPLES_TSV, ROW_INDEX_MAP]) {
        if (!existsSync(input)) continue;
        expect(
          binMtime >= statSync(input).mtimeMs,
          `public/binaries.bin is older than ${input} — rebuild with: `
            + 'npm run build:binaries-runtime',
        ).toBe(true);
      }
    },
  );
});
