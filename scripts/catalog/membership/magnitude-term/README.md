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
apply: § The record total the floor implies, below.

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

## The record total the floor implies — 983,069, measured

The catalogue is not the magnitude pull. It is the pull's `V <= 11` population
**unioned** with the membership manifest and deduped on `source_id`, then put
through the build's own two corrections. Projected 2026-09-19 from the
committed files, then measured on a real floor-11 build, 2026-09-20:

| term | projected | measured |
|---|---|---|
| `V <= 11` source_ids from the pull | 929,929 | 929,929 |
| distinct `gaia_source_id` in the manifest | 370,994 | 370,994 |
| in both | 327,701 | 327,701 |
| source_id union | 973,222 | 973,222 |
| manifest rows carrying no `gaia_source_id` | + 5,938 | + 5,938 |
| companions promoted to their own record | + 16,226 | **+ 14,657** |
| rows parked, so never a record | − 10,429 | **− 10,748** |
| **records** | ~984,957 | **983,069** |

The manifest side reproduced exactly: `build:membership` at the floor writes
979,160 rows and every primaries-side count holds. Both build-side terms
missed, in opposite directions, for 0.19% net. The catalogue is **2.53x**
today's 388,071 records.

**Promotion is not carried forward unchanged**, which is what the projection
assumed on the ground that WDS drives it and the deep population is not what
WDS describes. It falls to 14,657, because promotion is gated on the secondary
not already holding a record: `already-in-catalog` rises 1,668 → 3,317 as the
deep population turns out to *contain* stars the build used to promote under a
synthetic id. A deeper floor converts promoted companions into ordinary records
rather than adding to them. Two of those synthetic classes then match only
retired sids and need `../../../../data/sid/reinstatements.tsv` rows.

**Parking scaled close to the projection**, against today's 5,087:

| reason | today | at `V <= 11` |
|---|---|---|
| `no_parallax_published` | 3,423 | 9,032 |
| `refused_no_defensible_parallax` | 975 | 1,027 |
| `no_v_magnitude` | 688 | 688 |
| `no_position` | 1 | 1 |

The newcomers publish no parallax at 0.931%, not the projected 0.887%, and the
defensible-parallax gate refuses 52 on top — inside the "a few hundred at most"
the projection allowed. The other two reasons add exactly nothing, as
predicted: every newcomer has a V by construction of the floor, and none is
missing a position.

**The floor measures complete.** Today's apparent-V histogram over the built
records turns over at V 9–10 — 93,143 · 127,771 · 79,930 across the 8–9, 9–10
and 10–11 bins — and that turnover is the incompleteness signature, not
structure. At the floor the same bins read 113,478 · 298,221 · 482,489, rising
to the floor with no turnover. The additions land where the 2026-09-14 working
predicted, 250 pc – 2.5 kpc concentrated toward the plane.

**43,293 of the manifest's bindings sit outside the kept set** — stars fainter
than the floor that the classic-ID term keeps deliberately (Proxima, `V ≈
11.1`), plus the 855 pull rows no transform served that a designation reaches
anyway. The floor bounds the magnitude term, never the catalogue.

Reproduce the projection by streaming the pull through `rielloVMagnitude` and
intersecting the kept `source_id`s against the manifest's `gaia_source_id`
column; reproduce the measurement by setting `MAGNITUDE_FLOOR_V` to 11 and
running `build:membership` then `build:catalog`. **Key on strings**: a Gaia
`source_id` runs to 19 digits and loses precision silently as a float64.

### What that costs on the wire

`RECORD_SIZE` is 100 bytes (`../../record/README.md`), so the
record array is linear in the count. Measured on both builds rather than scaled
from a ratio:

| | today | at `V <= 11` |
|---|---|---|
| records | 388,071 | 983,069 |
| `catalog.bin` raw | 37.0 MiB | 93.8 MiB |
| `gzip -9` | 24.3 MiB | **59.5 MiB** |
| brotli-5 | 23.1 MiB | **56.7 MiB** |
| transport chunks | 3 | 6 |

The deep population compresses better than today's, as the projection warned it
would: `gzip -9` lands at 0.6347 against today's 0.6556, so the ratio-scaled
61.5 MiB was 2 MiB high. 59.5 MiB is 62.4 MB decimal, 63.5 gzipped bytes per
record.

**One sidecar is on the wire, and it does not scale.** `search-index.json` is
fetched beside the binary inside boot's one `Promise.all`
(`../../../../src/client/star-pipeline/star-module.ts`), and grows 4.35 → 4.46 MB
gz — 2.5%, because the deep population carries no designation and contributes
2,221 searchable entries against 594,998 new records.
`catalog-row-index-map.json` does scale, 5.3 → 12.6 MB gz, but **no client code
reads it**: it is a build- and test-side sidecar addressed only from `scripts/`
and `tests/`, so it is not a first-load cost and cannot drive a wire-chunking
decision.

First load therefore moves 29.8 → 66.9 MB gz, **2.24x**. `cns.6` owns the
barrier that makes that matter: the loader fetches every chunk under one
`Promise.all` and reassembles before decoding, so nothing renders until the
last byte of the last chunk lands.

### What that costs in video memory

Per-star GPU residency is derived, never pinned — the two folders that own
these buffers both say to re-derive rather than trust a byte count
(`../../../../src/client/webgpu/star/compaction/README.md` and
`../../../../src/client/webgpu/extinction/README.md`, each § What it costs, and
what it holds):

| resident | B/star | today | at `V <= 11` |
|---|---|---|---|
| static record table (`STAR_STATIC_STRIDE`, 12 floats) | 48 | 17.8 MiB | 45.0 MiB |
| forwarded tables (`iPosition` ×3 + three scalars) | 24 | 8.9 MiB | 22.5 MiB |
| compaction survivor lists (2 × `u32`) | 8 | 3.0 MiB | 7.5 MiB |
| extinction prepass (six buffers) | 36 | 13.3 MiB | 33.8 MiB |
| | **116** | **42.9 MiB** | **108.8 MiB** |

**+65.8 MiB of video memory** — and ordinary memory grows alongside it, which
is the tighter bound on an integrated or mobile device. Three of those buffers
keep a copy the renderer never releases: the static table's `Float32Array`
(48 B/star), extinction's packed position copy (16 B/star) and the order table
behind it (4 B/star) — 25.2 MiB today against **63.8 MiB** at the floor. The
forwarded tables add none, their arrays being the shell's, and the decoded
record columns sit on top of all of it.

A twelfth static field still costs no bytes at this stride; a thirteenth takes
the stride to 16 and so costs a whole vec4 rather than a slot — 15.0 MiB at the
floor, 5.9 MiB today.

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
