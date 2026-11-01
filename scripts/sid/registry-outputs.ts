// A registry partition's file paths, and its files keyed for the emitArtifacts declaration of the step that allocates it. See README.md.

import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { CATALOG_PARTITION, registryKeys, type RegistryFileSet } from './registry-partitions-pure';

/** Repo-relative. */
export function registryPaths(partition: string): RegistryFileSet {
  const suffix = partition === CATALOG_PARTITION ? '' : `-${partition}`;
  return {
    ledger: `data/sid/ledger${suffix}.tsv`,
    events: `data/sid/events${suffix}.tsv`,
    head: `data/sid/ledger-head${suffix}.json`,
  };
}

export function registryFiles(partition: string): Record<string, string> {
  const paths = registryPaths(partition);
  const keys = registryKeys(partition);
  return {
    [keys.ledger]: resolve(REPO_ROOT, paths.ledger),
    [keys.events]: resolve(REPO_ROOT, paths.events),
    [keys.head]: resolve(REPO_ROOT, paths.head),
  };
}
