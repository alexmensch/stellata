# The inherited spine — the record build's membership term

`data/athyg/inherited-spine.tsv` is one row per AT-HYG-derived record of the
final AT-HYG-driven build, carrying that record's resolved designation set
plus AT-HYG's printed cells. `readStars` walks it; membership is exactly
these rows. The contract is `docs/catalog-driver.md` § 3; why the spine is
load-bearing rather than a rare fallback is `data/classic-ids/README.md`
§ Coverage.

**The file is frozen and nothing regenerates it.** The one-shot generator
retired with the driver swap: it ran `readStars` over the AT-HYG CSV, and
that walk no longer exists — `readStars` reads this file instead.
`stellata-3bsf.8` replaces the spine by re-sourcing every record from the
primaries AT-HYG merged, which is a new artifact, not a regeneration of
this one.

## Files in this area

```
scripts/catalog/spine/
  inherited-spine-pure.ts         Column layout, row assembly, TSV codec,
    (+ test)                      per-column counts, and the designation
                                  recovery (spineDesignations). Pure, and on
                                  the build:catalog path — ../parse/ streams
                                  the walk's rows through iterSpineTsv;
                                  parseSpineTsv is the materialising form the
                                  two gates below need.
  inherited-spine-guard.test.ts   Assertions over the COMMITTED artifact —
                                  byte identity, counts, keyless rows, Sol,
                                  duplicate source_ids (§ Why a guard, not a
                                  rebuild).
  inherited-spine-parity.test.ts  Assertions against the BUILD the spine is a
                                  snapshot of — record count and designation
                                  multiset (§ Parity with the shipped build).
  inherited-spine-expected.json   Pinned count snapshot.
```

## Where each column comes from

`COLUMN_SPEC` in `inherited-spine-pure.ts` is the single ordered table
driving file layout, per-column origin, and the counts. Two origins:

- **`star`** — `hip`, `hd`, `hr`, `gl`, `flam`, `bayer`, `proper`,
  `gaia_source_id` come off the in-memory record, so they are the values
  the shipped build resolved: `gaia_source_id` has been through the native
  → HIP-cross-walk precedence and both binding gates, the three
  `multiples.tsv` HD-only primaries carry their backfilled HIP + source_id,
  and ξ UMa B carries the one written by the collocated-double merge. That
  is what makes the per-record designation set — and therefore every SID —
  identical by construction.
- **`printed`** — every other column is the AT-HYG cell **verbatim**, under
  its own upstream name. No parse/format round-trip, so the spine is a
  faithful slice of what AT-HYG printed and the file is trivially
  reproducible.

Rows are emitted in AT-HYG `id` order (readStars preserves CSV order), so
there is no sort key to disagree about.

`pm_ra` / `pm_dec` / `pm_src` are in the file although § 3's column list
predates them: the direction cascade's `athyg_printed` tier and the
space-motion velocity's `athyg_pm` tier both bottom out at AT-HYG's printed
proper motion (65 and 64 records respectively). A frozen artifact cannot
grow a column later, so they ship now.

## The membership gates still run, and must stay at zero

Every spine row already passed `readStars`' five drop gates in the build it
snapshots — no ra/dec, no distance, no direction, past `MAX_DIST_PC`, no V.
The walk keeps them, and each is pinned at **0** in
`build-catalog-expected.json` as `spineDroppedNoRaDec` / `…NoDist` /
`…NoDirection` / `…TooFar` / `…NoVMagnitude`: a refreshed Bailer-Jones or LMC
input that moves a row past the distance cutoff, or an astrometry table that
stops resolving a direction, is a disagreement between the spine and the
tables it was frozen against, and it fails the count assertion by name
instead of dropping a record the spine promised. `recordCount` would move
too, but it names the symptom rather than the gate.

## The identifier columns are read, never re-derived

`gaia_source_id` comes off the column. The native → HIP-cross-walk
precedence and both binding gates (G−V magnitude, sibling-letter
attribution) ran when the spine was generated, so re-running them in the
walk would re-decide a frozen binding against reference tables that have
moved since — and a scrubbed source_id changes the record's designation
set, hence its SID. `resolveGaiaSourceId` therefore has no caller on the
`build:catalog` path; it survives for `../export-astrometry-request.ts`
and the classic-ID overlay's own gate.

