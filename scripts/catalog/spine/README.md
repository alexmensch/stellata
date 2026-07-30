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
                                  the build:catalog path — ../parse/ reads
                                  the walk's rows through parseSpineTsv.
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
The walk keeps them, and `build-catalog-expected.json` pins all five at
**0**: a refreshed Bailer-Jones or LMC input that moves a row past the
distance cutoff, or an astrometry table that stops resolving a direction,
is a disagreement between the spine and the tables it was frozen against,
and it surfaces there rather than as a silent record drop.

## The identifier columns are read, never re-derived

`gaia_source_id` comes off the column. The native → HIP-cross-walk
precedence and both binding gates (G−V magnitude, sibling-letter
attribution) ran when the spine was generated, so re-running them in the
walk would re-decide a frozen binding against reference tables that have
moved since — and a scrubbed source_id changes the record's designation
set, hence its SID. `resolveGaiaSourceId` therefore has no caller on the
`build:catalog` path; it survives for `../export-astrometry-request.ts`
and the classic-ID overlay's own gate.

Three of these rows carry identifiers the frozen build resolved **after**
its walk: the `multiples.tsv` HD-only primaries backfilled by
`backfillPrimaryIdentifiers`, plus ξ UMa B's source_id, written by
companion promotion's collocated-double merge. Feeding them into the walk
is what makes each record's designation set — and so its SID — identical
by construction, and it also routes those records differently from the
build the spine snapshots, since a HIP now reaches the direction cascade
and the V cascade's printed tier. `../companions/README.md` § Anchor flux
conservation carries the consequence.

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
  `spineDesignations` over the committed TSV. That is what makes every SID
  preserved by construction. Needs a built catalogue, so it runs in the
  `build-catalog` job and locally.

Both axes became tautological at the swap, which is the point: membership
IS the spine, so the equalities hold by construction and any future change
that breaks one has broken the membership term itself.
