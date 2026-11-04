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
  `scripts/`) takes its `file` from here.
  It is the one module under `src/` that spells a `data/` path, listed by
  name in `tests/source-declarations.test.ts`'s `DATA_PATH_SPELLERS`.
