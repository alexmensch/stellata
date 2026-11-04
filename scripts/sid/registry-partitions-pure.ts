// The SID registry's partitions: one ledger / events / head file set per allocating step, and the namespaces each owns. See README.md#registry-partitions.

import { CATALOG_PARTITION } from '../../src/catalog-format/pipeline-outputs/data-files';
import { isSiblingNamespace, SIBLING_NAMESPACES, siblingOf, type SiblingNamespace } from './sibling-artifacts-pure';

export type RegistryPartition = typeof CATALOG_PARTITION | SiblingNamespace;

export const REGISTRY_PARTITIONS: readonly RegistryPartition[] = [CATALOG_PARTITION, ...SIBLING_NAMESPACES];

export function partitionOf(ns: string): RegistryPartition {
  return isSiblingNamespace(ns) ? ns : CATALOG_PARTITION;
}

export const inPartition = (partition: RegistryPartition) => (ns: string): boolean => partitionOf(ns) === partition;

export function registryHint(partition: RegistryPartition): string {
  const step = partition === CATALOG_PARTITION ? 'pnpm run build:catalog' : siblingOf(partition).buildHint;
  return `It grows only through SID allocation in \`${step}\`.`;
}
