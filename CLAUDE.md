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
- **Multi-paragraph paraphrases of `README.md` / `SCIENCE.md` /
  `CLAUDE.md`** — cite with one line (`// see SCIENCE.md § X`); never
  restate.
- **Section banners with bead IDs in them**:
  `// ---- LMC override (stellata-dch.NN) -------` is forbidden; plain
  banners are fine.

### Module docstrings: 1–3 lines, no exceptions

State what the module does. Not why it exists, when it was extracted,
what it used to be part of, which bead drove it, or which siblings it
complements. If you write more than 3 lines, stop — the content
belongs in the folder's `README.md` with a one-line code pointer.

### Substitution rule

When the impulse to write any forbidden pattern fires, ask which
surface should carry the content:

- Credit a bead → git commit subject, not the code.
- Explain what the file used to be → nothing; `git log -p` + `git
  blame` carry it.
- Point at a bd memory governing the code → update CLAUDE.md if it's
  a project-wide rule, otherwise leave it implicit.
- Restate an architecture section → one-line pointer to the folder's
  `README.md`.
- Explain what a function does → better function name + type signature.

If none of those fit, the content is noise. Delete.

## Folder & module conventions — one folder, one topic, one README

The codebase is organised as a wiki: every folder owns one topic,
documented in its own `README.md`. The folder name + README is the
documentation index. Recursively — when a folder accumulates content
that doesn't fit a single coherent topic, **split into subfolders**;
don't add a second sibling doc.

**Per-folder README is context, not just output.** Before editing
OR debugging files inside a subfolder that has its own `README.md`,
read it if you haven't this session — it carries invariants,
conventions, and historical decisions the code alone won't tell you
(the file roster explains what each module owns; the prose explains
*why*). The trigger is "editing OR debugging," not just editing:
when a bug is reported in a subsystem, the scout pass kicks in
*before* the first grep. A README sentence describing a shader
uniform / NDC pin / sentinel / override is frequently the entire
explanation of a bug whose symptom looks unrelated — skim past it
once and the next 30 minutes are spent re-deriving it. **Stop-rule:
if you've spent ≥5 minutes investigating a bug and haven't
re-confirmed every README in the implicated folders has been read
*this session*, stop and read them.** When your changes invalidate
a claim in the README — renamed file, changed data flow, new
consumer, dropped feature, shifted ownership — update the README in
the same PR. Folder READMEs are the prose-only surface a `grep` for
renamed symbols won't catch; they need their own audit pass at
commit time. Forgetting to read leaks pre-existing context to next
session; forgetting to update leaks misleading context. The five
"adding new code" rules below are why the README exists; this
paragraph is how to USE it.

Five rules for adding new code:

- **Physical / visual / thematic subsystems get a folder from day 1,
  with a README.** When adding the next layer of the model (Local
  Bubble, nebulae, Radcliffe Wave, etc.), the first file lands in
  `src/client/<name>/`, not flat. Day 1 includes: the renderer file,
  its loader, its `*-pure.ts` helpers, its tests, its tuning section,
  AND `src/client/<name>/README.md` describing the topic. Existing
  examples: `solar-system/`, `local-group/`, `milkyway/`, `galactic/`,
  `molecular-clouds/`, `chart-mode/`, `star-pipeline/`.
- **Cross-cutting plumbing lands in the matching type folder.**
  Includes small one-off helpers — texture/buffer factories, parsers,
  adapters, sentinel constants — not just large utilities. `overlays/`,
  `camera/`, `loaders/`, `ui/`, `util/`, `typeahead/`, `modals/`,
  `debug/`. A new top-level type folder is only justified when 3+
  files belong there.
- **Controllers extract at write time, not retrospectively.** State
  with the shape "state struct + tick + dispose + state-changes-via-method"
  lands as its own controller class. Camera-bound: in the matching
  `camera/<subtopic>/` subfolder. Layer-bound: in the layer folder.
- **`stellata.ts` is the integration shell, not a default home.** New
  module-scope functions — factories, adapters, pure transforms — go
  in their matching subsystem folder even when small (a 5–20 line
  helper still qualifies). Default question before adding a top-level
  `function` / `const` in `stellata.ts`: would a future reader look
  here, or in `star-pipeline/` / `loaders/` / `camera/<sub>/` / `util/`
  / the layer's folder? If anywhere else, put it there. If genuinely
  nowhere else, that's the signal a new subsystem folder is justified,
  not that `stellata.ts` should grow. Generated artifacts marked
  `// AUTO-GENERATED` cannot host hand-written helpers — pair them
  with a sibling wrapper module (e.g. `foo-data.ts` generated +
  `foo.ts` hand-written) so regen never clobbers the wrapper.
