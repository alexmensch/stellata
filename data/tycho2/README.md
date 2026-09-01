# Tycho-2 — astrometry and BT/VT photometry

Two TSVs from VizieR `I/259`, filtered to the TYCs our designation
sources mention. Tycho-2 is the first-order source for exactly the rows
Gaia misses: `docs/catalog-driver.md` § 5 routes the direction, proper
motion and V-magnitude cascades here for TYC-bearing records with no
Gaia solution.

```
tycho2_main.tsv     370,140 rows from I/259/tyc2. Mean position
                    (ra_mdeg/de_mdeg) at per-star mean epochs
                    (ep_ra/ep_de), proper motion + errors, BT/VT + errors,
                    prox, HIP, pflag, and the J2000 ra_icrs/de_icrs.
tycho2_suppl1.tsv   2,713 rows from I/259/suppl_1 — Tycho-1 and
                    Hipparcos stars. J2000 position only (no mean epoch),
                    PM where flag='H', BT/VT + errors, prox, HIP, flag.
```

## Which position to propagate from

Tycho-2 states two positions per star, at two different epochs, and neither
epoch is written in the column beside it.

| Cell | What it is | Epoch |
|---|---|---|
| `ra_mdeg` / `de_mdeg` | the mean solution's position — what a propagation starts from | **J2000** |
| `ra_icrs` / `de_icrs` | the observed Tycho-2 position | **J1991.25** |
| `ep_ra` / `ep_de` | mean epoch of the OBSERVATIONS behind the mean solution | — |

**`ep_ra` / `ep_de` are not the mean position's epoch**, and reading them as one
is the trap this table exists to close: they date the observations, the position
they produced is referred to J2000, and advancing from them adds `2000 - ep_ra`
of extra motion to every row. Those epochs run 1967.77–1991.74 in the direction
tier's own cohort, so the error reaches decades, not months. Nothing reads them.

Both epochs are **measured, not assumed** — the same discipline
`../../scripts/catalog/distance/README.md` § Direction resolution applies to the
SIMBAD tier:

- Over the 1,145 rows carrying a mean solution, a Gaia-grade SIMBAD position and
  a proper motion above 100 mas/yr, propagating from J2000 lands a median
  **0.061″** from SIMBAD's own J2016 place (p90 0.284″) against **1.817″**
  (p90 5.427″) propagating from `ep_ra`/`ep_de`. Expressed as years of each
  star's own motion, the second reads a median 8.97 yr adrift, and dividing that
  by `2000 - ep_ra` gives **1.009** — the signature of a position that sits at
  J2000.
- The observed cell solves to **1991.67** over the 133 measurable `pflag='X'`
  rows and **1991.25** over the 81 measurable supplement rows, against the
  catalogue's stated J1991.25. It is 8.75 yr behind `ra_mdeg`, which is the same
  fact from the other side: across 8,609 rows above 150 mas/yr the two cells sit
  `ep_ra - 8.75` apart when solved against each other.

`pm_ra` is μ_α* — the cos δ factor is already applied — so it is added along the
local east tangent directly, never divided by cos δ again.

