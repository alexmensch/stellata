# Classic-ID overlay build

Joins the four frozen CDS classic-designation tables onto Gaia DR3
source_ids, writes `data/classic-ids/classic_id_overlay.tsv`, and merges it
onto the record build's spine-derived labels. The contract it implements is
`docs/catalog-driver.md` § 2 (sources), § 4 (HD route, ambiguity, precedence)
and § 5 (the designation-constellation cascade); the measured coverage the join
achieves — and why the inherited spine is load-bearing beside it — is
`data/classic-ids/README.md` § Coverage.

Two entry points, both on the shipping path:

- `pnpm run build:classic-ids` regenerates the committed overlay and the label
  merge's review queue. CI asserts both are byte-identical to what the
  committed code produces, so artifact and code always land together.
- `build-catalog.ts` calls `applyClassicIdLabels` as a post-pass over
  `readStars`' output — this folder is where the record build's LABELS come
  from, while its membership is the spine alone.

## Files in this area

```
scripts/catalog/classic-ids/
  build-classic-id-overlay.ts     I/O orchestrator: reads the frozen tables,
                                  both Gaia cross-walks, the gate's three
                                  evidence tables and the spine, writes the
                                  overlay and its three review queues, and
                                  asserts the count snapshot.
  binding-candidates.ts (+ test)  The cross-walk loaders, and the source_ids
                                  the gate can weigh. Shared with
                                  ../astrometry-request/, which has to pull a
                                  G magnitude for every one of them
                                  (§ The gate's evidence has to be pulled).
                                  Two loaders, because the candidate set needs
                                  only the HIP cross-walk and CNS5 — the
                                  request never reads the 2.5 M-row TYC table.
                                  The test derives its expectation from a built
                                  overlay, so drift in either producer of
                                  `entry.hip` fails rather than silently
                                  shrinking the request.
  classic-ids-parse.ts (+ test)   The four frozen-TSV parsers. The gate's
                                  HIP → printed-V slice is
                                  ../photometry/hip-photometry-parse.ts, shared
                                  with the V cascade's bright tier. CNS5's row
                                  also carries the astrometry half of the
                                  slice, which `cns5AstrometryByGj` keys on the
                                  record's own GJ and `lookupCns5Astrometry`
                                  reads back — one GJ fold for the direction
                                  cascade's `cns5` tier and the PM rescue
                                  alike. This folder parses that file,
                                  ../distance/ routes on it. Its PM carries
                                  `pmBibcode` because 87% of CNS5's motions are
                                  Gaia's own republished and the rescue's skip
                                  rule needs the citation to see that; an
                                  unbibcoded motion is dropped whole, position
                                  intact.
  cns5-fixture.ts                 Test-only Cns5Row / Cns5Astrometry builders.
                                  A module, not an export from a test file:
                                  four suites across two folders build these,
                                  so a column added to either interface lands
                                  in one place.
  classic-id-overlay-pure.ts      The join, the binding gate, its counts, and
    (+ test)                      the overlay TSV codec (both directions).
                                  Pure.
  label-merge-pure.ts (+ test)    The merge itself: the per-identifier rule,
                                  the collision guard, the curated overrides,
                                  the review-queue codec, the designation
                                  delta the spine parity gate replays, and
                                  the unnetted removals the parity ledger's
                                  canonical-key audit reads. Pure.
  designation-constellation-pure.ts
                                  IV/27A's `cst` keyed by HD/HIP — the
                                  constellation a Bayer / Flamsteed
                                  designation is NAMED for. Pure.
  apply-classic-id-labels.ts      The record build's entry point: loads the
                                  committed tables and applies both of the
                                  above to the Star array.
  designation-constellation.test.ts
                                  Pins the cascade's output on the WIRE
                                  (ρ Aql, 15 LMi, Fomalhaut C) against the
                                  built search index.
  parity-ledger.test.ts           The swap parity ledger's committed gates:
                                  route-disagreement review join, the
                                  canonical-key audit of the label delta
                                  against the SID ledger + bridges, and the
                                  V/50 HD-less out-of-scope pin
                                  (../spine/README.md § The swap parity
                                  ledger).
  classic-id-overlay-expected.json
                                  Pinned count snapshot. Refresh with
                                  UPDATE_BUILD_COUNTS=1 (same env var
                                  build-catalog.ts uses).
```

