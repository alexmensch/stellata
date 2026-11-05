// The package.json scripts named or shaped like steps that are not on the table, each with why. See README.md#files.

import type { OutputsRef, StepTable } from './step-table-pure';

/** `report`: no step reads what it writes. `on-demand`: hand-run; what it writes is frozen data. `draft`: a report that reads the files its command line names, so its closure's declarations are defaults, not its reads. `vite`: the bundler, after the data build. `seed`: a wrapper that runs steps. */
export type NonStepWriter =
  | { readonly kind: 'report' | 'on-demand' | 'draft'; readonly outputs: readonly OutputsRef[] }
  | { readonly kind: 'vite' | 'seed' };

export const NON_STEP_WRITERS: Readonly<Record<string, NonStepWriter>> = {
  'sid:risk-set': { kind: 'report', outputs: [{ module: 'scripts/sid/dr-risk-set-outputs.ts', name: 'DR_RISK_SET_OUTPUTS' }] },
  'identity:snapshot': { kind: 'report', outputs: [] },
  'sid:dr-reconcile': { kind: 'draft', outputs: [{ module: 'scripts/sid/dr-reconcile-outputs.ts', name: 'DR_RECONCILE_OUTPUTS' }] },
  'build:lut': { kind: 'on-demand', outputs: [{ module: 'scripts/colour/blackbody-lut-outputs.ts', name: 'LUT_OUTPUTS' }] },
  'build:naming-parity': { kind: 'on-demand', outputs: [{ module: 'scripts/catalog/naming/naming-parity-outputs.ts', name: 'NAMING_PARITY_OUTPUTS' }] },
  'build:vaidman-table': { kind: 'on-demand', outputs: [{ module: 'scripts/distance-validation/vaidman-outputs.ts', name: 'VAIDMAN_OUTPUTS' }] },
  'build:client': { kind: 'vite' },
  'build:site': { kind: 'vite' },
  'build:seed': { kind: 'seed' },
};

/** The writers whose reads are their closure's declarations, held to the source rules like a step. */
export const closureReadingWriters = (): string[] => Object.entries(NON_STEP_WRITERS)
  .flatMap(([name, w]) => (w.kind === 'report' || w.kind === 'on-demand' ? [name] : []));

/** Every TypeScript outputs declaration, with the step or writer that owns it. */
export const outputsOwners = (table: StepTable): (readonly [string, OutputsRef])[] => [
  ...table.steps.flatMap((s) => (s.language === 'ts' ? [[s.name, s.outputs] as const] : [])),
  ...Object.entries(NON_STEP_WRITERS).flatMap(([name, w]) => ('outputs' in w ? w.outputs.map((o) => [name, o] as const) : [])),
];
