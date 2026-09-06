# The membership manifest — the primaries-derived membership term

`data/membership/membership-manifest.tsv` is one row per record the frozen
primaries admit: the spine's 313,257 rows re-keyed on the designations the
primaries publish for them, plus the 63,672 records the primaries name that
AT-HYG's subset never carried. It is the artifact that retires
`data/athyg/inherited-spine.tsv`; the contract is `docs/catalog-driver.md`
§ 3.1, the measurement behind it `../spine/README.md` § The primaries audit.

The manifest is a **pure function of committed inputs**, so unlike the spine it
takes the ordinary regenerate-and-diff gate: CI runs `pnpm run build:membership`
and fails on any diff under `data/membership/`.

## Files in this area

```
scripts/catalog/membership/
  membership-manifest-pure.ts     Row assembly (spine side, additions), the
    (+ test)                      admission rule, the § 6.1 reason codes, the
                                  label drops, the TSV codecs (manifest,
                                  additions ledger, review queue, its
                                  dispositions, label ledger), and the
                                  spine ↔ manifest matcher the gate runs. Pure.
  build-membership-manifest.ts    `pnpm run build:membership` — loads the
                                  spine, the primaries, the overlay,
                                  multiples.tsv and the review dispositions,
                                  writes data/membership/, and pins
                                  membership-manifest-expected.json.
  membership-manifest-gate.test.ts
                                  The replacement parity gate, (i)–(iii) below,
                                  over the COMMITTED artifacts. LFS-gated;
                                  runs in tier-a-corpus.
  membership-manifest-expected.json
                                  Pinned count snapshot. Refresh with
                                  UPDATE_BUILD_COUNTS=1.
```

The primaries load through `../spine/primaries-tables.ts`, shared with the
audit, so the two instruments read one table set.

## Columns

```
tyc  hip  hd  hd_alt  hr  hr_alt  gl  flam  bayer  proper
gaia_source_id  binding  routes
```

- The identifier cells carry the record's **final** labels: for a spine row
  the classic-ID label merge has already run (`../classic-ids/README.md`
  § The label merge), so `hd_alt` / `hr_alt` hold the alias lists and there is
  no second designation set to flip against. `bayer` and `proper` are the
  spine's printed cells on spine rows and empty on additions — the naming
  ladder resolves both from HD / HIP at build time and reads the cell only as
  a counter (`../naming/README.md`).
- `binding` says how `gaia_source_id` is justified: `crosswalk_gated` (a raw
  cross-walk binding the § 4 gate passed, or the spine's frozen binding a raw
  walk reproduces), `simbad_corroborated` (a spine binding no walk reaches, but
  SIMBAD's object for that id carries the record's own TYC / HIP / GJ),
  `reviewed` (a spine binding neither reaches, kept by its row in
  `data/membership/binding-review-dispositions.tsv`), or `none`.
- `routes` names the primary attesting each classical cell
  (`hd:iv25|hip:i239|gl:cns5|tyc:tycho2`), computed by the audit's
  `attestSpineRow` over the merged cells. A cell absent from the list is one
  no primary publishes — 46 today, the proper names
  `data/iau-wgsn/athyg_proper_dispositions.tsv` disposes; an unattested
  Flamsteed or HD cell leaves the row for `label-drops.tsv` instead (§ The
  spine side).

Rows are sorted by SID canonical key (`sortManifestRows`), then TYC, then
source — a total order over content, so a regeneration diffs by what changed
and never by walk order. Sol is first, keyed `sol:sun` alone.

## The spine side

Each spine row becomes one manifest row. The generator reads the spine as the
frozen record of AT-HYG's **merge decisions** — which designations name one
star, and which Gaia source it bound — which is the one thing AT-HYG supplies
that no primary does (`docs/catalog-driver.md` § 3.1). The spine's identifier
cells pass through the same `mergeClassicIdLabels` call `build:classic-ids`
runs, and the generator asserts the resulting review queue is byte-identical
to the committed `label_flips.tsv`: while the record build still merges labels
for itself, that equality is what says the manifest's labels are the labels
that ship.

