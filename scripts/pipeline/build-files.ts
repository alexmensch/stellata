// Every file the build steps own on disk: declared outputs, family members and stamps. See README.md#files.

import { existsSync } from 'node:fs';

import { familyMembers } from '../util/emit-artifacts';
import type { PipelineTree } from './pipeline-tree';
import { isBuild, type ResolvedStep } from './step-table/step-table-pure';

/** Repo-relative, sorted. */
export function buildFiles(steps: Iterable<ResolvedStep>, tree: PipelineTree): string[] {
  return [...steps]
    .filter(({ step }) => isBuild(step))
    .flatMap(({ step, outputs }) => [...outputs.files, ...outputs.families.flatMap(familyMembers), tree.buildStamp(step.name)])
    .filter((path) => existsSync(path))
    .map(tree.rel)
    .sort();
}
