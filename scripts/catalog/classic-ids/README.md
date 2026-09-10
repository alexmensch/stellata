# Classic-ID overlay build

Joins the four frozen CDS classic-designation tables onto Gaia DR3 source_ids
and writes `data/classic-ids/classic_id_overlay.tsv`. Contract:
`docs/catalog-driver.md` § 2 (sources), § 4 (HD route, ambiguity, precedence)
and § 5 (the designation-constellation cascade); measured coverage, and why the
inherited spine is load-bearing beside it, `data/classic-ids/README.md`
§ Coverage.

Two entry points, and they split cleanly: **this build joins the overlay,
`build:membership` applies it.**

- `pnpm run build:classic-ids` regenerates the committed overlay and its two
  gate queues, asserted byte-identical in CI. It reads no spine, merges nothing.
- `build:membership` runs `mergeClassicIdLabels` as it assembles each manifest
  row, keyed on the binding it derived, and writes
  `data/classic-ids/label_flips.tsv` (`label-merge/README.md`). The record
  build reads the merged cells off the manifest and applies only
  `applyDesignationConstellations` (§ The designation constellation).

## Subfolders

- `label-merge/` — the per-identifier rule that turns this overlay and the
  spine's cells into the manifest's final labels, with the collision guard,
  the curated overrides and the review queue. Imports this folder's overlay
  codec; nothing here imports back.

## Files in this area

