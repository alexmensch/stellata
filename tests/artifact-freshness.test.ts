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

import { REPO_ROOT } from '../scripts/util/paths';
import { isReadable } from '../scripts/util/sources/source';
import { changedSince, readStamp } from '../scripts/util/build-stamp';
import { stampPath } from '../scripts/util/stamp-path-pure';
import { CATALOG_OUTPUTS } from '../scripts/catalog/catalog-outputs';
import { MULTIPLES_TSV } from '../scripts/binaries/multiples-tsv';
import { STEPS } from '../scripts/pipeline/step-table/steps';

const RUNTIME_STEP = 'build:binaries-runtime';
const runtime = STEPS.steps.find((s) => s.name === RUNTIME_STEP);
if (runtime?.kind !== 'build' || runtime.language !== 'python' || runtime.outputs.length !== 1) {
  throw new Error(`${RUNTIME_STEP} is not a one-output Python build step in steps.ts`);
}
const BINARIES_BIN = resolve(REPO_ROOT, runtime.outputs[0]);
const BINARIES_BIN_STAMP = stampPath(RUNTIME_STEP);
const REBUILD = `pnpm run ${RUNTIME_STEP}`;

const catalogBuilt = existsSync(CATALOG_OUTPUTS.files.manifest);
const skip = !catalogBuilt || !isReadable(MULTIPLES_TSV);

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
