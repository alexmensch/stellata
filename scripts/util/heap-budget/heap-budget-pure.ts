// A heavy build step's heap capped at its share of the CI runner's V8 heap limit, under the Node CI pins. See README.md.

export const CI_HEAP_LIMIT_MIB = 4096;

export const CI_HEAP_HEADROOM = 0.85;

export const HEAP_BUDGET_MIB = Math.floor(CI_HEAP_LIMIT_MIB * CI_HEAP_HEADROOM);

/** `env` with V8's old-space limit set to `budgetMib`; it reaches every Node process the step starts, tsx's own included. */
export function heapCappedEnv(env: NodeJS.ProcessEnv, budgetMib: number): NodeJS.ProcessEnv {
  const cap = `--max-old-space-size=${budgetMib}`;
  return { ...env, NODE_OPTIONS: env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${cap}` : cap };
}

/** The Node major a step runs under, and the one `.nvmrc` pins for CI. */
export interface NodeRuntime {
  readonly running: number;
  readonly pinned: number;
}

export type RuntimeVerdict =
  | { readonly kind: 'pinned' }
  | { readonly kind: 'other'; readonly reason: string };

export function heapRuntimeVerdict(node: NodeRuntime): RuntimeVerdict {
  return node.running === node.pinned ? { kind: 'pinned' } : {
    kind: 'other',
    reason: `it runs under Node ${node.running}, but CI runs Node ${node.pinned} (.nvmrc), whose heap differs: `
      + 'run it under the pinned Node. See /scripts/util/heap-budget/README.md.',
  };
}

export function nodeMajor(version: string, source: string): number {
  const major = Number(/^v?(\d+)/.exec(version.trim())?.[1]);
  if (!Number.isInteger(major)) throw new Error(`${source}: "${version.trim()}" names no Node major`);
  return major;
}
