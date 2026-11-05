import { relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CODE_FILE } from '../util/import-closure-pure';
import { REPO_ROOT } from '../util/paths';
import { STEPS } from '../pipeline/step-table/steps';
import { entryInputPaths } from '../util/step-inputs';

const step = STEPS.steps.find((s) => s.name === 'measure:band-resolved')!;
const inputs = (await entryInputPaths([step.entry])).map((p) => relative(REPO_ROOT, p));

describe('measure:band-resolved\'s input set', () => {
  it('keys the column reader it measures through', () => {
    expect(inputs).toContain('scripts/catalog/columns/catalog-columns.ts');
  });

  it('keys one data file, so no count snapshot or other file beside a module it imports stales it', () => {
    expect(inputs.filter((p) => !CODE_FILE.test(p))).toEqual(['src/astro-core/baker-constants.json']);
  });
});
