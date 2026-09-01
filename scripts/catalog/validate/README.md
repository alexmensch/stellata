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
                                  docs/validation-residuals.md. Excludes the
                                  records whose distance came from SIMBAD.
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
  of the same cross-check. **Both skip a record whose distance the SIMBAD
  tier supplied** — `data/athyg/simbad_sourced_distances.tsv` names them,
  since this harness reads `catalog.bin` and cannot see a build-time tier.
  Their residual is zero by construction, so including them would report
  agreement nothing measured (`docs/catalog-driver.md` § 5, validation
  independence). Counted in the report as an exclusion rather than folded
  into `unmatched`, which means something else.

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
   **Never widen a tolerance.** Where the investigation lands on a real
   defect whose fix is deferred, re-pin the value to what the build emits
   and say so in `notes_source` — the published truth, the cause, and the
   bead that restores it. **Pin every star a deferred defect touches, not
   just the one you found it on** — a partially-pinned set fails loudly on
   one star and silently on the rest, which reads as a narrower defect than
   it is. A pinned known-wrong value keeps the row guarding everything else
   about the star and makes the regression fail loudly when its fix lands; a
   widened tolerance stops guarding anything and is silent either way.

   The shape, from the set that most recently carried one — ξ UMa, whose
   `primary_absmag` sat at 3.701 against the component's true 4.241 because
   the printed Hipparcos V on its record was the unresolved AB pair and
   nothing re-split it. The row pinned **3.701**, the emitted value, with
   `notes_source` carrying all three parts: `ABSMAG PINS A KNOWN-WRONG VALUE,
   3.701 against the component's true 4.241` (published truth), the cause,
   and `Reverts to 4.241 when the separation gate lands` naming the bead. Its
   `ci` stayed a truth pin — colour is unaffected by a blend — and
   `primary_radius_rsun` was left unpinned rather than pinned wrong, since it
   derives from the bad absmag. ξ Scorpii and HD 75632 carried the same pin
   for the same cause; the gate landed and all three now pin real values. No
   row carries a deferred pin today.

   Those three have since moved again, and **not** back toward 4.241 — read
   their `notes_source` before "correcting" them. `stellata-3bsf.18` put their
   Gaia sources in the astrometry pull for the first time, so each takes its
   own per-component Gaia photometry through the Riello transform instead of
   the printed pair blend and its re-split. 4.241 was the WDS-implied value;
   the pins are now the Gaia-measured one.

   The same pull moved ξ Sco's `ci` off its class-derived value, and that one
   is the warning about **tolerance**: at ±0.03 the stale 0.419 pin still
   passed against a measured 0.433, so the row kept asserting a tier it no
   longer took. A pin whose `notes_source` names its provenance has to be
   re-read whenever the cascade above it gains a tier — passing is not
   evidence the stated reason still holds.
6. When curating a multi-star system, also pin its kept-pair set in
   `system-pair-topology.tsv` — the exact-set fixture is what catches
   a later ingest silently adding or dropping a pair for that root.