The binding is `checkIdentity`'s verdict, as the audit grades it, with the
`gl:` ↔ `gl:` bridges of `data/sid/sameas-overrides.tsv` read as one
designation so CNS5's `GJ 9140` row answers for `Gl 157.1`: `agree` →
`crosswalk_gated`; `unreachable` / `disagree` with SIMBAD corroborating →
`simbad_corroborated`. The **34** bindings neither reaches go to
`data/membership/binding-review.tsv` with the SIMBAD witness columns, and each
has a row in `binding-review-dispositions.tsv`: `keep` or `drop`, a `basis`
from a closed enum, and the measured evidence. A kept binding stays on the row
as `reviewed`; a dropped one leaves it. All 34 are kept — 11 on
`tycho2_position` (the record's own Tycho-2 position against the Gaia source,
every one within 0.65″ at matching brightness), 17 on `v70a_astrometry`
(V/70A's B1950 position and proper motion against the Gaia source: proper
motions agree to a few per cent in size and direction, and the 1991
trigonometric parallaxes that disagree are the catalogue's, not the
binding's), 6 on `simbad_dr2_object` (SIMBAD holds the id as `Gaia DR2` and
that object carries the record's TYC / GJ —
`data/athyg/stale_gaia_source_ids.tsv`). None of the 34 was SID-keyed on its
Gaia id, so no canonical key moves. The 233 empty cells a raw walk would fill
stay empty (§ 3 forbids the re-derivation).

**A label no primary attests leaves the row.** After the merge, an HD —
display cell or alias — that IV/25, V/50 and I/239's own `HD` column all
lack, and a Flamsteed number neither IV/27A nor WGSN publishes for the star,
are emptied into `data/membership/label-drops.tsv`: one row per cell, keyed on
the manifest row as it stands afterwards, under `hd_unattested` or
`flamsteed_unattested`. Today that is 1 HD — HD 336196 on HIP 90265, where
I/239 prints HD 336187 — and 119 Flamsteed numbers. Those 119 are real
designations with no frozen primary behind them: IV/27A is the whole
3,690-row table and publishes 2,757 Flamsteed numbers, and SIMBAD lists every
one of the 119 as `* NN Con` (measured 2026-09-06). Attesting them from a
frozen SIMBAD identifier pull is the open option; until one exists the
manifest ships without them and the ledger says which.

**No dropped label was keying its record**, which is the same question § 7 asks
of a dropped binding and the reason neither queue writes a SID event. A
Flamsteed number is not a designation at all, so the 119 cannot move a key. An
HD can, so the gate states the rule rather than the coincidence: whatever keys
the row after the drop must already outrank the cell it lost. Dropping the
display HD promotes the first surviving alias into it, so the cell a record
publishes stays the one a primary attests.

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
keys no SID (`docs/sid.md` § 4.1), so attaching one another record holds would
cost that record its key for nothing. The claim set is the spine's after the
label merge and **grows as each group is admitted**, so the rule reads the same
whether the record already answering is a spine row or an earlier addition.
The consequences, measured 2026-09-06:

| Outcome | Groups | What it is |
|---|---|---|
| `admitted:hd_link_gap` | 54,812 | IV/25 star, lowest admitted HD < 100,000 — AT-HYG's link defect |
| `admitted:hd_omitted` | 5,060 | IV/25 star, HD ≥ 100,000 |
| `admitted:hip_omitted` | 444 | I/239 HIP with no IV/25 star |
| `admitted:cns5_census` | 3,356 | CNS5 `GJ 1xxxx` row |
| `component:<anchor>` | 471 | every designation it arrived with is another record's. 466 are the second Tycho-2 entry of a resolved pair whose HD (and, through Tycho-2's `hip`, HIP) a spine record carries; 5 are the second of a pair neither component of which is on the spine. Not a row; ledgered onto the record it resolves to |
| source left empty, on a spine record | 105 | Gaia fitted one source where Tycho-2 resolved two stars |
| source left empty, gate refused | 13 | the raw binding is in `rejected_bindings.tsv` |

