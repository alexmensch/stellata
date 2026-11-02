// One sibling artifact's namespace allocated over the committed registry: each record's SID and its partition's registry files. See README.md#sibling-artifact-stamping.

import { allocate, type Upstream } from './allocate-pure';
import { allocationRun, loadRegistry, registryTexts } from './registry-io';
import { inPartition, type RegistryKey } from './registry-partitions-pure';
import { siblingArtifactObjects, type SiblingArtifactSpec, type SiblingItem, type SiblingNamespace } from './sibling-artifacts';

const NO_LINEAGE: Upstream = { causes: () => new Map(), admissions: () => new Map() };

export interface SiblingAllocation<N extends SiblingNamespace> {
  /** Parallel to the items allocated. */
  readonly sids: readonly number[];
  readonly minted: number;
  /** The partition's files, present only when the allocation appended a row, so a run that mints nothing rewrites no registry file. */
  readonly registry: Partial<Record<RegistryKey<N>, string>>;
}

export function allocateSibling<N extends SiblingNamespace>(
  spec: SiblingArtifactSpec & { readonly ns: N },
  items: SiblingItem[],
): SiblingAllocation<N> {
  const registry = loadRegistry();
  const allocation = allocate({
    objects: siblingArtifactObjects(spec, items),
    storedEdges: registry.storedEdges,
    ledger: registry.ledger,
    events: registry.events,
    scope: inPartition(spec.ns),
    ...allocationRun(),
  }, NO_LINEAGE);
  if (allocation.kind === 'failed') {
    throw new Error(
      `${spec.ns} SID allocation failed:\n  ${allocation.errors.join('\n  ')}\n`
        + 'A renamed slug needs a bridge in data/sid/sameas-overrides.tsv.',
    );
  }
  const appended = allocation.minted.length > 0 || allocation.events.length > 0;
  return {
    sids: allocation.outcomes.map((o) => o.sid),
    minted: allocation.minted.length,
    registry: appended ? registryTexts(spec.ns, allocation.minted, allocation.events) : {},
  };
}

/** An emitArtifacts emission of the artifact plus whichever registry files the allocation produced. */
export function siblingEmission<K extends string, N extends SiblingNamespace>(
  artifact: Record<K, string>, allocation: SiblingAllocation<N>,
): { only: (K | RegistryKey<N>)[]; files: Record<K | RegistryKey<N>, string> } {
  const files = { ...artifact, ...allocation.registry } as Record<K | RegistryKey<N>, string>;
  return { only: Object.keys(files) as (K | RegistryKey<N>)[], files };
}
