// The namespaces each SID registry partition owns. See README.md#registry-partitions.

import {
  CATALOG_PARTITION, type RegistryPartition,
} from '../../src/catalog-format/pipeline-outputs/data-files';
import { isSiblingNamespace, siblingOf } from './sibling-artifacts-pure';
import { rerunCommand } from '../util/step-command-pure';

export function partitionOf(ns: string): RegistryPartition {
  return isSiblingNamespace(ns) ? ns : CATALOG_PARTITION;
}

export const inPartition = (partition: RegistryPartition) => (ns: string): boolean => partitionOf(ns) === partition;

export function registryHint(partition: RegistryPartition): string {
  const step = rerunCommand(partition === CATALOG_PARTITION ? 'build:catalog' : siblingOf(partition).step);
  return `It grows only through SID allocation in \`${step}\`.`;
}
