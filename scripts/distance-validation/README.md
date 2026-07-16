# Distance validation

Post-build cross-check of `public/catalog.bin` against Vaidman et al.
2025 BA-supergiant distance recalculation
(`data/distance-validation/vaidman-2025-supergiants.tsv`). Reports
per-star fractional difference distribution.

Run on every distance-source change (Gaia DR4 / StarHorse / B-J
successor) to confirm distances aren't drifting against an independent
reference.

- `validate-distances.py` — comparison driver. Exits 0 on pass, 1 on
  bar miss.
- `build-vaidman-tsv.py` — one-time builder: paper appendix tables →
  `data/distance-validation/vaidman-2025-supergiants.tsv`.
- `common.py` — shared helpers for both scripts.
- `*.test.py` — stdlib unittest pins.

The upstream B-J / LMC / MAX_DIST_PC override stack lives in the
catalog build (`scripts/catalog/`); this validator is the cross-check.

The validator reads the Bailer-Jones TSV directly rather than
`public/catalog.bin` so the harness stays decoupled from in-flight
writer-schema changes; the B-J override is the only distance source
for these source_ids today. See `docs/science-catalog-ingestion.md`
§ Distance-override validation against Vaidman et al. 2025 for the
project-level rationale.
