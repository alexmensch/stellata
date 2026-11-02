// The step table's types, its load-time rules and the order derived from it. See README.md.

import { basename, dirname } from 'node:path';

/** A `declareOutputs` constant, named by module and export so the module can be
 *  checked side-effect-free before it is imported. */
export interface OutputsRef {
  readonly module: string;
  readonly name: string;
}

interface StepBase {
  readonly name: string;
  readonly entry: string;
}

export interface TsBuildStep extends StepBase {
  readonly kind: 'build';
  readonly language: 'ts';
  readonly outputs: OutputsRef;
}

export interface PythonBuildStep extends StepBase {
  readonly kind: 'build';
  readonly language: 'python';
  readonly outputs: readonly string[];
  readonly after: readonly string[];
  /** Count snapshots the step rewrites under `--update-snapshots`: neither
   *  outputs nor ordering edges. */
  readonly snapshots: readonly string[];
}

export interface ManualStep extends StepBase {
  readonly kind: 'pull' | 'bake';
  readonly language: 'python';
  readonly outputs: readonly string[];
  /** The `package.json` script the stop message prints. */
  readonly command: string;
}

export type BuildStep = TsBuildStep | PythonBuildStep;
export type StepEntry = BuildStep | ManualStep;

export interface StepTable {
  readonly steps: readonly StepEntry[];
  readonly registryFiles: readonly string[];
}

export interface OutputFamilyClaim {
  readonly dir: string;
  readonly member: RegExp;
}

export interface OutputClaims {
  readonly files: readonly string[];
  readonly families: readonly OutputFamilyClaim[];
}

/** A step with every path absolute: its declared outputs and the files it is
 *  known to read (a TypeScript build's derived inputs, a manual step's recorded
 *  ones; a Python build's order comes from `after` instead). */
export interface ResolvedStep {
  readonly step: StepEntry;
  readonly outputs: OutputClaims;
  readonly reads: readonly string[];
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  /** Empty for an edge a Python step declares with `after`. */
  readonly files: readonly string[];
}

export interface StepGraph {
  /** Step names in run order. */
  readonly order: readonly string[];
  readonly edges: readonly Edge[];
  /** Back edges from a manual step's output that would close a loop. */
  readonly keptLoops: readonly Edge[];
  readonly registryEdges: readonly Edge[];
}

export type Derived =
  | { readonly kind: 'ordered'; readonly graph: StepGraph }
  | { readonly kind: 'rejected'; readonly problems: readonly string[] };

export const isBuild = (step: StepEntry): step is BuildStep => step.kind === 'build';

/** A step's name as a file name, for its stamp and its lock. */
export const stepFileName = (name: string): string => name.replaceAll(':', '-');

export function claims(outputs: OutputClaims, path: string): boolean {
  return outputs.files.includes(path)
    || outputs.families.some((f) => dirname(path) === f.dir && f.member.test(basename(path)));
}

export function outputConflicts(steps: readonly ResolvedStep[]): string[] {
  const problems: string[] = [];
  for (const [i, a] of steps.entries()) {
    for (const b of steps.slice(i + 1)) {
      const shared = [
        ...a.outputs.files.filter((p) => claims(b.outputs, p)),
        ...b.outputs.files.filter((p) => !a.outputs.files.includes(p) && claims(a.outputs, p)),
        ...a.outputs.families.filter((f) => b.outputs.families.some((g) => g.dir === f.dir)).map((f) => `${f.dir}/*`),
      ];
      for (const path of shared) {
        problems.push(`${path} is declared by both ${a.step.name} and ${b.step.name}`);
      }
    }
  }
  return problems;
}

