# The inherited spine — AT-HYG's merge decisions, frozen

`data/athyg/inherited-spine.tsv` is one row per AT-HYG-derived record of the
final AT-HYG-driven build, carrying that record's resolved designation set
plus AT-HYG's printed cells. The contract is `docs/catalog-driver.md` § 3; why
the spine is load-bearing rather than a rare fallback is
`data/classic-ids/README.md` § Coverage.

**Two readers, and the record build is not one of them.** `readStars` walks
the membership manifest (`../membership/README.md`), which this file is an
input to and a baseline for. What the spine still supplies is the one thing no
primary does: **which designations name one star**. `build:membership` reads
it for those merge decisions, derives each row's Gaia binding from committed
evidence and holds the result against the frozen `gaia_source_id` column as a
diff surface (`../membership/README.md` § The binding is derived), and the
manifest's parity gate (i) reads it as the baseline every manifest row must
account for. After the swap release that baseline becomes the previous
manifest.

**The file is frozen, so a merge decision review finds wrong is corrected in
`data/membership/spine-corrections.tsv`** — a committed, evidenced row the
manifest applies — never by an edit here (`../membership/README.md`
§ Correcting a merge decision).

**Nothing regenerates it.** The one-shot generator
retired with the driver swap: it ran `readStars` over the AT-HYG CSV, and that
walk no longer exists. The manifest that supersedes it is a new artifact, not
a regeneration of this one; the rule it re-sources under, and the measurement
behind it, are `docs/catalog-driver.md` § 3.1 and § The primaries audit below.

## Files in this area