```
scripts/catalog/classic-ids/
  build-classic-id-overlay.ts     I/O orchestrator: reads the frozen tables,
                                  both Gaia cross-walks and the gate's three
                                  evidence tables, writes the overlay and its
                                  two gate queues, and asserts the count
                                  snapshot.
  binding-candidates.ts (+ test)  The cross-walk loaders, and the source_ids
                                  the gate can weigh — shared with
                                  ../astrometry-request/, which pulls a G for
                                  every one (§ The gate's evidence has to be
                                  pulled). `BindingCandidateEvidence` states
                                  every table the walk reads and defaults
                                  none: a partial bundle would narrow the set
                                  to the HIP tier while the gate kept weighing
                                  three. The test derives its expectation from
                                  the source_ids a built overlay's gate ASKED
                                  a G for, so a change to what makes a row
                                  gateable fails rather than silently
                                  shrinking the request.
  binding-evidence.ts             Loads the gate's evidence tables — G per
                                  source, the V cascade's three printed tiers
                                  (Hipparcos, Tycho-2, Gliese), SIMBAD's WDS
                                  component cross-IDs — for this build and for
                                  ../membership/, whose derivation weighs its
                                  candidates through the same gates.
  classic-ids-parse.ts (+ test)   The four frozen-TSV parsers, plus the
                                  curated IV/27A corrections and their
                                  application. The gate's
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
                                  that file, ../distance/ routes on it. Motion
                                  and parallax arrive as a
                                  `CitedProperMotion` / `CitedParallax`
                                  (../cited-proper-motion.ts,
                                  ../cited-parallax.ts) so the skip rules can
                                  read the citation, and the parallax carries
                                  CNS5's own `e_plx_mas` — why each matters,
                                  data/classic-ids/README.md § The astrometry
                                  re-slice.
  cns5-fixture.ts                 Test-only Cns5Row / Cns5Astrometry builders.
                                  A module, not a test-file export: four suites
                                  across two folders build these, so a new
                                  column lands in one place.
  classic-id-overlay-pure.ts      The join, the binding gate, its counts, and
    (+ test)                      the overlay TSV codec (both directions).
                                  Pure.
  cross-index.ts                  IV/27A as every consumer reads it: the
                                  frozen table with
                                  cross_index_corrections.tsv applied
                                  (§ One designation, two HD numbers). Four
                                  call sites take it — this build, the
                                  designation-constellation pass, ../naming/'s
                                  Bayer union and ../spine/primaries-tables.ts
                                  — so no reader can miss a correction.
  designation-constellation-pure.ts
                                  IV/27A's `cst` keyed by HD/HIP — the
                                  constellation a Bayer / Flamsteed
                                  designation is NAMED for. Pure.
  apply-designation-constellation.ts
                                  The record build's one remaining classic-ID
                                  pass: loads IV/27A's cross-index and applies
                                  designation-constellation-pure to the Star
                                  array. The label merge does NOT run here —
                                  the manifest's cells are already final
                                  (label-merge/README.md).
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
                                  ledger). Also the withheld-sibling-HD ratchet
                                  (label-merge/README.md § A withheld number
                                  attaches to no record).
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

**HD routes entirely through TYC.** Every HD-bearing AT-HYG row also carries a
TYC (audit 2026-07-27), so the HIP route is a cross-check: on a disagreement
the HD route keeps the label and the row queues (`data/classic-ids/README.md`).

**Every route above is an unvetted best-neighbour walk, so the assembled
overlay is then gated** — `applyBindingGate` re-runs the record build's own
`resolveGaiaSourceId` checks and drops any row whose source_id is not the
star its designations name (460 rows today). It runs BEFORE the counts, so
every `overlay*` count and `hdOnMultipleSources` describe the artifact while
the route counters above stay pre-gate and keep describing upstream
reachability. Rationale, the two canonical cases, and the bound on the
gate's reach: `data/classic-ids/README.md` § The binding gate.

### The gate's evidence has to be pulled

The magnitude check compares a candidate's `phot_g_mean_mag` against the row's
printed V, taken in **the V cascade's own tier order** — Hipparcos on the
brightest of the row's HIPs, else Tycho-2's `VT − 0.090(BT − VT)` on the Tycho
entries IV/25 routes to this source, else Gliese on its GJ cells
(`../photometry/README.md` § The V cascade). One helper, `printedVBelowHip`,
serves both binding gates over one `printedVLookups` bundle — a loose callback
pair is how a call site supplies half the evidence — because
`docs/catalog-driver.md` § 4 says the label
side and the record side must not drift on what counts as a bad binding — and
until the lower two tiers landed here they drifted on evidence *reach*, with
the label gate weighing 99,799 rows against the derivation's whole spine.

The `G` comes from `data/gaia/gaia_dr3_astrometry_catalog.tsv`, and **`gMagOf`
returning null is not a rejection — it is a pass.** So a candidate the
astrometry pull does not cover is not merely unvetted, it is silently
accepted.

Candidates are not spine rows. A route resolves a designation to whatever
source a cross-walk names, and the gate exists precisely because that source
is often not the star, so the request has to carry them explicitly:
`../astrometry-request/README.md` § The request is a union.

`gateRejectedMag` measures the difference directly, and it is the count to
watch if this request ever changes again. Today the union pulls evidence for
every candidate and the queue reads **460** rows
(`data/classic-ids/README.md` § The binding gate); a membership-column-only
request drops `gateRejectedMag` to **0**, every candidate unvettable and
silently accepted. `reason` is the first gate that fired, so the two reason
counts trade rows without any binding changing verdict.

**The sibling-letter arm keys on a HIP and the magnitude arm does not**, so
widening the V evidence widened only the second: `gateRejectedSibling` holds
at 50 across the change while `gateRejectedMag` went 218 → 410. A row with no
HIP passes `null` to `resolveGaiaSourceId`, exactly as the record side passes
its own empty cell — passing `0` instead applies a gate here that the
derivation does not apply there, and read 692 rejections rather than 50.

**Two counts say whether the evidence actually arrived**, because a missing `G`
is a pass either way and only one of the causes is fixable:

| Count | Today | Meaning |
|---|---|---|
| `gateSkippedNoGMag` | **0** | gateable rows the pull returned no row for — the request under-covering its candidates. Pinned at zero; this is the fault the union exists to prevent. |
| `gateSkippedNullGMag` | 112 | rows Gaia has, with `phot_g_mean_mag` null. Silently accepted too, and no request can supply it — the residual the gate's reach does not cover. |

`gateableVia` partitions the rows the gate could weigh by which tier supplied
their V — **hip 99,799 · tycho2 254,135 · gliese 1,053** — and
`gateSkippedNoPrintedV` is what is left: **2,738** rows no printed tier reaches
at all. `bindingCandidateSourceIds` applies the same reach, so the request and
the gate agree by construction and `gateSkippedNoGMag` stays pinnable at zero.
The membership derivation runs the same checks on the record side through the
same `resolveGaiaSourceId` call, with its own candidate contribution to the
request and its own zero-pin (`../membership/README.md` § The binding is
derived).

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

## One designation, two HD numbers

IV/27A gives one Bayer or Flamsteed designation to several HD numbers on **75
Bayer and 110 Flamsteed** designation groups, and nearly all of them are a
close pair whose components the survey photographed separately. That is not a
defect: the naming ladder appends the component letter, so 40 Eri B, χ Aql B
and β Lyr B compose distinct labels from their primaries'
(`../naming/README.md` § Two callers, one composer).

The defect is the pair IV/27A joins that is **not one system**, where no
component letter exists to tell the two apart and both records compose the
identical label. `data/classic-ids/cross_index_corrections.tsv` is where
review says so, keyed on the HD whose row leaves the table and naming the HD
the designation belongs to; `readCrossIndexTable` applies it, so the join, the
designation-constellation pass, the naming ladder's Bayer union and the
primaries audit all read the corrected table. Two rows today (23 Ori and
104 Aqr), each backed by V/50 membership, SIMBAD's own identification and the
two stars' distances, and each removing one row of
`../naming/naming-duplicates.tsv`.

`applyCrossIndexCorrections` hard-fails on a correction that would do nothing
(the `hd` states no designation) or would orphan one (`belongs_to` does not
state the identical cells), because a curated file that silently does nothing
is worse than none — the same discipline `../membership/README.md`
§ Correcting a merge decision states for spine corrections.

**A mechanical discriminator was measured and NOT adopted.** Of the 185 groups,
41 have exactly one member V/50 carries an HR for, and on every one of those 41
SIMBAD agrees that member is the star the designation names (checked live,
2026-09-09 — the HR-bearing HD resolves to the bare designation or to its A
component, the others to a lettered component or to a different object). But
stripping the designation from the other members would take it off 11 genuine
lettered components that display it correctly today, so the rule buys nothing
the composer does not already do and costs real labels. `stellata-3bsf.43`'s
own proposal — *exactly one member carries a HIP* — is **refuted** rather than
merely narrow: on ε Boo it fires and picks the wrong star, because IV/27A gives
HIP 72105 to HD 129988 (ε Boo B) while SIMBAD, V/50 and the record's own
`proper` cell all put the designation on HD 129989 (Izar).

## The designation constellation

`desigConIndex` (search-index `dc`) is the constellation a Bayer / Flamsteed
designation is NAMED for. It is fixed by nomenclature and does not migrate when
proper motion carries a star across a 1930 Delporte boundary, so it cannot be
derived from the record's position. The cascade:

```
IAU WGSN designation -> IV/27A `cst` by HD -> by HIP
  -> GCVS trailing abbreviation -> positional conIndex
