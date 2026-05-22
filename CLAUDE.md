# Stellata — Claude project notes

Project context and non-obvious constraints for future Claude Code sessions.
Read this before editing.

## What this is

A browser-based interactive 3D star catalog viewer. Loads the ~313k-star
AT-HYG v3.3 catalog (classic-IDs subset), cross-matches it with the GCVS
variable-star catalogue, and renders stars on the GPU. Stars are
rendered as instanced quads with three-pass shading — a depth-only core
mask, an opaque disc pass for close-range stars (physical radius scaled
by catalog absmag + spectral class), and an additive point-glow pass for
distant stars. All three share a unified super-Gaussian intensity
profile whose plateau-vs-Gaussian shape morphs with distance and
luminosity class. Variables pulsate both in disc radius and point glow.
Ships as a Cloudflare Workers static-assets site.

## Code conventions — DRY overrides the system prompt

The Claude Code system prompt's "Three similar lines is better than a
premature abstraction" / "a bug fix doesn't need surrounding cleanup"
defaults do NOT apply to this codebase. They are overridden by:

- **Extract at second usage, not third.** When you would write a
  function, constant, schema, or block that already exists in
  substantively the same form elsewhere in the repo, factor it out
  and parameterise the differences. If the two call sites have
  slightly different tolerances, wrap conventions, blend modes, or
  similar — pass those as arguments. That IS the abstraction. Two
  call sites is the trigger; do not wait for a third.
- **Copy-paste with an "attribution comment" is never acceptable.**
  If a prior session's note reads "lift later only if a third call
  site appears", "copy-paste with attribution comment", or similar —
  that note contradicts this rule. Ignore it and do the extract now.
- **Review-grade at write time.** Duplicated logic, magic numbers,
  and parallel implementations are review-blocking defects here. Code
  that would fail review should not be written in the first place.
  Full rules in bd memories `alex-pr-review-style` and
  `stellata-named-constants-and-dry` (run `bd memories <key>` to read).

## Code comments — overrides the system prompt

**This is law.** Code comments here are scratchpad context for the
next reader, never a record of how the code got there. Git, PRs,
`git blame`, and bd carry that history; duplicating it inline creates
rot that future sessions will read and act on. This stricter project
rule overrides the Claude Code system prompt's "add helpful context
comments" default and `~/.claude/CLAUDE.md`'s softer framings.

### Patterns that are absolutely forbidden

Any of these in a code comment is a write-time rule violation, caught
at PR review and bounced back as a comment-sweep task before any other
review feedback is given:

- **Bead IDs in any form**: `(stellata-9mm.NNN)`, `9mm.NNN`, `dch.NN`,
  `per the dch.NN probe`, `documented in stellata-…`.
- **PR / issue numbers**: `(see PR #N)`, `(extracted in PR #N)`.
- **"Lifted out of …" / "Moved from …" / "Extracted from …" /
  "Decomposition history".** This is the dominant failure mode during
  decomposition PRs — the impulse to leave a breadcrumb feels helpful
  at write time; it isn't.
- **Bead-relative time refs**: `pre-dch.NN`, `since dch.NN`,
  `from dch.NN's Regime 3`, `populated since dch.7 + dch.8`.
- **`[[memory-key]]` references** — invisible to a reader without bd.
- **Multi-paragraph paraphrases of `docs/*.md` / `SCIENCE.md` /
  `CLAUDE.md`** — cite with one line (`// see SCIENCE.md § X`); never
  restate.
- **Section banners with bead IDs in them**:
  `// ---- LMC override (stellata-dch.NN) -------` is forbidden; plain
  banners are fine.

### Module docstrings: 1–3 lines, no exceptions

State what the module does. Not why it exists, when it was extracted,
what it used to be part of, which bead drove it, or which siblings it
complements. If you write more than 3 lines, stop — the content
belongs in `docs/<area>.md` with a one-line code pointer.

### Substitution rule

When the impulse to write any forbidden pattern fires, ask which
surface should carry the content:

- Credit a bead → git commit subject, not the code.
- Explain what the file used to be → nothing; `git log -p` + `git
  blame` carry it.
- Point at a bd memory governing the code → update CLAUDE.md if it's
  a project-wide rule, otherwise leave it implicit.
- Restate an architecture section → one-line pointer to `docs/<area>.md`.
- Explain what a function does → better function name + type signature.

If none of those fit, the content is noise. Delete.

## Folder & module conventions

The codebase is organised by per-subsystem folder + cross-cutting type
folder + a minimal root. Adding a new module follows five rules so we
don't re-incur the kind of flat-folder / 4kloc-integration-shell drift
that motivated `stellata-9mm.194`:

- **Physical / visual / thematic subsystems get a folder from day 1.**
  When adding the next layer of the model (Local Bubble, nebulae,
  Radcliffe Wave, etc.), the first file lands in `src/client/<name>/`,
  not flat. Day 1 includes: the renderer file, its loader, its
  `*-pure.ts` helpers, its tests, its tuning section. CLAUDE.md's
  module roster gets the entry in the same PR. Existing examples:
  `solar-system/`, `local-group/`, `milkyway/`, `galactic/`,
  `molecular-clouds/`, `chart-mode/`.
