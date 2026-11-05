import { relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import { STEPS } from '../pipeline/step-table/steps';
import { entryInputPaths } from '../util/step-inputs';

const step = STEPS.steps.find((s) => s.name === 'measure:band-resolved')!;
const inputs = (await entryInputPaths([step.entry])).map((p) => relative(REPO_ROOT, p));

describe('measure:band-resolved\'s input set', () => {
  it('keys the column reader it measures through', () => {
    expect(inputs).toContain('scripts/catalog/columns/catalog-columns.ts');
  });

  it('keys no count snapshot, so a catalogue re-pin leaves the bake fresh', () => {
    expect(inputs.filter((p) => p.endsWith('-expected.json'))).toEqual([]);
  });

  it('keys none of the built catalogue: it counts through the column projection', () => {
    expect(inputs.filter((p) => p.startsWith('public/'))).toEqual([]);
  });
});