```

The authority tops it because it states which constellation its OWN
designation is named for; this folder's route runs beneath it and is what
carries the Flamsteed-only records the authority does not reach
(`../naming/README.md` § The designation constellation).

Keyed on the DESIGNATION, deliberately, where the label overlay is keyed on
`gaia_source_id`:

- A designation → designation cross index carries **no astrometric claim** — it
  says the star named HD 216956 is also named α PsA, never which Gaia source
  holds that star's photons — so it needs no binding gate.
- That is also the only way to reach the bright tier: Gaia saturates near
  G ≈ 3, so most records at V ≤ 3 have no overlay row at all, Fomalhaut among
  them (`data/classic-ids/README.md` § Coverage).
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
`../../util/snapshot-assert.ts`). Three groups:

- **Input + route sizes** — upstream row counts, how many Tycho ids
  resolve, the HIP-route agree / disagree / HIP-only split. Pre-gate.
- **Overlay sizes** — rows, and per-identifier how many sources carry
  each designation, plus the multi-valued cardinalities. Post-gate.
- **`gate*`** — rows dropped per gate, `gateableVia` per printed tier, and
  `gateSkippedNoPrintedV`, the population no tier reaches and so unvettable.
  That last one is the count to watch alongside `../membership/`'s
  `spineBrightRowsWithoutOverlayEntry`: it is where the known-unfixed
  mis-bindings live.

The merge's own counts are `label-merge/README.md` § What the merge compares
values on.

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