- **Cross-cutting plumbing lands in the matching type folder.**
  Includes small one-off helpers — texture/buffer factories, parsers,
  adapters, sentinel constants — not just large utilities. `overlays/`,
  `camera/`, `loaders/`, `ui/`, `util/`, `typeahead/`, `modals/`,
  `debug/`. A new top-level type folder is only justified when 3+
  files belong there.
- **Controllers extract at write time, not retrospectively.** State
  with the shape "state struct + tick + dispose + state-changes-via-method"
  lands as its own controller class. Camera-bound: `camera/<name>-controller.ts`.
  Layer-bound: in the layer folder.
- **`stellata.ts` is the integration shell, not a default home.** New
  module-scope functions — factories, adapters, pure transforms — go
  in their matching subsystem folder even when small (a 5–20 line
  helper still qualifies). Default question before adding a top-level
  `function` / `const` in `stellata.ts`: would a future reader look
  here, or in `shaders/` / `loaders/` / `camera/` / `util/` / the
  layer's folder? If anywhere else, put it there. If genuinely nowhere
  else, that's the signal a new subsystem folder is justified, not
  that `stellata.ts` should grow. Generated artifacts marked
  `// AUTO-GENERATED` cannot host hand-written helpers — pair them
  with a sibling wrapper module (e.g. `foo-data.ts` generated +
  `foo.ts` hand-written) so regen never clobbers the wrapper.
- **No multi-paragraph in-code prose.** Physics derivations,
  calibration rationale, tuning history → `SCIENCE.md` or
  `docs/<area>.md`, with a one-line code-side pointer. Full rules
  in the "Code comments — overrides the system prompt" section
  above (hard 12-line ceiling, forbidden-pattern list, substitution
  table). The pure-helpers-extract-at-second-use companion to this
  rule is the DRY override stated in "Code conventions" above.

Controller-specific architectural prose lives in the matching
`docs/*.md` (`docs/architecture.md`, `docs/camera-warp.md`,
`docs/camera-observe.md`, `docs/camera-arrival.md`), updated by each
extraction PR as the boundary it documents stabilises. Code-review
patterns that catch recurring bug shapes are in
`docs/authoring-patterns.md`.

## Repo layout

