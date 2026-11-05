// Test support: a TypeScript manual step written under a fixture root, loaded alone, recorded through record.ts and judged.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { stepFileName } from '../util/stamp-path-pure';
import { manualDescription, manualFreshness, type Freshness } from './freshness';
import { pipelineTree } from './pipeline-tree';
import { recordStep, type RecordOutcome } from './record-step';
import { loadTable } from './step-table/load-table';
import type { ManualKind, ManualStep, StepEntry } from './step-table/step-table-pure';

export interface TsManualFixture {
  readonly step: ManualStep;
  readonly record: () => Promise<RecordOutcome>;
  readonly freshness: () => Freshness;
}

export interface TsManualSpec {
  readonly name: string;
  readonly kind: ManualKind;
  /** The entry module's source: exports `main`, and `describe` when the kind describes itself. */
  readonly source: string;
  /** The one file it writes, absolute. */
  readonly out: string;
  /** What `deriveInputs` answers beside the entry itself, absolute. */
  readonly inputs: readonly string[];
  /** Further steps on its table. */
  readonly others?: readonly StepEntry[];
}

export async function tsManualFixture(root: string, { name, kind, source, out, inputs, others = [] }: TsManualSpec): Promise<TsManualFixture> {
  const base = join(root, 'steps', stepFileName(name));
  mkdirSync(join(root, 'steps'), { recursive: true });
  writeFileSync(`${base}.ts`, source);
  writeFileSync(`${base}-outputs.ts`, `
import { ${declareOutputs.name} } from ${JSON.stringify(join(REPO_ROOT, 'scripts/util/emit-artifacts'))};
export const OUT = ${declareOutputs.name}({ out: ${JSON.stringify(out)} });
`);
  const step: ManualStep = { name, ...kind, language: 'ts', entry: `${base}.ts`, outputs: { module: `${base}-outputs.ts`, name: 'OUT' } };
  const loaded = await loadTable({ steps: [step, ...others], registryFiles: [] }, { root, deriveInputs: async () => [] });
  if (loaded.kind !== 'loaded') throw new Error(loaded.problems.join('; '));
  const tree = pipelineTree(root);
  return {
    step,
    record: () => recordStep(loaded, { root, step: name, force: false, args: [], deriveInputs: async () => [step.entry, ...inputs], log: () => {} }),
    freshness: () => manualFreshness(step, { files: [out], families: [] }, tree, manualDescription(step, tree)),
  };
}
