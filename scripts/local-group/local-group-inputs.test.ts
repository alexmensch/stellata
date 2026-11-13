import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUILD_COUNTS_EXPECTED_FILE } from '../catalog/build-counts';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { entryClosure } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import { stepEntries, stepInputPaths } from '../util/step-inputs';

const abs = (path: string): string => resolve(REPO_ROOT, path);

const inputs = new Set(await stepInputPaths('build:local-group'));

describe('stepInputPaths(build:local-group)', () => {
  it('keys every module its entry imports', async () => {
    const closure = await entryClosure(stepEntries('build:local-group'));
    expect([...closure].filter((m) => !inputs.has(abs(m)))).toEqual([]);
    expect(inputs).toContain(abs('scripts/local-group/local-group-parse.ts'));
    expect(inputs).toContain(abs('scripts/local-group/local-group-source.ts'));
    expect(inputs).toContain(abs('scripts/sid/sibling-allocation.ts'));
    expect(inputs).not.toContain(abs('scripts/clouds/build-clouds.ts'));
  });

  it('keys the three declared inputs', () => {
    expect(inputs).toContain(abs('data/local-group/lvdb-snapshot.csv'));
    expect(inputs).toContain(abs('data/local-group/overrides.tsv'));
    expect(inputs).toContain(abs('data/local-group/aliases.tsv'));
  });

  it('keys its own count snapshot and no other build\'s', () => {
    expect(inputs).toContain(abs(SIBLING_ARTIFACTS['local-group'].countsSnapshot));
    expect(inputs).not.toContain(abs(BUILD_COUNTS_EXPECTED_FILE));
  });
});
