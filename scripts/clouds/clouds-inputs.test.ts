import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { entryClosure, packageScripts } from '../util/import-closure';
import { tsxEntries } from '../util/import-closure-pure';
import { REPO_ROOT } from '../util/paths';
import { stepInputPaths } from '../util/step-inputs';
import { ZUCKER_2020, ZUCKER_2021_EXTENTS, ZUCKER_2021_FITS, ZUCKER_2021_MASSES } from './zucker-source';

const abs = (path: string): string => resolve(REPO_ROOT, path);

const inputs = new Set(await stepInputPaths('build:clouds'));

describe('stepInputPaths(build:clouds)', () => {
  it('keys every module its entry imports, the shared density profile and constants among them', async () => {
    const closure = await entryClosure(tsxEntries(packageScripts(), 'build:clouds'));
    expect([...closure].filter((m) => !inputs.has(abs(m)))).toEqual([]);
    expect(inputs).toContain(abs('src/astro-core/cloud-density-pure.ts'));
    expect(inputs).toContain(abs('src/astro-core/baker-constants.json'));
  });

  it('keys the four Zucker tables', () => {
    for (const source of [ZUCKER_2020, ZUCKER_2021_EXTENTS, ZUCKER_2021_FITS, ZUCKER_2021_MASSES]) {
      expect(inputs).toContain(abs(source.file));
    }
  });
});
