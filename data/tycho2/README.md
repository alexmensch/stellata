# Tycho-2 — astrometry and BT/VT photometry

Two TSVs from VizieR `I/259`, filtered to the TYCs our designation
sources mention and the rows naming a manifest HIP. Tycho-2 is the first-order source for exactly the rows
Gaia misses: [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) routes the direction, proper
motion and V-magnitude cascades here for TYC-bearing records with no
Gaia solution.

```
tycho2_main.tsv     372,630 rows from I/259/tyc2. Mean position
                    (ra_mdeg/de_mdeg), the observation epochs behind it
                    (ep_ra/ep_de), proper motion + errors, BT/VT + errors,
                    prox, HIP, pflag, and the observed ra_icrs/de_icrs.
                    Which cell a propagation starts from and at which
                    epoch: README.md#which-position-to-propagate-from.
tycho2_suppl1.tsv   5,910 rows from I/259/suppl_1 — Tycho-1 and
                    Hipparcos stars. Observed position only (no mean
                    solution), PM where flag='H', BT/VT + errors, prox,
                    HIP, flag.
```

## Which position to propagate from

Tycho-2 states two positions per star, at two different epochs.

| Cell | What it is | Epoch |
|---|---|---|
| `ra_mdeg` / `de_mdeg` | the mean solution's position — what a propagation starts from | **J2000** |
| `ra_icrs` / `de_icrs` | the observed Tycho-2 position | main: **`1990 + ep_ra_icrs_since_1990`** / **`1990 + ep_de_icrs_since_1990`**, per row and per coordinate; supplement: **J1991.25** |
| `ep_ra` / `ep_de` | mean epoch of the OBSERVATIONS behind the mean solution | — |

**`ep_ra` / `ep_de` are not the mean position's epoch**, and reading them as one
is the trap this table exists to close: they date the observations, the position
they produced is referred to J2000, and advancing from them adds `2000 - ep_ra`
of extra motion to every row. Those epochs run 1967.77–1991.74 in the direction
tier's own cohort and **1918.34–1992.47** across the whole table, so the error
reaches 32 yr on a tier row and 81.7 yr at the table's worst — decades, not
months. Nothing reads them.

```bash
awk -F'\t' 'NR>1 && $7!="" {if (m==""||$7<m) m=$7} END {print m, 2000-m}' \
  data/tycho2/tycho2_main.tsv
```

Both epochs are **measured, not assumed** — the same discipline
[Direction resolution](../../scripts/catalog/distance/README.md#direction-resolution) applies to the
SIMBAD tier:

- Over the 1,145 rows carrying a mean solution, a Gaia-grade SIMBAD position and
  a proper motion above 100 mas/yr, propagating from J2000 lands a median
  **0.061″** from SIMBAD's own J2016 place (p90 0.284″) against **1.817″**
  (p90 5.427″) propagating from `ep_ra`/`ep_de`. Expressed as years of each
  star's own motion, the second reads a median 8.97 yr adrift, and dividing that
  by `2000 - ep_ra` gives **1.009** — the signature of a position that sits at
  J2000.
- The main table prints each observed coordinate's own epoch (`EpRA-1990`,
  `EpDE-1990`): RA 1991.02–1992.11, Dec 1990.72–1992.28, RA mean **1991.70**
  over all rows and over the 1,802 `pflag='X'` rows alike — the 1991.67 the
  X rows solve to against another catalogue's rate. The supplement prints none
  and solves to **1991.25** over its 81 measurable rows, its stated epoch.
