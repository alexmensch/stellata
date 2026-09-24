# VizieR column slices

The declarative slice of Layer 2: whole VizieR table, column subset,
committed TSV. The refresh policy and the per-script table are the parent's
(`../README.md`).

```
vizier_slice.py        VizierSlice + pull_slices()
vizier_slice.test.py   non-network suite, in-memory TAP backend
```

A `VizierSlice` carries the table id, the VizieR→canonical column map (which
also fixes the TSV column order), the dtype schema, a row-count band, and
pinned spot rows; `pull_slices()` executes a list of them, folding its own
mtime into each slice's idempotency check the way `is_up_to_date` folds in
`refresh_lib`'s. `refresh-classic-ids.py` (four slices),
`refresh-hipparcos-vmag.py` (one) and `refresh-gliese.py` (one) are then spec
files with no query logic of their own — the same split
`gaia_astrometry_pull.py` uses for the 5p pulls.

**MAXREC is not load-bearing on CDS.** VizieR's TAP default MAXREC is ~1e9,
so a whole-table slice needs none of the sizing the Gaia sync endpoints demand
([Gaia TAP](../README.md#gaia-tap-synchronous-endpoints-only)); the row-count band is what catches an upstream
row loss here. Coverage of the pull is asserted downstream instead —
`pnpm run build:classic-ids` pins per-identifier counts.

**Quote every identifier.** VizieR table ids contain `/` and its column names
are case-sensitive, so `SELECT TOP 2 HIP FROM I/239/hip_main` is a parse error
on the slash. `rl.select_columns()` quotes for you.

**`refresh-tycho2.py` deliberately does NOT use `VizierSlice`**: its output is
a filtered subset rather than a whole table, and its gate is a band on kept
rows as a fraction of the request set rather than an absolute row count, so a
membership term that gains or loses rows moves the gate with it. It still
shares the projection and every gate helper — [VizieR](../README.md#vizier), and
[Why the pull is range-batched](/data/tycho2/README.md#why-the-pull-is-range-batched-rather-than-key-filtered).

Non-network dependency: `vizier_slice.test.py` covers the ADQL shape, the
row-count / spot-row gates, the `--only` selector, and the no-partial-write
guarantee against an in-memory TAP backend. Run it with
`python3 scripts/refresh/vizier/vizier_slice.test.py`. The in-memory backend
(`FakeTable`, `fake_tap_client`) lives in `scripts/test_helpers.py`.
