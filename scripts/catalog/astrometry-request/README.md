# The astrometry request

The source_id list the one Gaia 5p pull is made against. `pnpm run
build:astrometry-request` emits `data/gaia/gaia_astrometry_source_id_request.tsv`
— **388,982** ids, the union of four contributions the table's
consumers need ([The request is a union](#the-request-is-a-union-and-why-that-is-not-a-compromise)). Not a network pull and not on the
`build:catalog` path: this is **input preparation** for `scripts/refresh/`,
which is why it sits beside the record build rather than inside it
(`../README.md` owns the output contract).

## Files in this area

```
scripts/catalog/astrometry-request/
  export-astrometry-request.ts    The generator. Unions both gates'
                                  candidates, the binaries' Stage 2
                                  candidates (Stages 1–2 run in-process) and
                                  the review dispositions' kept ids, sorts,
                                  and emits the request through
                                  emitArtifacts. Reads no build:membership or
                                  build:binaries output. Carries the CI heap
                                  check (../../util/heap-budget/): 2,161 MiB
                                  peak live heap of a 3,482 MiB budget,
                                  measured 2026-11-14.
  astrometry-request-outputs.ts   ASTROMETRY_REQUEST_OUTPUTS — the request
                                  file as the generator's emitArtifacts
                                  declaration (../../util/README.md).
                                  Side-effect free.
  export-astrometry-request-pure.ts
    (+ test)                      The source_id request file's format:
                                  serialiseSourceIdRequest (header, then ids
                                  in sortSourceIdsNumeric's order, over
                                  ../../util/tsv/'s compareSourceIds) and
                                  readSourceIdRequest, the one parse of
                                  every such file (this one and the DR2 risk
                                  set). Also used by
                                  scripts/sid/export-dr-risk-set.ts and the
                                  membership gate test, whose coverage
                                  filter, unrequestedBindings, lives here.
  source-id-request-source.ts     sourceIdRequestSource — a request file
                                  declared through defineSource on that
                                  parse; scripts/sid/ and the request-scoped
                                  Gaia pulls (../../refresh/gaia-request/)
                                  declare theirs through it.
```

Each contribution lives with the consumer that defines it, not here — this
folder decides what to *request*, not what a route may propose:
`magnitudeWeighableSourceIds` in `../classic-ids/classic-id-overlay-pure.ts`,
`derivationCandidateSourceIds` in `../membership/binding/binding-derivation-pure.ts`,
`astrometryRequestIds` in `../../binaries/resolve/resolve-pairs.ts`, and
`data/membership/binding-review-dispositions.tsv` itself for the kept ids.

**source_ids exceed 2^53.** A lexicographic sort misorders unequal-length
ids and a `Number` sort collides them, so `BigInt` is the only correct
comparator. Every codec that orders by source_id shares the one comparator,
`compareSourceIds` (`../../util/tsv/table-pure.ts`).

## The record build's sources are covered by measurement

The request reads no `build:membership` output, so nothing in its construction
makes it cover the manifest's bindings: reading the manifest would close a loop
through the astrometry pull back into `build:membership`
([Loops through committed files](../../pipeline/README.md#loops-through-committed-files)).
The derivation's candidates cover every binding it can reach, since a binding
is one of its candidates; what they leave out is a reviewed id no committed
source proposes
(<!-- count:membership-manifest/membership.disposition.asserted -->33<!-- /count --> today), which is why the dispositions file is the fourth
contribution. `membership-manifest-gate.test.ts` asserts the result: every
`term = primaries` manifest row's `gaia_source_id` is in the request.

The 1,778 primaries rows carrying none are the no-Gaia tier. The
`term = magnitude` rows are not requested: their astrometry is the magnitude
pull's own
([The astrometry comes with it](../membership/magnitude-term/README.md#the-astrometry-comes-with-it)),
and requesting them would re-pull 598,464 rows that file already holds.

## The request is a union, and why that is not a compromise

`data/gaia/gaia_dr3_astrometry.tsv` has **four** contributors wanting
different sets, so the request is the union of all four:

| Contribution | Ids | Consumer |
|---|---|---|
| `../classic-ids/`' binding-gate candidates | 354,987 | the gate's `phot_g_mean_mag` evidence |
| `../membership/`' binding-derivation candidates | 376,305, +21,556 beyond the gate's | the derivation's `phot_g_mean_mag` evidence — every source any primaries row could be bound to: the corrected spine's rows, and every addition item `additionItemCells` enumerates, admitted or not |
| `../../binaries/`' Stage 2 candidates | 24,512, +12,409 beyond the two above | the binaries' Stages 1–6 — every source a component resolves to and every candidate a Stage 2 gate weighs — and the parallax cascade's `pair_member_parallax` tier, whose pair members are a subset |
| `binding-review-dispositions.tsv`' `keep_source_id` column | 53, +30 beyond the three above | the record build: a reviewed binding's direction / rv / V / ci cascades |

`build:astrometry-request` prints every figure in this table — each
contribution's own size and its increment over the ones above it — so all four
rows and the union total re-derive together in one local run. Correct them
from that run and never one cell from another source: the increments are what
make the four sum to the total above.

**The derivation's contribution is the gate's shape again, on the record
side**: the manifest generator weighs candidates before it writes a binding,
so the candidates cannot be read off the manifest column — the column is the
outcome — nor off its identifier cells, since which addition items admission
turns into rows is an output of the build this request feeds.
`additionItemCells` reads them off the primaries and the corrected spine
instead, the same enumeration `buildMembership` derives. Requesting them all, whatever a row ends up bound to, is what lets
the generator fail on any candidate it weighs with no pulled row, as the
overlay's `classic-ids.unweighed-no-pulled-row` invariant does. A disposition can keep an id no
candidate walk reaches, so the kept ids are requested on their own.

**The binaries' one covers the pair members the parallax cascade reads.**
Every `multiples.tsv` `gaia_source_id` is a Stage 2 binding, so the
contribution holds every kept-physical pair member, a member that is not a
manifest row (a component Gaia resolved that no primary indexes) included;
the tier lends that member's parallax to the sibling Gaia fitted none for.
Its coverage still fails the build on its own: a sibling source this pull
holds no row for is named with its `multiples.tsv` row, and it is the only
reason the tier misses one that a re-pull can fix
([The tier's reach is bounded by measurement quality](../distance/parallax/README.md#the-tiers-reach-is-bounded-by-measurement-quality-not-by-our-request)).
Every other refusal there is a measurement, and
`pairMemberSiblingNotAnchorGrade` — the anchor gate on fit quality alone —
dominates them.

It asks for every candidate Stage 2 weighs rather than only the members of
kept pairs. Which pairs Stage 5 keeps is an *output* of the build this request
feeds, so keying the request on it would leave the two defining each other and
the set unstable under any cascade change.

## The binaries' share closes a loop through the pull

The generator runs the binaries' Stages 1–2 itself (`loadReferenceCatalogs`,
`resolveStage2`) rather than reading an id list `build:binaries` writes, so
one function, `astrometryRequestIds`, decides that share and no second file
carries it. Stage 1's magnitude gate reads this pull — a cross-walk or AT-HYG
binding whose `G` disagrees with its V is refused — so the request depends on
the pull it requests: a kept loop
([Loops through committed files](../../pipeline/README.md#loops-through-committed-files)).
The stale-pull stop is its convergence check. The share keeps a refused
candidate as well as the binding that replaces it, so a re-pull can only add
rows the gate then weighs: the request grows rather than oscillates, and a
second pass over the re-pulled table reproduces it byte for byte.

**The gate's one is not optional, and a membership-only request silently
breaks the gate.** The gate vets a *candidate* — whatever source a cross-walk
names for a designation — and the whole reason it exists is that a
candidate is frequently NOT the star, so candidates are routinely not
membership rows. With no `phot_g_mean_mag` for one, `weighBinding`'s
magnitude check has nothing to compare and **binds it unweighed**: rejections
become silent acceptances. Measured on a membership-only request at the time
the fault was found: `gateRejectedMag` 102 → **0** and
`rejected_bindings.tsv` 187 → 101 rows. The extra bindings key sources that
are not records, so nothing shipped moved — which is what made it a *latent*
fault, and why it is fixed rather than pinned: a source that becomes a record
is one whose binding was never vetted.

The contribution is the overlay join's own candidates —
`joinOverlayCandidates`, the step that needs no evidence — narrowed by
`magnitudeWeighableSourceIds` through the gate's own `printedV` walk
(`../classic-ids/classic-id-overlay-pure.ts`), so the request and the gate
agree by construction rather than by a test holding two copies in step. A
source is a candidate where any of the V cascade's three printed tiers answers
for it, which is nearly the
whole overlay — only the <!-- count:classic-id-overlay/gateSkippedNoPrintedV -->2,738<!-- /count --> rows no tier reaches are skipped, because
without a printed V a `G` decides nothing.

The gate's contribution therefore reads the same tables the derivation's does,
and this script loads them once: the 2.5 M-row TYC cross-walk narrowed to
IV/25's Tycho ids UNION the spine's (the gate walks IV/25's, the derivation
the spine's), plus Tycho-2 and Gliese for the two lower V tiers. The widening
cost 295 ids on the request and is what lets the gate see a mis-binding on a
row with no Hipparcos V at all.

**Requesting a candidate is not the same as pulling one.** A requested id the
archive returns no row for lands the gate right back in pass-by-default, which
is why both gates fail on a candidate that reaches them with no row in the
pull, so a request that quietly stops covering them fails the build instead of
silently accepting bindings: the overlay through classic-ID lineage's
`unweighed-no-pulled-row` invariant, which names each designation and source,
and the derivation through membership lineage's
`binding.unweighed-no-pulled-row` invariant, which names each record and
source ([Invariants](../lineage/README.md#invariants)). Neither fires today. The pull holds 388,980 rows against the request's
388,982: 2 requested ids have no row, and both are reviewed bindings rather
than candidates — the two DR2 ids of `data/athyg/stale_gaia_source_ids.tsv` SIMBAD
holds no DR3 successor for ([Six source_ids DR3 does not publish](../spine/README.md#six-source_ids-dr3-does-not-publish)).
HD 2094 B's source, which only the spine's uncorrected TYC reached
([Correcting a merge decision](../membership/spine-corrections/README.md#correcting-a-merge-decision)), is not requested and has no row here: it ships as a
magnitude-term row on the magnitude pull's own astrometry, which is why the
spine guard reads both pulls ([Six source_ids DR3 does not publish](../spine/README.md#six-source_ids-dr3-does-not-publish)).
What no request can fix is `gateSkippedNullGMag` (<!-- count:classic-id-overlay/gateSkippedNullGMag -->112<!-- /count -->) and
`derivedWeighedNullGMag` (<!-- count:membership-manifest/membership.binding.weighed-null-g -->77<!-- /count -->): sources Gaia has a row for and publishes no
`phot_g_mean_mag` for, which stay unvettable at any request size.

## What the pulled set feeds

The request drives `refresh:gaia-astrometry`
(`scripts/refresh/gaia-request/`) →
the astrometry pull, which is tier 1 of the direction cascade and the rv
cascade, the source of the BP/RP the V and ci cascades transform, both
gates' evidence above, and the binaries' per-component astrometry.
`refresh:gaia-gspc`, `refresh:gaia-apsis` and `refresh:bailer-jones` read the
same request. `pnpm run build:classic-ids` and `pnpm run
build:membership` — CI asserts both artifacts byte-identical — are what prove a
change to this request did not move either gate.