The audit's headline cohort sizes (60,344 / 566 / 3,362) are pre-grouping and
pre-admission; the table above is what the manifest carries.

**Those 5 are two groups arriving with one designation and no spine record to
lose it to.** IV/25 resolves HD 23068, 37703, 45900, 63846 and 86269 onto two
Tycho-2 stars each — close doubles at 1.5–3″, HD 45900's pair at 8.5″, flagged
`n_tyc > 1` — and neither component is on the spine. Admission is sequential,
so its order fixes which one takes the designation: the group whose Gaia
binding survives the § 4 gate first, since the other would park for want of a
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
designation one carries sits on a second row (`sharedDesignations`, 69, every
one a spine-side pair), so `sid:allocate` mints every addition under `hd:` /
`hip:` / `gl:`. The two counts answer only together: the first says the row has
a classical designation, the second that the designation is its own.

An addition's other labels come by **designation-keyed** joins over the same
primaries — HR from V/50 by HD, HIP and Flamsteed from IV/27A by HD, HIP from
Tycho-2's own column — never through the source-keyed overlay, whose gate the
group's `gaia_source_id` already passed (`overlay.has(source)` is the § 4
verdict on every raw binding, spine row or not). An addition's source is the
TYC route's where it has one; 3 groups have a HIP route binding a different
source and follow the HD-route authority of § 4.

## The parity gate

`membership-manifest-gate.test.ts`, over the committed artifacts — the
replacement for `../spine/inherited-spine-parity.test.ts`'s spine-less-ledger
arithmetic and label-flips replay:

- **(i)** every spine row resolves to exactly one manifest row.
  `matchSpineToManifest` resolves it the way `sid:allocate` resolves a record:
  the same-as graph over the manifest's designations plus
  `data/sid/sameas-overrides.tsv`, ambiguous designations dropped, the row
  keyed on its first ladder-ranked designation the graph knows. A lower-ranked
  designation the merge moved to a sibling (the 36 mutual HD/HR swaps) does not
  split the match, because the SID never rode on it — which
  `../classic-ids/parity-ledger.test.ts` pins from the other side.
- **(ii)** the manifest rows no spine row reaches are exactly the
  `admitted:*` rows of `additions-ledger.tsv`, per-reason counts pinned; every
  `component:` row names a manifest designation and is itself no manifest row.
- **No addition shares a designation with another record**, which is what says
  each mints on a classical key rather than falling through to its Gaia id.
  The 69 designations two rows do share are the spine's own — pinned, so a
  label change that makes a seventieth fails here.
- **(iii)** the built catalogue's designation multiset equals the manifest's
  over the records the build produces. Until the record build reads the
  manifest (`stellata-3bsf.8.3`) that is the spine-origin rows less the parked
  ledger, plus the review bindings a disposition dropped and the HD labels the
  label ledger dropped, both of which the spine-driven build still ships.
  Needs a built catalogue, so it self-skips in the bare `test` job and runs in
  `tier-a-corpus`.
- **The two joins.** Every `binding-review.tsv` row has exactly one
  disposition row and every disposition names a queue row (both regular git,
  so this runs in every job); every `label-drops.tsv` row keys a manifest
  row, and the per-reason counts are pinned.

## What the record-build swap changes here

When `readStars` walks the manifest: gate (iii) drops all three exclusions;
`label_flips.tsv` and the record build's own merge retire, since the labels are
the manifest's; the spine stays committed as the baseline (i) reads and the
generator's merge-decision input, and nothing else reads it. After the swap
release the baseline becomes the previous manifest.