```
scripts/catalog/spine/
  inherited-spine-pure.ts         Column layout, row assembly, TSV codec,
    (+ test)                      per-column counts, and the designation
                                  recovery (spineDesignations). Pure, and off
                                  the build:catalog path entirely.
                                  iterSpineTsv streams for a single pass
                                  (the parity ledger's replay); parseSpineTsv
                                  materialises for the callers
                                  that index rows or walk them twice —
                                  build:membership, the audit, the guard, the
                                  manifest gate and ../astrometry-request/.
  inherited-spine-guard.test.ts   Assertions over the COMMITTED artifact —
                                  byte identity, counts, keyless rows, Sol,
                                  duplicate source_ids (§ Why a guard, not a
                                  rebuild), plus the stale-source_id queue
                                  (§ Six source_ids DR3 does not publish).
  inherited-spine-expected.json   Pinned count snapshot.
  primaries-audit-pure.ts         The retirement's measurement: per-row
    (+ test)                      designation attestation against the
                                  frozen primaries, source_id reproduction
                                  from the raw cross-walks with SIMBAD's
                                  cross-IDs as the witness, and the records
                                  the primaries admit that the spine lacks.
  primaries-audit.ts              `pnpm run audit:spine-primaries` — prints
                                  the report; --out=<dir> writes every row
                                  behind every count (§ The primaries audit).
  primaries-tables.ts             Loads the frozen primary tables the audit
                                  and ../membership/ both measure against —
                                  one table set for both instruments — plus
                                  the gl: ↔ gl: bridges of
                                  data/sid/sameas-overrides.tsv.
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
predates them: a frozen artifact cannot grow a column later, so they shipped
against a need that might arise, and for the same reason they stay. Nothing
reads them.

## The identifier columns are read, never re-derived

The classical cells come off the column and the manifest re-keys them; the
`gaia_source_id` cell is the one column the manifest **does not** copy. The
generator derives each binding from the TYC and HIP cross-walks, CNS5 and
SIMBAD's cross-IDs through both binding gates, and reads the frozen cell only
to diff against (`../membership/README.md` § The binding is derived). The
native → HIP-cross-walk precedence that produced the frozen column took
AT-HYG's own `gaia` cell as its first input, which is not in the repo, so no
walk order reproduces it; the derivation is a fresh answer held against it,
not a replay of it.

What that answer decides differently is measured rather than feared:
§ The primaries audit puts the frozen column at 11,731 bindings no **raw walk**
reaches or agrees with, and 233 empty cells a raw walk would fill. **233 is the
walk-only figure.** The derivation adds SIMBAD's cross-IDs as a fourth source,
which settles 11,687 of the 11,721 the walks cannot reach and takes the fills
to 940 ungated, 791 after both gates — a reader scoping off 233 under-budgets
by four. The manifest's `derivedVsFrozen` count carries the full comparison.

**Four rows carry identifiers the frozen build resolved *after* its walk**:
the three `multiples.tsv` HD-only primaries it stamped from their
pair-primary rows (ξ UMa / HD 98231, ξ Sco / HD 144069, HD 75632), plus
ξ UMa B's source_id, written by companion promotion's collocated-double
merge. Feeding
them into the walk is what makes each record's designation set — and so its
SID — identical by construction. It also routes those four records
differently from the build the spine snapshots, and **every count the swap
moved that is not a retired gate traces to these four**:

| Count | Δ | Which of the four, and why |
|---|---|---|
| `spectralBySimbad` / `spectralFallback` | +4 / −4 | all four: a source_id at walk time resolves SIMBAD sp_type in the walk instead of in a re-classification after it |
| `ciSpectralDerived` (now `ciVia.spectral_derived`) | +2 | ξ Sco and ξ UMa B — the two with an empty printed `ci` and no Apsis Teff, so the now-parseable class supplied the colour where classIdx=8 had fallen through to solar. **At the swap only:** `stellata-3bsf.12` put a Gaia relation above that tier and the same pull reached these sources, so both now route `ciVia.gaia_relation` and neither is in the 279 (`../photometry/README.md` § The ci cascade) |
| `vPrintedHip` / `vCatalogued` | +3 / −3 | the three primaries: a HIP reaches the V cascade's printed tier |
| `companionAlreadyInCatalog` | +1 | ξ UMa B: its record now carries the source_id, so `findExisting` hits and the pair row returns early |
| `companionRepositionedCollocatedDouble` | 1 → 0 | ξ UMa B: that early return precedes the collocated-double merge, which is what used to write the source_id |
| `companionAbsmagWdsMagDerived` | −1 | ξ UMa B: the early return also precedes `imputeCompanionAbsmag` |
| `systemCoherenceSystems` | +1 | ξ UMa B: the coherence pass resolves members by source_id then HIP, so B used to collapse onto A's record on the shared HIP 55203 and the root never reached two members |
| `bjEligible` | −1 | none of the four — the one `tooFar` row the old walk counted as eligible before dropping it; the spine never carried it |

`../companions/README.md` § Anchor flux conservation carries the
consequence of the V-tier move: three records ship as unsplit blends.

## Six source_ids DR3 does not publish

Six rows carry a Gaia **DR2** id in the column the pipeline reads as DR3,
so the 5p pull has no row for them however the request is composed. They
are enumerated with their DR3 status in
`data/athyg/stale_gaia_source_ids.tsv`, and three assertions here keep that
queue honest: it is exactly the spine's unpublished source_ids, every one
of them reaches the SIMBAD values pull, and no successor id it names is
itself a spine cell — which would put two records on one SIMBAD row and
trip the values parser's duplicate-key throw.

Why the cells stay as they are, and what the manifest carries for each of the
six: `data/athyg/README.md` § Six DR2 ids in the DR3 column.

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

## Parity is the manifest's gate now

`../membership/membership-manifest-gate.test.ts` is where the spine is held
against the shipped build: its **(i)** resolves every spine row to exactly one
manifest row, and its **(iii)** tallies the built catalogue's designation
multiset against the manifest less the parked ledger. Together those chain the
spine to the records that ship, which is what the retired
`inherited-spine-parity.test.ts` did directly.

The property both rest on: **every departure from the spine's designation set
is accounted for by an enumerated file**, never by a relaxed comparison. The
classic-ID label layer moves designations off the spine's inherited cells by
design (`docs/catalog-driver.md` § 4), and `data/classic-ids/label_flips.tsv`
is the COMPLETE enumeration of that delta — flips, additions, suppressions and
dropped extras. That is what keeps every SID preserved by construction, and a
queue failing to list one departure fails the gate.

The ledgered drops are subtracted by **key**, not by count: a ledger row is
matched on the whole five-cell identifier tuple
(`tyc`/`hip`/`hd`/`gl`/`gaia_source_id`), so a park with no identifier at all
is still named by the empty tuple rather than left to a guess about which id
identifies. `../distance/parallax/parked-ledger.ts` holds the closed reason
enum, pinned by its own test. What pins the ledger's *rows* is the
reproduce-and-diff step on `data/membership/parked-ledger.tsv` in the
`build-catalog` job — `build:catalog` writes that file, so without the diff a
build parking a different star for the same total would land silently.

## The primaries audit

`pnpm run audit:spine-primaries` measures the spine against the frozen tables
AT-HYG merged — IV/25, V/50, IV/27A, CNS5, V/70A, I/239, HIP2, the WGSN
tables, Tycho-2 and the two DR3 best-neighbour walks — and is the evidence
behind `docs/catalog-driver.md` § 3.1, which owns the decisions. Three
questions, one pass over the rows:

- **Attestation** — for each classical cell (`hd` `hr` `hip` `gl` `bayer`
  `flam` `proper`), which primary publishes it: HD by IV/25, then V/50, then
  I/239's own `HD` column. A row none of whose carried cells is attested
  exists on AT-HYG's authority alone. **0 rows** do; 167 carry one
  unattested *label* (1 HDE number, 120 Flamsteed cells, the 46 disposed
  proper names — `../membership/README.md` § The spine side disposes them).
- **Identity** — the spine's `gaia_source_id` against what the raw TYC / HIP /
  CNS5 walks bind, pre-gate. 300,155 agree, 11,721 no walk reaches, 10 a walk
  contradicts; on 11,697 of those 11,731 SIMBAD's object for the same id
  carries the record's own TYC, HIP or bare GJ number, 16 name a different
  designation, 12 have no object, 6 no cross-id. A GJ compares on its bare
  number because SIMBAD names a Gaia source by the system entry where the
  record names the component, and through the `gl:` ↔ `gl:` bridges of
  `data/sid/sameas-overrides.tsv` in both the CNS5 walk and the SIMBAD
  witness — CNS5's `GJ 9140` row answers for `Gl 157.1`.
- **Additions** — what the primaries admit that no spine row carries, per
  table: 60,344 IV/25 stars by TYC (55,008 below HD 100,000, the AT-HYG link
  defect § 3.1 explains), 566 I/239 HIPs, 3,362 CNS5 census rows, 90 IV/27A
  and 103 V/50 rows — the latter being 89 bright-double secondaries plus the
  14 non-stellar V/50 entries § 3.1 rules out by class.

**The unverified residual is zero, not small.** The 34 bindings the Identity
bullet leaves uncorroborated — its 16 + 12 + 6 — each carry a committed
review disposition with the measurement behind it
(`../membership/README.md` § The spine side), and the Attestation bullet's
**0 rows** says the same of the classical cells. So no row of this file exists
on AT-HYG's authority alone, on either question the pass asks — frozen here
means examined and then held, not taken on trust.

**`flam` is compared by value, `bayer` only by star.** A Flamsteed cell
counts as sourced only where IV/27A or WGSN publishes *that number* for the
record's HD/HIP; a Bayer cell counts where those tables publish *any* Bayer
designation for the star, because HYG's `Alp-1` and IV/27A's `alf01` meet
only through the naming ladder's normalisers, which are `../naming/`'s to
own. The value check is what makes the Flamsteed residual 120 rather than
115 — § 3.1 names the five it separates.

The audit also reads `data/athyg/athyg_33_classic_ids.csv` for one
measurement, the HD-provenance split behind the link defect. It is the only
reader of that file outside CI, and it is not on the `build:catalog` path.

The counts are measured, not pinned: the audit is a design-gate instrument
and the swap's own gate (§ 3.1's manifest) is what will hold them. Re-run it
with `--out=<dir>` to get the rows before trusting a number quoted here —
every count above has a file, `attestation.tsv` carrying one row per spine
row with the primary behind each of its cells.

## The swap parity ledger

The instantiation of `docs/catalog-driver.md` § 6 for the driver swap,
audited 2026-08-09. Counts are pinned in `../build-catalog-expected.json`
unless another home is named; the committed gates are
`inherited-spine-guard.test.ts` here, `../membership/`'s manifest gate and
`../classic-ids/parity-ledger.test.ts`.

- **Record parity — zero drops.** `recordCount` was unchanged across the
  swap itself. The figure it held then is not quoted here: it has moved
  twice since — the value-half children park rows, and the manifest admits
  63,672 more — and quoting it invites a later reader to take it for the
  count before some other change. `../build-catalog-expected.json` is
  always the live one. Membership was exactly the
  spine, every walk gate read 0, and `sid:check` resolved every
  record with zero mints — so the § 6.1 dropped list was empty and its
  reason enum had no rows. The only per-record routing deltas are the
  four-record set enumerated above. The value-half children have since
  opened that list: retiring the printed `dist` cell parks the rows no owned
  parallax reaches (`../distance/parallax/README.md` § Why the residual drops
  rather than degrading), which is the first non-empty dropped list this
  ledger has carried and the reason the parity gate subtracts it.
- **Label parity — strict gain.** No previously-labeled record lost a
  label: per identifier the shipped coverage is the spine's keyed count
  plus the overlay's additions (hd +149, hr +4, gl +200, flam +67,
  hip +0). Every departure from the spine's cells is one of the 725
  disposed rows of `data/classic-ids/label_flips.tsv`, replayed exactly
  by the designation-multiset gate above.
- **Field parity.** The swap PR moved no field values beyond the
  four-record set: V and absmag moved one PR earlier under the V
  cascade, with the |ΔV| distribution measured per G bin against
  printed V (`../photometry/README.md` § Where the validity bound comes
  from) and `vVia` routing pinned. § 6.3's |Δabsmag| axis needs no
  second measurement: absmag is derived from that V on a distance the
  swap did not touch, so it moves by |ΔV| exactly. Spectral-string
  changes are the +4/−4 rows of the same four-record table. ci and rv
  were spine passthroughs at swap time and are no longer: both took a
  Gaia-native tier above the printed cell in `stellata-3bsf.12`, which
  carries its own |Δci| measurement (`../photometry/README.md` § The ci
  cascade) and its own per-tier routing pins.
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

  `rejected_bindings.tsv` is deliberately not on that list: its 268
  rows are the binding gate refusing to key a designation on a source
  that is not the star, so each leaves its record on the spine's label
  — no departure for the label term to carry, and no identity event to
  dispose (`data/classic-ids/README.md` § The binding gate).

### The derived-binding ledger

The § 6 instantiation for the manifest deriving its `gaia_source_id` instead
of copying this file's column (`../membership/README.md` § The binding is
derived), measured 2026-09-08 by diffing the built catalogue against the one
built from the copied column, records matched on their canonical designation.
That baseline also predates the four manifest-derived re-pulls
(`../../refresh/README.md` § The staleness gate), so a move below carries both
the new binding and the table row it can now reach; two records whose binding
never changed move for the second reason alone.
Pins: `derivedVsFrozen` and the review counts in
`../membership/membership-manifest-expected.json`; per-tier routing in
`../build-catalog-expected.json`.

- **Record parity.** 794 records changed binding: 789 gained a source, 4
  swapped one (the DR3 successors of three DR2 ids and HD 2094 following its
  HIP onto the primary), 1 lost one (HD 253820, an IV/25 addition whose walk
  source a spine row now derives). Two records park that shipped before —
  HD 225284 and HIP 46653 gained a 2-parameter source, so their SIMBAD
  parallax now falls to the Gaia-bibcode skip rule
  (`refused_no_defensible_parallax`) — and HIP 114929 un-parks. Both are
  presence events; the SIDs hold. **Eight identity events**: AT-HYG carried
  eight Gaia sources as rows of their own beside the HIP record each belongs
  to, and the derived binding joins the classes — the Gaia-keyed twin retires
  with the HIP SID as successor (`data/sid/retirements.tsv`, the same shape as
  the three sibling-letter merges before it). One `synth:` key re-letters
  (HD 98278's collocated B and C pair rows promote as one record under B,
  bridged in `data/sid/sameas-overrides.tsv`) and one promoted companion mints
  (HD 126862 Ab). Zero keys move: every one of the 794 keys on a HIP, HD or GJ.
- **Field parity, over the 794.** |ΔV| p50 **0.050** · p99 0.932 · max
  1.639; |Δabsmag| p50 **0.079** · p99 1.661 · max 5.526; |Δci| p50 **0.041**
  · p99 0.331 · max 1.120. 212 distances move (|Δd|/d p99 0.62, max 8.76),
  428 positions (p99 0.83″, max 11.6″ — HIP 26500, whose Tycho-2 position was
  a blend's), 50 spectral strings. Multiplicity carries a share of it:
  `multiplicityUnresolved` +81, `multiplicityResolved` +39, `ccdmFlagged` +68,
  `componentDesignations` +35, `binaryPairs` +14, `renderableCompanionWinged`
  +1, all of them record fields — byte 96 drives the chart-mode wings, so a
  gained binding reaches the multiplicity term and not only photometry.
  The median V move is the Riello transform replacing a printed cell, inside
  the transform's σ; the tail is not the binding but the tiers behind it — a
  converged-looking G on an unconverged astrometric fit (HIP 23617: RUWE 19.7,
  `ipd_frac_multi_peak` 70, a 1.25 ± 0.83 mas parallax at S/N 1.5 against
  HIP2's 5.84 ± 0.45, and a Bailer-Jones posterior of 1671 pc on it — where
  the parallax measures nothing the prior answers instead, so the layer that
  exists to absorb low S/N widens the error rather than absorbing it, and this
  row is the ledger's largest |Δabsmag|), or a blended source whose BP/RP feed
  the V transform (HIP 35261, `ipd` 84, |ΔV| 1.34). Neither cascade gates its
  Gaia tier on fit quality; that is `stellata-3bsf.49`'s question, with these
  rows as its corpus.
- **The review queue is disposed** — 54 rows, § The spine side of
  `../membership/README.md` — and `sid:check` is clean.
