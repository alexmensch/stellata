// One sibling artifact's namespace allocated over the committed registry: each record's SID and its partition's registry files. See README.md#sibling-artifact-stamping.

import { emitArtifacts, type DeclaredOutputs } from '../util/emit-artifacts';
import { allocate, type Upstream } from './allocate-pure';
import { allocationRun, loadRegistry, registryTexts } from './registry-io';
import { inPartition } from './registry-partitions-pure';
import { siblingArtifactObjects, type SiblingArtifactSpec, type SiblingItem, type SiblingNamespace } from './sibling-artifacts-pure';
import type { RegistryKey } from '../../src/catalog-format/pipeline-outputs/data-files';

const NO_LINEAGE: Upstream = { causes: () => new Map(), admissions: () => new Map() };

export interface SiblingAllocation<N extends SiblingNamespace> {
  /** Parallel to the items allocated. */
  readonly sids: readonly number[];
  readonly minted: number;
  /** The partition's files, or null when the allocation appended nothing, so such a run rewrites no registry file. */
  readonly registry: Readonly<Record<RegistryKey<N>, string>> | null;
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
    registry: appended ? registryTexts(spec.ns, allocation.minted, allocation.events) : null,
  };
}

/** Lands the artifact, and the registry partition when the allocation appended, in one emitArtifacts call. */
export function emitSibling<K extends string, N extends SiblingNamespace>(
  outputs: DeclaredOutputs<K | RegistryKey<N>>, artifact: Readonly<Record<K, string>>, allocation: SiblingAllocation<N>,
): void {
  if (allocation.registry === null) {
    emitArtifacts<K | RegistryKey<N>, K>({ outputs, only: Object.keys(artifact) as K[], files: artifact });
  } else {
    emitArtifacts<K | RegistryKey<N>>({ outputs, files: { ...artifact, ...allocation.registry } });
  }
}