```
scripts/                                     Each subsystem cluster owns a folder
                                             (stellata-9mm.204). Cross-folder
                                             imports are sys.path-based for Python
                                             and explicit relative paths for TS.
  catalog/
    build-catalog.ts                         AT-HYG + GCVS + CCDM + Bailer-Jones + Gaia Apsis
                                             + SIMBAD sp_type + Stellarium →
                                             public/catalog.bin (v6 binary) +
                                             public/constellations.json +
                                             public/search-index.json.
    build-catalog-expected.json              Build-count snapshot (UPDATE_BUILD_COUNTS=1).
    catalog-pure.ts                          Single source of truth for the v6 binary
                                             layout (HEADER_LAYOUT / RECORD_LAYOUT / MAGIC
                                             / NO_APSIS), resolveSpectralInfo (SIMBAD →
                                             GSP-Spec → fallback), physicalRadius,
                                             applyBailerJonesOverride, applyLmcKinematicOverride,
                                             inferBinaries, parseBailerJonesTsv,
                                             parseGaiaApsisTsv, parseSimbadSptypeTsv.
                                             Shared with src/client/loaders.
    catalog-pure.test.ts                     vitest pin for catalog-pure (binary-format
                                             constants, B-J / LMC override math, spectral
                                             parser shape).
    stars-parse.ts                           readStars — per-row AT-HYG ingest with the
                                             three-layer distance stack (B-J → LMC →
                                             MAX_DIST_PC), three-tier spectral resolver,
                                             Apsis routing, Gaia source_id resolution
                                             (AT-HYG-native + HIP→Gaia backfill).
                                             MAX_DIST_PC = 50,000 lives here.
    constellations.ts                        IAU constellation table + figure-line
                                             resolver from Stellarium HIP polylines.
    gaia-xmatch.ts                           Gaia DR3 HIP cross-walk reader
                                             (data/gaia/gaia_dr3_hip_xmatch.tsv) +
                                             companion vitest.
    gcvs-parse.ts                            parseGcvsMain + parseGcvsCrossref +
                                             bridgeGcvsByGaia + applyVariability +
                                             companion vitest.
    visual-doubles.ts                        Hipparcos CCDM parser with MultFlag {C,G,O}
                                             gate + curated KNOWN_VISUAL_DOUBLES set
                                             (Polaris / ε¹ Lyr / 61 Cyg).
    gaia-xmatch.test.ts, gcvs-parse.test.ts  vitest pins for those modules. (Other
                                             siblings — stars-parse, constellations,
                                             visual-doubles — are exercised through the
                                             catalog-pure / known-stars / distance-
                                             regression tests rather than per-file
                                             pins.)
    verify-catalog.ts                        sanity-check tool for the generated binary.
    catalog-lookup.ts                        runtime lookup helper used by known-stars.test.ts.
    star-fixture.ts                          shared test fixture for catalog-lookup-based tests.
    build-counts.ts                          BuildCounts schema + compareBuildCounts.
    build-counts.test.ts                     vitest pin for build-counts diff format.
    distance-regression-check.ts             Post-build distance gate — self-consistency
                                             (AT-HYG dist vs final) + SIMBAD cross-check
                                             (vs simbad_sample.tsv). Snapshot-pinned in
                                             build-distance-outliers-expected.json
                                             (UPDATE_DISTANCE_OUTLIERS=1). Hand-edited
                                             `reason` strings survive snapshot refresh
                                             via mergeReasonsFromSnapshot.
    distance-regression-check.test.ts        vitest pin for the regression-check module.
    build-distance-outliers-expected.json    Known-acceptable distance outliers (LMC
                                             kinematic snaps, B-J overrides on noisy
                                             G_R3 parallaxes, ρ Cas-class hypergiants).
    known-stars.tsv                          Tier A validation corpus (~50 hand-curated
                                             systems with HIP / Gaia source_id / distance ±
                                             1σ / absmag / spectral type / per-component
                                             tuples). Asserted against catalog.bin +
                                             multiples.tsv.
    known-stars.test.ts                      vitest driver for the Tier A corpus.
    validate-simbad-sample.ts                Tier C — cross-check the built catalog.bin
                                             against the committed SIMBAD random 10k
                                             sample. Manual run (`npm run validate:simbad`).
    validate-simbad-sample.test.ts           vitest pin for the validator helpers.
  binaries/
    build-binaries.py                        WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2
                                             + Gaia (HIP/Tyc xwalks, NSS, 5p astrometry)
                                             + SIMBAD WDS xids + SIMBAD per-component
                                             sp_type → data/binaries/multiples.tsv.
                                             Orchestration shell; per-stage logic in
                                             stage{2..7}_*.py.
    parsers.py                               Row dataclasses + parse functions for every
                                             reference catalogue (Stage 1).
    indices.py                               IdentifierIndices builder (HIP/Tyc → Gaia,
                                             src_id → astrometry / NSS / AT-HYG,
                                             HIP → HIP2 / CCDM, CCDM → HIP-list, etc.).
                                             Built once at Stage 1; every Stage 2-7
                                             lookup is O(1).
    stage2_resolve.py                        WDS-component → Gaia DR3 source_id cascade
                                             (orb6_hip → athyg_gaia_native → simbad_xid
                                             → ccdm_hip → AT-HYG position-match), with
                                             same-letter + Aa→A propagation.
    stage3_astrometry.py                     Per-component astrometry routing (gaia_5p /
                                             gaia_nss_systemic / hip2_long_baseline /
                                             unresolved). HIP2 is the Gaia-saturated
                                             bright-primary fallback.
    stage4_orbits.py                         Per-pair orbital-element selection
                                             (gaia_nss / orb6 / orb6_spectroscopic /
                                             none). Inline Heintz 1978 / Halbwachs+ 2023
                                             Thiele-Innes → Campbell algebra.
    stage5_optical.py                        Five-tier physical-vs-optical classification
                                             (WDS-notes → both-Gaia → asymmetric-Gaia
                                             → orbit-on-file → mag-gap).
    stage6_multiples.py                      Emit data/binaries/multiples.tsv with
                                             per-component provenance columns +
                                             system-anchor inheritance for tight inner
                                             binaries + SIMBAD standalone augmentation.
    stage7_counts.py                         Build-counts + build-rates snapshot writer
                                             (mirrors scripts/catalog/build-counts.ts).
    mass_estimate.py                         Phase 5 spectral-class-aware mass-ratio q
                                             backfill from Cox 2000 §15.2 / Pecaut &
                                             Mamajek 2013 tables.
    build-binaries.test.py                   stdlib unittest pins for Stages 1-7.
    build-binaries-expected.json             per-strategy / per-tier count snapshot
                                             (UPDATE_BUILD_COUNTS=1).
    build-binaries-rates-expected.json       per-strategy rate snapshot — catches
                                             population-mix shifts that don't shift
                                             absolute counts.
  distance-validation/
    validate-distances.py                    Compare build-catalog.ts output against
                                             Vaidman et al. 2025 BA-supergiant distances.
                                             Reports per-star fractional difference
                                             distribution; runs on every distance-source
                                             change (DR4 / StarHorse / B-J successor).
    validate-distances.test.py               stdlib unittest pin for the validator.
    build-vaidman-tsv.py                     One-time builder: paper appendix tables →
                                             data/distance-validation/vaidman-2025-supergiants.tsv.
    build-vaidman-tsv.test.py                stdlib unittest pin for the builder.
    common.py                                Shared helpers for both scripts.
  clouds/
    build-clouds.py                          Zucker 2020/2021 → public/clouds.json.
  dust/
    build-dust.py                            Edenhofer 2024 dust resampler +
                                             particle sampler (Python; LFS outputs).
    sync-dust.ts                             mirror data/dust → public/dust on dev/build.
    requirements-dust.txt                    pip deps for build-dust.py.
  local-group/
    build-local-group.ts                     LVDB + overrides.tsv → public/local-group.json
                                             (stellata-38m).
    build-local-group-pure.ts                pure helpers (RA/Dec→ICRS, orient →
                                             quaternion, override merge).
    build-local-group{,-pure}.test.ts        vitest pins for both halves.
  colour/
    blackbody-lut.ts                         Ballesteros 2012 + Planck + CIE 1931 →
                                             src/client/shaders/blackbody-lut-data.ts.
    blackbody-lut.test.ts                    vitest signature pin (`npm run build:lut`
                                             on drift).
  refresh/
    refresh_lib.py                           shared Astroquery / ADQL / atomic-rename
                                             plumbing for all refresh-*.py scripts.
    refresh_lib.test.py                      stdlib unittest pins for refresh_lib.
    refresh-bailer-jones.py                  → data/bailer-jones/bailer-jones-dr3.tsv
    refresh-gaia-apsis.py                    → data/gaia/gaia_dr3_apsis.tsv
    refresh-gaia-astrometry.py               reads data/gaia/gaia_astrometry_source_id_request.tsv,
                                             writes data/gaia/gaia_dr3_astrometry.tsv.
    refresh-gaia-hip-xmatch.py               → data/gaia/gaia_dr3_hip_xmatch.tsv
    refresh-gaia-nss.py                      → data/gaia/gaia_dr3_nss_two_body.tsv
    refresh-gaia-tyc-xmatch.py               → data/gaia/gaia_dr3_tyc_xmatch.tsv
    refresh-hipparcos2.py                    → data/hipparcos/hip2_van_leeuwen.tsv
    refresh-simbad-sample.py                 → data/simbad/simbad_sample.tsv
    refresh-simbad-sptype.py                 → data/simbad/simbad_sptype.tsv —
                                             orchestration shell over scripts/refresh/simbad/
                                             that pulls sp_type / sp_qual / sp_bibcode
                                             / otype + HIP / Gaia DR3 cross-IDs.
    refresh-simbad-wds-xids.py               → data/simbad/simbad_wds_xids.tsv —
                                             orchestrates the WDS↔Gaia cross-ID pull
                                             via wds_xids_cascade.py + wds_xids_overrides.py.
    wds_xids_cascade.py                      Per-component identifier cascade
                                             (HIP / Tycho / WDS-J variants) shared with
                                             refresh-simbad-wds-xids.py.
    wds_xids_cascade.test.py                 stdlib unittest pin for the cascade logic.
    wds_xids_overrides.py                    Hand-curated WDS-J coalesce overrides
                                             (Sirius B-shaped systems where SIMBAD
                                             collapses multiple WDS-J variants onto
                                             one Gaia source).
    wds_xids_overrides.test.py               stdlib unittest pin for the override
                                             merge logic.
    simbad/                                  reusable SIMBAD-pull plumbing —
                                             specs (ColumnSpec / IdentLookup),
                                             inputs (per-source-file id iterators),
                                             query (ADQL builders + batched
                                             executors), tsv (spec-driven writer).
                                             Modelled on scripts/binaries; future
                                             SIMBAD pulls (RV, photometry, …)
                                             reuse every file here.
    requirements-refresh.txt                 pip deps for the refresh family (astropy,
                                             astroquery, numpy). Install once via
                                             `python3 -m venv .venv &&
                                              .venv/bin/pip install -r
                                              scripts/refresh/requirements-refresh.txt`.
data/                                        Per-source-catalogue folders. LFS coverage
                                             is per-folder via .gitattributes patterns;
                                             stellarium/, local-group/, molecular-clouds/
                                             stay on regular git as the files are small.
  athyg/
    athyg_33_classic_ids.csv                 AT-HYG source CSV (~64 MB, LFS).
  bailer-jones/
    bailer-jones-dr3.tsv                     Bailer-Jones 2021 DR3 Bayesian distance
                                             posteriors (~23 MB, LFS).
  gaia/
    gaia_dr3_apsis.tsv                       Gaia DR3 Apsis astrophysical parameters (LFS).
    gaia_dr3_astrometry.tsv                  Gaia DR3 5p astrometry for resolved
                                             source_ids (LFS).
    gaia_dr3_hip_xmatch.tsv                  HIP → Gaia DR3 source_id cross-walk (LFS).
    gaia_dr3_nss_two_body.tsv                Gaia DR3 NSS two-body orbits (LFS).
    gaia_dr3_tyc_xmatch.tsv                  Tycho-2 → Gaia DR3 source_id cross-walk (LFS).
    gaia_astrometry_source_id_request.tsv    Stage 2 → Stage 3 deduped source_id request
                                             list (LFS).
  hipparcos/
    hip_ccdm.tsv                             Hipparcos HIP↔CCDM cross-reference (LFS).
    hip2_van_leeuwen.tsv                     Hipparcos-2 (van Leeuwen 2007) reduction (LFS).
  gcvs/
    gcvs5.txt                                GCVS main catalogue (~14 MB, LFS).
    crossid.txt                              GCVS cross-reference (~12 MB, LFS).
  wds/
    wds_summ.txt                             Washington Double Star summary (~20 MB, LFS).
    wds_notes.txt                            Per-pair WDS notes prose (LFS).
    wds_refs.txt                             WDS reference list (LFS).
    orb6_orbits.txt                          ORB6 sixth catalog of visual binary orbits (LFS).
  simbad/
    simbad_sample.tsv                        Stratified random 10k-star SIMBAD sample (LFS).
    simbad_wds_xids.tsv                      SIMBAD-curated per-component WDS↔Gaia DR3
                                             cross-IDs (LFS).
  binaries/
    multiples.tsv                            build-binaries.py output — two rows per
                                             kept WDS pair, plus standalone rows for
                                             SIMBAD-known components the pair walk
                                             didn't reach. Consumed today by the Tier A
                                             validation harness + ad-hoc debugging; the
                                             future per-frame binary-orbit runtime layer
                                             will read it directly (not merged into
                                             catalog.bin). (LFS)
  distance-validation/
    vaidman-2025-supergiants.tsv             Vaidman et al. 2025 BA-supergiant distance
                                             recalculation (132 rows; CC BY 4.0).
                                             Reference set for scripts/distance-validation/
                                             validate-distances.py.
    README.md                                Provenance + SIMBAD name-resolution recipe.
  stellarium/
    stellarium-modern-skyculture.json        Stellarium constellation lines (~200 KB,
                                             regular git).
  local-group/
    lvdb-snapshot.csv                        Pace 2024 LVDB dwarf_all (~430 KB, regular git).
    overrides.tsv                            hand-curated LMC / SMC / Sgr structural detail.
  molecular-clouds/
    zucker2020-tablea1.tsv                   Zucker 2020 cloud distances (~88 KB).
    zucker2021-table1.dat                    Zucker 2021 3D bounding boxes (~1 KB).
    zucker2021-table2.dat                    Zucker 2021 radial profile fits (kept for future).
    zucker2021-table3.dat                    Zucker 2021 cloud masses (kept for future).
  dust/
    chunk_X_Y_Z.bin                          64 voxel chunks, 2 MiB each, LFS.
    particles.bin                            50K importance-sampled dust points (LFS).
    manifest.json                            grid params + chunk index + particle count.
public/
  catalog.bin             generated (gitignored, ~24 MB, binary v6)
  constellations.json     generated (gitignored)
  search-index.json       generated (gitignored, ~13 MB raw, ~2 MB gzipped)
  clouds.json             generated (gitignored, ~30 KB)
  local-group.json        generated (gitignored, ~20 KB)
  dust/                   gitignored mirror of data/dust/
src/
  worker.ts               Cloudflare Worker entry (passthrough to ASSETS)
  client/
    main.ts               bootstrap
    stellata.ts           Three.js scene + state machine + event bus
    star-pipeline.ts      InstancedBufferGeometry + disc/glow/coreMask
                          ShaderMaterials + meshes; owns applyDiscBlendDefaults
                          + setMonochromeBlend + dispose. Extracted from
                          stellata.ts in 9mm.43.
    index.html, styles.css, globals.d.ts
    stellata-events.test.ts integration-shell event-emission test
    disc-blend.test.ts    star-disc/glow blend-equation parity test
    star-pipeline.test.ts dispose + uniform-sharing + blend defaults
    shaders/
      star.vert.glsl, star.frag.glsl              GLSL3/WebGL2
      planet.vert.glsl, planet.frag.glsl          three-pass instanced planet bodies (3re.16-17)
      perceptual-disc.glsl                        shared point-of-light disc/glow chunk (stars + planets)
      dust-particle.vert.glsl, dust-particle.frag.glsl   shelved dust splats
      cloud.vert.glsl, cloud.frag.glsl                   molecular cloud ellipsoids
    # ─── per-subsystem folders (rule 1) ─────────────────────────────
    solar-system/         planet-system, orbit-rings-layer, planet-body-field,
                          perceptual-magnitude, planet-labels, time, time-readout,
                          ephemeris, astronomy-constants, heliopause, first-load,
                          phase-function (+ tests for each)
    local-group/          local-group, local-group-loader, local-group-tuning
                          (+ tests). Local Group wireframes + MW + dwarf labels
    milkyway/             milkyway, milkyway-tuning. Volumetric disc + bulge
    galactic/             galactic-disc, galactic-fade, galactic-grid,
                          galactic-coords (+ tests). Disc outline / b-l grid /
                          GALACTIC_CENTRE_PC / shared fade smoothstep
    molecular-clouds/     molecular-clouds, cloud-loader (+ tests). Shelved
    dust/                 dust-particle-layer (+ tests). Instanced additive
                          billboards; shelved (strength=0 → mesh hidden
                          → zero per-frame cost). DustField + dust-loader stay
                          in loaders/. Extracted from stellata.ts in 9mm.194/70.
    chart-mode/           chart-mode, chart-labels, chart-disc-pure (+ tests).
                          Observe-only paper aesthetic
    hover/                hover-engine, hover-types, hover-pick-disambiguator,
                          per-layer hover providers, formatters/ (5 + tests)
    # ─── cross-cutting type folders (rule 2) ────────────────────────
    overlays/             constellation-overlay, disc-mask (+ pure),
                          distance-vector-overlay, focus-ring-overlay,
                          hud-overlay, poi-overlay, dirty-attr, overlay-project,
                          arrow-fade, arrow-path (+ tests)
    camera/               controls, observe-controls, focus-transition,
                          focus-target, arrival-curves, camera-motion, warp-pure,
                          warp-button, warp-tuning, mode-toggle, star-geometry,
                          star-physics, camera-up-align, up-align-pure, picker,
                          aim-controller, warp-controller, observe-transition,
                          focus-controller (+ tests).
                          timing.ts — CAMERA_LERP_MS / WARP_*_MS /
                          AIM_*_MS / OBSERVE_TRANSITION_MS / DCAM_LOG_FLOOR_PC /
                          WARP_BASE_DIR (canonical camera-wide constants;
                          renamed from warp-constants in 9mm.194.1).
                          picker.ts — pure target resolver; click + hover
                          pick paths for stars / clouds / planets / Local Group /
                          heliopause (extracted from stellata.ts in 9mm.194.3)
                          aim-controller.ts — mode-aware aim slerps (navigate
                          orbit-pivot + observe quaternion-in-place), shared
                          `aimDurationMs` ramp (extracted from stellata.ts in
                          9mm.194.4)
                          warp-controller.ts — 3-phase warp FSM (reorient
                          → fly → post-arrival) + WarpState + tryMidFlyRecentre
                          + swapObserveAnchor + FocusOps cross-controller seam
                          (extracted from stellata.ts in 9mm.194.5)
                          observe-transition.ts — navigate↔observe FSM:
                          ObserveTransitionState + setMode + startExit +
                          startUnfocusLerp + ObserveFocusOps seam (extracted
                          from stellata.ts in 9mm.194.6)
                          up-align-pure.ts — alignCameraUpToQuaternion
                          helper (lifted from stellata.ts in 9mm.194.6;
                          paired with the existing camera-up-align.test.ts
                          algebra fixture)
                          star-physics.ts — per-star camera/screen geometry:
                          fovMinorRad, peakAmplitudeFactor,
                          binaryCompanionFloorPc, minOrbitDistForStar,
                          parkDistForStar, renderedSizePx,
                          renderedDiscPxAtPeak, getChartDiscParams +
                          canonical ZOOM_FLOOR_FRACTION /
                          VAR_TROUGH_FLOOR_FRACTION /
                          BINARY_VIEWPORT_HALF_ANGLE_RAD /
                          BINARY_MIN_DIST_FACTOR (extracted from
                          stellata.ts in 9mm.194.9; sits between
                          star-geometry's pure formulae and the
                          per-frame uniform reads in stellata)
                          focus-controller.ts — focus FSM + focus-park
                          lerp + per-kind FocusTarget factories +
                          pin-engage geometry; FocusOps seam consumed
                          by WarpController; ObserveFocusOps seam
                          consumed by ObserveTransition. Canonical home
                          for GLOBAL_MIN_DIST_PC + PIN_ENGAGE_THRESHOLD_SQ_PC.
                          FrameAnchor (recenterOrigin + worldOffset +
                          starLocalPosition) stays on stellata.ts —
                          cleaner extraction is coupled to the
                          StarPipeline extract (9mm.43). Extracted from
                          stellata.ts in 9mm.194.8.
    loaders/              catalog-loader, dust-loader (+ tests). cloud-loader
                          lives under molecular-clouds/; local-group-loader
                          under local-group/
    ui/                   panel-layout, scale-bar, theme-toggle, unit-toggle,
                          distance-util, distance-gated-label, keyboard-shortcuts
                          (+ pure), dom-util (+ tests)
    util/                 event-bus, url-state (+ tests). Project-agnostic plumbing
    typeahead/            typeahead, typeahead-util, constellation-typeahead,
                          search (+ tests). Picker UI surface
    modals/               info-modal, brand-modal, help-modal, modal-dismiss.
                          Welcome / about / help overlays
    debug/                debug, debug-panel, perf-hud, pin-debug-hud,
                          arrow-fade-debug-hud, star-tuning (+ tests).
                          Debug-panel chrome + per-area tuning sections
```