- Against HIP2, the per-row epoch is what closes the gap: over the 1,046
  spine pairs whose HIP Gaia cross-matches to no source, carrying HIP2 to it takes the right entry's 99th
  percentile from 0.39″ to 0.18″
  ([The tolerances](/scripts/catalog/membership/positional-witness/README.md#the-tolerances)).

**The parse keeps both coordinates' epochs on `Tycho2Row.observed`.** The
direction tier still propagates a `pflag='X'` row from J1991.25
(`stellata-hooj.47.2`).

`pm_ra` is μ_α* — the cos δ factor is already applied — so it is added along the
local east tangent directly, never divided by cos δ again.

`ra_icrs` earns its place on the **1,802 `pflag='X'` rows**, which have no mean
solution at all: `ra_mdeg`, `ep_ra`, `pm_ra` and their Dec siblings are all empty
there and the observed cell is the only position the row has. `pflag='P'` (5,555 rows) means the mean solution is
the photocentre of an unresolved double, not one star's place — both entries of
such a pair carry the same mean position, so only their observed cells tell them
apart. Every row has one, and the parse keeps it beside the chosen position
for the [positional witness](/scripts/catalog/membership/positional-witness/README.md#the-two-witnesses).

## The two tables overlap on 254 TYCs

Supplement 1 is documented as Tycho-1 stars absent from the main
catalogue, but 254 of the mentioned TYCs appear in both. **The main table
wins**: it carries a mean epoch and a proper motion, and the supplement's
`flag='T'` rows (1,404 of 5,910) carry no PM at all. Consumers read the
supplement only where the main table has no row.

## The request set — manifest ∪ IV/25

The pull derives the mentioned-TYC set (`tycho2Request`, `scripts/refresh/tycho2/`) from the
membership manifest's `tyc` column (372,164) unioned with IV/25's own TYCs
(302 more than the manifest already names), for 372,466 requested. The pull
also keeps every row whose `hip` names one of the manifest's 118,218 HIPs, so
both entries Tycho-2 gives a HIP are in the table for the pair rule
([The request set](/scripts/refresh/tycho2/README.md#the-request-set)):
2,643 main and 3,197 supplement rows (every supplement one `flag='H'`) that
no TYC names.

`refresh:simbad-tyc-hd` asks the same TYCs and every Tycho-2 pair's entries:
both pulls build the TYC part through one `tycInputs`
(`scripts/refresh/tycho2/tyc-request.ts`), which parses each side into integer
triples, so they cover the same entries and a differently-spelled cell cannot
drift them apart.

Coverage, re-measured 2026-11-16 against the committed tables:

| Cohort | Requested | Reached |
|---|---|---|
| Manifest TYCs | 372,164 | 372,146 |
| IV/25-only TYCs | 302 | 300 |
| Union | 372,466 | 372,446 |

The refresh hard-fails on a manifest TYC that reaches neither table **and**
whose pair entry is unreached too. All 371,375 manifest TYCs with `TYC3=1`
reach Tycho-2, so a primary that misses is a membership event for [§ 6](/docs/catalog-driver.md#6-parity--the-gate-on-any-membership-change) to
adjudicate, or an upstream regression — not a refresh landing short. The whole
residual sits in the 789-row component cohort (`TYC3>1`), 771 of which reach,
and Tycho-2 carries the pair's `TYC3=1` entry for all 18 that do not: it lists
as one star a pair IV/25 resolves, so the component's own row never existed to
be pulled.

**That pair entry is evidence of the merge, not a solution the component
inherits.** `scripts/catalog/tycho2-parse.ts` indexes on the full
`TYC1-TYC2-TYC3` and the direction cascade looks the record's own TYC up in
it, so a `TYC3=2` component draws nothing from Tycho-2 whichever verdict this
gate reaches. What covers the 18 is the cascade either side of Tycho-2, never
Tycho-2 itself: all 18 carry SIMBAD astrometry in
`data/simbad/simbad_values.tsv`, the tier below — 16 have no Gaia binding at
all and depend on it, and 2 carry a `crosswalk_gated` `gaia_source_id` the 5p
tier above reaches first. **This gate measures the pull's reach, never a
record's placement** — an unreached TYC does not imply an unplaced record, and
reading it that way is what the pre-manifest wording got wrong.

One limit to know: `reached` is the filtered pull, so a pair entry is visible
to the gate only when the pull keeps it — the request set names it, or its
`hip` names a manifest HIP. 673 of the 969 requested `TYC3>1` components have
no pair primary in the TYC request set (counted over TYCs alone; a primary
carrying a manifest HIP is kept anyway), and an unreached one whose primary
is kept by neither would fail the gate even where Tycho-2 carries the pair. None
is unreached today; widening the request set to cover every component's pair
primary is the fix if one ever is.

The 20-row residual across the whole request set is entirely `TYC3=2` —
secondary components IV/25 names that Tycho-2 does not carry as separate
entries:
`103-2864-2`, `724-2738-2`, `1065-3144-2`, `1454-1134-2`, `1623-800-2`,
`1655-484-2`, `2013-959-2`, `2133-2964-2`, `2156-1015-2`, `2859-2231-2`,
`3224-2276-2`, `4005-261-2`, `4476-387-2`, `4480-1545-2`, `4522-1564-2`,
`5619-1257-2`, `5816-358-2`, `6284-876-2`, `7422-1737-2`, `8991-538-2`.

## Why the pull is range-batched rather than key-filtered

The filter runs locally, over 24 queries that each scan a contiguous TYC1
band, because VizieR can express no server-side filter on the full
identifier. Its ADQL parser rejects `CAST`, and without one its Postgres
backend overflows int32 composing `TYC1*1000000 + TYC2*10 + TYC3` into a
single key. Restricting by TYC1 alone saves nothing either — the manifest
mentions all 9,537 regions. The range scans are cheap (~2 min for the
whole 2,539,913-row main table), so the pull transfers the table and
keeps 15% of it.

**Every band reply is checkpointed**, as any TypeScript pull's is
([The checkpoint](/scripts/refresh/pull/README.md#the-checkpoint)): about
400 MB of CSV, the unfiltered rows, held until both tables land.

Nothing is written until every gate has passed — each table's fraction
band and pinned rows, then the cross-table manifest cover. A gate failure
leaves the committed TSVs and the pull's record untouched, so a
half-committed failing pull can never read as fresh.

## The pinned row

`TYC 3694-2544-1` (HD 14039) is the highest-proper-motion row of the 41
Tycho-2-placed stars, so pinning it holds both the printed tier this
ingest replaced and the J2000 mean cell that replaces it. Its printed
AT-HYG cell matches this table's unpropagated mean position to 8 decimal
places — the ~27″ staleness measured rather than asserted.

It is also the corpus pin for the whole tier, through the only `hd:` record ref
in the repo (`scripts/catalog/validate/sky-position-corpus.tsv`). Being the
tier's fastest mover is what makes it the row that pins [Which position to
propagate from](#which-position-to-propagate-from) above: it lands 0.113″ from Gaia's own place on the J2000 epoch
and 3.7″ away on the observation epochs.

## Provenance

- **Citation**: [Høg 2000](/data/papers/index.md#hog2000) (Tycho-2).
- **VizieR**: `I/259` (`tyc2`, `suppl_1` tables), over
  `scripts/refresh/pull/tap-pure.ts`'s `VIZIER`: CDS, or the CfA mirror when
  CDS is unreachable. The stamp (`data/stamps/refresh-tycho2.json`,
  `answeredBy`) names which answered.
- **Retrieved**: 2026-08-25; re-pulled from CfA 2026-11-16 with the rows naming a manifest HIP.
- **Licence**: CDS/VizieR standard academic use; cite
  [Høg 2000](/data/papers/index.md#hog2000).

Tycho-2 is a completed 1997-epoch publication, so upstream will not
republish; a re-pull is warranted only when the request set moves.

## Consumed by

- `scripts/catalog/tycho2-parse.ts` → the direction, PM and V cascades'
  `tycho2` tier, on **3,688** direction rows (1,172 placed from the observed
  J1991.25 cell, 28 on a photocentre) and **3,794** V rows. It is the bulk of
  the no-Gaia astrometry cohort, not all of it: **4** rows route CNS5 on a GJ
  number and **222** route SIMBAD, the latter including the `TYC3>1`
  components Tycho-2 merged into their pair, which carry a TYC that reaches no
  row of its own ([The request set](#the-request-set--manifest--iv25), [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers)).
- The same parse feeds the **PM rescue cascade**
  (`scripts/catalog/distance/pm-rescue/README.md`) on a further **<!-- count:build-catalog/placement.pm-rescue.tycho2 -->95<!-- /count -->** rows.
  These carry a Gaia position but a 2p solution Gaia fitted no proper motion
  to, and Tycho-2 is the tier admitted without a bibcode check, because a
  1997 publication cannot be Gaia's own reduction returning. A `pflag='P'` row
  is admitted here deliberately: the light centre's motion is the quantity
  wanted, and the flag's warning is about the position.
- The **positional witness**
  (`scripts/catalog/membership/positional-witness/README.md`) reads
  `observed` with its two epochs, on every row it is handed.

Every count above is pinned in `scripts/catalog/build-catalog-expected.json`
(`placement.direction.tycho2.*`, `vTycho2`, `placement.pm-rescue.tycho2`) and moves with membership —
read it rather than this list when they disagree.

The parser resolves [Which position to propagate from](#which-position-to-propagate-from) at parse time, so
no consumer re-decides it: a row with a mean solution exposes
`ra_mdeg`/`de_mdeg` at J2000, a row with none exposes `ra_icrs` at J1991.25
and `fromIcrs: true`, every row carries `observed` with its own two epochs,
and the main table's row wins on the 254 identifiers both tables carry.

## Refresh

`pnpm run refresh:tycho2` (`scripts/refresh/tycho2/`).
`--force` re-pulls when its record is fresh
([Freshness](/scripts/pipeline/README.md#freshness--one-mechanism)).
