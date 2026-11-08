# The membership manifest — the primaries-derived membership term

`data/membership/membership-manifest.tsv` is one row per record the frozen
primaries admit: the spine's <!-- count:inherited-spine/rows -->313,257<!-- /count --> rows re-keyed on the designations the
primaries publish for them, less the one a correction folds
([Correcting a merge decision](#correcting-a-merge-decision)), plus the <!-- count:membership-manifest/additionRows -->63,653<!-- /count --> records the primaries name
that AT-HYG's subset never carried — 376,909 rows, and the <!-- count:membership-manifest/magnitudeRows -->598,463<!-- /count --> the V <= 11
magnitude term adds on top (`magnitude-term/README.md`), <!-- count:membership-manifest/rows -->975,372<!-- /count --> in
all. **`readStars` walks it, and
membership is exactly these rows less the [§ 6.1](/docs/catalog-driver.md#61-record-parity) parks**
([Per-row pipeline](../parse/README.md#per-row-pipeline)). It is the artifact that retires
`data/athyg/inherited-spine.tsv` as the build's input; the contract is
[§ 3.1](/docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries), the measurement behind it
[The primaries audit](../spine/README.md#the-primaries-audit).

The manifest is a **pure function of committed inputs**, so unlike the spine it
takes the ordinary regenerate-and-diff gate: CI runs `pnpm run build:membership`
and fails on any diff under `data/membership/`.

## Files in this area

```
scripts/catalog/membership/
  membership-manifest-tsv.ts      MEMBERSHIP_MANIFEST, the manifest's codec:
                                  the columns, the binding and term sets, and
                                  ManifestRecord — typed ids, alias lists,
                                  binding and term checked against their
                                  sets, isSol. manifestRecord is the one
                                  constructor, shared by the file decoder and
                                  the generator, which assembles rows as
                                  spine-shaped cells and types them at the
                                  end. Leaf: readers import it, not the
                                  generator module.
  additions-ledger-tsv.ts         The three ledgers' codecs, one leaf each:
  binding-review-tsv.ts           header check, decode and sort order.
  label-drops-tsv.ts
  ledger-rows-pure.ts             Their columns, row types and closed sets,
                                  apart from the codecs so the row-assembly
                                  rules reach no ledger file. The review
                                  queue's carries the key a disposition joins
                                  on; the additions ledger's, the
                                  /docs/catalog-driver.md#61-record-parity reason codes. Also the
                                  own-candidate reasons, which the generator
                                  and its lineage both read.
  origin-keys.ts                  ORIGIN_KEYS: each record's origin key,
                                  built from the declarations it is founded
                                  on; the build and the unit suite share it.
  membership-lineage-pure.ts      This stage's lineage: reason codes, the
    (+ test)                      outcome union and its serialiser, the
                                  four ledgers as views of it
                                  (#membership-lineage), and the change
                                  report's multiples join, which reads the
                                  baseline's identity file only for a key
                                  the build lacks.
  membership-manifest-pure.ts     Row assembly (spine side, additions), the
    (+ test)                      review queue and the dispositions settling
                                  it, the admission rule, the label drops, and
                                  the spine ↔ manifest matcher the gate runs.
                                  Pure.
  binding-review-dispositions-    The dispositions' columns, closed bases and
    pure.ts                       reader, on the same terms.
  binding-review-dispositions-    BINDING_REVIEW_DISPOSITIONS, the curated
    source.ts                     dispositions' declaration
                                  (../../util/sources/).
  build-membership-manifest.ts    `pnpm run build:membership` — loads the
                                  spine and its corrections, the primaries, the
                                  overlay, the binding gates' evidence,
                                  multiples.tsv and the review dispositions,
                                  and emits data/membership/ plus the label
                                  merge's queue
                                  (data/classic-ids/label_flips.tsv) and its
                                  lineage, baseline rotation and change
                                  report (build/lineage-diff/membership.tsv)
                                  through emitArtifacts: all land, or none
                                  does, and only once
                                  membership-manifest-expected.json, the
                                  lineage budget, the lineage invariants
                                  (../lineage/README.md#invariants) and the
                                  CI heap budget
                                  (../../util/heap-budget/README.md) pass.
  membership-manifest-outputs.ts  MEMBERSHIP_OUTPUTS — every file the
                                  generator writes, as its emitArtifacts
                                  declaration (../../util/README.md), its
                                  lineage files included (MEMBERSHIP_LINEAGE,
                                  /src/catalog-format/pipeline-outputs/).
                                  Side-effect free.
  committed-artifacts.test.ts     Each of the four codecs above round-trips
                                  its committed file byte for byte.
  membership-manifest-gate.test.ts
                                  The replacement parity gate, (i)–(iii) below,
                                  over the COMMITTED artifacts. LFS-gated.
  membership-manifest-expected.json
                                  Pinned count snapshot. Refresh with
                                  --update-snapshots.
  additions/                      The primaries' rows the spine lacks: their
                                  items, grouping, admission and outcomes.
                                  Own README.
  binding/                        A row's gaia_source_id from committed
                                  evidence alone: the four sources, both
                                  gates, and the outcomes the derivation
                                  cannot settle by itself. Own README.
  magnitude-term/                 The union's second term — the V floor, its
                                  filter over the Gaia pull and the 5p
                                  astrometry that comes with it. Own README.
  spine-corrections/              The curated corrections to AT-HYG's merge
                                  decisions, and the spine they leave. Own
                                  README.
```

The primaries load through `../spine/primaries-tables.ts`, shared with the
audit, so the two instruments read one table set.

## Columns

```
tyc  hip  hd  hd_alt  hr  hr_alt  gl  flam  bayer  proper
gaia_source_id  binding  routes  term  origin_key
```

- The identifier cells carry the record's **final** labels: for a spine row
  the classic-ID label merge has already run
  (`../classic-ids/label-merge/README.md`), so `hd_alt` / `hr_alt` hold the
  alias lists and there is no second designation set to flip against. `bayer` and `proper` are the
  spine's printed cells on spine rows and empty on additions — the naming
  ladder resolves both from HD / HIP at build time and reads the cell only as
  a counter (`../naming/README.md`).
- `binding` says how `gaia_source_id` is justified: `crosswalk_gated` (a TYC,
  HIP or CNS5 candidate the [§ 4](/docs/catalog-driver.md#4-how-hd-reaches-gaia) gates passed), `simbad_corroborated` (the
  source SIMBAD's frozen cross-IDs hold under the record's own HIP, TYC or GJ,
  through the same gates), `reviewed` (the value a row of
  `data/membership/binding-review-dispositions.tsv` settles on stated
  evidence), or `none`. [Both gates weigh every candidate](binding/README.md#both-gates-weigh-every-candidate)
  is the rule.
- `term` is which side of [§ 1](/docs/catalog-driver.md#1-the-driver-model)'s union admitted the
  row — `primaries` or `magnitude`; `magnitude-term/README.md` owns the
  other side, its floor and its dedupe against the bindings derived below.
- `routes` names the primary attesting each classical cell
  (`hd:iv25|hip:i239|gl:cns5|tyc:tycho2`), computed by the audit's
  `attestSpineRow` over the merged cells. A cell absent from the list is one
  no primary publishes — <!-- count:membership-manifest/unattestedByCell.proper -->46<!-- /count --> today, the proper names
  `data/iau-wgsn/athyg_proper_dispositions.tsv` disposes; an unattested
  Flamsteed or HD cell leaves the row for `label-drops.tsv` instead
  ([The unattested labels leave the row](#the-unattested-labels-leave-the-row)).
- `origin_key` is the record's lineage origin key, the same one its lineage
  rows and identity row are keyed on
  ([Identity](../lineage/README.md#identity--the-origin-source-row)). `readStars`
  carries it onto the record, so a later stage cites a record by it rather
  than re-deriving it from the identifier cells.

Rows are sorted by SID canonical key (`sortManifestRecords`), then TYC, then
source — a total order over content, so a regeneration diffs by what changed
and never by walk order. Sol is first, keyed `sol:sun` alone.

## The spine side

Each spine row becomes one manifest row. The generator reads the spine as the
frozen record of AT-HYG's **merge decisions** — which designations name one
star — which is the one thing AT-HYG supplies that no primary does
([§ 3.1](/docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries)). The spine's identifier cells then pass
through `mergeClassicIdLabels`, **keyed on the binding derived below and never
on the frozen cell**, and this build writes the resulting
`data/classic-ids/label_flips.tsv`. **The merge happens once, here**, and one
producer is what says that queue enumerates every departure from the spine's
cells — the property replayed by [Parity is the manifest's gate now](../spine/README.md#parity-is-the-manifests-gate-now).
The record build reads the manifest's cells as final and
runs no merge of its own.

Keying on the derivation is what lets a filled binding carry labels: <!-- count:membership-manifest/spineRowsWithoutSourceId -->399<!-- /count --> spine
rows reach no source against the frozen column's 1,371, and the difference is
where the overlay can now speak. It moves five cells today — HD 2094 onto
HIP 1997, whose own addition row folds away as a component (a [§ 7](/docs/catalog-driver.md#7-identity-and-ordering-rules) merge,
retiring `hd:2094` in favour of `hip:1997`); GJ 9013 onto Ankaa; GJ 9257AB onto
Tegmine; `Gl 596.1A` to `GJ 9527` on ψ Ser under CNS5's renumbering; and one
curated refusal ([Curated overrides](../classic-ids/label-merge/README.md#curated-overrides-and-what-does-not-belong-in-them)):
Propus, where
Gaia fits one source across a resolved Tycho-2 pair and its cross-match keys
that source to the sibling, so the overlay would hand η Gem the sibling's
HD 253820 in place of its own HD 42995. Gl 563.2
A/B, whose letters AT-HYG swapped, is reached mechanically now the merge scores
`gl` on the component the two sides name ([The gl comparison is specificity-aware](../classic-ids/label-merge/README.md#the-gl-comparison-is-specificity-aware)).

The binding is **derived**, not copied, and **nothing holds it against the
spine's `gaia_source_id` cell**: [The four sources, in precedence order](binding/README.md#the-four-sources-in-precedence-order)
walks four committed
sources through both gates and writes what survives. `derivationOutcome` in the
count snapshot pins what the derivation reached, over every spine row:

| Outcome | Rows | What it is |
|---|---|---|
| `bound` | <!-- count:membership-manifest/derivationOutcome.bound -->312,492<!-- /count --> | one source survives both gates, with no passing rival |
| `refused` | <!-- count:membership-manifest/derivationOutcome.refused -->437<!-- /count --> | no source binds — a derived refusal, not an absence |
| `contested` | <!-- count:membership-manifest/derivationOutcome.contested -->326<!-- /count --> | the winner has a passing runner-up, so precedence chose and not the evidence. Ships the winner and queues the row |
| `collision` | <!-- count:membership-manifest/derivationOutcome.collision -->0<!-- /count --> | a second row derives the same source; both withheld and queued |
| `sol` | <!-- count:membership-manifest/derivationOutcome.sol -->1<!-- /count --> | |

The outcome is a property of the derivation alone, so a count moving is the
derivation moving. That is what replaced the frozen comparison: `derivedVia`,
`bindingByClass` and the review counts are the pins a binding change has to
get past, in place of a diff against a cell AT-HYG wrote.

**A disposition is the authority wherever one keys a row**, whatever the
derivation reached — `data/membership/binding-review-dispositions.tsv`, keyed on
the record's `tyc` / `hip` / `hd` / `gl` cells and restating the derived id it
was taken over, so a re-pull that moves the derivation re-opens the review
rather than carrying a stale verdict forward. `keep_source_id` is what the row
ships: the derived id, any other candidate the queue row lists, an id **no
committed source proposes at all**, or empty for none. That last case is <!-- count:membership-manifest/dispositionAsserted -->32<!-- /count --> of
the 53 today (`dispositionAsserted`) and is why the file exists — the review
reached evidence the derivation cannot, and the count is what keeps the number
of ids resting on it visible.

**An asserted id still needs a second witness**, because the count cannot
supply one: a mistyped digit leaves `dispositionAsserted`, `bindingDispositions`
and `bindingByClass` all reading what they read before, so nothing but the
value itself says it is wrong. The generator therefore requires every asserted
id to be a source `data/gaia/gaia_dr3_astrometry_catalog.tsv` carries, and
fails the build otherwise. The one exemption is `basis = simbad_dr2_object`,
whose ids are in the DR2 namespace and so cannot appear in a DR3 table at all —
a gap in what SIMBAD publishes for two objects, not a rule
(`stellata-hooj.17.10`).

`basis` comes from a closed enum: `tycho2_position` (the record's own Tycho-2
position against the source), `v70a_astrometry` (V/70A's B1950 position and
proper motion against it), `simbad_dr2_object` (SIMBAD holds the id in the DR2
namespace), `gaia_photometry` (G against the record's printed V on each
candidate), `pair_component` (a resolved pair's components bound crosswise,
the HIP and SIMBAD's letters deciding), `shared_source` (one source two records
reach). Today `bindingDispositions` reads <!-- count:membership-manifest/bindingDispositions.derived -->10<!-- /count --> `derived` and <!-- count:membership-manifest/bindingDispositions.other -->43<!-- /count --> `other`. The ten
are the four DR2 ids SIMBAD carries a DR3 successor for, HD 2094 (the HIP
record follows its canonical key onto the primary), Gl 225.2 A, HD 199461
(SIMBAD names the brighter of a blended pair whose fainter member the TYC
cross-match picks), and GJ 1001, GJ 3527 and GJ 4032 — bare cells the
SIMBAD route binds to component A only while `simbad_sptype.tsv` holds no
companion object under the number, so the review stays the authority should
a pull bring one back. A kept value ships as `reviewed`.

How a row reaches its `gaia_source_id` — the four committed sources, the
precedence and consensus ranking, both gates, and the `contested` /
`collision` outcomes the derivation cannot settle alone — is
[What the derivation cannot settle alone](binding/README.md#what-the-derivation-cannot-settle-alone), which owns it.

## The unattested labels leave the row

**A label no primary attests leaves the row.** After the merge, an HD —
display cell or alias — that IV/25, V/50 and I/239's own `HD` column all
lack, and a Flamsteed number neither IV/27A nor WGSN publishes for the star,
are emptied into `data/membership/label-drops.tsv`: one row per cell, keyed on
the manifest row as it stands afterwards, under `hd_unattested` or
`flamsteed_unattested`. Today that is <!-- count:membership-manifest/labelDropsByReason.hd_unattested -->1<!-- /count --> HD — HD 336196 on HIP 90265, where
I/239 prints HD 336187 — and <!-- count:membership-manifest/labelDropsByReason.flamsteed_unattested -->119<!-- /count --> Flamsteed numbers. Those <!-- count:membership-manifest/labelDropsByReason.flamsteed_unattested -->119<!-- /count --> are real
designations with no frozen primary behind them: IV/27A is the whole
3,690-row table (<!-- count:classic-id-overlay/crossIndexRows -->3,688<!-- /count --> after its curated corrections) and publishes 2,755
Flamsteed numbers, and SIMBAD lists every one of the 119 as `* NN Con`
(measured 2026-09-06). Attesting them from a frozen SIMBAD identifier pull is
the open option; until one exists the manifest ships without them and the
ledger says which.

**No dropped label was keying its record**, which is the same question [§ 7](/docs/catalog-driver.md#7-identity-and-ordering-rules) asks
of a dropped binding and the reason neither queue writes a SID event. A
Flamsteed number is not a designation at all, so the <!-- count:membership-manifest/labelDropsByReason.flamsteed_unattested -->119<!-- /count --> cannot move a key. An
HD can, so the gate states the rule rather than the coincidence: whatever keys
the row after the drop must already outrank the cell it lost. Dropping the
display HD promotes the first surviving alias into it, so the cell a record
publishes stays the one a primary attests.

## Correcting a merge decision

Where review found AT-HYG's merge decision wrong, `spine-corrections.tsv`
rewrites a row's `tyc` or folds the row onto its duplicate before anything
else reads the spine. The file, its checks and the folds' identity rule:
[Correcting a merge decision](spine-corrections/README.md#correcting-a-merge-decision).

## The additions

The primaries' rows the spine lacks — IV/25 Tycho-2 stars, I/239 HIPs, CNS5
census rows — are grouped into stars, bound through the spine's own
derivation and admitted under the collision guard's rule, or ledgered onto
the record they resolve to. The cohorts, the grouping, admission and its
outcomes, and why admission is not a promise of a record:
[The additions](additions/README.md).

## The parity gate

`membership-manifest-gate.test.ts`, over the committed artifacts — the
replacement for `../spine/inherited-spine-parity.test.ts`'s spine-less-ledger
arithmetic and label-flips replay:

- **(i)** every spine row resolves to exactly one manifest row — with the
  folds of [Correcting a merge decision](#correcting-a-merge-decision) as the only exception, whose count is
  pinned and whose every pair is checked, so a second row landing on someone
  else's record still fails.
  `matchSpineToManifest` resolves it through the classes SID allocation
  resolves a record by — `sameAsClasses` (`../../sid/sid-pure.ts`) over the
  manifest's designations plus `data/sid/sameas-overrides.tsv`, ambiguous
  designations dropped — the row keyed on its first ladder-ranked
  designation the graph knows. A lower-ranked
  designation the merge moved to a sibling does not split the match, because
  the SID never rode on it — which `../classic-ids/parity-ledger.test.ts` pins
  from the other side. **10** `hd` / `hr` cells move that way today; the figure
  is derived rather than pinned, so recompute it rather than trusting this
  line:

  ```
  awk -F'\t' 'NR>1 && ($3=="hd"||$3=="hr") {
    if ($4!="") spine[$3 FS $4]=$1
    if ($6!="") rows[NR]=$1 FS $3 FS $6 }
    END { for (r in rows) { split(rows[r], f, FS)
            k=f[2] FS f[3]; if (k in spine && spine[k]!=f[1]) n++ }
          print n+0 }' data/classic-ids/label_flips.tsv
  ```
- **(ii)** the manifest rows no spine row reaches are exactly the
  `admitted:*` rows of `additions-ledger.tsv`, per-reason counts pinned; every
  `component:` row names a manifest designation and is itself no manifest row.
- **No addition shares a designation with another record**, which is what says
  each mints on a classical key rather than falling through to its Gaia id.
  The <!-- count:membership-manifest/sharedDesignations -->68<!-- /count --> designations two rows do share are the spine's own — pinned, so a
  label change that makes a sixty-ninth fails here.
- **The astrometry request covers every binding**: each `term = primaries`
  row's `gaia_source_id` is in the request, which reads no manifest, so this
  test holds the coverage ([covered by measurement](../astrometry-request/README.md#the-record-builds-sources-are-covered-by-measurement)).
- **The naming authority's residual**: the manifest propers no WGSN name
  matches are exactly the disposed ones, with the counts pinned in
  `../naming/manifest-naming-expected.json` ([The residual gate](../naming/README.md#the-residual-gate)).
- **(iii)** the built catalogue's designation multiset equals the manifest's
  over the records the build produces — **every manifest row less the [§ 6.1](/docs/catalog-driver.md#61-record-parity)
  parks**, with no exclusions. The three the gate used to carry (spine-origin
  rows only, plus the dropped review bindings and dropped HD labels the
  spine-driven build still shipped) went when `readStars` swapped onto the
  manifest: the build now reads the same cells the manifest publishes, so a
  dropped label is dropped in both. Needs a built catalogue, so it self-skips
  in the bare `test` job and runs in `build-catalog`'s full vitest.
- **The two joins.** Every disposition names a queue row on the same record
  and the same derived id, and every disposed row ships the value its
  disposition settled on (both files regular git, so this runs in every job).
  The converse does not hold and must not be asserted: a queue row need not be
  disposed, since an undisposed `contested` ships its winner while it waits.
  Every `label-drops.tsv` row keys a manifest row, and the per-reason counts
  are pinned.

## Membership lineage

`build:membership` is the first stage with lineage
(`membership-lineage-pure.ts`). `buildMembership` returns a
keyed outcome per decision — admission, fold, component, the spine
derivation's verdict with every candidate it refused, a disposition, an
addition's binding, each label flip and label drop — and
`membershipLineageRow` is the one serialiser, its `switch` exhaustive so a
new variant without a row fails typecheck. `ParamsOf` declares each code's
params beside the codes; the writer and the views both read through it, so
a renamed key fails typecheck on both sides. Every record gets an admission
row. `membershipLedgers` generates the four ledgers from those rows and the
identity rows alone, byte-identical to the files they replaced as writers.

## The identifier columns are read, never re-derived

`readStars` takes `gaia_source_id` off the manifest column. The binding is
derived **once, here** — `binding` says on what basis — and re-deriving it in
the walk would decide it a second time, against whatever reference tables the
walk happened to load. A changed source_id changes the record's designation
set, hence its SID. `weighBinding` therefore has no caller on the
`build:catalog` path; this generator and the classic-ID overlay's gate are
its two.

The same holds for the classical cells: they are FINAL, the merge having run in
the generator, so the record build applies no label pass to them
(`../classic-ids/label-merge/README.md`).

## What the spine is still for

The spine stays committed as the baseline gate (i) reads, as the record of
AT-HYG's merge decisions — which designations name one star — that the
generator re-keys (with the corrections of [Correcting a merge decision](#correcting-a-merge-decision)
applied), and as the inherited label cells the merge above starts from. **Its
`gaia_source_id` and `mag` columns are no longer read by anything**: the
derivation stands on its own outputs ([The spine side](#the-spine-side)) and the V ≤ 3 coverage
counters take the printed-V cascade the binding gate already weighs each row
against. Since the label merge moved onto the derived binding,
`build:classic-ids` does not read this file at all. After the swap release the
baseline becomes the previous manifest. The per-column, per-consumer
retirement plan and its order: [§ 3.2](/docs/catalog-driver.md#32-retiring-the-spines-consumers--per-column-per-consumer-in-order).