## Local commands

```bash
npm run build:catalog   # regenerate public/catalog.bin (idempotent)
npm run build:binaries  # regenerate data/binaries/multiples.tsv (idempotent)
npm run dev             # preprocess + Vite dev server
npm run build           # full production build
npm run typecheck       # tsc --noEmit over src/ and scripts/
npm test                # vitest run (regression-prevention suite)
npm run test:watch      # vitest in watch mode
npm run test:coverage   # vitest run with v8 coverage
npm run deploy          # wrangler deploy (requires auth)
npx tsx scripts/catalog/verify-catalog.ts   # dump header + spot-check records
```

External-catalogue refresh (manual, never wired into `npm run build` —
see `docs/build-and-data.md` § Layer 2 for the protocol +
`RELEASING.md` § Catalogue refresh policy for cadence):

```bash
npm run refresh:gaia-hip          # Gaia DR3 HIP cross-walk
npm run refresh:gaia-tyc          # Gaia DR3 Tycho-2 cross-walk
npm run refresh:gaia-astrometry   # Gaia DR3 5p astrometry for resolved source_ids
npm run refresh:gaia-nss          # Gaia DR3 NSS two-body orbits
npm run refresh:gaia-apsis        # Gaia DR3 Apsis (gspphot ∪ gspspec)
npm run refresh:bailer-jones      # Bailer-Jones 2021 distance posteriors
npm run refresh:hip2              # Hipparcos-2 van Leeuwen reduction
npm run refresh:simbad            # SIMBAD random 10k validation sample
npm run validate:simbad           # Tier C cross-check of catalog.bin vs SIMBAD sample
```

