// Every stamp under build/stamps/ and data/stamps/ is a step's, and matches the disk the way the runner judges it.

import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

import { describe, it, expect } from 'vitest';

import { buildFreshness, manualFreshness, readManualRecord } from '../scripts/pipeline/freshness';
import { pipelineTree } from '../scripts/pipeline/pipeline-tree';
import { rerunCommand } from '../scripts/util/step-command-pure';
import { loadedRepoTable } from '../scripts/pipeline/step-table/repo-table';
import { isBuild, type ManualStep } from '../scripts/pipeline/step-table/step-table-pure';
import { isLfsPointerFile, REPO_ROOT } from '../scripts/util/paths';

const loaded = await loadedRepoTable();
const tree = pipelineTree(REPO_ROOT);
const resolved = [...loaded.steps.values()];
const builds = resolved.flatMap((r) => (isBuild(r.step) ? [{ step: r.step, resolved: r }] : []));
const manuals = resolved.flatMap((r) => (isBuild(r.step) ? [] : [{ step: r.step, resolved: r }]));

const HASHING_TIMEOUT_MS = 120_000;

const jsonIn = (folder: string): string[] => (existsSync(folder)
  ? readdirSync(folder).filter((name) => name.endsWith('.json')).sort()
  : []);

const BUILD_STAMPS = builds.map(({ step }) => tree.buildStamp(step.name));
const MANUAL_STAMPS = manuals.map(({ step }) => tree.manualStamp(step.name));
const BUILD_STAMP_DIR = tree.buildStamps;
const MANUAL_STAMP_DIR = tree.manualStamps;

function onLfsStub(step: ManualStep): boolean {
  const read = readManualRecord(step, tree.manualStamp(step.name));
  if (read.kind !== 'read') return false;
  const { inputs, outputs } = read.record.stamp;
  return [...Object.keys(inputs), ...Object.keys(outputs)]
    .some((p) => existsSync(tree.abs(p)) && isLfsPointerFile(tree.abs(p)));
}

describe('stamp folders hold only steps\' stamps', () => {
  it('every data/stamps/ record is a manual step\'s, and every manual step has one', () => {
    expect(jsonIn(MANUAL_STAMP_DIR)).toEqual(MANUAL_STAMPS.map((s) => basename(s)).sort());
  });

  it('every build/stamps/ file is a build step\'s stamp — delete any other', () => {
    const known = new Set(BUILD_STAMPS.map((s) => basename(s)));
    expect(jsonIn(BUILD_STAMP_DIR).filter((name) => !known.has(name))).toEqual([]);
  });
});

describe.skipIf(jsonIn(BUILD_STAMP_DIR).length === 0)('once any build step has run, every build stamp is fresh', () => {
  for (const { step, resolved: r } of builds) {
    it(step.name, () => {
      expect(buildFreshness(step, r, tree).freshness, `${step.name} is stale against these files — rebuild with: ${rerunCommand(step.name)}`)
        .toEqual({ kind: 'fresh' });
    }, HASHING_TIMEOUT_MS);
  }
});

describe('every manual step\'s committed record matches the disk', () => {
  for (const { step, resolved: r } of manuals) {
    it.skipIf(onLfsStub(step))(step.name, () => {
      expect(manualFreshness(step, r.outputs, tree, null), `${step.name}'s record is stale against these files — re-run: ${rerunCommand(step.name)}`)
        .toEqual({ kind: 'fresh' });
    }, HASHING_TIMEOUT_MS);
  }
});