- **No multi-paragraph in-code prose.** Physics derivations,
  calibration rationale, tuning history → `SCIENCE.md` or the folder's
  `README.md`, with a one-line code-side pointer. Full rules in the
  "Code comments — overrides the system prompt" section above (hard
  12-line ceiling, forbidden-pattern list, substitution table). The
  pure-helpers-extract-at-second-use companion to this rule is the
  DRY override stated in "Code conventions" above.

The recursive split rule: a folder's README should be FOCUSED on its
one topic. If you're tempted to write a second sibling doc, or the
README has grown to cover unrelated concerns, the right move is to
**create a subfolder** and move the relevant code + README into it.
The parent becomes a thin coordinator (README + any genuinely shared
cross-subtopic file). `src/client/camera/` is the canonical example
(controls/ + warp/ + observe/ + arrival/ subfolders + shared
`timing.ts` + coordinator README).

Code-review patterns that catch recurring bug shapes are in
`docs/authoring-patterns.md`.

## Repo layout — the structure is the index

Top-level folders. Navigate the wiki by folder name + each folder's
`README.md` — that's the documentation index. Don't expect a flat
table of every doc here; the folder tree IS the table.

```
scripts/  Build scripts. Per-pipeline subfolders (catalog/, binaries/,
          distance-validation/, clouds/, dust/, local-group/, colour/,
          refresh/). scripts/README.md carries the cross-folder build
          narrative (binary catalog format, Layer 1/2 split, distance
          refinement, idempotency).
data/     Reference inputs. Per-source subfolders; LFS coverage
          per-folder via .gitattributes. data/README.md carries the
          frozen-external-data policy + per-source orientation.
public/   Generated artifacts (gitignored). Built from scripts/+data/.
src/      Worker entry (worker.ts) + client. src/client/ has one
          subfolder per subsystem (solar-system/, local-group/,
          milkyway/, galactic/, molecular-clouds/, chart-mode/,
          star-pipeline/, hover/, overlays/, camera/, ui/, typeahead/,
          modals/, debug/, util/, loaders/, dust/, binaries/) —
          each with its own README.
docs/     Genuinely cross-cutting docs that don't belong to one
          folder: authoring-patterns.md, ux-tweaks.md. New docs default
          to "find the right folder and put a README.md there"; only
          add to docs/ if the topic truly spans the whole codebase.
tests/    Repo-meta tests (CLAUDE.md size guard, etc.).
```

Read `SCIENCE.md` for every external data source (catalogues, papers,
DOIs, licences) and the physics/modelling decisions baked into the
build pipeline + renderer.

When adding a new folder, write its `README.md` in the same PR — the
folder + README is the topic doc, and the file system stays
self-documenting only if every subsystem has one. A vitest size guard
(`tests/claude-md-size.test.ts`) holds this file at its budget; if you
need a new top-level surface or want to grow CLAUDE.md, raise it with
the user before expanding.

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
see `scripts/refresh/README.md` for the protocol +
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

One-time Python venv setup is documented in `scripts/refresh/README.md`.

## Temporarily shelved

Code paths preserved; rendering / visibility disabled until the visual
treatment is refined. Don't refactor the underlying machinery away.

- **Molecular cloud overlay.** Layer renders nothing — the user toggle
  is removed and `FilterState.showMolecularClouds` defaults to false;
  URL flag bit 2 is reserved. Chart-mode still calls `setCloudsIsobar`
  against the invisible group. See `src/client/molecular-clouds/README.md`.
- **Volumetric Milky Way in chart mode.** `Milkyway.setIsobar` hides
  the disc + bulge meshes when chart engages. The chart-isobar uniform
  / blending switches stay wired so the contour pass can return. See
  `src/client/milkyway/README.md`.
- **Dust particle layer.** Rendered at strength=0 → mesh hidden → zero
  per-frame cost. Machinery preserved. See `src/client/dust/README.md`.

## Things deliberately kept out

Noted here so we don't re-debate scope:

- IAU constellation **boundary** datasets (only the asterism lines are
  included — boundaries would be a separate Stellarium dataset).
- HR diagram side panel.
- WASD / flight controls (removed after early review).
- Desktop two-finger roll on Chrome / Firefox (no rotate gesture exists in
  those browsers; Safari-only on desktop by design).
- Time-series proper motion (single-star positions are snapshot-only,
  no T animation). Binary / multiple-star orbital motion IS live —
  driven by `BinaryOrbitField` against `getT()` — but only for pairs
  with published Kepler elements in `public/binaries.bin`.
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
