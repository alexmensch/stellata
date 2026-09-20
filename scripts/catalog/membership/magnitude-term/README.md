# The magnitude term — `MAGNITUDE PULL(V ≤ floor)`

The second term of `membership(floor) = SPINE ∪ MAGNITUDE PULL(V ≤ floor)`
(`docs/catalog-driver.md` § 1): the Gaia sources a Johnson-V floor admits on
their brightness alone, with no classical designation behind them. The first
term is the primaries-derived manifest of `../README.md`; this folder owns the
floor, the filter over the pull, and the union onto that manifest.

## Files in this area

```
scripts/catalog/membership/magnitude-term/
  magnitude-term-pure.ts        MAGNITUDE_FLOOR_V, the per-row verdict over
    (+ test)                    the Riello transform, the line-fed accumulator
                                the whole-text and streaming readers share,
                                and the union's dedupe. Pure.
  magnitude-term.ts             The streaming reads: the floor's selection and
                                the 5p astrometry over the ~200 MB pull, and
                                the term's own source_ids out of the manifest.
  magnitude-term-gate.test.ts   The floor measured over the COMMITTED pull and
                                manifest, pinning the four figures
                                data/gaia/README.md states. LFS-gated.
```

## The floor is one constant

`MAGNITUDE_FLOOR_V` is the whole parameter. `null` is a membership term of the
primaries alone — what ships today — and a number re-cuts the catalogue with no
other edit: `build:membership` reads the pull, unions the survivors onto the
manifest, and the record build walks the longer file unchanged.

Moving it **deeper than `V ≤ 11` needs a re-pull first**. The file on disk is
bounded at `G ≤ 11` and `{V ≤ 11} ⊂ {G ≤ 11}` strictly, so any floor at or
below 11 is complete and a floor above it would claim a completeness the file
does not hold. `MAGNITUDE_PULL_G_BOUND` states that bound and the accumulator
**throws** on a floor past it, beside its non-finite check — the read refuses
rather than under-selecting, so an ad-hoc call with a deeper floor fails at the
build and not at whatever later point a count is read as complete. The
argument, and why the pull carries no margin over the floor rather than the
0.5 mag one intuition asks for: `data/gaia/README.md` § Why the floor carries
no margin.

The pull is `data/gaia/gaia_dr3_magnitude_pull.tsv`, refreshed by
`pnpm run refresh:gaia-magnitude` (`scripts/refresh/README.md`).

## The filter is the shipped cascade's own top tier

`magnitudeVerdict` calls `rielloVMagnitude` — the function
`../../photometry/`'s V cascade runs, not a second reading of the same cubic —
so the saturation gate and the colour range come along for free. Writing the
predicate as a colour range plus the cubic instead costs the gate and admits
**633** saturated rows the cascade refuses, which is the whole difference
between the 929,929 this filter keeps and the 930,562 an archive-side count of
the same population reports.

Three verdicts partition every pull row, and two of them are **non-selection,
not a drop**: the term's predicate is a bound on V, and a source with no V
satisfies no predicate over V. Ledgering those would equally oblige ledgering
every row above the floor. `data/gaia/README.md` § What the filter keeps, and
what falls through it carries the cohorts and the decision behind them.

Measured over the committed pull at `V ≤ 11`, and pinned by the gate suite:

| verdict | rows |
|---|---|
| `kept` | 929,929 |
| `above_floor` | 312,475 |
| `no_v` | 4,836 |
| | 1,247,240 |

## The union dedupes on the derived binding

`buildMembership` runs the dedupe itself rather than taking a newcomer list,
because the sources the primaries bind are the bindings it has just derived
(`../README.md` § The binding is derived) — a caller deduping against the
*previous* manifest would re-admit every source that run's derivation moved.

`source_id` is keyed as a **string** throughout. A Gaia id runs to 19 digits
and loses precision silently as a float64, so a numeric key merges distinct
sources without erroring.

Against today's manifest the union measures 370,994 bound source_ids, 327,701
of them in the kept set, so 602,228 rows are the term's own and the union is
973,222 source_ids. The record total that implies, once promotion and parking
apply: `data/gaia/README.md` § The record total the floor implies.

Run at `V ≤ 11` the generator writes **979,160** manifest rows — 376,932 plus
those 602,228 — and every primaries-side count holds byte for byte, which is
what says the term adds and moves nothing. Reproduce by setting the floor and
running `pnpm run build:membership`; nothing else changes.

## The column is the ledger

A magnitude-term row carries no classical cell, `binding` `gaia_native` and
`term` `magnitude`. That column is what says a record is present on its
brightness rather than on a primary naming it, and it is the whole ledger for
this cohort — every row of it has the same admission reason, and the manifest
already names which rows those are. An `additions-ledger.tsv` entry per row
would restate the column 602,228 times.

`gaia_native` is a fifth binding class rather than `none`, which means an empty
cell: these rows' `gaia_source_id` is the pull row itself, justified by nothing
because there is nothing between the source and the record.

**Every one keys its SID on `gaia_dr3:`** — they hold no designation that could
key anything else. That is the opposite of `additionGaiaKeyedOnly`, which the
primaries' own additions pin at zero: an admitted group falling through to its
Gaia id means the admission rule leaked, while a magnitude row doing so is the
term working. The two counts must not be read against each other.

## The astrometry comes with it

The pull carries full 5p astrometry and `radial_velocity` for every row, on
`gaia_astrometry_pull.TSV_COLUMNS` — the same schema
`gaia_dr3_astrometry_catalog.tsv` uses. `readMagnitudeTermAstrometry` therefore
feeds `gaiaAstrometryAccumulator` (`../../distance/direction-cascade.ts`), the
fold behind the same parser, so the direction cascade stays single-sourced and
the overlap between the two files cannot drift. No request-file extension
reaches these sources, and none is needed.

It takes a keep-set and streams, for the reason `../../parse/gaia-xmatch.ts`
does: parsing 1.25 M rows to join a subset holds the whole table in memory for
no gain. The keep-set arrives the same way — `readMagnitudeTermSourceIds`
folds the `term=magnitude` rows out of the manifest a line at a time, since
the record build needs it *before* it walks that file and the manifest is the
build's largest artifact once the term is on. Both reads resolve their columns
from the header by name; neither assumes a column's position.
`../../parse/README.md` § Streaming a committed table carries the pattern and
why a collect-then-rejoin reader defeats it.

Bailer-Jones distances and Apsis parameters for the same population arrive
through `refresh_lib.pull_deep_population` (`scripts/refresh/README.md`), not
through this folder.
