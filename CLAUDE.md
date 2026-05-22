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
that motivated the convention:

- **Physical / visual / thematic subsystems get a folder from day 1.**
  When adding the next layer of the model (Local Bubble, nebulae,
  Radcliffe Wave, etc.), the first file lands in `src/client/<name>/`,
  not flat. Day 1 includes: the renderer file, its loader, its
  `*-pure.ts` helpers, its tests, its tuning section. The matching
  `docs/<name>.md` gets a "Files in this area" section in the same PR
  (see § Repo layout below). Existing examples: `solar-system/`,
  `local-group/`, `milkyway/`, `galactic/`, `molecular-clouds/`,
  `chart-mode/`.
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

Top-level shape only — per-area file rosters live in the matching
`docs/<area>.md` (see § Documentation index below). Each area doc
carries its `scripts/` + `data/` + `src/client/` slices.

```
scripts/  Build scripts. Per-pipeline folders: catalog/, binaries/,
          distance-validation/, clouds/, dust/, local-group/, colour/,
          refresh/.
data/     Reference inputs. Per-source-catalogue folders; LFS coverage
          is per-folder via .gitattributes patterns.
public/   Generated artifacts (gitignored).
src/      Worker entry + client. Per-subsystem folders under
          src/client/ per § Folder & module conventions above.
docs/     Topic-area docs; one per subsystem.
tests/    Repo-meta tests (CLAUDE.md size guard, etc.).
```

When adding a new module or folder, the matching `docs/<area>.md`
gets the "Files in this area" entry in the SAME PR — that's the
single source of truth that keeps the per-area rosters from drifting
out of sync with the code. A vitest size guard
(`tests/claude-md-size.test.ts`) holds this file at its budget; if a
new top-level concept doesn't fit the existing topic-tree shape,
raise it with the user before expanding CLAUDE.md.

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
constraints, formulas, gotchas — AND the per-area file rosters — live
in topic-specific docs that Claude Code should read on demand when
working on the relevant area. Each doc opens with "Files in this area"
listing every `scripts/` / `data/` / `src/client/` file the area owns.

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
- **`docs/solar-system.md`** — solar-system layer: JPL Standish
  ephemerides, planet-bodies + orbit-rings + heliopause
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
