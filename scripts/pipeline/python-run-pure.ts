// A Python step's run record checked against its declarations. See README.md#the-step-table--stepsts.

import { dirname } from 'node:path';

import {
  claims, reaches, type OutputClaims, type ResolvedStep, type StepGraph,
} from './step-table-pure';

function listsOutputsOf(outputs: OutputClaims, dir: string): boolean {
  return outputs.families.some((f) => f.dir === dir) || outputs.files.some((p) => dirname(p) === dir);
}

/** What `build_stamp.record_run` writes; every path absolute. */
export interface RunRecord {
  readonly reads: Readonly<Record<string, string | null>>;
  readonly listings: Readonly<Record<string, string>>;
  readonly probes: Readonly<Record<string, boolean>>;
  readonly services: readonly string[];
  readonly writes: readonly string[];
}

export function undeclaredWrites(self: ResolvedStep, writes: readonly string[], allowed: readonly string[] = []): string[] {
  return writes
    .filter((p) => !claims(self.outputs, p) && !allowed.includes(p))
    .map((p) => `${self.step.name} wrote ${p}, which it does not declare`);
}

export function recordProblems(
  self: ResolvedStep,
  snapshots: readonly string[],
  record: RunRecord,
  steps: Iterable<ResolvedStep>,
  graph: StepGraph,
): string[] {
  const name = self.step.name;
  const problems = undeclaredWrites(self, record.writes, snapshots);
  const others = [...steps].filter((s) => s.step.name !== name);
  const touched: [string, (writer: ResolvedStep) => boolean][] = [
    ...[...Object.keys(record.reads), ...Object.keys(record.probes)]
      .map((path): [string, (w: ResolvedStep) => boolean] => [path, (w) => claims(w.outputs, path)]),
    ...Object.keys(record.listings)
      .map((dir): [string, (w: ResolvedStep) => boolean] => [dir, (w) => listsOutputsOf(w.outputs, dir)]),
  ];
  const runsAfter = (writer: string): boolean => reaches(graph.edges, writer, name)
    || graph.keptLoops.some((e) => e.from === writer && e.to === name);
  for (const [path, isWriter] of touched) {
    for (const writer of others.filter(isWriter)) {
      if (!runsAfter(writer.step.name)) {
        problems.push(`${name} read ${path}, an output of ${writer.step.name}, without running after it`);
      }
    }
  }
  return problems;
}
