# Distance validation

Post-build cross-check of `public/catalog.bin` against Vaidman et al.
2025 BA-supergiant distance recalculation
(`data/distance-validation/vaidman-2025-supergiants.tsv`). Reports
per-star fractional difference distribution.

Run on every distance-source change (Gaia DR4 / StarHorse / B-J
successor) to confirm distances aren't drifting against an independent
reference.

- `validate-distances.py` — comparison driver.
- `build-vaidman-tsv.py` — one-time builder: paper appendix tables →
  `data/distance-validation/vaidman-2025-supergiants.tsv`.
- `common.py` — shared helpers for both scripts.
- `*.test.py` — stdlib unittest pins.

See `scripts/README.md` § Multi-layer distance refinement for the
upstream algorithm.
