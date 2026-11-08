# pipeline-outputs — where the pipeline's own outputs land

The names a step's output declaration needs, for the files the pipeline
writes and the viewer never fetches. They live in this tree because the step
table imports every outputs module before anything runs, and an outputs
module may reach only this tree, `/src/astro-core/`, `scripts/util/emit-artifacts`
and `scripts/util/paths` ([Load-time rules](/scripts/pipeline/step-table/README.md#load-time-rules)).
So a name is here, and the module that reads or writes the file — its codec,
its build — imports it from here; neither spells it.

Names are repo-relative. `declareOutputs` reads a relative path as
repo-relative, so an outputs module passes them as they are.

- `data-files.ts` — `DATA_FILES`, the committed `data/` files the
  step-table outputs modules declare: the membership manifest and its three
  ledgers, the parked and SIMBAD-sourced distance ledgers, SIMBAD's WDS
  component cross-IDs (which a pull writes and two sources read) and the
  WDS-keyed SIMBAD spectral types, the SIMBAD validation sample, value tier and manifest-keyed spectral types, the label-merge
  queue, the classic-ID overlay and its two gate queues, the two WGSN
  tables, the two Gaia astrometry requests (the catalogue's, and the one
  `build:binaries` writes, which the step table names), the three
  whole-table Gaia pulls' tables (HIP and TYC cross-matches, NSS two-body
  orbits), the generated
  reason-code list, and the Vaidman 2025 reference table the hand-run
  `build:vaidman-table` writes; and `MANUAL_STAMP_FOLDER`, where the manual
  steps' committed records live (`/scripts/pipeline/pipeline-tree.ts`). The Horizons fetchers' per-target families are spelled beside
  their own outputs modules. Python cannot import this module, so the
  Python `scripts/refresh/` pulls left take the manifest's and the request's
  paths from `refresh_lib.py`, Python's one spelling of each. Each file's codec (a `defineArtifact` in
  `scripts/`) takes its `file` from here. Also the SID registry's
  partitions (`REGISTRY_PARTITIONS`: the catalogue's and one per sibling
  artifact, `SIBLING_PARTITIONS`, each named here — `CLOUD_PARTITION`,
  `LOCAL_GROUP_PARTITION` — so the clouds and Local Group outputs modules
  and `/scripts/sid/sibling-artifacts-pure.ts` share one spelling) and how each one's ledger, events and head
  files are named and keyed (`registryPaths`, `registryKeys`,
  `registryFiles`), all typed by `RegistryPartition`, so naming a partition
  no step allocates fails typecheck. Which namespaces each partition owns is
  `/scripts/sid/registry-partitions-pure.ts`'s.
  It is the one production module that spells a `data/` path:
  `tests/source-declarations.test.ts`'s `DATA_PATH_SPELLERS` names it, and
  pins it as the list's only production entry.
- `build-files.ts` — `BUILD_FILES`, the build-only hand-offs under
  `build/` a declaration and its readers both name: today
  `build/catalog-row-index-map.json`.
- `lineage-files.ts` — the lineage layout under a build folder
  (`lineage/`, `lineage.previous/`, `lineage-diff/`; `LINEAGE_REPO_LAYOUT`
  is the checkout's own), each stage's spec (`MEMBERSHIP_LINEAGE`,
  `PLACEMENT_LINEAGE`, `BRIGHTNESS_COLOUR_LINEAGE`, `COHERENCE_LINEAGE`, `PROMOTION_LINEAGE`,
  `ALLOCATION_LINEAGE`, `NAMING_LINEAGE`, and the
  sibling builds' `CLOUDS_ALLOCATION_LINEAGE` and
  `LOCAL_GROUP_ALLOCATION_LINEAGE` from `siblingAllocationLineage`: the stage
  name and its file stems), the file names, and `stageOutputFiles` /
  `stageFamilies`, a stage's files as output declarations. Each stage's codes
  stay with its stage module; the absolute layout the readers and writers use
  is `/scripts/catalog/lineage/lineage-layout-pure.ts`'s. The contract is
  [Run-to-run diff](/scripts/catalog/lineage/README.md#run-to-run-diff).
