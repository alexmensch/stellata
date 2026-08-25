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

`ra_mdeg`/`de_mdeg` is the **observed mean position** at `ep_ra`/`ep_de`,
and it is what a propagation to the scene epoch must start from.
`ra_icrs`/`de_icrs` is Tycho-2's own propagation of that same solution to
J2000; propagating it again compounds its error rather than correcting it.

The two mean epochs differ per star and per coordinate (a row can read
`ep_ra` 1991.07 against `ep_de` 1991.00), so RA and Dec advance over
different intervals. `pm_ra` is μ_α* — the cos δ factor is already
applied — so it is added along the local east tangent directly, never
divided by cos δ again.

`ra_icrs` earns its place on the **1,537 `pflag='X'` rows**, which have no
mean solution at all: `ra_mdeg`, `ep_ra`, `pm_ra` and their Dec siblings
are all empty there and the J2000 cell is the only position the row has.
`pflag='P'` (3,953 rows) means the mean solution is the photocentre of an
unresolved double, not one star's place.

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

## Provenance

- **Citation**: Høg E. et al. 2000, *A&A* 355, L27 (Tycho-2).
- **VizieR**: `I/259` (`tyc2`, `suppl_1` tables), CDS TAP
  `https://tapvizier.cds.unistra.fr/TAPVizieR/tap`.
- **Retrieved**: 2026-08-25.
- **Licence**: CDS/VizieR standard academic use; cite Høg et al. 2000.

Tycho-2 is a completed 1997-epoch publication, so upstream will not
republish; a re-pull is warranted only when the request set moves.

## Consumed by

- Nothing yet — this is the ingest half. The no-Gaia astrometry cohort
  (`docs/catalog-driver.md` § 5: `directionAthygPrinted`,
  `velocityAthygPm`, `vCatalogued`) is the first consumer.

## Refresh

`pnpm run refresh:tycho2` (venv per `scripts/refresh/README.md`
§ One-time setup). `--force` overrides the mtime skip.
