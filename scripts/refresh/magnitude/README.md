# The magnitude-bounded selection

Layer 2's non-declarative case: a pull whose scope is a **bound on
`phot_g_mean_mag`** rather than a list of ids, and the two-leg deep-population
pull built on it. The refresh policy and the per-script table are the parent's
(`../README.md`).

```
magnitude_pull.py        the floor, the slice partition, both legs
magnitude_pull.test.py   non-network suite, in-memory TAP backend
```

Three pulls read this module — `refresh-gaia-magnitude.py` (the selection
alone), `refresh-bailer-jones.py` and `refresh-gaia-apsis.py` (both legs).
It imports `refresh_lib` for the TAP client, `run_in_batches` and the
checkpoint; nothing in `refresh_lib` imports back.

**`is_up_to_date` does not fold this module's mtime in** — it folds
`refresh_lib`'s. Each caller passes `magnitude_pull.MODULE_PATH` among its
sources, so an edit to the slicing or either leg re-pulls rather than skips.

## Slicing a magnitude-bounded pull

A selection with no request set still has to be batched: 1.25 M rows in one
sync query has no resume point and a 300 s timeout. `refresh-gaia-magnitude.py`
splits on `phot_g_mean_mag`, and the spacing is the part worth not
re-deriving. Source counts grow ~2.48x per magnitude at this depth, so equal
magnitude steps would make the faintest slice ~27x the brightest. Equal steps
in **log-count** space instead — edge `k` at `floor + ln(k/K)/ln(2.48)` —
land every slice but the first within ~5% of the mean: measured 15,897 to
27,367 over 48 slices, the low figure being the open-ended bright slice, where
the power law stops holding. The whole pull runs in about four minutes.

**The edges are shared as formatted strings, not recomputed per side.**
Slice `k`'s `<=` bound and slice `k+1`'s `>` bound are the same literal, which
is what makes the bounds a partition: a source can satisfy neither only if the
two sides disagree in their last decimal. `assert_partitioned` gates the other
direction (no source returned twice) and `assert_within_floor` gates the
result against the bound, so a bad edge fails the pull rather than quietly
moving the floor.

`SyncOverflowError` covers the truncation case and is deliberately NOT
classified transient — retrying or switching mirrors at the same MAXREC
truncates identically, so it fails fast naming the MAXREC to raise.

**The floor and the partition are this module's** (`G_MAG_FLOOR`,
`magnitude_slices`): three pulls name the same population, and a floor that
drifted between them would leave the enrichment tables covering a different
set of records than the magnitude term admits. `slice_sync_maxrec` sizes each
slice's MAXREC off the same partition — [Gaia TAP](../README.md#gaia-tap-synchronous-endpoints-only).

## The deep population — a bounded leg plus a request leg

Bailer-Jones and Apsis are scoped to every source the catalogue's RECORDS can
reach, which takes two legs: that population has two definitions and neither
contains the other. `pull_deep_population` is the one statement of
the shape, and each script supplies only a table, a column list and its gates.

It owns the request-file read, both legs' logging, and the count of the
request set either leg served; it hands back a `DeepPopulation`
(`seen` · `from_magnitude` · `requested` · `matched_request`). A third pull
scoped this way writes its gates and nothing else.

**Both legs need a gate, and they are different gates.** The magnitude leg
answers to a row-count band on `from_magnitude`; that band says nothing
about the request leg, so a request leg returning nothing would otherwise
pass every check and drop exactly the promoted companions the union exists
to reach. `assert_request_coverage` is the second gate and both pulls carry
it at 0.90.

- The **magnitude leg** is a selection — every source at the floor or
  brighter, which no request set names because nothing binds most of them yet.
  Neither table carries a magnitude, so each slice joins to
  `gaiadr3.gaia_source`, where the bound lives; both are keyed on the indexed
  `source_id`, so the join costs about what the slice does. Why that beats an
  id list, and why Bailer-Jones is pulled from ESA rather than VizieR:
  [Why the pull is ESA-side](/data/bailer-jones/README.md#why-the-pull-is-esa-side).
- The **request leg** is `gaia_catalog_source_id_request.tsv`, whose classic
  tiers reach fainter than the floor, restricted to the ids the magnitude leg
  did not return. That restriction keeps it to the genuine remainder and makes
  "each source exactly once" a property of the helper rather than of a dedupe.

Reading the exported union rather than the manifest is what closes the
asymmetry [The staleness gate](../README.md#the-staleness-gate--pin-the-shortfall-never-the-numerator) names.

