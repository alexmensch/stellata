# SIMBAD pull plumbing

Reusable building blocks for SIMBAD TAP pulls. Modelled on
[`scripts/binaries/`](../../binaries/README.md) (one module per
phase, shared dataclasses) so future SIMBAD-anchored refreshes
(radial velocities, photometry, …) reuse the entire stack.

```
specs.py     Declarative dataclasses — ColumnSpec for basic-table
             columns (sp_type / sp_qual / sp_bibcode / otype / oid),
             IdentLookup for ident-table cross-IDs (HIP, Gaia DR3).
             Canonical catalogue of column + ident-prefix instances.
inputs.py    Per-source-file id iterators (AT-HYG HIPs, AT-HYG Gaia
             source_ids, WDS pair components). One function per
             input feeder; the orchestration shell picks the subset
             it needs.
query.py     ADQL builders + batched TAP executor. Wraps each
             ColumnSpec's adql fragment with `AS <alias>` so ORDER BY
             can reference the alias (SIMBAD rejects qualified names
             in ORDER BY).
tsv.py       Spec-driven TSV writer — schema, header row, atomic
             rename via the shared refresh_lib path.
simbad.test.py   stdlib unittest pins covering spec definitions,
                 input iterators, query builders, and TSV emit.
__init__.py      Package marker.
```

## Used by

- [`refresh-simbad-sptype.py`](../README.md) — pulls per-source
  `sp_type` / `sp_qual` / `sp_bibcode` / `otype` keyed on HIP +
  Gaia DR3.
- [`refresh-simbad-wds-xids.py`](../README.md) — pulls per-WDS-
  component (Gaia DR3, HIP) cross-IDs via a two-phase WDS-id →
  SIMBAD-oid → cross-IDs walk.

`refresh-simbad-sample.py` and the older `refresh-simbad-*` scripts
predate this folder and drive their TAP queries directly via the
shared
[`scripts/refresh/refresh_lib.py`](../README.md). New SIMBAD pulls
should compose `specs.py` + `query.py` + `tsv.py` here instead of
inlining their own ADQL.
