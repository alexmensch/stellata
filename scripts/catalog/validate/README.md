# Validation harness

The Tier-A/B validation harness for a built catalogue: `verify-catalog`
structural checks, the SIMBAD-sample cross-check, and the frozen
regression corpora that pin named stars, sky positions, and
cross-language parser parity.

## Files in this area

```
scripts/catalog/validate/
  verify-catalog.ts               Structural + invariant checks over a
                                  built catalog.bin. Excluded from the
                                  vitest run (it is a CLI, not a test).
  validate-simbad-sample.ts       pnpm run validate:simbad — cross-checks a
    (+ test)                      built catalog against the frozen SIMBAD
                                  sample and writes
                                  docs/validation-residuals.md.
  simbad-sample-parse.ts (+ test) Parser for data/simbad/simbad_sample.tsv.
  known-stars.test.ts             Tier-A corpus: named stars pinned against
  known-stars.tsv                 public/catalog.bin, plus the exact-set
  system-pair-topology.tsv        pair-topology fixture.
  sky-position.test.ts            Sky-position corpus (RA/Dec per named
  sky-position-corpus.tsv         star) against the built catalog.
  gaia-hip-xmatch-parity.test.ts  Cross-language parity: gaia-xmatch.ts vs
  gaia-hip-xmatch-parity.tsv      scripts/binaries/parsers.py over one
                                  shared fixture.
```

## Validation harness

Three tiers, all snapshot-pinned:

- **Tier A — known-stars corpus.** `scripts/catalog/validate/known-stars.tsv`
  carries ~80 hand-curated systems (single stars + multiples) with
  expected HIP, Gaia DR3 source_id, distance ± 1σ, absmag, spectral
  type, optional intrinsic-colour + physical-radius pins (primary_ci
  ±0.03 / primary_radius_rsun ±10% or per-row radius_rel_tol — the
  end-to-end guard on the two most user-visible per-star properties),
  per-companion (HIP, source_id, absmag) tuples, and optional
  GCVS variability pins (var_type / var_period_days / var_amp_mag —
  published values quantised through `encodeAmpUnits` /
  `encodePeriodUnits` before comparison; `var_type=none` asserts a
  record is NOT variable). Coverage spans one pin per population
  dimension: nearest M dwarf, halo subdwarf, white dwarfs (single +
  promoted-companion), carbon star, Wolf-Rayet, O supergiant, each
  animated GCVS family (M, DCEP, SRC, EA, EW), LMC members, B-J
  regression cases, a Tycho-only no-HIP record, and the multi-star
  showcase systems (Castor, Algol, AR Cas, ν Sco, 40 Eri).
  `scripts/catalog/validate/known-stars.test.ts` loads `public/catalog.bin` via
  the runtime loader and asserts every row matches within tolerance.
  Adding a row → see § Adding to the known-stars corpus below.
  The sky-position corpus (`sky-position-corpus.tsv` +
  `sky-position.test.ts`, `../distance/README.md` § Direction resolution) is the companion
  Tier A harness for single-star angular placement.
- **Tier A — system pair topology.**
  `scripts/catalog/validate/system-pair-topology.tsv` (driven by the same
  `known-stars.test.ts` harness) pins, per WDS root, the EXACT set of
  pair rows multiples.tsv may emit — a dropped physical pair and a
  re-leaked optical pair both fail by name. This is the regression
  guard on Stage 5 optical-filter verdicts (Sirius AC-AF, Albireo AB,
  40 Eri D/E) and on the showcase systems' sub-pair subdivision
  topology. Rows can additionally pin a minimum 3D separation between
  two catalog records as the on-record Gaia evidence that a rejected
  pair is optical (Albireo A↔B at ~9.4 pc). Standalone `_X` member
  rows are exempt from the exact-set check.
