import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { entryClosure, packageScripts } from '../util/import-closure';
import { tsxEntries } from '../util/import-closure-pure';
import { REPO_ROOT } from '../util/paths';
import { stepInputPaths } from '../util/step-inputs';

const abs = (path: string): string => resolve(REPO_ROOT, path);

const inputs = new Set(await stepInputPaths('build:local-group'));

describe('stepInputPaths(build:local-group)', () => {
  it('keys every module both chained entries import', async () => {
    const closure = await entryClosure(tsxEntries(packageScripts(), 'build:local-group'));
    expect([...closure].filter((m) => !inputs.has(abs(m)))).toEqual([]);
    expect(inputs).toContain(abs('scripts/local-group/local-group-parse.ts'));
    expect(inputs).toContain(abs('scripts/local-group/local-group-source.ts'));
    expect(inputs).toContain(abs('scripts/sid/stamp-sibling-sids.ts'));
  });

  it('keys the three declared inputs', () => {
    expect(inputs).toContain(abs('data/local-group/lvdb-snapshot.csv'));
    expect(inputs).toContain(abs('data/local-group/overrides.tsv'));
    expect(inputs).toContain(abs('data/local-group/aliases.tsv'));
  });
});
