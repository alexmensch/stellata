# Stage 1 — the reference catalogues, loaded

The TypeScript Stage 1 of the binaries pipeline: every reference catalogue
read through its declaration ([Declaring a source](../../util/sources/README.md#declaring-a-source)),
then the Stage 1 passes over them, returned as one frozen `ReferenceCatalogs`
for Stage 2 to resolve; `../build-binaries.ts` calls it. What each pass
decides, and why: [Sub-pair synthesis](#sub-pair-synthesis),
[Blank-components rescue](#blank-components-rescue), and the magnitude gate
under [What each tier decides](../resolve/README.md#what-each-tier-decides).

## Files in this area

```
scripts/binaries/load/
  reference-catalogs.ts        loadReferenceCatalogs (the reads) and
                               assembleReferenceCatalogs (the passes, pure),
                               ReferenceCatalogs, ROW_BANDS, stage1Counts.
  assemble.test.ts             The passes over fixtures: order, outcomes,
                               counts, bands.
  stage1-report-pure.ts        The build-log lines, read off the result;
                               the AT-HYG Gaia-coverage warning band.
  msc-pure.ts (+ test)         The MSC tables, the label → WDS token map,
                               the MscLookup, and the MSC element checks
                               (period, t0, renderable).
  msc-source.ts                MSC_SYSTEMS, MSC_ORBITS, MSC_COMPONENTS.
  curated-pure.ts              The three hand-curated tables.
  curated-source.ts            ORB6_COMPONENT_OVERRIDES,
                               COMPONENT_SPTYPE_OVERRIDES,
                               ASTROMETRY_EXCLUSIONS.
  gaia-pure.ts                 The 5p astrometry pull and the NSS orbit
                               columns; NSS_SOLUTION_KINDS, one table naming
                               what each solution type's columns constrain,
                               which Stage 4 converts by.
  binaries-astrometry-source.ts  BINARIES_ASTROMETRY (gaia_dr3_astrometry.tsv).
  simbad-pure.ts               SIMBAD's WDS cross-IDs, the sp_type pull, and
                               their join on simbad_oid.
  simbad-wds-sptype-source.ts  SIMBAD_WDS_SPTYPE.
  athyg-pure.ts                The AT-HYG rows, off ATHYG_CLASSIC_IDS.
  readers-pure.test.ts         The curated, Gaia, SIMBAD, AT-HYG and MSC
                               readers.
  indices-pure.ts (+ test)     IdentifierIndices, the CCDM index, and the
                               magnitude gate (scrubAthygGaia, and the HIP
                               cross-walk's inside buildIndices).
  subdivide-pure.ts (+ test)   The curated ORB6 letters, the ORB6 orphan
                               pairs, the MSC inner pairs; subResolutionPair,
                               the row every synthesized pair is, Stage 3's
                               NSS inner pairs included.
  blank-rescue-pure.ts         The blank-components rescue.
    (+ test)
  load-fixture.ts              Test-only row builders (the WDS and ORB6
                               ones are ../../wds/wds-fixture.ts).
```

The real-data case is the parent folder's `build-binaries.test.ts`.

## Where each input comes from

Seventeen inputs. Eight are declared here. The WDS summary and ORB6 are
declared in [`../../wds/`](../../wds/README.md), which the SIMBAD WDS cross-ID
pull reads too, with the duplicate-row collapse and `measuredOffset`. Seven are files the catalogue build
reads too, read through **its** declaration, never a second one: AT-HYG
(`../../catalog/spine/`), HIP↔CCDM (`../../catalog/multiplicity/`), HIP2 and
the NSS table (`../../catalog/sources/`), the two Gaia best-neighbour walks
(`../../catalog/parse/`), and SIMBAD's WDS cross-IDs
(`../../catalog/membership/binding/`). Where the two builds want different
columns of one file, the declaration returns a column table and each reader
keeps its own parse ([Reading a table](../../util/tsv/README.md#reading-a-table)).

## The order of the passes

`assembleReferenceCatalogs` runs them in this order, because each reads the
one before:

1. Collapse duplicate WDS rows; stamp the curated ORB6 letters.
2. Synthesize the ORB6 orphan pairs, from the curated ORB6.
3. Drop the curated astrometry exclusions, then the magnitude gate empties
   refused AT-HYG `gaia` cells; the indices are built from the scrubbed rows.
4. Rescue blank-components rows, over the WDS rows and the orphans (an orphan's
   donor row is not rescued), and align blank ORB6 rows to AB.
5. Synthesize the MSC inner pairs, which see the rescued AB rows.

`pairs` is the WDS rows, then the orphans, then the MSC inner pairs — the
list Stage 2 walks.

## How the readers read

The cell rules are the one reader's
([Reading a table](../../util/tsv/README.md#reading-a-table)): a missing
column throws, an empty cell is absent, and a non-empty cell that does not
parse throws, naming file, line and column. The fixed-width WDS and ORB6
fields read the same way, plus their own sentinels
([How the readers read](../../wds/README.md#how-the-readers-read)). A row that is a rejected archive record or carries no key is
skipped: a Gaia astrometry row with no position or epoch, an AT-HYG row with
no position, distance or absolute magnitude, a SIMBAD cross-ID with no
wds_id, component or oid. A curated row missing a cell it exists to state
throws ([Cell corrections](../../util/tsv/README.md#cell-corrections)).
AT-HYG spells an absent identifier `0` as well as empty.

## Checks and counts

`checks` are the row-band checks (`ROW_BANDS`, the pull runtime's
`bandCheck`), which the shell hands to `emitArtifacts` once it writes
multiples.tsv, so a truncated input fails before any write. An ORB6 row whose
grade cell is not a digit reads as grade 5 (outcome `fallback`).

Each pass returns one outcome per row it weighed — duplicate collapse, ORB6
grades, curated ORB6 letters, astrometry exclusions, the rescue, MSC synthesis
— and every count, in `stage1Counts` and in the build log, folds from those
through the one tally helper ([The tally](../../util/counts/README.md#the-tally));
no pass returns a bare number.
`stage1Counts` names the count-snapshot keys this stage's code produces. The
snapshot's `wds_pairs_total` is not one of them: Stage 3 appends its NSS
inner pairs to the same list, so its `stage3Counts` returns the total
([Counts](../astrometry/README.md#counts)).

## Sub-pair synthesis

Some orbits have no WDS pair row to live on — every downstream stage
walks WDS pairs, so those orbits were unreachable. Four passes at
four points in the pipeline:

- **ORB6 component overrides (Stage 1).**
  `data/binaries/orb6_component_overrides.tsv` stamps curated WDS
  component letters onto ORB6 rows whose fixed-width components field
  is blank because the catalog names the pair only by its
  variable-star designation (YY Gem = Castor Ca,Cb). Keyed on
  `(wds_id, discoverer)`; curation wins over the parsed field.
- **ORB6 orphan pairs (pre-Stage-2).** One synthesized `WdsPair` per
  ORB6 `(wds_id, components)` key that names a clean sub-pair (both
  sides single-component tokens after WDS truncated-form expansion —
  the fixed-width misalignment garbage `"95"` / `"a,Ab"` is filtered)
  with no WDS row — ~<!-- count:build-binaries/synthesized_orb6_orphan_pairs -->33<!-- /count --> pairs, 64 Psc Aa,Ab and Castor Ca,Cb among
  them. A blank-components WDS row under the same `(wds_id,
  discoverer)` is the same physical pair and donates its ρ/θ/mags/
  date/notes; otherwise the pair is sub-resolution (ρ = 0.0, no
  photometry) and the precise coord falls back to ORB6's own
  coordinate prefix. The synthesized components then ride the normal
  Stage 2 cascade (orb6_hip fires for primaries — the ORB6 entry key
  matches by construction), and
  `seedSynthesizedComponentBindings` backstops what the cascade
  missed: an unresolved primary inherits the in-system parent-token
  component's binding (Ca ← C), an unresolved secondary inherits the
  pair primary's (the blend convention).
- **MSC inner pairs (pre-Stage-2, after the blank-components
  rescue).** One synthesized `WdsPair` per WDS-token-mapped MSC orbit
  whose pair WDS never enumerates — the spectroscopic subsystems ORB6
  and Gaia NSS both miss (AR Cas Aa,Ab; ν Sco Aa1,Aa2). Gates mirror
  the NSS pass: both sides clean single-component tokens, at least one
  renderable-element orbit row, the token pair absent from the
  system's existing pairs, and the pair anchored to the existing
  system (each token's parent present) — unanchored MSC-only systems
  are skipped rather than minting unreachable orphans. Synthesized
  pairs are sub-resolution (ρ = 0, `discoverer=MSC`) and ride the
  normal Stage 2 cascade + synthesized-binding seeds. Counted
  `synthesized_msc_inner_pairs` with per-gate skip counts in the
  build log.
- **Gaia-NSS inner pairs (post-Stage-3).** A component whose own
  source has an `nss_two_body_orbit` row while its pair partner is a
  DIFFERENT resolved source hosts an unresolved companion of its own
  — the orbit is interior to that component, not the pair's (Stage
  4's distinct-source gate stops the misattribution). One synthesized
  inner pair per `(wds_id, source_id)`, named one hierarchy level
  down from the deepest carrier token (`A` → `Aa,Ab`, `Aa` →
  `Aa1,Aa2`) — ~<!-- count:build-binaries/synthesized_nss_inner_pairs -->442<!-- /count --> pairs. Skipped when the carrier token has no
  deeper WDS convention (compound / digit-bearing), the child tokens
  already exist in the system, the NSS row is outside the
  detectability regime, or the elements can never render (missing
  P/T/e, or missing ω on a non-circular fit). Children inherit the
  carrier's identifiers and astrometry; the pair is sub-resolution by
  construction (ρ = 0.0, `discoverer=GNSS`).

Synthesized pairs then flow through Stages 4-7 like any WDS pair:
Stage 4 attaches the orbit through its normal routes, Stage 5 keeps
them (both-Gaia tier for blended children, orbit-on-file otherwise),
Stage 6 emits them with system-anchor positions, and
`build:binaries-runtime` nests them under their outer pair via the
component-letter hierarchy. Build counters:
`synthesized_orb6_orphan_pairs`, `synthesized_nss_inner_pairs`.

## Blank-components rescue

73% of WDS_SUMM rows leave the `components` field blank — WDS's
convention for a system with exactly one pair (implied `A,B`), NOT a
system-level duplicate. `splitComponents('')` returns `None`, so these
never decompose and were dropped end-to-end (Antares, with an ORB6
orbit, and Deneb both vanished). `rescueBlankComponents`
(`blank-rescue-pure.ts`, a Stage 1 pass) rewrites the
`components` field to `AB` in place for the high-confidence subset — a
blank row anchored by an ORB6 orbit for the same `wds_id` (Antares) or a
SIMBAD WDS xid for the system — and aligns a matching blank-components
ORB6 row to `AB` so the strict `(wds_id, components)` orbit lookup
reaches the rescued pair. The far larger position-anchored population
(primary merely position-matches a catalog star — mostly wide optical
doubles surviving only on the Stage 5 mag-gap backstop) is deferred to
the full blank→AB ingest (`stellata-dch.83.9`). Rows already consumed as
ORB6-orphan donors are skipped; and because the implied `AB` pair is
identified by `wds_id` alone (`dedupWdsPairRows` keys on discoverer
and runs upstream, so it can't collapse two of them), at most one `AB`
row is promoted per system — a system any discoverer already enumerates
as `AB`, or that the pass already rescued, is skipped so nothing
double-emits. Counted `blank_components_rescued` /
`blank_components_deferred` in the Stage-7 snapshot.