The classic-ID label merge is not an exception to this. It runs as a post-pass
over the walk's output and rewrites LABELS (`hip`/`hd`/`hr`/`gl`/`flam`) — never
`gaia_source_id`, and never before the direction / distance / V / spectral
cascades have keyed on the spine's frozen `hip`
(`../classic-ids/README.md` § The label merge).

**Four rows carry identifiers the frozen build resolved *after* its walk**:
the three `multiples.tsv` HD-only primaries `backfillPrimaryIdentifiers`
wrote (ξ UMa / HD 98231, ξ Sco / HD 144069, HD 75632), plus ξ UMa B's
source_id, written by companion promotion's collocated-double merge. Feeding
them into the walk is what makes each record's designation set — and so its
SID — identical by construction. It also routes those four records
differently from the build the spine snapshots, and **every count the swap
moved that is not a retired gate traces to these four**:

| Count | Δ | Which of the four, and why |
|---|---|---|
| `spectralBySimbad` / `spectralFallback` | +4 / −4 | all four: a source_id at walk time resolves SIMBAD sp_type in the walk instead of via the backfill's reclassify callback |
| `ciSpectralDerived` | +2 | ξ Sco and ξ UMa B — the two with an empty printed `ci` and no Apsis Teff, so the now-parseable class supplies the colour where classIdx=8 had fallen through to solar |
| `vPrintedHip` / `vCatalogued` | +3 / −3 | the three primaries: a HIP reaches the V cascade's printed tier |
| `multiplesIdentifierBackfill` | 3 → 0 | the three primaries: the pass finds its work already done |
| `companionAlreadyInCatalog` | +1 | ξ UMa B: its record now carries the source_id, so `findExisting` hits and the pair row returns early |
| `companionRepositionedCollocatedDouble` | 1 → 0 | ξ UMa B: that early return precedes the collocated-double merge, which is what used to write the source_id |
| `companionAbsmagWdsMagDerived` | −1 | ξ UMa B: the early return also precedes `imputeCompanionAbsmag` |
| `systemCoherenceSystems` | +1 | ξ UMa B: the coherence pass resolves members by source_id then HIP, so B used to collapse onto A's record on the shared HIP 55203 and the root never reached two members |
| `bjEligible` | −1 | none of the four — the one `tooFar` row the old walk counted as eligible before dropping it; the spine never carried it |

`../companions/README.md` § Anchor flux conservation carries the
consequence of the V-tier move: three records ship as unsplit blends.

## Why a guard, not a rebuild

Every other generated artifact in the repo has a CI step that regenerates
it and diffs (`multiples.tsv`, `classic_id_overlay.tsv`). The spine
deliberately does not: it is a **snapshot of the final AT-HYG-driven
build**, so a legitimate refresh of an upstream input (a new Bailer-Jones
pull moving one row past the distance cutoff) would make a regeneration
gate demand rewriting a file whose whole purpose is to stop moving.

`inherited-spine-guard.test.ts` is the substitute: it reads the committed
TSV and pins its byte length + sha256, the row count, the per-column fill
rates, one Sol record, no keyless row, and no duplicate source_id.
Determinism itself was verified at authoring time by generating twice and
comparing bytes.

The byte pin lives in the **test source**, not in
`inherited-spine-expected.json`: `UPDATE_BUILD_COUNTS=1` rewrites that
snapshot, so a regeneration would otherwise refresh its own guard. Editing
the two literals is what unfreezes the spine, and it shows up in review as
a diff in a test rather than in a 40 MB LFS blob.

## Parity with the shipped build

The spine is only worth freezing if it stands in for the build exactly, so
`inherited-spine-parity.test.ts` asserts that on both axes:

- **Record count**, from the two committed snapshots — `rows` here equals
  `recordCount` − `companionPromoted` in
  `../build-catalog-expected.json`. No artifacts and no LFS, so it runs in
  every job; a record-build change that moves `recordCount` without
  regenerating the spine fails here.