The refresh scripts use astroquery + astropy + numpy. One-time setup:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/refresh/requirements-refresh.txt
```

Then activate (`source .venv/bin/activate`) before running any
`npm run refresh:*` target. `refresh-simbad-sptype.py` and
`refresh-simbad-wds-xids.py` (no npm target yet) are invoked directly
with `python3 scripts/refresh/refresh-simbad-*.py`.

## Documentation index

This file is the always-loaded entry point. The rest of the project's
constraints, formulas, and gotchas live in topic-specific docs that
Claude Code should read on demand when working on the relevant area.

- **`SCIENCE.md`** — every external data source (catalogues, papers, DOIs,
  licences) and the physics/modelling decisions baked into the build
  pipeline and renderer. Read when adding or changing anything
  science-driven, or to look up a citation.
- **`docs/build-and-data.md`** — binary catalog format, search index,
  build scripts (`build-catalog.ts`, `build-clouds.py`, `build-dust.py`),
  Stellarium HIP resolution, geometric-binary inference, GCVS
  cross-match, Layer 1 reference-data table + Layer 2 refresh
  protocol, multi-layer distance refinement (B-J → LMC → MAX_DIST_PC)
  + Apsis surfacing, reference epoch + PM-not-applied contract,
  binary-system pipeline (Stages 1-7), idempotency. Read when
  touching `scripts/` or `data/`.
- **`docs/cross-match.md`** — engineer-audience walk-through of the
  source-ID-anchored catalogue pipeline. Stage-by-stage as-built
  behaviour of `build-binaries.py` + the catalog-side B-J / LMC /
  MAX_DIST_PC / Apsis routing, with canonical enum values
  (`RESOLVE_VIA_VALUES`, `ASTROMETRY_VIA_VALUES`, `ORBIT_VIA_VALUES`,
  `OPTICAL_VIA_VALUES`) + numeric thresholds quoted from code. Tier
  A/B/C validation harness, DR4 refresh recipe, debug recipes. ~10
  min read. Read when refreshing external catalogues, adding to the
  Tier A corpus, or debugging a per-star resolution / distance /
  spectral-classification failure.
- **`docs/architecture.md`** — event bus, click-state machine, focused
  constellation aim, floating origin, pin-to-center, FocusTarget
  contract. The cross-cutting patterns the rest of the codebase
  assumes. Read when changing state flow, focus/vector behaviour, or
  anything that reads star positions. The 194 extraction chain adds
  per-controller sections (Picker / Aim / Warp / ObserveTransition /
  Focus) here as each one lands.
- **`docs/authoring-patterns.md`** — write-time consistency rules
  (lifecycle pairing, sibling symmetry, sentinel-init for dirty-track,
  single source of truth for time / camera state). Read before adding
  a new `bus.on()` call, a sibling of an existing helper, a sentinel-
  init dirty-track pattern, or any state struct shifted mid-animation.
- **`docs/url-state.md`** — `?v=` URL wire format: v3 envelope,
  presence mask, per-component vec3 sub-masks, legacy v1/v2 decode,
  process for adding a field, console helpers. Read when touching
  `url-state.ts` or changing what serialises to `?v=`.
- **`docs/rendering.md`** — full render stack table (WebGL renderOrder
  + SVG source order + per-layer visibility gates), then the star
  pipeline core: instanced quads, three passes (core depth-mask + disc
  + glow), super-Gaussian intensity profile, physical-size, luminosity
  softness, variable pulsation, per-star dust extinction. Read when
  touching the star shaders or the magnitude / size / dust knobs, or
  when reasoning about why one layer paints on top of another.
- **`docs/galactic-overlay.md`** — galactic disc outline, coordinate
  sphere (b/l grid), Sol/GC SVG arrows, HUD ring, navigate↔observe
  shaft-start lerp. Read when touching any of those layers.
- **`docs/local-group.md`** — Local Group wireframe layer (LMC, SMC,
  Sagittarius dSph, classical dSphs, LVDB ultra-faints — plus M31,
  M33, NGC 205, M 32, IC 10 and the outer-band dIrrs out to 2 Mpc),
  MW label, per-object dwarf labels via the shared distance-gated
  label engine. Data pipeline + override schema (with optional
  standalone-position columns for objects not in LVDB) + orient
  specs + quaternion construction. Read when touching `local-group.{ts,
  test.ts}`, `local-group-loader.ts`, `scripts/local-group/build-local-group*.ts`,
  or `data/local-group/`.
- **`docs/molecular-clouds.md`** — cloud ellipsoids: data, shader,
  the unified cloud-as-focus / cloud-as-vector-tip click and warp UX.
  Read when touching `molecular-clouds.ts` or cloud picking.
- **`docs/milky-way.md`** — volumetric disc + bulge: density
  profiles, magnitude-consistency conversion, analytical-only dust,
  render-order placement, brightness/glow calibration. Read when
  tuning `milkyway.{ts,frag.glsl}`.
- **`docs/solar-system.md`** — solar-system layer (`stellata-3re`):
  JPL Standish ephemerides, planet-bodies + orbit-rings + heliopause
  rendering, ecliptic-vs-galactic-plane orientation rule, time `t`
  and the UTC readout, Sol-focus minDistance relaxation, the canonical
  no-URL first-load view (5 AU galactic-centre-aimed park via `first-load.ts`).
  Read when touching `ephemeris.ts`,
  `time.ts`, `planet-system.ts`, `orbit-rings-layer.ts`,
  `planet-body-field.ts`, `perceptual-magnitude.ts`,
  `planet-labels.ts`, `heliopause.ts`, `first-load.ts`, or any
  `planet.*.glsl` / `heliopause.*.glsl` / `perceptual-disc.glsl`.
- **`docs/chart-mode.md`** — paper aesthetic: flat hard-edged discs,
  isobar contours for MW + clouds, the per-frame
  label / glyph engine, picking under chart mode. Read when touching
  `chart-mode.ts`, `chart-labels.ts`, or any chart-specific shader
  branch.
- **`docs/overlays.md`** — SVG layers above the canvas: constellation
  stick-figures, disc-mask, focus ring, distance vector with near-plane
  clipping. (The Sol/GC SVG arrows are documented in
  `docs/galactic-overlay.md` alongside the rest of the galactic
  overlay feature.) Read when touching anything in `*-overlay.ts` or
  `*-mask.ts`.
- **`docs/hover.md`** — hover-label engine, per-layer providers and
  formatters, and the four UX conventions (spell out units, no
  focus-gate on hover, whole-object hit surface for extended objects,
  HTML monospace typography in chart mode). Read when touching
  anything in `src/client/hover/` or adding a hover surface to a new
  layer.
- **`docs/ui-and-controls.md`** — layout containers, panel
  reverse-sync, magnitude presets + override flags, FOV / theme /
  debug-panel hooks, brand box, keyboard shortcuts (single capture-
  phase listener + DOM-relocate modal for the Go / Constellation
  pickers), CSS gotchas (`[hidden]` specificity, `backdrop-filter`
  stacking contexts). Read when touching the panel/topbar.
- **`docs/camera-controls.md`** — near-plane vs minDistance invariant,
  TrackballControls tuning, two-finger roll gesture (platform-split).
  Read when touching camera geometry or gesture handling.
- **`docs/camera-warp.md`** — warp animation (3-phase state machine),
  scale-bar smoothness, navigate↔observe interactions at launch /
  arrival, floating-origin recentre. Read when touching focus travel
  or warp UX.
- **`docs/camera-observe.md`** — OBSERVE mode: look-around controller,
  drag mechanics, momentum, FOV-on-wheel, aim slerps, POI dispatch,
  single/double click handlers, navigate-mode close-zoom unfocus.
  Read when touching observe-mode behaviour.
- **`docs/camera-arrival.md`** — angular-arrival problem and the
  log-distance smoothstep profile the `camera-motion.ts` helper applies
  to focus-park, warp Fly, and unfocus. Worked examples for Sol /
  Betelgeuse, why the two-region `dWindow` split was rejected, why
  warp Phase 3 stays inline. Read when touching `camera-motion.ts`,
  `focus-transition.ts`, or the arrival branches of `updateWarp` /
  `unfocus`.
- **`docs/deployment.md`** — Wrangler config, `@cloudflare/workers-types`
  global leak, `compatibility_date`, `custom_domain` DNS auto-registration.
  Read when changing deployment or worker code.
- **`docs/ux-tweaks.md`** — reference table of UX knobs (orbit feel,
  chevron density, focus-ring size, panel defaults, etc.) and where to
  find them. Read when the user asks for a tweak.
- **`docs/performance.md`** — `perf-hud.ts` instrumentation, the
  `debug.panel()` activation path, the per-frame sections measured in
  `animate()` / `chart-labels.ts`, and the chart-mode optimisations
  (centroid cache, eligibility prefilter, dirty-tracked SVG writes,
  full-tick skip, sorted-distance core-mask window). Read when
  profiling, tuning a hot path, or wiring new instrumentation.

## Temporarily shelved

Code paths preserved; rendering / visibility disabled until the visual
treatment is refined. Don't refactor the underlying machinery away.

- **Molecular cloud overlay.** `molecular-clouds.ts`, `cloud-loader.ts`,
  the cloud shaders, and `data/molecular-clouds/` all stay; the user
  toggle is removed from settings and `FilterState.showMolecularClouds`
  defaults to `false`. URL flag bit 2 is reserved for the prior
  encoding. Chart-mode still calls `setCloudsIsobar` against the
  invisible layer so the integration is intact for re-enable.
- **Volumetric Milky Way in chart mode.** `Milkyway.setIsobar` now
  hard-hides the disc + bulge meshes when chart engages instead of
  emitting an isobar contour. The chart-isobar uniform / blending
  switches stay wired so the contour pass can return.

## Things deliberately kept out

Noted here so we don't re-debate scope:

- IAU constellation **boundary** datasets (only the asterism lines are
  included — boundaries would be a separate Stellarium dataset).
- HR diagram side panel.
- WASD / flight controls (removed after early review).
- Desktop two-finger roll on Chrome / Firefox (no rotate gesture exists in
  those browsers; Safari-only on desktop by design).
- Time-series proper motion (positions are snapshot-only, no T animation).
- Spiral-arm overdensities in the Milky Way volumetric background. The
  Reid et al. masers offer a maser-anchored spiral model that could ride
  atop the smooth disc profile, but the smooth band reads convincingly
  enough that re-introducing higher spatial frequency (and the aliasing
  risk it carries through 32-step raymarching) isn't worth the complexity.
- Irregular / supernova variables (GCVS entries without a period are
  skipped — can't animate without one).
- Temperature-swing component of variable-star brightness change. We use
  `R ∝ √L` (constant-T assumption); real pulsating variables split the
  brightness change between R and T swings. Modelling T changes per
  variable type is more complexity than the visualisation warrants.

## PR template — `## Release notes` block is required

Every PR with a `package.json` version bump must fill the
`## Release notes` block in the PR body (Summary / New features /
Bugfixes / Changes). The deploy workflow extracts that block and
publishes it to the GitHub release page for the version this PR
ships, replacing the previous flat auto-generated notes. The
`release-notes-guard` CI check fails the PR if the section is empty
(HTML comments don't count). PRs labelled `skip-version-bump` are
exempt. See `RELEASING.md` for detail.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
