# The membership manifest — the primaries-derived membership term

`data/membership/membership-manifest.tsv` is one row per record the frozen
primaries admit: the spine's 313,257 rows re-keyed on the designations the
primaries publish for them, plus the 63,672 records the primaries name that
AT-HYG's subset never carried — 376,929 rows. **`readStars` walks it, and
membership is exactly these rows less the § 6.1 parks**
(`../parse/README.md` § Per-row pipeline). It is the artifact that retires
`data/athyg/inherited-spine.tsv` as the build's input; the contract is
`docs/catalog-driver.md` § 3.1, the measurement behind it
`../spine/README.md` § The primaries audit.

The manifest is a **pure function of committed inputs**, so unlike the spine it
takes the ordinary regenerate-and-diff gate: CI runs `pnpm run build:membership`
and fails on any diff under `data/membership/`.

## Files in this area

```
scripts/catalog/membership/
  binding-derivation-pure.ts      A row's gaia_source_id from committed
    (+ test)                      evidence: the four candidate sources, the
                                  consensus ranking, both gates through
                                  resolveGaiaSourceId, and the candidate set
                                  the astrometry request has to cover
                                  (§ The binding is derived). Pure.
  membership-manifest-pure.ts     Row assembly (spine side, additions), the
    (+ test)                      derived binding held against the frozen
                                  cell, the review queue and its dispositions,
                                  the admission rule, the § 6.1 reason codes,
                                  the label drops, the TSV codecs, and the
                                  spine ↔ manifest matcher the gate runs. Pure.
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
- `binding` says how `gaia_source_id` is justified: `crosswalk_gated` (a TYC,
  HIP or CNS5 candidate the § 4 gates passed), `simbad_corroborated` (the
  source SIMBAD's frozen cross-IDs hold under the record's own HIP, TYC or GJ,
  through the same gates), `reviewed` (the value a row of
  `data/membership/binding-review-dispositions.tsv` settles on stated
  evidence), or `none`. § The binding is derived is the rule.
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
star — which is the one thing AT-HYG supplies that no primary does
(`docs/catalog-driver.md` § 3.1). The spine's identifier cells then pass
through `mergeClassicIdLabels`, **keyed on the binding derived below and never
on the frozen cell**, and this build writes the resulting
`data/classic-ids/label_flips.tsv`. **The merge happens once, here**, and one
producer is what says that queue enumerates every departure from the spine's
cells — the property replayed by `../spine/README.md` § Parity is the
manifest's gate now. The record build reads the manifest's cells as final and
runs no merge of its own.

Keying on the derivation is what lets a filled binding carry labels: 578 spine
rows reach no source against the frozen column's 1,371, and the difference is
where the overlay can now speak. It moves five cells today — HD 2094 onto
HIP 1997, whose own addition row folds away as a component (a § 7 merge,
retiring `hd:2094` in favour of `hip:1997`); GJ 9013 onto Ankaa; GJ 9257AB onto
Tegmine; `Gl 596.1A` to `GJ 9527` on ψ Ser under CNS5's renumbering; and one
curated refusal (`../classic-ids/README.md` § Curated overrides): Propus, where
Gaia fits one source across a resolved Tycho-2 pair and its cross-match keys
that source to the sibling, so the overlay would hand η Gem the sibling's
HD 253820 in place of its own HD 42995. Two further overrides sit beside it,
unrelated to the re-key: Gl 563.2 A/B, whose letters AT-HYG swapped and whose
correction the merge's own comparison cannot express.

The binding is **derived**, not copied: § The binding is derived walks four
committed sources through both gates and writes what survives. The spine's
`gaia_source_id` cell is read once more, as the **diff surface** — every row
where the derived value and the frozen cell part company is a review item in
`data/membership/binding-review.tsv`, never a gate failure — and
`derivedVsFrozen` in the count snapshot pins the whole comparison:

| Comparison | Rows | What it is |
|---|---|---|
| `match` | 311,835 | the sources bind what AT-HYG bound |
| `fill` | 791 | a source binds where the frozen cell was empty; the record takes it |
| `refused` | 576 | no source binds and the cell was empty — a derived refusal, not an absence |
| `differs` | 8 | the sources bind a different id; reviewed |
| `unreached` | 43 | the frozen cell has a value no source binds; reviewed |
| `contested` | 2 | a fill whose winner has a passing runner-up; ships nothing until reviewed |
| `collision` | 1 | another spine row already holds the derived source; withheld and reviewed |
| `sol` | 1 | |

Every reviewed row has one row in `binding-review-dispositions.tsv`, keyed on
the record's `tyc` / `hip` / `hd` / `gl` cells and restating the frozen and
derived ids it adjudicated between — a re-pull that moves either one re-opens
the review rather than carrying a stale verdict forward. `keep_source_id` is
what the row ships: the frozen id, the derived id, any other candidate the
queue row lists, or empty for none; an id no committed source proposed is
refused at parse. `basis` comes from a closed enum: `tycho2_position` (the
record's own Tycho-2 position against the source), `v70a_astrometry` (V/70A's
B1950 position and proper motion against it), `simbad_dr2_object` (SIMBAD
holds the frozen id in the DR2 namespace and the derived one as its DR3
renumbering), `gaia_photometry` (G against the record's printed V on each
candidate), `pair_component` (a resolved pair's components bound crosswise,
the HIP and SIMBAD's letters deciding), `shared_source` (one source two records
reach). Today: 46 keep the frozen value, 6 take the derived one, 1 takes a
runner-up, 1 refuses both. The six derived are the four DR2 ids of
`data/athyg/stale_gaia_source_ids.tsv` that SIMBAD carries a DR3 successor for,
HD 2094 (the HIP record follows its canonical key onto the primary) and
Gl 225.2 A. A kept value ships as `reviewed`.

## The binding is derived

`deriveBinding` (`binding-derivation-pure.ts`) answers each spine row from four
committed sources, in precedence order:

1. **TYC** — `data/gaia/gaia_dr3_tyc_xmatch.tsv` on the record's own TYC.
2. **HIP** — `data/gaia/gaia_dr3_hip_xmatch.tsv` on its HIP.
3. **CNS5** — `data/classic-ids/cns5.tsv` on its GJ: the exact
   number-plus-letter key, each letter of a combined `gj_comp` separately,
   and the bare number **only from a row CNS5 lists without letters**. A
   binding takes one component's source, so a bare cell may not fold onto a
   lettered row — GJ 1001 is the shape, where CNS5 lists the L-dwarf pair C
   first (`../classic-ids/README.md` § The GJ fold stops at the component).
   The `gl:` ↔ `gl:` bridges of `data/sid/sameas-overrides.tsv` are read as
   one designation, so CNS5's `GJ 9140` row answers for `Gl 157.1`.
4. **SIMBAD** — the Gaia source SIMBAD's frozen cross-IDs
   (`data/simbad/simbad_sptype.tsv`) hold under the record's HIP, then TYC,
   then GJ (exact, with its bridged spellings, before bare). A key two SIMBAD
   objects claim proposes nothing. The bare GJ key is what lets a lettered
   cell reach an unresolved pair's one object — the pull keeps a single GJ
   ident per object, so EZ Aqr sits under `866 C` whatever letter the record
   names — and the two-claimants guard is what stops a resolved pair's
   components answering for each other.

A value two sources agree on outranks a lone leader; ties fall in the order
above. **Every** candidate then goes through **both binding gates by calling
`resolveGaiaSourceId`** — the one call `applyBindingGate` makes on the label
side, so the two cannot drift on what counts as a bad binding — and the first
that passes wins. The magnitude gate weighs G
against the record's **printed V in the V cascade's own tier order**:
Hipparcos on its HIP, else Tycho-2's `VT − 0.090(BT − VT)` on its TYC
(`../photometry/README.md` § The V cascade). The Tycho-2 arm is what reaches
the HD-only rows: a best-neighbour walk landing on a faint neighbour of a
Tycho star has no HIP to be caught by, and 32 fills sat more than a magnitude
below their own star's Tycho-2 V — 14 of them by two to nine magnitudes. The
gates refuse 317 candidates on G − V and 119 on sibling-letter attribution
(`derivedRejected`); falling off the end is a derived refusal.
`derivedUngateable` (7) is the rows that reached a candidate with no printed V
under any tier, so nothing could be weighed against it.

**The losers are weighed too, not only the candidates ahead of the winner.**
`passingRunnersUp` reads the rejections to decide whether a row's sources
genuinely disagree, so a candidate left unweighed would read as passing on a
verdict never taken and queue a `contested` review the gate settles by itself.
Gl 864 shipped exactly that way before the derivation weighed its losers: the
runner-up was the TYC walk's neighbour at G 13.90 against the star's printed
V 9.98, and a human had to write the disposition restating what the magnitude
gate already knew.

Two things the derivation cannot settle alone are queued rather than decided.
A **contested** fill is one whose winner has a runner-up the gates also passed:
the precedence order chose, not the evidence, so the row ships nothing until a
disposition names a value — Gl 563.2 A is the shape, where CNS5 follows
AT-HYG's swapped component letter and SIMBAD follows the HIP. A **collision**
is a derived source another spine row already holds: a Gaia source on two
records keys neither (`docs/sid.md` § 4.1), so the row whose frozen cell held
it keeps it and the other is withheld. Matches with a passing runner-up are
counted (`derivedContestedMatch`, 227), not queued: the frozen cell sides
with the winner and nothing moves.

**The candidates have to be in the astrometry pull.** A missing G is a pass at
the gate, so `derivationCandidateSourceIds` feeds every source any row could be
bound to into `../astrometry-request/` and `derivedWeighedNoGMag` is pinned at
**0** — a candidate weighed with no pulled row is the request under-covering
the derivation. `derivedWeighedNullGMag` (77) is Gaia publishing no G for a
source it has a row for, which no request can supply.

**A Gaia id for a bright star is an identity statement, not a data source.**
Most of the fills are saturated stars whose source is a 2-parameter solution:
sky position only, no parallax, no proper motion. Such a source satisfies
neither the direction cascade (5p) nor the distance cascade (a parallax), and
`GAIA_PHOTOMETRY_SATURATION_G` refuses the Riello V transform below G 4, so
those records keep their Hipparcos-2 astrometry and printed V whatever goes
in the identifier cell. The bright end is already protected by evidence-keyed
conditions; an empty cell was the worse way to express one.

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
errors — a curated file that silently does nothing is worse than none.

**A fold has to be a merge, not a drop.** After the rows are built the
generator holds every folded row's `spineDesignations` against the surviving
manifest row's, and fails on any the survivor does not answer to. It is an
identity event too: the folded row's SID retires with the survivor's as
successor (`docs/sid.md` § 4.3). Both today:

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
| source left empty, on a spine record | 109 | Gaia fitted one source where Tycho-2 resolved two stars |
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

**Admission is not a promise of a record.** An admitted row walks the § 5
cascades like any other, so one that reaches no owned parallax or no V parks on
`data/membership/parked-ledger.tsv` under the existing reason codes
(`../parse/README.md` § Per-row pipeline). Manifest rows are the membership
term; the record count is that term less the parks.

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

- **(i)** every spine row resolves to exactly one manifest row — with the
  folds of § Correcting a merge decision as the only exception, whose count is
  pinned and whose every pair is checked, so a second row landing on someone
  else's record still fails.
  `matchSpineToManifest` resolves it the way `sid:allocate` resolves a record:
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
  over the records the build produces — **every manifest row less the § 6.1
  parks**, with no exclusions. The three the gate used to carry (spine-origin
  rows only, plus the dropped review bindings and dropped HD labels the
  spine-driven build still shipped) went when `readStars` swapped onto the
  manifest: the build now reads the same cells the manifest publishes, so a
  dropped label is dropped in both. Needs a built catalogue, so it self-skips
  in the bare `test` job and runs in `tier-a-corpus`.
- **The two joins.** Every `binding-review.tsv` row has exactly one
  disposition row on the same record naming the same frozen and derived ids,
  every disposition names a queue row, and every disposed row ships the value
  its disposition settled on (both files regular git, so this runs in every
  job); every `label-drops.tsv` row keys a manifest row, and the per-reason
  counts are pinned.

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
(`../classic-ids/README.md` § The label merge).

## What the spine is still for

The spine stays committed as the baseline gate (i) reads, as the record of
AT-HYG's merge decisions — which designations name one star — that the
generator re-keys (with the corrections of § Correcting a merge decision
applied), as the inherited label cells the merge above starts from,
and as the frozen `gaia_source_id` column the derivation is diffed against
(§ The spine side). Its binding cell is not an input to the manifest's: no row
takes a value from it except through a committed disposition row that says so,
and since the label merge moved onto the derived binding `build:classic-ids`
does not read this file at all. After the swap release the baseline becomes the
previous manifest.
