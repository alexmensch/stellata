// The SID registry's partitions: one ledger / events / head file set per allocating step, the namespaces each owns, and the keys its files emit under. See README.md#registry-partitions.

import { isSiblingNamespace, SIBLING_NAMESPACES, siblingOf, type SiblingNamespace } from './sibling-artifacts-pure';

export const CATALOG_PARTITION = 'catalog';

export type RegistryPartition = typeof CATALOG_PARTITION | SiblingNamespace;

export const REGISTRY_PARTITIONS: readonly RegistryPartition[] = [CATALOG_PARTITION, ...SIBLING_NAMESPACES];

export function partitionOf(ns: string): RegistryPartition {
  return isSiblingNamespace(ns) ? ns : CATALOG_PARTITION;
}

export const inPartition = (partition: RegistryPartition) => (ns: string): boolean => partitionOf(ns) === partition;

export interface RegistryFileSet {
  ledger: string;
  events: string;
  head: string;
}

export type RegistryKey<P extends RegistryPartition> = `sid.${P}.${keyof RegistryFileSet}`;

/** The emitArtifacts keys a partition's three files land under. */
export function registryKeys<P extends RegistryPartition>(partition: P): { [F in keyof RegistryFileSet]: `sid.${P}.${F}` } {
  return { ledger: `sid.${partition}.ledger`, events: `sid.${partition}.events`, head: `sid.${partition}.head` };
}

export function registryHint(partition: RegistryPartition): string {
  const step = partition === CATALOG_PARTITION ? 'pnpm run build:catalog' : siblingOf(partition).buildHint;
  return `It grows only through SID allocation in \`${step}\`.`;
}
