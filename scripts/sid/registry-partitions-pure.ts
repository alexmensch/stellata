// The SID registry's partitions: one ledger / events / head file set per allocating step, the namespaces each owns, and the keys its files emit under. See README.md#registry-partitions.

import { SIBLING_NAMESPACES } from './sibling-artifacts';

export const CATALOG_PARTITION = 'catalog';

export const REGISTRY_PARTITIONS: readonly string[] = [CATALOG_PARTITION, ...SIBLING_NAMESPACES];

export function partitionOf(ns: string): string {
  return SIBLING_NAMESPACES.has(ns) ? ns : CATALOG_PARTITION;
}

export interface RegistryFileSet {
  ledger: string;
  events: string;
  head: string;
}

export const inPartition = (partition: string) => (ns: string): boolean => partitionOf(ns) === partition;

/** The emitArtifacts keys a partition's three files land under. */
export function registryKeys(partition: string): RegistryFileSet {
  return { ledger: `sid.${partition}.ledger`, events: `sid.${partition}.events`, head: `sid.${partition}.head` };
}

export function registryHint(partition: string): string {
  const step = partition === CATALOG_PARTITION ? 'pnpm run build:catalog' : 'pnpm run sid:stamp';
  return `It grows only through SID allocation in \`${step}\`.`;
}