## Join routes

```
hd        IV/25 hd → tyc → gaia_dr3_tyc_xmatch → source_id      (primary)
hr        V/50 hr → hd → the hd route
bayer     IV/27A hd → the hd route, else its own hip → hip walk
flamsteed same as bayer
hip       gaia_dr3_hip_xmatch, plus CNS5's own hip column
gj        CNS5's EDR3 source_id, else its hip → hip walk
```

**HD routes entirely through TYC.** Every HD-bearing AT-HYG row also
carries a TYC (audit 2026-07-27), so the HIP route is a cross-check, not
a second authority: where both resolve and disagree, the HD route keeps
the label and the row is appended to
`data/classic-ids/hd_hip_route_disagreements.tsv` for the parity
ledger's review queue rather than resolved mechanically.

**Every route above is an unvetted best-neighbour walk, so the assembled
overlay is then gated** — `applyBindingGate` re-runs the record build's own
`resolveGaiaSourceId` checks and drops any row whose source_id is not the
star its designations name (268 rows today). It runs BEFORE the counts, so
every `overlay*` count and `hdOnMultipleSources` describe the artifact while
the route counters above stay pre-gate and keep describing upstream
reachability. Rationale, the two canonical cases, and the bound on the
gate's reach: `data/classic-ids/README.md` § The binding gate.

### The gate's evidence has to be pulled

The magnitude check compares a candidate's `phot_g_mean_mag` against the
printed V of its brightest HIP. That G comes from
`data/gaia/gaia_dr3_astrometry_catalog.tsv`, and **`gMagOf` returning null
is not a rejection — it is a pass.** So a candidate the astrometry pull does
not cover is not merely unvetted, it is silently accepted.

Candidates are not spine rows. A route resolves a designation to whatever
source a cross-walk names, and the gate exists precisely because that source
is often not the star, so the request has to carry them explicitly:
`../astrometry-request/README.md` § The request is a union.

`gateRejectedMag` measures the difference directly, and it is the count to
watch if this request ever changes again:

| Request | `gateRejectedMag` | `gateRejectedSibling` | rows |
|---|---|---|---|
| spine column alone | **0** — every candidate unvettable, all silently accepted | 101 | 101 |
| the AT-HYG walk this replaced | 102 | 85 | 187 |
| spine ∪ candidates (today) | **218** | 50 | **268** |

The walk was never complete either — it over-pulled by accident rather than
covering the candidate set on purpose — so the queue grows by **81 bindings it
could not weigh and now refuses**. None of the 81 had reached a record: the
label merge's per-identifier routing is unchanged and `label_flips.tsv` is
byte-identical, which is what says the gain is coverage, not a label change.

**`gateRejectedMag` moves by 116, not 81, and `gateRejectedSibling` falls — both
because `reason` is the FIRST gate that fired**, `verdict.magRejected ? 'mag' :
'sibling'`. A candidate with no `G` cannot fail the magnitude check, so 35 rows
the sibling-letter check had already refused are now refused by the magnitude
check instead and re-labelled: 116 = 81 new + 35 re-labelled, and sibling 85 →
50 is those same 35 leaving. No binding the gate used to refuse is accepted
today; read the two reason counts as one queue, not as two independent gates.

**Two counts say whether the evidence actually arrived**, because a missing `G`
is a pass either way and only one of the causes is fixable:

| Count | Today | Meaning |
|---|---|---|
| `gateSkippedNoGMag` | **0** | gateable rows the pull returned no row for — the request under-covering its candidates. Pinned at zero; this is the fault the union exists to prevent. |
| `gateSkippedNullGMag` | 63 | rows Gaia has, with `phot_g_mean_mag` null. Silently accepted too, and no request can supply it — the residual the gate's reach does not cover. |

The set stays small (768 ids beyond the spine) because `applyBindingGate`
skips what it cannot weigh — an entry with no HIP, and a HIP with no printed V
(`gateSkippedNoHipVMag`) — and `bindingCandidateSourceIds` applies both
narrowings so the request and the gate agree by construction.

