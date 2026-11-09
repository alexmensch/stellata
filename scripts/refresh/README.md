# External-catalogue refresh

**Layer 2** of the build/data split — manual, infrequent refresh of
the frozen external catalogues under `data/`. Never wired into
`pnpm run build`. The freshness policy is in [Frozen external data](/data/README.md#frozen-external-data);
the per-source table is in [Per-source folders](/data/README.md#per-source-folders).

## Who runs a refresh

**"Manual" means not wired into `pnpm run build` — it does not mean a
human has to be the one to type it.** Claude Code sessions have network
access and run every target on this page directly, including the long
batched pulls.

So a column a frozen table lacks — or a row, or a whole request set that
misses a consumer — is a **re-pull to execute**, not a constraint to design
around. Adding `radial_velocity` to the 5p schema, re-slicing a VizieR table
for one more column, widening a request set, re-stratifying the SIMBAD sample
— all are in-session work. Never scope a design down, defer a field, or hand a
pull back to the user on the assumption that a network fetch is out of reach;
the cost is the pull's wall-clock time, and the `.ckpt` resume path
([Resuming a long pull](#resuming-a-long-pull)) bounds the retry risk.

**None of these is a reason to defer a pull to its own PR**, and each has been
used as one: the artifact is tens of MB and tracked in LFS; the re-pull moves
an entries pin and every count derived from it; the coverage diff wants
reviewing. Every PR is reviewed, so "a human reviews the diff" describes
review, not a gate on doing the work — and a re-pull landing in the PR whose
design needs it is what makes that diff *reviewable*, because the reason for
each moved count is in the same change. Splitting it out ships a design whose
measured reach is a property of the stale table.

What still needs a human: deciding to **freeze** a newly-pulled table
([Frozen external data](/data/README.md#frozen-external-data) governs when a refresh is warranted
at all) — a judgement about scope, not about effort.

## Layer 2 — refresh scripts

Every refresh script is **manually invoked**, never wired into
`pnpm run build`. The freshness policy (above) drives the split: build
reads committed files, refresh writes them. Each script lives under
`scripts/refresh/`, takes no required arguments (a pull scoped by a request
reads a request file a build writes, or for the DR2 neighbourhood a frozen
one), and atomically replaces its output TSV under `data/`.

### One-time setup

The refresh scripts use astropy + numpy + pyvo + requests. Pin them to a
local virtualenv so the system Python stays clean:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/refresh/requirements-refresh.txt
```

After that, prefix every `python3` invocation with `.venv/bin/`, or
shell-activate via `source .venv/bin/activate`. Every pnpm target below
runs its script through `scripts/pipeline/record.ts`, which starts bare
`python3` — activate the venv (or alias `python3` to the venv binary) in the
shell that runs them. `record.ts` skips a pull whose `data/stamps/` record is
still fresh (`--force` re-pulls) and rewrites the record after every run
([Recording a manual step](../pipeline/README.md#recording-a-manual-step--recordts)).

**`.venv` is gitignored, so a git worktree has none** — a refresh run from
one dies on `ModuleNotFoundError: astropy` after resolving its paths
perfectly well, which reads like a code fault and is not one. Put the main
checkout's venv first on `PATH` and run the target
(`PATH=<main-checkout>/.venv/bin:$PATH pnpm run refresh:<x>`): `record.ts`
starts bare `python3`, and the scripts resolve `REPO_ROOT` from their own
location, so they still read and write the worktree's `data/`. Running the
script directly writes no record, so the build then stops on that pull.

### Per-script targets

| pnpm target | Script | Output | What it pulls |
|---|---|---|---|
| `refresh:gaia-hip` | `gaia-whole-table/refresh-gaia-hip-xmatch.ts` | `data/gaia/gaia_dr3_hip_xmatch.tsv` | HIP → Gaia DR3 source_id cross-walk from `hipparcos2_best_neighbour`. |
| `refresh:gaia-tyc` | `gaia-whole-table/refresh-gaia-tyc-xmatch.ts` | `data/gaia/gaia_dr3_tyc_xmatch.tsv` | Tycho-2 → Gaia DR3 cross-walk from `tycho2tdsc_merge_best_neighbour`. |
| `refresh:gaia-nss` | `refresh-gaia-nss.py` | `data/gaia/gaia_dr3_nss_two_body.tsv` | Gaia DR3 `nss_two_body_orbit` (binary orbits Gaia detected astrometrically). |
| `refresh:gaia-astrometry` | `gaia-request/refresh-gaia-astrometry.ts` | `data/gaia/gaia_dr3_astrometry.tsv` | Gaia DR3 5-parameter astrometry for the binaries request (`data/gaia/gaia_astrometry_source_id_request.tsv`): the source_ids Stage 2 resolved plus every candidate a Stage-2 gate weighed — `write_astrometry_request` owns the list. Run AFTER `refresh:gaia-hip` + `refresh:gaia-tyc` + a fresh `pnpm run build:binaries`. |
| `build:astrometry-request` | `scripts/catalog/astrometry-request/export-astrometry-request.ts` | `data/gaia/gaia_catalog_source_id_request.tsv` | Full-catalog deduped Gaia DR3 source_id request list — the union of four contributions ([The request is a union](../catalog/astrometry-request/README.md#the-request-is-a-union-and-why-that-is-not-a-compromise)). Not a network pull. Reads both Gaia cross-walks and `multiples.tsv`'s kept pairs, which Stage 5 decides from `gaia_dr3_astrometry.tsv`, so it runs AFTER `refresh:gaia-hip` / `refresh:gaia-tyc` and a `build:binaries` that follows `refresh:gaia-astrometry`. |
| `refresh:gaia-astrometry-catalog` | `gaia-request/refresh-gaia-astrometry-catalog.ts` | `data/gaia/gaia_dr3_astrometry_catalog.tsv` | Gaia DR3 5p astrometry + `radial_velocity` for every catalog source_id ([the request](../catalog/astrometry-request/README.md)) — tier 1 of the direction, rv, V and ci cascades. Same schema/query as `refresh:gaia-astrometry`; reads `gaia_catalog_source_id_request.tsv`. Run AFTER `build:astrometry-request`. |
| `refresh:gaia-magnitude` | `magnitude/refresh-gaia-magnitude.ts` | `data/gaia/gaia_dr3_magnitude_pull.tsv` | Every `gaiadr3.gaia_source` row at `G ≤ 11` (<!-- count:membership-manifest/magnitudeTerm.rows -->1,247,240<!-- /count -->) — membership's magnitude term ([§ 1](/docs/catalog-driver.md#1-the-driver-model)), on `ASTROMETRY_COLUMNS`. The one Gaia pull with **no request set**: its selection is the magnitude bound, so it reads nothing under `data/` and has no ordering constraint. Floor rationale — why `G ≤ 11` needs no margin over `V ≤ 11` — [Why the floor carries no margin](/data/gaia/README.md#why-the-floor-carries-no-margin). |
| `refresh:gaia-apsis` | `magnitude/refresh-gaia-apsis.ts` | `data/gaia/gaia_dr3_apsis.tsv` | Gaia DR3 `astrophysical_parameters` (gspphot ∪ gspspec) — Teff / log g / [M/H] / A0 + the ESP-ELS `spectraltype_esphs` enum. Scoped to the deep population (`magnitude/README.md`), so it runs AFTER `build:astrometry-request`. |
| `refresh:gaia-gspc` | `gaia-request/refresh-gaia-gspc.ts` | `data/gaia/gaia_dr3_gspc.tsv` | Gaia DR3 `synthetic_photometry_gspc` — Johnson-Kron-Cousins B/V synthesised per source from its BP/RP spectrum, with fluxes and the per-band validated-range flag. Reads `gaia_catalog_source_id_request.tsv`, so it runs AFTER `build:astrometry-request`. Flag polarity and the S/N > 30 cut this table already applies — [The GSPC validated-range flag](/data/gaia/README.md#the-gspc-validated-range-flag--1-means-in-range). |
| `refresh:gaia-dr2-neighbourhood` | `gaia-request/refresh-gaia-dr2-neighbourhood.ts` | `data/gaia/gaia_dr2_neighbourhood.tsv` | DR2 ↔ DR3 cross-match candidates (`gaiadr3.dr2_neighbourhood`) for the Gaia-only catalog stars (reads `data/gaia/gaia_dr2_neighbourhood_request.tsv`). Input to the SID DR-reconciliation dry run — [§ 6.2 DR2→DR3 dry run](/docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07), incl. the request-file derivation recipe. |
| `refresh:bailer-jones` | `magnitude/refresh-bailer-jones.ts` | `data/bailer-jones/bailer-jones-dr3.tsv` | [Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) photogeometric + geometric distance posteriors per Gaia DR3 source_id, from `external.gaiaedr3_distance` on ESA rather than VizieR's `I/352` ([Why the pull is ESA-side](/data/bailer-jones/README.md#why-the-pull-is-esa-side)). Deep population (`magnitude/README.md`), so it runs AFTER `build:astrometry-request`. |
| `refresh:hip2` | `refresh-hipparcos2.py` | `data/hipparcos/hip2_van_leeuwen.tsv` | Hipparcos-2 ([van Leeuwen 2007](/data/papers/index.md#vanleeuwen2007)) reduction. |
| `refresh:hip-vmag` | `refresh-hipparcos-vmag.py` | `data/hipparcos/hip_main_vmag.tsv` | Printed Johnson V and B−V per HIP from `I/239/hip_main` — the printed tiers of the V-magnitude and ci cascades — plus the catalogue's own HD column, the `hd:i239` attestation route. |
| `refresh:classic-ids` | `refresh-classic-ids.py` | `data/classic-ids/{tyc2_hd,cross_index,bsc5,cns5}.tsv` | The four frozen CDS classic-designation cross indexes (`IV/25`, `IV/27A`, `V/50`, CNS5 `J/A+A/670/A19`). Four slices in one script; `--only <stem>` limits it to one. |
| `refresh:iau-wgsn` | `refresh-iau-wgsn.py` | `data/iau-wgsn/{NEC,wgsnFaints}.csv` | The IAU WGSN naked-eye catalogue + faint approved names (plain HTTP, not TAP; schema / row-band / spot-row gates). Follow with `pnpm run build:wgsn`. |
| `refresh:tycho2` | `refresh-tycho2.py` | `data/tycho2/{tycho2_main,tycho2_suppl1}.tsv` | Tycho-2 (`I/259` `tyc2` + `suppl_1`) mean positions with per-star mean epochs, PM, BT/VT — filtered to the TYCs the manifest and IV/25 mention. Range-batched over TYC1 and filtered locally; VizieR can express no server-side filter on the full identifier ([Why the pull is range-batched](/data/tycho2/README.md#why-the-pull-is-range-batched-rather-than-key-filtered)). |
| `refresh:gliese` | `refresh-gliese.py` | `data/gliese/gliese_v70a.tsv` | [Gliese 1991](/data/papers/index.md#gliese1991) third catalogue of nearby stars (`V/70A`, whole table) — printed Johnson V + B−V, spectral type, parallax and rv, plus the B1950 position, proper motion and cross-names the binding review measures against. The V cascade's tier under Tycho-2, and the first-order source behind every `mag_src=GJ` cell (`data/gliese/README.md`). |
| `refresh:simbad` | `simbad-sample/refresh-simbad-sample.ts` | `data/simbad/simbad_sample.tsv` | V-stratified seeded 50k SIMBAD sample (validation corpus). TypeScript, on `pull/`; own README. |
| `refresh:simbad-values` | `simbad-values/refresh-simbad-values.ts` | `data/simbad/simbad_values.tsv` | Bibcoded rv / parallax / PM / coordinates + B/V fluxes for the [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) value cohort — the manifest rows a SIMBAD value tier can reach. Cohort predicate and coverage: [The values pull](/data/simbad/README.md#the-values-pull). The cohort is manifest rows less those Gaia's 5p tables (`gaia_dr3_astrometry_catalog.tsv`, `gaia_dr3_magnitude_pull.tsv`) already complete, and `build:membership` reads both, so it runs AFTER `refresh:gaia-astrometry-catalog`, `refresh:gaia-magnitude` and the `build:membership` that follows them. |
| `refresh:simbad-tyc-hd` | `refresh-simbad-tyc-hd.py` | `data/simbad/simbad_tyc_hd.tsv` | SIMBAD's own HD identification per Tycho-2 entry, keyed on TYC — the witness independent of IV/25 that a close pair's crossed HD cells need ([The TYC → HD pull](/data/simbad/README.md#the-tyc--hd-pull)). Request set is `refresh_lib.read_mentioned_tycs` — IV/25's Tycho ids union the manifest's — shared with `refresh:tycho2` rather than restated, so both cover the same entries by construction. Composes the `simbad/` plumbing and states no ADQL of its own. |
| `refresh:simbad-wds-sptype` | `simbad-wds-sptype/refresh-simbad-wds-sptype.ts` | `data/simbad/simbad_wds_sptype.tsv` | SIMBAD `sp_type` for every oid `simbad_wds_xids.tsv` binds a WDS component to — the rows `build:binaries` Stage 6 reads. Keyed on that file alone, never the manifest, so run it AFTER `refresh:simbad-wds-xids`. TypeScript, on `pull/`; own README. |
| `refresh:edenhofer2024-main` / `-2kpc` | `refresh-edenhofer2024-{main,2kpc}.py` | `data/dust/edenhofer2024-{main,2kpc}.json` | The [Edenhofer 2024](/data/papers/index.md#edenhofer2024) dust map's two variants into `dustmaps`' cache, each recorded as a committed identity file the bakes read — [The Edenhofer 2024 pulls](/scripts/dust/README.md#the-edenhofer-2024-pulls). |
| `validate:simbad` | `scripts/catalog/validate/validate-simbad-sample.ts` | (report only) | Tier C — cross-check `public/catalog.bin` against the committed SIMBAD sample. The build-time subset of the same check is `distance-regression-check.ts`, gated on `build-distance-outliers-expected.json`. |

`refresh:simbad-sptype` (`simbad-sptype/`, TypeScript, own README) writes
`data/simbad/simbad_sptype.tsv`, the manifest-keyed spectral types membership
and the catalogue read. `refresh:simbad-wds-xids` and `refresh:msc` run
`refresh-simbad-wds-xids.py` and `refresh-msc.py` (outputs
`data/simbad/simbad_wds_xids.tsv`, `data/msc/msc_*.tsv`). The TypeScript
SIMBAD pulls share `scripts/refresh/simbad/`'s core, and the two Python ones
left (wds-xids, tyc-hd) its `specs.py` and `query.py`; that folder's own
README carries the roster. `refresh-msc.py` pulls the
three Multiple Star Catalog (MSC) tables (VizieR `J/ApJS/235/6`) into `data/msc/` with
per-table schema validation and row bounds — source detail in
`data/msc/README.md`.

### Request sets are membership-derived

**No refresh script reads `data/athyg/`** — neither AT-HYG's own CSV
(`athyg_33_classic_ids.csv`) nor the inherited spine.
Every catalog-scoped request set
traces to the membership term
([§ 3.1](/docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries)) by one of two routes: directly off
`data/membership/membership-manifest.tsv`, through
`refresh_lib.read_membership_source_ids` / `iter_membership_rows` (the
SIMBAD pulls), or off the committed inputs `build:membership` derives the
manifest from, through the request file `export-astrometry-request.ts`
builds (astrometry-catalog, GSPC,
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021), Apsis —
see `readSourceIdRequest` below), whose coverage of the manifest's
bindings the membership gate test holds.
`refresh_lib.MEMBERSHIP_MANIFEST` is the one statement of where that table
lives for the Python pulls, `refresh_lib.TYC2_HD_CROSS_INDEX` the same for
IV/25, and `DATA_FILES.astrometryRequest` for the request file; a script
naming any of these paths itself has drifted from it. The two pulls scoped to Tycho
entries share the whole request set, not just the paths —
`refresh_lib.read_mentioned_tycs`, [The request set](/data/tycho2/README.md#the-request-set--manifest--iv25).
[Request sets come off the membership term](/data/simbad/README.md#request-sets-come-off-the-membership-term) carries
the measured drop/gain of the SIMBAD rebase.

The manifest's `gaia_source_id` is the binding the manifest **justified**, its
`binding` cell saying on what basis, so a request derived from it and the
record build name the same sources by construction — `readStars` reads the
same cell. A raw cross-walk value is the ungated one, which is why a walk over
one over-pulls rows that never became records. The astrometry request walks
candidates on purpose, since both binding gates need a G for every source they
weigh, and covers the manifest's bindings by measurement rather than
construction
([The record build's sources are covered by measurement](/scripts/catalog/astrometry-request/README.md#the-record-builds-sources-are-covered-by-measurement)).

**A rebased request set does not rewrite its output.** The rebase changes
what the *next* run asks for; the committed TSV keeps whatever the previous
run pulled until that run happens — the same terms as `radial_velocity`
above. A rebase that changes the keys a pull asks under changes its
`--describe` request, so the pull's `data/stamps/` record reads stale and the
build stops naming its refresh; a plumbing edit alone does not
([Freshness](../pipeline/README.md#freshness--one-mechanism)).

[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) and Apsis
add a second, magnitude-bounded leg on top of that request —
[The deep population](magnitude/README.md#the-deep-population--a-bounded-leg-plus-a-request-leg).

### The staleness gate — pin the shortfall, never the numerator

That last paragraph is the hazard, and it has bitten more than once: the
binding column moves, the pull is not re-run, and the build reads a table
that no longer covers the manifest. Nothing fails. The affected records
quietly fall to a lower cascade tier.

**A rebuild cannot catch it and must not be relied on to.** `build:catalog`
reads committed tables, so rebuilding from the same stale TSV reproduces the
same gap exactly — the missing rows are not computable, they need a network
fetch. The build's skip gate already invalidates the artifact on any build-script
edit and it is no help here: nothing is stale in the *build*, the *data* is.

**What does catch it is gating the shortfall.** A coverage numerator —
`bjOverridden`, `apsisMatched` — cannot serve as the gate, because when the
column gains sources the pull was never asked for, the numerator simply
stops growing. "Stopped growing" is the most invisible diff a snapshot can
carry: it reads as no change, and `UPDATE_SNAPSHOTS` writes it back
without comment. The shortfall is what moves loudly, so the shortfall is what
is gated — where it must be zero, by a check that fails the build and names
each missing row (a lineage invariant, [Invariants](/scripts/catalog/lineage/README.md#invariants), or an
input-index check like the bound-pair siblings'); only a residual shortfall
stays a pinned count:

| Shortfall | Gate | What a move means |
|---|---|---|
| `placement.distance.bailer-jones-absent` rows | **none**: a lineage invariant fails the build naming each one ([Invariants](/scripts/catalog/lineage/README.md#invariants)) | an eligible row has its own DR3 parallax, so [Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) publishes a posterior for it; an absence is only ever this request set drifting |
| `apsisSourcesUnpulled` | reviewed residual | **<!-- count:build-catalog/apsisSourcesUnpulled -->484<!-- /count -->**, down from 5,126 when the request was manifest-keyed and 5,076 of it was promoted companions — RECORDS but not manifest rows, so unrequestable at any magnitude. The union reaches all but <!-- count:build-catalog/apsisSourcesUnpulled -->484<!-- /count --> of them; that remainder plus genuine upstream absence is what the pin now holds |
| `gspcSourcesUnpulled` | reviewed residual | Gaia genuinely lacks parameters for part of the catalogue; its request is the exported union, which does cover pair members |
| `gateSkippedNoGMag` · `membership.binding.unweighed-no-pulled-row` rows | **0** · **none**, a lineage invariant | the original instance of this rule, on the two binding gates ([The request is a union](/scripts/catalog/astrometry-request/README.md#the-request-is-a-union-and-why-that-is-not-a-compromise)) |

Adding a per-source consumer therefore means adding its shortfall gate in
the same change: a lineage invariant on the code its consumer writes for a
missing row, or a pinned count only where Gaia genuinely publishes nothing for
part of the set. The cost is one hash lookup per record, so it scales with
the catalogue rather than with the pull.

**A shortfall pinned at a residual hides what a zero gate would have shown.**
A consumer that runs over RECORDS is under-covered by a request derived from
manifest rows by exactly the promoted companions — they carry a Gaia id and
are never in the manifest's column — and only a zero gate makes that visible.
A residual that stays put reads as upstream absence however much of it is the
request set not asking.

Every request-scoped pull therefore reads the exported union
(`build:astrometry-request`), which explicitly includes `multiples.tsv`'s
kept-physical pair members. Check the same question for any new per-record
consumer of a per-source table.

**`simbad_sptype.tsv` is a cycle, not a line, and cannot be gated this
way.** Its request keys come off the manifest's binding column
(`membershipKeys` keys a row on its `gaia_source_id` where it has
one), and its cross-IDs are the derivation's fourth binding source — so
re-pulling it can change the very column that decided what to request.
Re-running it is a fixpoint iteration with no convergence guarantee, and it
re-opens every row of `data/membership/binding-review-dispositions.tsv` by
construction, since a disposition names the two ids it adjudicated between
and the generator hard-fails when either moves. Re-pull it deliberately, as
its own change, expecting to re-review the queue — never as a step folded
into unrelated work.

The one-column request format has one parse, `readSourceIdRequest`
(`../catalog/astrometry-request/`), beside its writer: every pull that reads
a request is TypeScript.

**`refresh:gaia-magnitude` is scoped by a selection, not a request set**, and
so sits outside this whole section: membership's magnitude term is defined by
a bound on `phot_g_mean_mag`, not by a list of ids, so the pull reads nothing
under `data/`, derives from nothing, and cannot go stale against a column
that moved. Its shortfall gate is a row-count band rather than a coverage
fraction — there is no numerator, because there was no request. What it
shares with the two astrometry pulls is the schema: all three project
`ASTROMETRY_COLUMNS` (`gaia-request/`), so one parser reads all three
outputs.

Non-network dependency: `refresh-simbad-tyc-hd.test.py` covers that pull's
request-set union, the space-padded ident join, its compose gates and the
row-count / spot-row bands against an in-memory TAP backend. Run it with
`python3 scripts/refresh/refresh-simbad-tyc-hd.test.py`.

Non-network dependency: `refresh-simbad-wds-xids.test.py` covers Phase B's
cross-ID parse (Gaia DR3, per-component HIP, and the oids the JOIN misses).

`scripts/refresh/refresh_lib.py` is the shared TAP / Astroquery /
atomic-rename plumbing every refresh script imports — handles retry,
batched pulls (`run_in_batches`), schema validation, row-count and
coverage gating (`assert_row_count`, `report_coverage`), spot-check
pinning (`validate_spot_rows`), and
partial-write protection so a mid-run failure never leaves a
half-written TSV under `data/`. `assert_row_count` is also imported by
`scripts/binaries/build-binaries.py` for its Stage-1 parser bounds.

The pulls port onto `pull/`, the TypeScript runtime: one CSV TAP backend whose
overflow check is a row count, a query-keyed resume cache, required gates and
an all-or-none write ([pull/README.md](pull/README.md)).

### VizieR

The declarative whole-table case — `VizierSlice` / `pull_slices()`, CDS's
non-load-bearing MAXREC, identifier quoting — lives in
`scripts/refresh/vizier/` with its own README.

`refresh-tycho2.py` stays here and does not use `VizierSlice` — why is
`vizier/README.md`'s to state. **Its pull and its write are separate calls
on purpose** — `pull_table` gates and returns rows, `write_table` commits
them, and
nothing is written until the cross-table membership cover has also passed
([Why the pull is range-batched](/data/tycho2/README.md#why-the-pull-is-range-batched-rather-than-key-filtered), last paragraph).
Its non-network test (`refresh-tycho2.test.py`) covers the request-set
union, the TYC1 range cover and scan-span assertion, the local filter,
the fraction / spot-row gates against an in-memory TAP backend, and the
manifest-cover gate's three verdicts ([The request set](/data/tycho2/README.md#the-request-set--manifest--iv25)).

The in-memory TAP backend every non-network suite here uses (`FakeTable`,
`fake_tap_client`) lives in `scripts/test_helpers.py`.

### Gaia TAP: synchronous endpoints only

Every `gaiadr3.*` pull asks a `/sync` endpoint — ESA primary, ARI Heidelberg
fallback, both hosting the identical `gaiadr3.*` schema. The ESA archive's
ASYNC path intermittently 500s on result retrieval while its sync endpoint
stays healthy, so nothing reaches Gaia any other way. The TypeScript pulls do
it through `pull/`'s backend ([The TAP backend](pull/README.md#the-tap-backend));
`refresh-gaia-nss.py`, the one Python Gaia pull left, through
`refresh_lib.gaia_sync_client()`.

The Python `TapClient` moves whichever backend answered to the front, so a
mirror that is down costs its retry schedule (about 5 min of connect
timeouts) once per run, not once per batch. It reports each answering backend
through `build_stamp.report_service`, and `client.services` is its declared
service list, the one a pull's `--describe` states.

`TapClient` takes `backends=` as a required argument — there is no
default list, because which service can serve a query is a property of
the table. CDS VizieR doesn't host `gaiadr3.*`, so an ESA→CDS fallback
would fail with a misleading "table not found";
`refresh-hipparcos2.py` goes the other way and uses
`cds_client()` (CDS alone) because `I/311/hip2` is VizieR-only. SIMBAD
gets `simbad_client()` for its divergent dialect — CDS primary, the
Harvard CfA mirror as fallback, both serving the same database and oids.
Check ESA's
`external.*` schema before concluding a catalogue is VizieR-only:
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) is on
both, and `refresh:bailer-jones` takes the ESA copy precisely because only
that one can be joined to a magnitude
([Why the pull is ESA-side](/data/bailer-jones/README.md#why-the-pull-is-esa-side)).
ARI hosts it too, as `gaiaedr3_complements.distances`; the pull asks ESA
alone (`GAIA_ESA`) because one query names one of the two.

**MAXREC is load-bearing.** A sync endpoint answers HTTP 200 and flags
truncation in a VOTable `QUERY_STATUS` INFO rather than erroring, so a
MAXREC below the result size would silently short a pull. The Python pull's
sizing rule below may not be replaced with a bare literal.
**ESA's `/capabilities` declares a hard output limit of 50,000 rows** (ARI
10,000,000; measured 2026-11-05), and a mirror truncates at its own hard
limit whatever MAXREC asks. Whether ESA flags that truncation as a
`QUERY_STATUS` overflow, which `refresh_lib` raises on, is unmeasured, so a
Python query ESA answers past 50,000 rows may come back short with only its
row band to catch it. The TypeScript runtime reads each mirror's limit and
routes around it ([The TAP backend](pull/README.md#the-tap-backend)); the
cross-walk and magnitude-bounded pulls are TypeScript and sliced to fit ESA
([gaia-whole-table/](gaia-whole-table/README.md), [magnitude/](magnitude/README.md)).

- `refresh-gaia-nss.py`, the one Python whole-table pull, calls
  `whole_table_sync_maxrec(EXPECTED_ROW_COUNT_MAX)` — double the pinned
  ceiling, clamped to `GAIA_SYNC_MAX_ROWS` (3 M, not ESA's limit). It exits
  rather than clamp below the ceiling. Its 440,000–446,000-row band is past
  ESA's limit, so only ARI can answer it whole; an ESA answer is left to the
  row band to refuse.

### Magnitude-bounded pulls

A pull scoped by a bound on `phot_g_mean_mag` rather than by a request set —
the magnitude slices, and the two-leg deep population
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) and Apsis
are pulled over — lives in `scripts/refresh/magnitude/` with its own README.

### The astrometry schema

Both astrometry scopes (`refresh:gaia-astrometry`, binaries; and
`refresh:gaia-astrometry-catalog`, full catalogue) are one `PullTable` over
`ASTROMETRY_COLUMNS` ([gaia-request/](gaia-request/README.md)), so **a column
added to it lands in both scopes** — but only in whichever output is
actually re-pulled. The column list is part of both scopes' query, so an
added column stales both records and the build names both refreshes.

Both scopes carry `radial_velocity` and `radial_velocity_error`. The catalog
scope's rv cascade reads them, and `parseGaiaAstrometryCatalogTsv` requires
the error column; its consumer is the build-counts ratchet, not a filter —
the cascade takes DR3's value whatever error it states
(`../catalog/distance/radial-velocity/README.md`). Nothing reads rv from the
binaries-scope `gaia_dr3_astrometry.tsv`.

### Resuming a long pull

A TypeScript pull resumes through its query-keyed cache
([The checkpoint](pull/README.md#the-checkpoint)); this section is the Python
pulls'.

`run_in_batches(..., checkpoint=rl.BatchCheckpoint(out.with_suffix(
out.suffix + '.ckpt')))` makes a batched pull resumable: each batch is
cached under `<output>.tsv.ckpt/` as it lands, and a re-run replays the
cached batches and queries only what's missing. The directory is removed
only once every batch has landed — **a surviving `.tsv.ckpt*/` directory
means the previous run did not finish**. It's gitignored, and discarded automatically when the request set or
batch size changes (the cache is fingerprinted on both, since batch N of
a different request set covers different source_ids). Deleting it by
hand is always safe — it only forces a full re-pull.

See [Catalogue refresh policy](/RELEASING.md#catalogue-refresh-policy) for the cadence
(event-driven, not scheduled) and the version-bump policy for a
catalogue-refresh PR.

## Refreshing data when DR4 / new AT-HYG lands

The full Gaia data-release transition takes coordinated refreshes
because the source_id space changes; partial refreshes leave the
catalogue inconsistent. Order matters:

1. **Swap AT-HYG.** Drop the new `athyg_3X_classic_ids.csv` into
   `data/athyg/`. Its one build consumer is `build:binaries` Stage 1's parse
   ([Consumed by](/data/athyg/README.md#consumed-by)), which step 4 re-runs. Membership is
   the primaries-derived manifest and `build:catalog` reads neither this file
   nor the frozen spine, so the swap moves no record.
2. **Refresh the Gaia DR4-keyed side-files** — `refresh:gaia-hip`,
   `refresh:gaia-tyc`, `refresh:gaia-nss`, `refresh:gaia-magnitude`,
   `refresh:gaia-astrometry`, `build:astrometry-request`,
   `refresh:gaia-astrometry-catalog`, `refresh:gaia-apsis`,
   `refresh:gaia-gspc`, `refresh:bailer-jones`, then `build:membership`
   (it reads the astrometry catalog and the magnitude pull) and
   `refresh:simbad-values` — in the order the
   "Run AFTER" prerequisites in [Per-script targets](#per-script-targets)
   set; that table is the one statement of it. Under a DR transition the
   request's `gaia_dr3:` ids bridge through
   [§ 6](/docs/sid.md#6-gaia-data-release-reconciliation) first —
   requesting DR3 ids against a DR4 table returns nothing.
3. **Refresh HIP2 + SIMBAD if upstream republished** — these are
   keyed on HIP / SIMBAD `oid` respectively, so they don't change
   under a Gaia DR transition unless their own pipeline updated.
   The SIMBAD pulls key their requests off the manifest, so any that run
   go after step 2's `build:membership`.
4. **Re-run `pnpm run build:binaries`**, **`pnpm run build:membership`**,
   then **`pnpm run build:catalog`**.
   Both build steps reassert against their snapshots; the count diffs
   are the first place to look for regressions.
5. **`pnpm run build:catalog --update-snapshots`** to
   refresh both snapshots once the new build is reviewed. Re-edit the
   `reason` strings on the distance-outliers snapshot for any new
   outliers.
6. **Re-run Tier A and Tier C.** Tier A's known-stars table may need
   per-row source_id updates if Gaia DR4's source_ids changed for the
   tracked stars (Gaia publishes a DR3↔DR4 cross-walk during the
   transition window). Tier C's `simbad_sample.tsv` should be
   refreshed via `refresh:simbad`, which re-stratifies over
   SIMBAD's own V-magnitude populations and so tracks SIMBAD growth rather
   than the DR transition.
