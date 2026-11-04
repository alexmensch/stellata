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