**An ambiguous designation attaches to every matching record** (§ 4) —
`buildClassicIdOverlay` never picks a winner, so overlay cells are
`|`-separated lists and `sourcesWithMultipleHd` / `hdOnMultipleSources`
are pinned counts rather than assertions of uniqueness. Search dispatch
resolving to the brightest, and SID allocation keying no row off such a
designation, are the consumer's job.

The TYC cross-walk is 2.5 M rows for a ~350 k-row join, so
`readGaiaTycXmatch` (`../parse/gaia-xmatch.ts`) streams it line-by-line
and takes a keep-set of the Tycho ids IV/25 actually mentions. Reading it
as one string peaks near a gigabyte alongside the join's own maps.

## The label merge

`mergeClassicIdLabels` (`label-merge-pure.ts`) runs over the same overlay from
two places — `build:classic-ids` over the spine rows, `build:catalog` over the
records those rows produced — through one pure function, and the record build
then asserts its own review queue is byte-identical to the committed one. That
equality is the guarantee that `data/classic-ids/label_flips.tsv` describes the
labels actually shipped.

Per identifier (`hip`, `hd`, `hr`, `gl`, `flam`), first hit wins:

```
overlay asserts nothing        -> the spine's value stands (the backstop)
overlay confirms the spine     -> the spine's own SPELLING is kept
spine has no value             -> the overlay's is added
the two disagree               -> the overlay wins (§ 4 precedence)
```

**Bayer STRINGS are not merged.** IV/27A spells Bayer letters `alf` where the
spine spells them `Alp`; choosing between the conventions is the naming
ladder's gate (`docs/star-naming.md` § 4). So the overlay's `flamsteed` cell is
read for its NUMBER only, its `bayer` cell for nothing at all, and the
constellation those cells carry reaches the build through the separate
designation-keyed route below.

Record fields are single-valued while overlay cells are not, so where the
overlay asserts several values the field takes one and the rest are enumerated
as `extra-dropped` — labels the record will not answer to. Multi-valued
identifier support is a wire + ledger change, not a merge rule.

### The collision guard

**The merge may not turn an unambiguous spine designation into an ambiguous
one.** A designation covering more than one record names a catalogue
granularity, so `docs/sid.md` § 4.1 drops it from the same-as graph entirely —
it keys no ledger row. Attaching an identifier a DIFFERENT record already holds
off the spine therefore deletes a working SID key from BOTH records and buys
nothing: the star stays findable under that identifier through the record that
holds it. p Eridani (the overlay attaches HIP 7751 to the HD 10361 component)
and Gl 277A (HIP 36626, which would go fully keyless and hard-fail allocation)
are the two cases the guard exists for; it fires on 37 cells in total.

Scored against the POST-merge assignment, so the four HD mutual swaps stay
legal — neither value gains an owner. That needs a fixpoint rather than one
pass: withholding one proposal can re-expose a value its partner had proposed
to vacate.

### Curated overrides, and what does NOT belong in them

`data/classic-ids/classic_id_overrides.tsv` pins one record's one identifier —
an explicit value, or empty for "keep the spine's". It is for the case
`docs/catalog-driver.md` § 4 names: review finding the CDS join wrong. It is
**empty today**, and two shapes deliberately stay out of it:

- an addition that would make another record's designation ambiguous is
  withheld mechanically by the guard above;
