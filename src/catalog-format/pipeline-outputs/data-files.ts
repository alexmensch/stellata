// Where the committed data/ files the pipeline writes land, repo-relative. See README.md.

export const DATA_FILES = {
  membershipManifest: 'data/membership/membership-manifest.tsv',
  additionsLedger: 'data/membership/additions-ledger.tsv',
  bindingReview: 'data/membership/binding-review.tsv',
  labelDrops: 'data/membership/label-drops.tsv',
  parkedLedger: 'data/membership/parked-ledger.tsv',
  labelFlips: 'data/classic-ids/label_flips.tsv',
  simbadSourcedDistances: 'data/athyg/simbad_sourced_distances.tsv',
  reasonCodes: 'data/lineage/reason-codes.tsv',
} as const;

export const CATALOG_PARTITION = 'catalog';

export interface RegistryFileSet {
  ledger: string;
  events: string;
  head: string;
}

export type RegistryKey<P extends string> = `sid.${P}.${keyof RegistryFileSet}`;

/** The emitArtifacts keys a partition's three files land under. */
export function registryKeys<P extends string>(partition: P): { [F in keyof RegistryFileSet]: `sid.${P}.${F}` } {
  return { ledger: `sid.${partition}.ledger`, events: `sid.${partition}.events`, head: `sid.${partition}.head` };
}

export function registryPaths(partition: string): RegistryFileSet {
  const suffix = partition === CATALOG_PARTITION ? '' : `-${partition}`;
  return {
    ledger: `data/sid/ledger${suffix}.tsv`,
    events: `data/sid/events${suffix}.tsv`,
    head: `data/sid/ledger-head${suffix}.json`,
  };
}

export function registryFiles<P extends string>(partition: P): Record<RegistryKey<P>, string> {
  const paths = registryPaths(partition);
  const keys = registryKeys(partition);
  return { [keys.ledger]: paths.ledger, [keys.events]: paths.events, [keys.head]: paths.head } as Record<RegistryKey<P>, string>;
}
