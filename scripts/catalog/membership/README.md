# The membership manifest — the primaries-derived membership term

`data/membership/membership-manifest.tsv` is one row per record the frozen
primaries admit: the spine's 313,257 rows re-keyed on the designations the
primaries publish for them, plus the 63,677 records the primaries name that
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
                                  three TSV codecs, and the spine ↔ manifest
                                  matcher the gate runs. Pure.
  build-membership-manifest.ts    `pnpm run build:membership` — loads the
                                  spine, the primaries, the overlay and
                                  multiples.tsv, writes data/membership/, and
                                  pins membership-manifest-expected.json.
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
  SIMBAD's object for that id carries the record's own TYC / HIP / GJ), or
  `none`.
- `routes` names the primary attesting each classical cell
  (`hd:iv25|hip:i239|gl:cns5|tyc:tycho2`), computed by the audit's
  `attestSpineRow` over the merged cells. A cell absent from the list is one
  no primary publishes — 167 today: 2 HDE numbers, 119 Flamsteed numbers, 46
  disposed proper names (`stellata-3bsf.8.4` disposes them). The audit counts
  120 Flamsteed cells because it reads the spine's pre-merge cell; the overlay
  corrected one.

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

The binding is `checkIdentity`'s verdict, unchanged from the audit: `agree` →
`crosswalk_gated`; `unreachable` / `disagree` with SIMBAD corroborating →
`simbad_corroborated`; the **39** uncorroborated bindings lose their
`gaia_source_id` and go to `data/membership/binding-review.tsv` with the SIMBAD
witness columns. None of the 39 was SID-keyed on its Gaia id, so no canonical
key moves. The 233 empty cells a raw walk would fill stay empty (§ 3 forbids
the re-derivation).

## The additions

`findAdditions` (the audit) yields three cohorts the spine lacks: IV/25 Tycho-2
stars by TYC, I/239 HIPs, CNS5 census rows. The same star reaches that list
once per primary, so the cohorts are **grouped** before admission
(`groupAdditions`): an HD item joins the HIP item Tycho-2's own `hip` column
or IV/27A names for it (123 + 5 groups), and items naming one raw source are
one star (6 CNS5 ↔ TYC groups) — except two TYC items, which are two Tycho-2
stars whatever the best-neighbour walk says.

**Admission applies the collision guard's rule at the door.** A group takes
only designations no spine record answers to after the label merge — display
cell or alias, compared on `hd` / `hr` / `hip` / normalised GJ — and only a
raw source no spine record carries. A designation on two records names a
granularity and keys no SID (`docs/sid.md` § 4.1), so attaching one a spine
record holds would cost that record its key for nothing. The consequences,
measured 2026-09-05:

| Outcome | Groups | What it is |
|---|---|---|
| `admitted:hd_link_gap` | 54,817 | IV/25 star, lowest admitted HD < 100,000 — AT-HYG's link defect |
| `admitted:hd_omitted` | 5,060 | IV/25 star, HD ≥ 100,000 |
| `admitted:hip_omitted` | 444 | I/239 HIP with no IV/25 star |
| `admitted:cns5_census` | 3,356 | CNS5 `GJ 1xxxx` row |
| `component:<anchor>` | 466 | every designation it arrived with is a spine record's — the second Tycho-2 entry of a resolved pair whose HD (and, through Tycho-2's `hip`, HIP) the primary already carries. Not a row; ledgered onto the record it resolves to |
| source left empty, on a spine record | 105 | Gaia fitted one source where Tycho-2 resolved two stars |
| source left empty, gate refused | 13 | the raw binding is in `rejected_bindings.tsv` |

The audit's headline cohort sizes (60,344 / 566 / 3,362) are pre-grouping and
pre-admission; the table above is what the manifest carries. Zero admitted rows
key on a Gaia id alone (`additionGaiaKeyedOnly`), so `sid:allocate` mints
every addition under `hd:` / `hip:` / `gl:`.

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
- **(iii)** the built catalogue's designation multiset equals the manifest's
  over the records the build produces. Until the record build reads the
  manifest (`stellata-3bsf.8.3`) that is the spine-origin rows less the parked
  ledger, plus the review queue's bindings the spine-driven build still ships.
  Needs a built catalogue, so it self-skips in the bare `test` job and runs in
  `tier-a-corpus`.

## What the record-build swap changes here

When `readStars` walks the manifest: gate (iii) drops both exclusions;
`label_flips.tsv` and the record build's own merge retire, since the labels are
the manifest's; the spine stays committed as the baseline (i) reads and the
generator's merge-decision input, and nothing else reads it. After the swap
release the baseline becomes the previous manifest.
