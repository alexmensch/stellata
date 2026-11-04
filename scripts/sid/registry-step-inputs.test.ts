import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import { stepInputPaths } from '../util/step-inputs';
import { REGISTRY_PARTITIONS } from './registry-partitions-pure';
import { registryPaths } from '../../src/catalog-format/pipeline-outputs/data-files';

const ALLOCATING_STEPS = ['build:catalog', 'build:local-group', 'sid:stamp'];

const registryInputs = REGISTRY_PARTITIONS.flatMap((partition) => {
  const { ledger, events } = registryPaths(partition);
  return [ledger, events].map((path) => resolve(REPO_ROOT, path));
});

describe('every SID-allocating step keys every partition\'s ledger and events', () => {
  it.each(ALLOCATING_STEPS)('%s', async (step) => {
    const inputs = new Set(await stepInputPaths(step));
    expect(registryInputs.filter((path) => !inputs.has(path))).toEqual([]);
  });
});
