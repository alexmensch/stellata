// Where the committed data/ files the pipeline writes land, repo-relative. See README.md.

export const DATA_FILES = {
  membershipManifest: 'data/membership/membership-manifest.tsv',
  additionsLedger: 'data/membership/additions-ledger.tsv',
  bindingReview: 'data/membership/binding-review.tsv',
  labelDrops: 'data/membership/label-drops.tsv',
  parkedLedger: 'data/membership/parked-ledger.tsv',
  labelFlips: 'data/classic-ids/label_flips.tsv',
  classicIdOverlay: 'data/classic-ids/classic_id_overlay.tsv',
  routeDisagreements: 'data/classic-ids/hd_hip_route_disagreements.tsv',
  rejectedBindings: 'data/classic-ids/rejected_bindings.tsv',
  wgsnNames: 'data/iau-wgsn/wgsn_names.tsv',
  wgsnDesignations: 'data/iau-wgsn/wgsn_designations.tsv',
  astrometryRequest: 'data/gaia/gaia_catalog_source_id_request.tsv',
  multiples: 'data/binaries/multiples.tsv',
  binariesAstrometryRequest: 'data/gaia/gaia_astrometry_source_id_request.tsv',
  gaiaHipXmatch: 'data/gaia/gaia_dr3_hip_xmatch.tsv',
  gaiaTycXmatch: 'data/gaia/gaia_dr3_tyc_xmatch.tsv',
  gaiaNssTwoBody: 'data/gaia/gaia_dr3_nss_two_body.tsv',
  gaiaAstrometry: 'data/gaia/gaia_dr3_astrometry.tsv',
  gaiaAstrometryCatalog: 'data/gaia/gaia_dr3_astrometry_catalog.tsv',
  gaiaGspc: 'data/gaia/gaia_dr3_gspc.tsv',
  gaiaDr2Neighbourhood: 'data/gaia/gaia_dr2_neighbourhood.tsv',
  gaiaMagnitudePull: 'data/gaia/gaia_dr3_magnitude_pull.tsv',
  gaiaApsis: 'data/gaia/gaia_dr3_apsis.tsv',
  bailerJones: 'data/bailer-jones/bailer-jones-dr3.tsv',
  simbadSourcedDistances: 'data/membership/simbad_sourced_distances.tsv',
  simbadWdsXids: 'data/simbad/simbad_wds_xids.tsv',
  simbadWdsSptype: 'data/simbad/simbad_wds_sptype.tsv',
  simbadSample: 'data/simbad/simbad_sample.tsv',
  simbadValues: 'data/simbad/simbad_values.tsv',
  simbadSptype: 'data/simbad/simbad_sptype.tsv',
  reasonCodes: 'data/lineage/reason-codes.tsv',
  vaidmanSupergiants: 'data/distance-validation/vaidman-2025-supergiants.tsv',
} as const;

export const MANUAL_STAMP_FOLDER = 'data/stamps';

export const CATALOG_PARTITION = 'catalog';
/** One per sibling artifact; `/scripts/sid/sibling-artifacts-pure.ts` must name each. */
export const CLOUD_PARTITION = 'cloud';
export const LOCAL_GROUP_PARTITION = 'lg';
export const SIBLING_PARTITIONS = [CLOUD_PARTITION, LOCAL_GROUP_PARTITION] as const;

export type SiblingPartition = (typeof SIBLING_PARTITIONS)[number];
export type RegistryPartition = typeof CATALOG_PARTITION | SiblingPartition;

export const REGISTRY_PARTITIONS: readonly RegistryPartition[] = [CATALOG_PARTITION, ...SIBLING_PARTITIONS];

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

export function registryPaths(partition: RegistryPartition): RegistryFileSet {
  const suffix = partition === CATALOG_PARTITION ? '' : `-${partition}`;
  return {
    ledger: `data/sid/ledger${suffix}.tsv`,
    events: `data/sid/events${suffix}.tsv`,
    head: `data/sid/ledger-head${suffix}.json`,
  };
}

export function registryFiles<P extends RegistryPartition>(partition: P): Record<RegistryKey<P>, string> {
  const paths = registryPaths(partition);
  const keys = registryKeys(partition);
  return { [keys.ledger]: paths.ledger, [keys.events]: paths.events, [keys.head]: paths.head } as Record<RegistryKey<P>, string>;
}