`ra_icrs` earns its place on the **1,537 `pflag='X'` rows**, which have no mean
solution at all: `ra_mdeg`, `ep_ra`, `pm_ra` and their Dec siblings are all empty
there and the observed cell is the only position the row has. (That 1,537 and
the 1,537 Gaia 2p rows in the spine are unrelated counts that happen to match —
see the PM rescue's README.) `pflag='P'` (3,953 rows) means the mean solution is
the photocentre of an unresolved double, not one star's place.

## The two tables overlap on 254 TYCs

Supplement 1 is documented as Tycho-1 stars absent from the main
catalogue, but 254 of the mentioned TYCs appear in both. **The main table
wins**: it carries a mean epoch and a proper motion, and the supplement's
`flag='T'` rows (1,404 of 2,713) carry no PM at all. Consumers read the
supplement only where the main table has no row.

## The request set — spine ∪ IV/25

`refresh-tycho2.py` derives the mentioned-TYC set from the spine's `tyc`
column (312,275) unioned with IV/25's own TYCs (60,344 more), for
372,619 requested. The IV/25 half is there so the membership rework —
which redefines the record set from the primaries rather than from
AT-HYG's subset — consumes this same pull instead of forcing a second
one.

Coverage measured 2026-08-25:

| Cohort | Requested | Reached |
|---|---|---|
| Spine TYCs | 312,275 | **312,275 (100%)** |
| IV/25-only TYCs | 60,344 | 60,324 |
| Union | 372,619 | 372,599 |

Every TYC-bearing spine row reaches a Tycho-2 solution, and the refresh
hard-fails if that ever stops being true — the cascade has no tier below
this one for a TYC-keyed row, so an unreached spine TYC is a record with
no owned direction, which § 6 adjudicates as a membership event rather
than landing quietly.

The 20-row residual is **IV/25-only and entirely `TYC3=2`** — secondary
components IV/25 names that Tycho-2 does not carry as separate entries:
`103-2864-2`, `724-2738-2`, `1065-3144-2`, `1454-1134-2`, `1623-800-2`,
`1655-484-2`, `2013-959-2`, `2133-2964-2`, `2156-1015-2`, `2859-2231-2`,
`3224-2276-2`, `4005-261-2`, `4476-387-2`, `4480-1545-2`, `4522-1564-2`,
`5619-1257-2`, `5816-358-2`, `6284-876-2`, `7422-1737-2`, `8991-538-2`.

## Why the pull is range-batched rather than key-filtered

The filter runs locally, over 24 queries that each scan a contiguous TYC1
band, because VizieR can express no server-side filter on the full
identifier. Its ADQL parser rejects `CAST`, and without one its Postgres
backend overflows int32 composing `TYC1*1000000 + TYC2*10 + TYC3` into a
single key. Restricting by TYC1 alone saves nothing either — the spine
mentions all 9,537 regions. The range scans are cheap (~2 min for the
whole 2,539,913-row main table), so the pull transfers the table and
keeps 15% of it.

**No resume checkpoint, deliberately.** `run_in_batches` can cache each
batch to `<output>.tsv.ckpt/` (`scripts/refresh/README.md` § Resuming a
long pull), but here a batch is ~106k *unfiltered* upstream rows and the
cache holds them as XML, so checkpointing this pull would spend gigabytes
of disk to save two minutes. The filter is what makes the output small;
the thing worth caching is the part we throw away.

Nothing is written until every gate has passed — each table's fraction
band and pinned rows, then the cross-table spine cover. A gate failure
must leave the committed TSVs untouched, because the skip check is a
file-modification-time comparison: a half-committed failing pull would
look up to date to the next run and skip itself silently.

## The pinned row

`TYC 3694-2544-1` (HD 14039) is the highest-proper-motion row of the 43
`directionTycho2` stars, so pinning it holds both the printed tier this
ingest replaced and the mean epochs that replace it. Its printed
AT-HYG cell matches this table's unpropagated mean position to 8 decimal
places — the ~27″ staleness measured rather than asserted.

It is also the corpus pin for the whole tier, through the only `hd:` record ref
in the repo (`scripts/catalog/validate/sky-position-corpus.tsv`). Being the
tier's fastest mover is what makes it the row that pins § Which position to
propagate from above: it lands 0.113″ from Gaia's own place on the J2000 epoch
and 3.7″ away on the observation epochs.

## Provenance

- **Citation**: Høg E. et al. 2000, *A&A* 355, L27 (Tycho-2).
- **VizieR**: `I/259` (`tyc2`, `suppl_1` tables), over the CDS TAP endpoint
  `refresh_lib.CDS_TAP_URL` names.
- **Retrieved**: 2026-08-25.
- **Licence**: CDS/VizieR standard academic use; cite Høg et al. 2000.

Tycho-2 is a completed 1997-epoch publication, so upstream will not
republish; a re-pull is warranted only when the request set moves.

## Consumed by

- `scripts/catalog/tycho2-parse.ts` → the direction, PM and V cascades'
  `tycho2` tier, on **43** direction rows (40 of them with a PM) and
  **123** V rows. That is the whole no-Gaia astrometry cohort minus the
  Gliese-numbered remainder, which has no TYC and routes CNS5 / SIMBAD /
  Gliese instead (`docs/catalog-driver.md` § 5).
- The same parse feeds the **PM rescue cascade**
  (`scripts/catalog/distance/pm-rescue/README.md`) on a further **242** rows —
  its widest reach in this build. These carry a Gaia position but a 2p
  solution Gaia fitted no proper motion to, and Tycho-2 is the tier admitted
  without a bibcode check, because a 1997 publication cannot be Gaia's own
  reduction returning. **2** are `pflag='P'` (ξ UMa A and B), where the light
  centre's motion is the quantity wanted and the flag's warning is about the
  position.

The parser resolves § Which position to propagate from at parse time, so
no consumer re-decides it: a row with a mean solution exposes
`ra_mdeg`/`de_mdeg` and its two epochs, a `pflag='X'` row exposes
`ra_icrs` at J2000 and `fromIcrs: true`, and the main table's row wins on
the 254 identifiers both tables carry.

## Refresh

`pnpm run refresh:tycho2` (venv per `scripts/refresh/README.md`
§ One-time setup). `--force` overrides the mtime skip.