- **Designation multiset**, against the built artifacts — the
  `catalogRecordDesignations` walk (`../../sid/catalog-designations.ts`,
  the same one `sid:allocate` resolves against the ledger) over every
  non-`FLAG_BINARY_COMPANION_ONLY` record must tally identically to
  `spineDesignations` over the committed TSV, **replayed through
  `data/classic-ids/label_flips.tsv`**. Needs a built catalogue, so it runs in
  the `build-catalog` job and locally.

The classic-ID label layer moves designations off the spine's inherited cells
by design (`docs/catalog-driver.md` § 4), so the raw equality died with it. The
committed review queue is the COMPLETE enumeration of that delta — flips,
additions, suppressions and dropped extras — which is exactly why the gate
replays it instead of relaxing: "every departure from the spine's designation
set is accounted for" is the property that keeps every SID preserved by
construction, and a queue that failed to list one would fail this gate.

Membership itself stays tautological, which is the point: it IS the spine, so
that equality holds by construction and any future change that breaks it has
broken the membership term.

## The swap parity ledger

The instantiation of `docs/catalog-driver.md` § 6 for the driver swap,
audited 2026-08-09. Counts are pinned in `../build-catalog-expected.json`
unless another home is named; the committed gates are the two suites in
this folder plus `../classic-ids/parity-ledger.test.ts`.

- **Record parity — zero drops.** `recordCount` (329,657) is unchanged
  across the swap. Membership is exactly the spine, the five walk gates
  are pinned at 0 (`spineDropped*`), and `sid:check` resolves every
  record with zero mints — so the § 6.1 dropped list is empty and its
  reason enum has no rows. The only per-record routing deltas are the
  four-record set enumerated above.
- **Label parity — strict gain.** No previously-labeled record lost a
  label: per identifier the shipped coverage is the spine's keyed count
  plus the overlay's additions (hd +148, hr +4, gl +198, flam +69,
  hip +0). Every departure from the spine's cells is one of the 719
  disposed rows of `data/classic-ids/label_flips.tsv`, replayed exactly
  by the designation-multiset gate above.
- **Field parity.** The swap PR moved no field values beyond the
  four-record set: V and absmag moved one PR earlier under the V
  cascade, with the |ΔV| distribution measured per G bin against
  printed V (`../photometry/README.md` § Where the validity bound comes
  from) and `vVia` routing pinned. § 6.3's |Δabsmag| axis needs no
  second measurement: absmag is derived from that V on a distance the
  swap did not touch, so it moves by |ΔV| exactly. Spectral-string
  changes are the +4/−4 rows of the same four-record table; ci and rv
  are spine passthroughs until `stellata-3bsf.12`, which pins its own
  |Δci| distribution.
- **Identity events — five bridges, zero ledger writes.** The swap
  appended nothing to `data/sid/ledger.tsv`, `retirements.tsv` or
  `reinstatements.tsv`; there were no presence events (membership is
  1:1 with the prior build) and no merges or splits. The complete
  identity surface is the five CNS5 Gliese renumberings, bridged in
  `data/sid/sameas-overrides.tsv` — `parity-ledger.test.ts` pins that
  exact set and fails on any label change that moves an unbridged
  canonical key off its record.
- **Review queues, disposed.** The two queues the ledger owns. All 21
  HD/HIP route disagreements: one spine record holds both designations,
  the two cross-walks bind it to different components of a resolved
  pair, the HD route keeps label authority — no identity event
  (`data/classic-ids/hd_hip_route_disagreements_review.tsv`, joined
  row-for-row to the queue by the same test). The 14 HD-less V/50
  rows are non-stellar (novae/SNe, four clusters, M 31): out of scope
  by class, never records, pinned as an exact set. Both dispositions
  are backed against the spine rather than asserted — the join and the
  HR set would each stay green over a stale verdict otherwise.

  `rejected_bindings.tsv` is deliberately not on that list: its 187
  rows are the binding gate refusing to key a designation on a source
  that is not the star, so each leaves its record on the spine's label
  — no departure for the label term to carry, and no identity event to
  dispose (`data/classic-ids/README.md` § The binding gate).
