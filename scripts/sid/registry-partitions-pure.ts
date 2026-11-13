// The namespaces each SID registry partition owns. See README.md#registry-partitions.

import {
  CATALOG_PARTITION, type RegistryPartition,
} from '../../src/catalog-format/pipeline-outputs/data-files';
import { isSiblingNamespace, siblingBuildHint, siblingOf } from './sibling-artifacts-pure';

export function partitionOf(ns: string): RegistryPartition {
  return isSiblingNamespace(ns) ? ns : CATALOG_PARTITION;
}

export const inPartition = (partition: RegistryPartition) => (ns: string): boolean => partitionOf(ns) === partition;

export function registryHint(partition: RegistryPartition): string {
  const step = partition === CATALOG_PARTITION ? 'pnpm run build:catalog' : siblingBuildHint(siblingOf(partition));
  return `It grows only through SID allocation in \`${step}\`.`;
}
