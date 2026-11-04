# Distance validation

Cross-check of
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) distances against
[Vaidman 2025](/data/papers/index.md#vaidman2025) BA-supergiant
distance recalculation
(`data/distance-validation/vaidman-2025-supergiants.tsv`). Reports
per-star fractional difference distribution.

Run on every distance-source change (Gaia DR4 / StarHorse / B-J
successor) to confirm distances aren't drifting against an independent
reference.

- `validate-distances.ts` — `pnpm run validate:distances`, the comparison
  driver. Exits 0 on pass, 1 on a bar miss. `validate-distances-pure.ts`
  (+ test) holds the statistics, the acceptance bars and the report, whose
  `validate-distances:` headline lines are stable for a downstream grep.
- `build-vaidman-table.ts` — `pnpm run build:vaidman-table [--pdf <path>]`,
  the one-time builder: paper appendix tables (through `pdftotext -layout`)
  → `data/distance-validation/vaidman-2025-supergiants.tsv`.
  `build-vaidman-table-pure.ts` (+ test) parses the appendix and joins each
  name to its hand-resolved source_id. A hand-run writer, so it is on the
  step table's not-a-step list (`tests/step-coverage.test.ts`). An entry's
  name never ends in `-tsv.ts` or `-source.ts`: the input-set walk imports
  every module so named, and an entry runs its step on import.
- `vaidman-tsv.ts` — the reference table's codec, which the builder writes
  through and the validator reads through; the builder's test round-trips the
  committed file byte for byte. `vaidman-outputs.ts` is the builder's
  emitArtifacts declaration.

The upstream B-J / LMC / MAX_DIST_PC override stack lives in the
catalog build (`scripts/catalog/`); this validator is the cross-check.

The validator reads the
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) TSV through the
catalogue's own declaration (`BAILER_JONES`,
`scripts/catalog/distance/refinement/`), so it compares the distance the
override applies (photogeometric, else geometric) rather than reading
`public/catalog.bin`, which keeps the harness decoupled from in-flight
writer-schema changes; the B-J override is the only distance source for
these source_ids today. See
[Distance-override validation against Vaidman 2025](/docs/science-catalog-ingestion.md#distance-override-validation-against-vaidman-et-al-2025)
for the project-level rationale.
