# Promotion lineage

Companion promotion (`../README.md`) as a lineage stage: one row per
`multiples.tsv` row and per record it sizes or re-curates, the identity rows
of what it mints, retires, parks or merges, and the invariants over them.

## Files in this area

```
scripts/catalog/companions/promotion-lineage/
  promotion-lineage-pure.ts       Promotion's reason codes and count block,
    (+ test)                      the serialiser over RowOutcome,
                                  rewriteRows (each sized record's size row
                                  and a held record's brightness rows),
                                  promotionSummary, the identity rows, and
                                  PROMOTION_INVARIANTS.
```

## The stage

`build:catalog`'s companion promotion is the lineage stage after coherence
(`promotion-lineage-pure.ts`). `promoteCompanions` returns one
`PromotedRow` per `multiples.tsv` row, keyed on that row
(`multiples:<system_id>/<comp>`), and `promotionDecision` serialises its
`RowOutcome` ([Companion promotion](../README.md#companion-promotion-from-databinariesmultiplestsv)) through an exhaustive `switch`: the
outcome row (a mint is `promotion.minted.keyed` or `.synthetic`, a refused
parked record `.gaia-5p` or `.other-route` by route), then a facet row, effect
`none` and no evidence, per flag the outcome carries
(`promotion.brightness.*`, `spectral.*`, `colour.*`, `dust.*`,
`constellation.*`, `desig-con.*`, `fit.owned`), so every per-row count is a
code's line count.

A mint's facets are its brightness lineage, since the record walk's
[brightness-colour stage](../../photometry/README.md#brightness-colour-lineage)
never sees it: the absmag source (`brightness.*`), a row for the post-pass,
if any, that changed that absmag after the mint — at most one, since blend
split takes only own-photometry mints and the re-split only Δmag ones
(`brightness.blend-split`, `params.n` the records sharing the source;
`brightness.anchor-re-split`, `params.record` the dimmed anchor — a record
already in the catalogue those passes change writes the rows below instead), the B−V's (`colour.own`,
the row's observed colour; `.spectral-derived`; `.none`, the solar fallback —
`companionCi`), and one dust row naming which of the two the A_V at the
minted position corrected (`dust.edenhofer2024.absmag-and-ci`,
`.absmag-only`, `.ci-only`, `.not-applied`: a class→M_V absmag and a derived
B−V are intrinsic), its `params.av` in brightness-colour's format
(`dustParams`). Their evidence is the outcome
row's: the photometry is the row's own, and the anchor a Δmag reads is cited
there.

Every record promotion sizes or re-sizes also gets rows keyed on its own
origin key — a mint's is its row, a re-curated or dimmed record's its
manifest key — from the `RecordRewrite` `promoteCompanions` returns per
record (`rewriteRows`), uncited; `recuratedRecords` reads the same map for
the records re-curated onto their anchor (system membership's lent-distance
set). One `promotion.size.*` row names the LAST
pass that set its radius (`mint`, `recurated`, `blend-split`,
`anchor-dimmed`, `anchor-re-split`), its params the radius's route and inputs
in the size stage's form (`radiusRouteParams`,
[Size lineage](../../spectral/README.md#size-lineage)), so its `absmag` is the
one the record ships. A key's rows are a set, so the size row is what says
which pass came last. A record the catalogue already held also gets one row
per change to its brightness: `existing.recurated.<source>` (the
re-curation's absmag, `av` and `ci_via`; `.held` carries `from_pc`, `to_pc`,
`av_from`, `av_to` instead), `existing.anchor-dimmed` (citing by origin key the
members whose light it lost, so trace reaches it from each) and `existing.anchor-re-split` (`params.record`,
the dimmed anchor). A key's rows are a set, ordered as every stage file is
([SourceRowRef](../../lineage/README.md#sourcerowref)). A
pair's primary that anchors its pair on a record carrying the row's own Gaia
source, HIP or synthetic key (`isRowStar`) is `promotion.pair-anchor.own-star`, a merge
into that record: it is the row's star, so a SID keyed on the row's synthetic
key — the component it named when it was minted on its own — merges into the
record's. One anchoring on any other record (a shared slot's parent, a
proper-name match) is `promotion.pair-anchor.other-record`, effect `none`:
nothing says the record is the row's star, so a SID keyed on the row fails
closed. A keyed mint
carries its row's synthetic key too, the synth↔component same-as edge
([§ 4.1](/docs/sid.md#41-same-as-equivalence-graph)):
`mintSynthDesignations` names it per minted record, by origin key, and SID
allocation adds it to that record's designations, so a SID the key held
before the component bound an identifier of its own continues on the
record, with no event.
A row in no pair is `promotion.parked.unpaired`, and a primary that resolves
to no record, leaving its pair anchor-less, `promotion.parked.primary-unresolved`:
both park, since promotion ships no record for the star the row names, so a
SID keyed on its identifiers stays in the ledger with that cause. Each row cites as evidence the record its pair
resolved to and its WDS root's anchor; every merge-effect row names the
record it merges into in `params.record`. Both are origin keys: every record
carries its own from the manifest's `origin_key` column
(`../../membership/README.md#columns`), so these are joins on the origin key.

A minted companion is founded on its row, so promotion writes its identity
row (`promotion.identity.tsv.gz`, named by `StageLineageSpec.identity`),
carrying its row's synthetic key even when it is keyed on its own id. So
does every row whose code retires, parks or merges, keyed on the `hip` and
`gaia_source_id` cells it arrived with and the synthetic key a mint from it
would carry (`PromotedRow.synthKey`), less any designation a membership
manifest record or one of promotion's own mints already carries, so an
orphaned SID keyed on one of them joins to that row's cause and never to a
row that merely cites another stage's star. A cloud's or Local Group
object's is its sibling allocation stage's; every other record's is
membership's.

Measured 2026-11-18: 134,776 rows over the <!-- count:build-binaries/multiples_rows_emitted -->50,584<!-- /count --> `multiples.tsv` rows —
among them 31,564 facet rows (two, colour and dust, per minted record), 17,820
size rows (one per record promotion sized, by its last pass:
<!-- count:build-catalog/promotion.size.mint -->13,608<!-- /count --> mint,
<!-- count:build-catalog/promotion.size.anchor-re-split -->2,053<!-- /count --> anchor re-split,
<!-- count:build-catalog/promotion.size.anchor-dimmed -->1,987<!-- /count --> anchor-dimmed,
<!-- count:build-catalog/promotion.size.blend-split -->120<!-- /count --> blend-split,
<!-- count:build-catalog/promotion.size.recurated -->52<!-- /count --> recurated) and 2,172 held-record brightness rows — and 49,298
identity rows (the 15,782 minted companions and the 33,516 rows promotion
retires, parks or merges), 1.89 MB gzipped in 0.19 s (header, diff, write and
invariants; 45 ms of it the baseline); `PROMOTION_LINEAGE_BUDGET` pins
2.04 MB and 10 s. A CI run with a diff took
6.9 s (2026-11-07), almost all of it the baseline phase.

## Promotion's invariants

`PROMOTION_INVARIANTS` ([Invariants](../../lineage/README.md#invariants)) name
the rows of each code a known defect produces, so a new one fails the build by
name:

- `dropped.anchor-is-component` and `adopted.sameas-bridge`: none but the
  `multiples.tsv` rows named, by row key — the three mis-keyed rows and the
  six bridged ones. Another row onto the same record still fails. A fix
  upstream that clears one fails the check until the row is struck off its
  list.
- `brightness.anchor-collocated`: none.

`brightness.inherited-twin` (<!-- count:build-catalog/promotion.brightness.inherited-twin -->529<!-- /count -->)
is a genuine count, pinned exactly in the snapshot and never listed row by
row: each is a pair with a renderable orbit whose companion has no published
per-component type yet. Curating types into
`data/binaries/component_sptype_overrides.tsv` shrinks it; at zero it becomes
a must-not-appear invariant.
