# The membership manifest — the primaries-derived membership term

`data/membership/membership-manifest.tsv` is one row per record the frozen
primaries admit: the spine's 313,257 rows re-keyed on the designations the
primaries publish for them, less the one a correction folds
([Correcting a merge decision](#correcting-a-merge-decision)), plus the 63,676 records the primaries name
that AT-HYG's subset never carried — 376,932 rows, and the 602,228 the V <= 11
magnitude term adds on top (`magnitude-term/README.md`), 979,160 in
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
  membership-manifest-pure.ts     Row assembly (spine side, additions), the
    (+ test)                      review queue and the dispositions settling
                                  it, the admission rule, the /docs/catalog-driver.md#61-record-parity reason
                                  codes, the label drops, the TSV codecs, and
                                  the spine ↔ manifest matcher the gate runs.
                                  Pure.
  build-membership-manifest.ts    `pnpm run build:membership` — loads the
                                  spine and its corrections, the primaries, the
                                  overlay, the binding gates' evidence,
                                  multiples.tsv and the review dispositions,
                                  writes
                                  data/membership/ plus the label merge's
                                  queue (data/classic-ids/label_flips.tsv),
                                  and pins
                                  membership-manifest-expected.json.
  membership-manifest-gate.test.ts
                                  The replacement parity gate, (i)–(iii) below,
                                  over the COMMITTED artifacts. LFS-gated;
                                  runs in CI's `Tier-A star corpus` step.
  membership-manifest-expected.json
                                  Pinned count snapshot. Refresh with
                                  UPDATE_BUILD_COUNTS=1.
  binding/                        A row's gaia_source_id from committed
                                  evidence alone: the four sources, both
                                  gates, and the outcomes the derivation
                                  cannot settle by itself. Own README.
  magnitude-term/                 The union's second term — the V floor, its
                                  filter over the Gaia pull and the 5p
                                  astrometry that comes with it. Own README.
```

The primaries load through `../spine/primaries-tables.ts`, shared with the
audit, so the two instruments read one table set.

## Columns

```
tyc  hip  hd  hd_alt  hr  hr_alt  gl  flam  bayer  proper
gaia_source_id  binding  routes  term
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
  no primary publishes — 46 today, the proper names
  `data/iau-wgsn/athyg_proper_dispositions.tsv` disposes; an unattested
  Flamsteed or HD cell leaves the row for `label-drops.tsv` instead
  ([The unattested labels leave the row](#the-unattested-labels-leave-the-row)).

Rows are sorted by SID canonical key (`sortManifestRows`), then TYC, then
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

Keying on the derivation is what lets a filled binding carry labels: 577 spine
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
| `bound` | 312,405 | one source survives both gates, with no passing rival |
| `refused` | 619 | no source binds — a derived refusal, not an absence |
| `contested` | 231 | the winner has a passing runner-up, so precedence chose and not the evidence. Ships the winner and queues the row |
| `collision` | 0 | a second row derives the same source; both withheld and queued |
| `sol` | 1 | |

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
committed source proposes at all**, or empty for none. That last case is 36 of
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
reach). Today `bindingDispositions` reads 6 `derived` and 47 `other`. The six
are the four DR2 ids SIMBAD carries a DR3 successor for, HD 2094 (the HIP
record follows its canonical key onto the primary) and Gl 225.2 A. A kept
value ships as `reviewed`.

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
`flamsteed_unattested`. Today that is 1 HD — HD 336196 on HIP 90265, where
I/239 prints HD 336187 — and 119 Flamsteed numbers. Those 119 are real
designations with no frozen primary behind them: IV/27A is the whole
3,690-row table (3,688 after its curated corrections) and publishes 2,755
Flamsteed numbers, and SIMBAD lists every one of the 119 as `* NN Con`
(measured 2026-09-06). Attesting them from a frozen SIMBAD identifier pull is
the open option; until one exists the manifest ships without them and the
ledger says which.

**No dropped label was keying its record**, which is the same question [§ 7](/docs/catalog-driver.md#7-identity-and-ordering-rules) asks
of a dropped binding and the reason neither queue writes a SID event. A
Flamsteed number is not a designation at all, so the 119 cannot move a key. An
HD can, so the gate states the rule rather than the coincidence: whatever keys
the row after the drop must already outrank the cell it lost. Dropping the
display HD promotes the first surviving alias into it, so the cell a record
publishes stays the one a primary attests.

## Correcting a merge decision

The spine states which designations name one star, and that is the one thing no
primary supplies — so it is also the one thing no other curated file can
correct. `data/membership/spine-corrections.tsv` is where review says AT-HYG
merged wrong, keyed on `tyc`/`hip`/`hd`/`gl`, which is unique across all
313,257 spine rows. Two operations:

- **`set`** rewrites one cell. It accepts **`tyc` alone**: every other
  identifier the spine states is the label merge's, and a curated exception to
  a LABEL belongs in `classic_id_overrides.tsv` where the merge can see it.
- **`fold`** says the row is another spine row's duplicate, `value` naming that
  row's key. The folded row becomes no manifest row of its own.

A key matching no spine row, a `set` writing the value the spine already
states, a fold onto a folded row, and a row stating no evidence are all hard
errors — a curated file that silently does nothing is worse than none. So is a
row naming **no** key cell, which is the one blank that would resolve rather
than miss: Sol is the single spine row whose four key cells are all empty, so
an unkeyed correction lands on the Sun.

**A fold has to be a merge, not a drop.** After the rows are built the
generator holds every folded row's `spineDesignations` against the surviving
manifest row's, and fails on any the survivor does not answer to. It is an
identity event too: the folded row's SID retires with the survivor's as
successor ([§ 4.3](/docs/sid.md#43-ledger--datasidledgertsv)). Both today:

| Row | Op | What review found |
|---|---|---|
| TYC 2265-1793-1 / HIP 1997 | `set tyc` | the row is HD 2094 A on its HIP, its bound source and its HD, and carried B's TYC — 5.1″ away, and what the direction, V and PM cascades key on |
| the Gaia-keyed `Gl 277A` | `fold` | AT-HYG carried VV Lyn twice, 0.65″ apart at the same magnitude; `multiples.tsv`, CNS5 and SIMBAD each pair HIP 36626 with that source |

Both corrections **retire** a curated row rather than adding one: HD 2094's
queue verdict stays `differs` but its TYC route now agrees with the HIP and
SIMBAD ones, and the fold clears the `collision` the twin caused, so its
disposition goes. The survivor also gains the Gaia 5p solution the twin held —
83.3788 ± 0.0487 mas against Hipparcos-2's blended 84.26 ± 3.45.

## The additions

`findAdditions` (the audit) yields three cohorts the spine lacks: IV/25 Tycho-2
stars by TYC, I/239 HIPs, CNS5 census rows. The same star reaches that list
once per primary, so the cohorts are **grouped** before admission
(`groupAdditions`): an HD item joins the HIP item Tycho-2's own `hip` column
or IV/27A names for it (123 + 5 groups), and items naming one raw source are
one star (6 CNS5 ↔ TYC groups) — except two TYC items, which are two Tycho-2
stars whatever the best-neighbour walk says.

**Admission applies the collision guard's rule at the door.** A group takes
only designations **no record already answers to** — display cell or alias,
compared on `hd` / `hr` / `hip` / normalised GJ — and only a raw source no
spine record carries. A designation on two records names a granularity and
keys no SID ([§ 4.1](/docs/sid.md#41-same-as-equivalence-graph)), so attaching one another record holds would
cost that record its key for nothing. The claim set is the spine's after the
label merge and **grows as each group is admitted**, so the rule reads the same
whether the record already answering is a spine row or an earlier addition.
The consequences, measured 2026-09-06:

| Outcome | Groups | What it is |
|---|---|---|
| `admitted:hd_link_gap` | 54,813 | IV/25 star, lowest admitted HD < 100,000 — AT-HYG's link defect |
| `admitted:hd_omitted` | 5,063 | IV/25 star, HD ≥ 100,000 |
| `admitted:hip_omitted` | 444 | I/239 HIP with no IV/25 star |
| `admitted:cns5_census` | 3,356 | CNS5 `GJ 1xxxx` row |
| `component:<anchor>` | 466 | every designation it arrived with is another record's. 461 are the second Tycho-2 entry of a resolved pair whose HD (and, through Tycho-2's `hip`, HIP) a spine record carries; 5 are the second of a pair neither component of which is on the spine. Not a row; ledgered onto the record it resolves to. Five left the class when the curated HD corrections freed the number their anchor was wrongly displaying ([Curated overrides](../classic-ids/label-merge/README.md#curated-overrides-and-what-does-not-belong-in-them)) |
| source left empty, on a spine record | 108 | Gaia fitted one source where Tycho-2 resolved two stars |
| source left empty, gate refused | 121 | the raw binding is in `rejected_bindings.tsv` |

The audit's headline cohort sizes (60,344 / 566 / 3,362) are pre-grouping and
pre-admission; the table above is what the manifest carries.

**Those 5 are two groups arriving with one designation and no spine record to
lose it to.** IV/25 resolves HD 23068, 37703, 45900, 63846 and 86269 onto two
Tycho-2 stars each — close doubles at 1.5–3″, HD 45900's pair at 8.5″, flagged
`n_tyc > 1` — and neither component is on the spine. Admission is sequential,
so its order fixes which one takes the designation: the group whose Gaia
binding survives the [§ 4](/docs/catalog-driver.md#4-how-hd-reaches-gaia) gate first, since the other would park for want of a
parallax this one has (HD 86269 is the pair where that outranks the lower TYC),
then TYC, HIP, GJ. A total order over content, never over walk order.

The guard is keyed on the **normalised GJ, letter included**: `GJ 3131B` is the
other component of `GJ 3131A`'s pair, a second star under a second designation,
and matching the bare number as well ledgers 21 CNS5 component stars away as
components of their own primaries. Whether the system is represented at all is
the cohort filter's question, and `spineKeys` answers it against the bare
number there.

Two admitted rows ship without a designation their primaries publish
(`additionsWithBlockedDesignation`): TYC 8188-4142-1 on HIP 50798 without
HD 90034, TYC 1567-2517-2 on HD 166479 without HR 6803, both held by a spine
record. The record ships; only the label is withheld.

No admitted row keys on a Gaia id alone (`additionGaiaKeyedOnly`), and no
designation one carries sits on a second row (`sharedDesignations`, 68, every
one a spine-side `hd:` or `hr:` pair), so `sid:allocate` mints every addition under `hd:` /
`hip:` / `gl:`. The two counts answer only together: the first says the row has
a classical designation, the second that the designation is its own.

<a id="admission-is-not-a-promise-of-a-record"></a>**Admission is not a promise of a record.** An admitted row walks the [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers)
cascades like any other, so one that reaches no owned parallax or no V parks on
`data/membership/parked-ledger.tsv` under the existing reason codes
([Per-row pipeline](../parse/README.md#per-row-pipeline)). Manifest rows are the membership
term; the record count is that term less the parks.

An addition's other labels come by **designation-keyed** joins over the same
primaries — HR from V/50 by HD, HIP and Flamsteed from IV/27A by HD, HIP from
Tycho-2's own column — never through the source-keyed overlay, whose gate the
group's `gaia_source_id` already passed (`overlay.has(source)` is the [§ 4](/docs/catalog-driver.md#4-how-hd-reaches-gaia)
verdict on every raw binding, spine row or not). An addition's source is the
TYC route's where it has one; 3 groups have a HIP route binding a different
source and follow the HD-route authority of [§ 4](/docs/catalog-driver.md#4-how-hd-reaches-gaia).

## The parity gate

`membership-manifest-gate.test.ts`, over the committed artifacts — the
replacement for `../spine/inherited-spine-parity.test.ts`'s spine-less-ledger
arithmetic and label-flips replay:

- **(i)** every spine row resolves to exactly one manifest row — with the
  folds of [Correcting a merge decision](#correcting-a-merge-decision) as the only exception, whose count is
  pinned and whose every pair is checked, so a second row landing on someone
  else's record still fails.
  `matchSpineToManifest` resolves it the way `sid:allocate` resolves a record:
  the same-as graph over the manifest's designations plus
  `data/sid/sameas-overrides.tsv`, ambiguous designations dropped, the row
  keyed on its first ladder-ranked designation the graph knows. A lower-ranked
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
  The 68 designations two rows do share are the spine's own — pinned, so a
  label change that makes a sixty-ninth fails here.
- **(iii)** the built catalogue's designation multiset equals the manifest's
  over the records the build produces — **every manifest row less the [§ 6.1](/docs/catalog-driver.md#61-record-parity)
  parks**, with no exclusions. The three the gate used to carry (spine-origin
  rows only, plus the dropped review bindings and dropped HD labels the
  spine-driven build still shipped) went when `readStars` swapped onto the
  manifest: the build now reads the same cells the manifest publishes, so a
  dropped label is dropped in both. Needs a built catalogue, so it self-skips
  in the bare `test` job and runs in the `Tier-A star corpus` CI step.
- **The two joins.** Every disposition names a queue row on the same record
  and the same derived id, and every disposed row ships the value its
  disposition settled on (both files regular git, so this runs in every job).
  The converse does not hold and must not be asserted: a queue row need not be
  disposed, since an undisposed `contested` ships its winner while it waits.
  Every `label-drops.tsv` row keys a manifest row, and the per-reason counts
  are pinned.

## The identifier columns are read, never re-derived

`readStars` takes `gaia_source_id` off the manifest column. The binding is
derived **once, here** — `binding` says on what basis — and re-deriving it in
the walk would decide it a second time, against whatever reference tables the
walk happened to load. A changed source_id changes the record's designation
set, hence its SID. `resolveGaiaSourceId` therefore has no caller on the
`build:catalog` path; it survives for this generator and the classic-ID
overlay's gate.

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
