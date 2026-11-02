// A Python step's run record checked against its declarations. See README.md#the-step-table--stepsts.

import { claims, reaches, type ResolvedStep, type StepGraph } from './step-table-pure';

/** What `build_stamp.record_run` writes; every path absolute. */
export interface RunRecord {
  readonly reads: Readonly<Record<string, string | null>>;
  readonly listings: Readonly<Record<string, string>>;
  readonly probes: Readonly<Record<string, boolean>>;
  readonly writes: readonly string[];
}

export function recordProblems(
  self: ResolvedStep,
  snapshots: readonly string[],
  record: RunRecord,
  steps: Iterable<ResolvedStep>,
  graph: StepGraph,
): string[] {
  const name = self.step.name;
  const problems = record.writes
    .filter((p) => !claims(self.outputs, p) && !snapshots.includes(p))
    .map((p) => `${name} wrote ${p}, which it does not declare`);
  const others = [...steps].filter((s) => s.step.name !== name);
  for (const path of Object.keys(record.reads)) {
    for (const writer of others.filter((s) => claims(s.outputs, path))) {
      if (!reaches(graph.edges, writer.step.name, name)) {
        problems.push(`${name} read ${path}, an output of ${writer.step.name}, without running after it`);
      }
    }
  }
  return problems;
}
