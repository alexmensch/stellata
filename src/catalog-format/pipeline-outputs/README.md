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

- `data-files.ts` — `DATA_FILES`, the committed `data/` files TypeScript
  steps write: the membership manifest and its three ledgers, the parked
  and SIMBAD-sourced distance ledgers, the label-merge queue and the
  generated reason-code list. Each file's codec (a `defineArtifact` in
  `scripts/`) takes its `file` from here. Also the SID registry's
  partitions (`REGISTRY_PARTITIONS`: the catalogue's and one per sibling
  artifact, `SIBLING_PARTITIONS`) and how each one's ledger, events and head
  files are named and keyed (`registryPaths`, `registryKeys`,
  `registryFiles`), all typed by `RegistryPartition`, so naming a partition
  no step allocates fails typecheck. Which namespaces each partition owns is
  `/scripts/sid/registry-partitions-pure.ts`'s.
  It is the one module under `src/` that spells a `data/` path, listed by
  name in `tests/source-declarations.test.ts`'s `DATA_PATH_SPELLERS`.
- `lineage-files.ts` — the lineage layout under a build folder
  (`lineage/`, `lineage.previous/`, `lineage-diff/`; `LINEAGE_REPO_LAYOUT`
  is the checkout's own), each stage's spec (`MEMBERSHIP_LINEAGE`,
  `PLACEMENT_LINEAGE`, `PROMOTION_LINEAGE`, `ALLOCATION_LINEAGE`: the stage
  name and its file stems), the file names, and `stageOutputFiles` /
  `stageFamilies`, a stage's files as output declarations. Each stage's codes
  stay with its stage module; the absolute layout the readers and writers use
  is `/scripts/catalog/lineage/lineage-layout-pure.ts`'s. The contract is
  [Run-to-run diff](/scripts/catalog/lineage/README.md#run-to-run-diff).