function readEdges(steps: readonly ResolvedStep[]): { edges: Edge[]; problems: string[] } {
  const byName = new Map(steps.map((s) => [s.step.name, s]));
  const edges: Edge[] = [];
  const problems: string[] = [];
  for (const reader of steps) {
    const { step } = reader;
    if (step.kind === 'build' && step.language === 'python') {
      for (const name of step.after) {
        if (byName.has(name)) edges.push({ from: name, to: step.name, files: [] });
        else problems.push(`${step.name} runs after ${name}, which is not a step`);
      }
      continue;
    }
    for (const writer of steps) {
      if (writer === reader) continue;
      const files = reader.reads.filter((p) => claims(writer.outputs, p));
      if (files.length > 0) edges.push({ from: writer.step.name, to: step.name, files });
    }
  }
  return { edges, problems };
}

export function reaches(edges: readonly Edge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (at === to) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const e of edges) if (e.from === at) stack.push(e.to);
  }
  return false;
}

function findCycle(names: readonly string[], edges: readonly Edge[]): string[] | null {
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (at: string): string[] | null => {
    if (state.get(at) === 'done') return null;
    if (state.get(at) === 'open') return [...path.slice(path.indexOf(at)), at];
    state.set(at, 'open');
    path.push(at);
    for (const e of edges) {
      if (e.from !== at) continue;
      const cycle = visit(e.to);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(at, 'done');
    return null;
  };
  for (const name of names) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
}

/** Kahn's sort, ties broken by table order. */
function topological(names: readonly string[], edges: readonly Edge[]): string[] {
  const indegree = new Map(names.map((n) => [n, 0]));
  for (const e of edges) indegree.set(e.to, indegree.get(e.to)! + 1);
  const order: string[] = [];
  const ready = names.filter((n) => indegree.get(n) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => names.indexOf(a) - names.indexOf(b));
    const at = ready.shift()!;
    order.push(at);
    for (const e of edges) {
      if (e.from !== at) continue;
      indegree.set(e.to, indegree.get(e.to)! - 1);
      if (indegree.get(e.to) === 0) ready.push(e.to);
    }
  }
  return order;
}

export function deriveGraph(steps: readonly ResolvedStep[], registryFiles: readonly string[]): Derived {
  const names = steps.map((s) => s.step.name);
  const kindOf = new Map(steps.map((s) => [s.step.name, s.step.kind]));
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  const { edges: all, problems } = readEdges(steps);
  problems.unshift(...duplicates.map((n) => `${n} is in the table twice`), ...outputConflicts(steps));

  const registry = new Set(registryFiles);
  const isRegistryEdge = (e: Edge): boolean => kindOf.get(e.from) === 'build' && kindOf.get(e.to) === 'build'
    && e.files.length > 0 && e.files.every((f) => registry.has(f));
  const registryEdges = all.filter(isRegistryEdge);
  const remaining = all.filter((e) => !isRegistryEdge(e));
  const fromManual = (e: Edge): boolean => kindOf.get(e.from) !== 'build';

  const edges = remaining.filter((e) => !fromManual(e));
  const cycle = findCycle(names, edges);
  if (cycle) problems.push(`the build steps form a cycle: ${cycle.join(' → ')}`);
  if (problems.length > 0) return { kind: 'rejected', problems };

  const keptLoops: Edge[] = [];
  const manualEdges = remaining.filter(fromManual)
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (const e of manualEdges) {
    if (reaches(edges, e.to, e.from)) keptLoops.push(e);
    else edges.push(e);
  }
  return { kind: 'ordered', graph: { order: topological(names, edges), edges, keptLoops, registryEdges } };
}

export function selectSteps(graph: StepGraph, targets: readonly string[]): string[] {
  const upstream = [...graph.edges, ...graph.keptLoops];
  const selected = new Set<string>();
  const stack = [...targets];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (selected.has(at)) continue;
    selected.add(at);
    for (const e of upstream) if (e.to === at) stack.push(e.from);
  }
  return graph.order.filter((n) => selected.has(n));
}

export function writersOf(graph: StepGraph, name: string): string[] {
  return [...new Set([...graph.edges, ...graph.registryEdges].filter((e) => e.to === name).map((e) => e.from))];
}
