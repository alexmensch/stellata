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
                                  cascade's `cns5` tier, the PM rescue and the
                                  parallax cascade's `cns5_plx` tier alike, and
                                  no bare-number fold beneath it (§ The GJ fold
                                  stops at the component). This folder parses
                                  that file, ../distance/ routes on it. Its
                                  motion is a
                                  `CitedProperMotion` (../cited-proper-motion.ts)
                                  because 87% of CNS5's are Gaia's own
                                  republished and the rescue's skip rule needs
                                  the citation to see that; an uncited one is
                                  dropped whole, position intact. Its parallax
                                  is a `CitedParallax` (../cited-parallax.ts)
                                  for the same reason and on the same terms,
                                  carrying CNS5's own `e_plx_mas` so the
                                  cascade's precision floor has an error bar to
                                  read on this tier as on every other.
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
overlay asserts several values the field takes ONE for display and the rest go
to the record's alias list — `hdAlt` / `hrAlt`, queued as `extra-alias`. The
record answers to every one of them: they become extra keys on the search
index's `hdMap` / `hrMap` (`src/client/typeahead/README.md` § Star search) and
extra `hd:` / `hr:` designations in its same-as class (`docs/sid.md` § 4.1).
The overlay asserts 130 such values today (129 hd + 1 hr); **95 are carried**,
and which ones is the next section's rule.

**HD and HR are the only fields with an alias list**, and that follows from the
join rather than from today's data: HD numbered both components of many close
pairs, and the `hr` route resolves through `hd`. `sourcesWithMultipleGj` and
`sourcesWithMultipleFlamsteed` are 0 because a GJ carries its component letter
and a Flamsteed number names one star. `hip`, `gl` and `flam` therefore have
nowhere to put an extra and queue it as `extra-dropped` instead — a label the
record will not answer to.

### An alias stops at the blend

**A second HD number names the pair's other COMPONENT, not a second name for
one star**, so whether the record may answer to it turns on whether that
component is a record of its own. 14 Lyncis is the shape: the Henry Draper
survey photographed two spectra of a 0.3″ pair and numbered them 49618 and
49619, Tycho-2 carries the pair as the single entry TYC 3778-1982-1 (IV/25
flags it `n_hd=2`), and the overlay hangs both numbers on the one Gaia source
without saying which component is which. Three outcomes:

| Disposition | Values | When |
|---|---|---|
| `extra-alias` | 95 | the pair is unresolved — one record, both components' light |
| `extra-sibling-rendered` | 35 | the secondary is a record of its own, so the number is its |
| `extra-dropped` | 0 | the field has no alias list, or the guard withheld the value |

Where the pair is unresolved the single record **is** the granularity the
catalogue has, and answering to both numbers is accurate rather than sloppy:
**93 of the 95 have no `multiples.tsv` row at all**, so no separation, position
angle or component magnitude exists to split them with, and the two HD numbers
are the entire trace of duplicity. Where it IS resolved, 14 Lyn B holds its own
record and letting the primary claim 49619 would point the number at a star we
draw separately.

The predicate is `sourceIdsWithSiblingComponent`
(`../companions/companion-promotion.ts`), keyed on the `multiples.tsv` SYSTEM
rather than the source_id — a secondary routinely carries its own source_id or
none, so grouping by source_id misses the sibling on exactly the resolved pairs
this asks about. Promotion can still decline to render a member row, so the set
is a **superset** of what ships (35 withheld — 34 hd + the 1 hr — across the 34
records whose system names a sibling, of which 33 render one today), and
that direction is deliberate: withholding one alias too many is a reviewable
queue row, leaving one on the wrong record is a wrong answer. It must be derived
from the committed table by BOTH merge callers, or the two review queues stop
being byte-identical.

An alias also clears the collision guard's rule, which the guard itself cannot
apply: aliases are not display cells, so its tally never sees them, and an alias
equal to a value another record DISPLAYS would go ambiguous under
`docs/sid.md` § 4.1 and cost both records the key. Those are withheld to
`extra-dropped`. 0 fire today — measured, and now also guarded.

The **69** ambiguous designations `sid:allocate` still drops (57 `hd:`, 11
`hr:`, 1 `gl:`) are spine-side component pairs, unrelated to this list;
`../../sid/README.md` § Ambiguous designations carries the regenerating command.
No carried alias is among them, and none keys a ledger row, so the additions
cannot fuse two same-as classes or move a canonical key.

A promoted companion inherits neither list. The overlay names no component, so
handing the anchor's alternative HD to the companion would invent the very
attribution the table declines to make (`../companions/README.md` § Fields a
promoted record carries). Attributing each number to its component where
IV/27A's own columns disambiguate — 49618 carries HR 2520 and HIP 33048 where
49619 carries neither — is `stellata-3bsf.39`.

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

### The GJ fold stops at the component

`gj_comp` states a system's letters **combined** — Gl 423 is one entry reading
`ABCD` — so the exact `number+comp` key reaches no record, whose own cell names
a single component. Each letter therefore aliases onto its row, and an alias
never displaces a row that names that component outright.

**The fold stops there: no bare number is written from a component row.** What
this index carries is a position, a proper motion and a parallax as one bundle,
and the first two belong to one component. The tier below `cns5` in both the
direction cascade and the PM rescue is SIMBAD, which resolves per object — so
answering a bare `Gl 1294` with whichever component CNS5 lists first would
substitute a sibling's measurement for the star's own, from a *higher* tier.

The exposure is not hypothetical: **278 bare GJ numbers in the committed slice
are claimed by two or more rows**, 45 of them stating parallaxes more than 1%
apart (worst GJ 428, 17.4%), and on 102 the first row listed carries a wider
error bar than a sibling on the same number. GJ 1294 is the shape — component A
at 65.24 ± 1.76 mas against component B at 58.99 ± 0.02, which is 15.33 pc
against 16.95. **38 spine rows** carry a bare `gl` cell that such a fold would
reach.

```
awk -F'\t' 'NR>1 && $10!="" {gj=$2; sub(/\.0$/,"",gj); n[gj]++}
  END{for(k in n) if(n[k]>1) c++; print c+0}' data/classic-ids/cns5.tsv
```

Where lending a bound sibling's parallax IS right, the cascade has a tier for
it — `pair_member_parallax`, at the bottom, gated on anchor-grade fit quality
(`../distance/parallax/README.md`) rather than on file order.

V/70A's index *does* fold to the bare number
(`data/gliese/README.md` § The join key), and the asymmetry is deliberate: a V
read off a system entry is a blend that advertises itself as one
(`vTierIsSystemBlend`), and a parallax off it is a distance the components
share. Neither is true of a position.

`spineBrightRowsWithoutOverlayEntry` is the count to watch: Gaia saturates near
G ≈ 3, so a source_id-keyed table structurally cannot carry the brightest
stars, and a future session reading a high `overlayHd` could otherwise conclude
the overlay replaces the spine's label columns outright.
