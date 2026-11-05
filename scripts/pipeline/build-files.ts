// Every file the build steps own on disk: declared outputs, family members and stamps. See README.md#files.

import { existsSync } from 'node:fs';

import { familyMembers } from '../util/emit-artifacts';
import type { PipelineTree } from './pipeline-tree';
import { isBuild, type OutputClaims, type ResolvedStep } from './step-table/step-table-pure';

/** A build step's declared files and its stamp, with its families; absolute. */
export function buildClaims({ step, outputs }: ResolvedStep, tree: PipelineTree): OutputClaims {
  return { files: [...outputs.files, tree.buildStamp(step.name)], families: outputs.families };
}

/** Repo-relative, sorted. */
export function buildFiles(steps: Iterable<ResolvedStep>, tree: PipelineTree): string[] {
  return [...steps]
    .filter(({ step }) => isBuild(step))
    .map((resolved) => buildClaims(resolved, tree))
    .flatMap(({ files, families }) => [...files, ...families.flatMap(familyMembers)])
    .filter((path) => existsSync(path))
    .map(tree.rel)
    .sort();
}