- a Gliese renumbering (`Gl 157.1` → CNS5's `GJ 9140`) is an IDENTITY bridge in
  `data/sid/sameas-overrides.tsv`, not a label exception — both designations
  name the star, and `gl:` is the canonical key of all five affected records,
  so the bridge is what keeps their sids through the rename.

## The designation constellation

`desigConIndex` (search-index `dc`) is the constellation a Bayer / Flamsteed
designation is NAMED for. It is fixed by nomenclature and does not migrate when
proper motion carries a star across a 1930 Delporte boundary, so it cannot be
derived from the record's position. The cascade:

```
IV/27A `cst` by HD -> by HIP -> GCVS trailing abbreviation -> positional conIndex
```

Keyed on the DESIGNATION, deliberately, where the label overlay is keyed on
`gaia_source_id`:

- A designation → designation cross index carries **no astrometric claim** — it
  says the star named HD 216956 is also named α PsA, never which Gaia source
  holds that star's photons — so it needs no binding gate.
- That is also the only way to reach the bright tier. Gaia saturates near
  G ≈ 3, so 117 records at V ≤ 3 have no overlay row at all, Fomalhaut among
  them, and their promoted companions compose names off them.
- Measured over the 3,303 spine rows carrying a Bayer or Flamsteed cell, the
  HD/HIP route covers 3,180 against the source_id route's 2,474, with zero
  disagreements and nothing the overlay reaches that it does not. One tier
  instead of two.

The 123 rows it misses are faint Flamsteed-only records absent from IV/27A's
TAP subset; they ride the positional fallback.

**GCVS fills the field only where IV/27A left it empty** (7,363 records). On the
8 where the two disagree the star carries a Bayer/Flamsteed designation and a
variable name in different constellations (HD 104337 is Crater's Flamsteed star
and Corvus's TY): one `uint8` serves one of them, and IV/27A wins because its
consumers COMPOSE the label out of this field, while a GCVS label reads the
constellation out of the designation string and loses only its expanded alias
(`../parse/gcvs/README.md`).

## Counts and the parity measurement

`classic-id-overlay-expected.json` pins the counts through the same
`compareBuildCounts` / `UPDATE_BUILD_COUNTS` machinery
`build-catalog.ts` uses (`assertOrUpdateSnapshot` in
`../../util/snapshot-assert.ts`). Four groups:

- **Input + route sizes** — upstream row counts, how many Tycho ids
  resolve, the HIP-route agree / disagree / HIP-only split. Pre-gate.
- **Overlay sizes** — rows, and per-identifier how many sources carry
  each designation, plus the multi-valued cardinalities. Post-gate.
- **`gate*`** — rows dropped per gate, and `gateSkippedNoHipVMag`, the
  population carrying no printed V under any HIP and so unvettable. That
  last one is the count to watch alongside
  `athygBrightRowsWithoutOverlayEntry`: it is where the known-unfixed
  mis-bindings live.
- **`label*`** — the merge's own per-identifier routing, which IS the label
  parity measurement: `labelAgree + labelFlipped + labelSpineOnly` is every
  record the spine labels and `labelAgree` is the subset the overlay
  reproduces, so coverage is a ratio of counts the build itself produced
  rather than a second walk that could disagree with the shipped labels. The
  same set is pinned in `../build-catalog-expected.json` from the record side.
- **`spine*`** — rows, no-source_id rows, rows with no overlay entry, and the
  bright-tier split of that last one.

Values compare on the merge's own normalisation: `gl` on its bare GJ number
(the `Gl`/`GJ` prefix and component suffix are display forms, and CNS5's
trailing `.0` on whole numbers is a formatting artifact — not collapsing it
scored 14 same-star pairs as disagreements), `flam` on the number alone (the
row is already keyed on one source_id, so a same-number-different-constellation
match is not reachable).

**That `.0` is a join hazard beyond the merge, and `normaliseGjKey`
(`../catalog-pure.ts`) is where it is handled once.** `cns5AstrometryByGj`
keys the direction cascade's `cns5` tier off these same cells, so an index
built over CNS5 and a record's own `gl` cell have to reduce identically or the
lookup misses — indistinguishably from an absent row. 17 rows carry the
artifact. It cost nothing when the tier shipped (all 17 route to the Tycho-2
tier above CNS5 on their own TYC), which is exactly why it needed collapsing
before something reached it. Only a ZERO fraction collapses; `Gl 17.1` keeps
its own. `glieseNumber` states the same rule for the label side, where it also
has to strip the component letter.

`spineBrightRowsWithoutOverlayEntry` is the count to watch: Gaia saturates near
G ≈ 3, so a source_id-keyed table structurally cannot carry the brightest
stars, and a future session reading a high `overlayHd` could otherwise conclude
the overlay replaces the spine's label columns outright.