- **Tier A — multi-star geometry corpus.**
  `scripts/catalog/companions/multi-star-regression.tsv` +
  `multi-star-regression.test.ts` pin per-PAIR geometry against
  external truth (WDS sep+PA at the published epoch, ORB6 periods):
  catalog.bin tangential separation + PA between the two component
  records, the multiples.tsv geometry columns, the binaries.bin
  Tier-1 record (flags, elements, stored sep/PA/epoch), and a Kepler
  propagation to each record's own `sep_pa_epoch_jd` through the same
  pure path the runtime baseline cache uses. Also drives the runtime
  render layer against the shipped artifacts: every cached relation's
  offset `baseDiffPc + ΔR(t)` must stay on its orbit shell
  `[a(1−e), a(1+e)]` (the headline sweep — would have caught the
  displaced-centre bug), a full `BinaryOrbitField` walk of Algol Aa,Ab
  in the focus regime, and a ratchet counting non-collocated Tier-1
  pairs whose baked placement disagrees with elements-alone R(epoch)
  by > 0.5·a (a data-curation signal, ratchets DOWN). Also sweeps
  identifier integrity: corpus-wide HIP distinctness, URL star-ref
  round-trips (first-seen `hipToIndex` semantics matching `main.ts`),
  and a pinned-count ratchet on promoted-companion HIP collisions.
  A catalog-wide variability-honesty sweep asserts every
  `VAR_TYPE_ECLIPSING` record carries `FLAG_BINARY_PRIMARY` (eclipsers
  earn wings, never a variable ring), with Algol as the named showcase.
  Column contract + per-row tolerance discipline live in the TSV header.
- **Tier B — population statistics.**
  `scripts/catalog/build-counts.ts` (`compareBuildCounts`) + the two
  per-build snapshot JSONs gate every absolute count and rate the build
  emits. The diff format in `formatCountDiff` is the same in both Phase
  2 and Phase 3 — `scripts/binaries/stage7_counts.py` mirrors
  `scripts/catalog/build-counts.ts` so the per-strategy assertion shape
  reads identically across the two builds. A `BuildCounts` entry is
  either a scalar or a `DistSrcPartition`; the latter diffs as one
  `parent.bucket` row per bucket, so a single drifting population names
  itself (`../distance/README.md` § Override-layer authoring discipline).
- **Tier C — SIMBAD random sample.**
  `scripts/catalog/validate/validate-simbad-sample.ts` cross-checks the built
  `public/catalog.bin` against a stratified random 10k SIMBAD sample
  in `data/simbad/simbad_sample.tsv`. Manual run; the
  distance-regression check above is the build-time automated subset
  of the same cross-check.

## Adding to the known-stars corpus

`scripts/catalog/validate/known-stars.tsv` is tab-separated with comment lines
preserved. To add a star or system:

1. Pick the system. Confirm the WDS id (empty for single stars), the
   primary HIP and Gaia DR3 source_id (`SIMBAD` or VizieR resolve), a
   trusted distance ± 1σ, the expected absmag, and the MK spectral type.
2. For multiples, list each companion's letter, HIP, source_id, and
   absmag in the `companions` column as
   `comp_letter:hip:gaia_id:absmag` tuples joined by semicolons.
3. For GCVS variables, pin `var_type` (`pulsating` / `eclipsing` /
   `other`) plus the PUBLISHED (unquantised) `var_period_days` and
   `var_amp_mag` (max − min); the test applies the byte encoding
   before comparing. `var_type=none` on a non-variable guards against
   false-positive cross-matches. Use the spectral string the resolver
   actually consumed (`data/simbad/simbad_sptype.tsv`) when SIMBAD's
   live sp_type differs — the corpus pins pipeline behaviour, with the
   live value noted in notes_source.
4. Append the row. Run `pnpm test -- known-stars` to confirm the row
   passes against the current `public/catalog.bin`. The test parses the
   spectral string via `classifyFromSimbad` so the format must be
   SIMBAD-canonical MK.
5. If the test fails on a row you expected to pass, the discrepancy is
   genuine — either the catalog has a bug or the expected values are
   wrong. Don't relax the tolerance to silence; investigate.
6. When curating a multi-star system, also pin its kept-pair set in
   `system-pair-topology.tsv` — the exact-set fixture is what catches
   a later ingest silently adding or dropping a pair for that root.
