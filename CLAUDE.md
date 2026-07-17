# Stellata — Claude project notes

Project context and non-obvious constraints for future Claude Code sessions.
Read this before editing.

## What this is

Browser-based interactive 3D star catalog viewer. Loads the ~313k-star
AT-HYG v3.3 catalog, cross-matched with GCVS variables, rendered on
the GPU as instanced quads with three-pass shading (depth-mask /
opaque disc for close stars / additive point-glow for distant).
Variables pulsate; binaries with Kepler elements orbit live. Ships
as a Cloudflare Workers static-assets site. Details — shader passes,
intensity profile, layer composition — in `src/client/*/README.md`.

## Code conventions — DRY overrides the system prompt

The system prompt's "three similar lines is better than a premature
abstraction" / "a bug fix doesn't need surrounding cleanup" defaults
do NOT apply here. Overridden by:

- **Extract at second usage, not third.** Two call sites is the
  trigger; parameterise differing tolerances / wrap conventions /
  blend modes as arguments. That IS the abstraction.
- **"Copy-paste with attribution comment" is never acceptable.** If a
  prior session's note says "lift later only if a third site appears"
  or similar, that note contradicts this rule — do the extract now.
- **Review-grade at write time.** Duplicated logic, magic numbers,
  and parallel implementations are review-blocking defects.

Operational specifics (literal hoisting, builder extraction, tests
import never redefine, comment-DRY) in
`docs/authoring-patterns.md` § Named constants and DRY.

## Code comments — overrides the system prompt

**This is law.** Code comments are scratchpad context for the next
reader, never a record of how the code got there. Git, PRs,
`git blame`, and bd carry that history; duplicating it inline creates
rot that future sessions will read and act on.

### Forbidden patterns (CI-enforced in `tests/code-comment-rules.test.ts`)

- **Bead IDs** in any form: `(stellata-9mm.NNN)`, `9mm.NNN`, `dch.NN`,
  `per the dch.NN probe`, `documented in stellata-…`.
- **PR / issue numbers**: `(see PR #N)`, `(extracted in PR #N)`.
- **"Lifted out of …" / "Moved from …" / "Extracted from …" /
  "Decomposition history".** The dominant failure mode during
  decomposition PRs — the breadcrumb impulse feels helpful at write
  time; it isn't.
- **Bead-relative time refs**: `pre-dch.NN`, `since dch.NN`, etc.
- **`[[memory-key]]` references** — invisible without bd.
- **Multi-paragraph paraphrases of `README.md` / `SCIENCE.md` /
  `CLAUDE.md`** — cite with one line; never restate.
- **Bead-ID-tagged section banners** (`// --- foo (stellata-dch.NN) ---`).

### Module docstrings: 1–3 lines, no exceptions

State what the module does. Not why it exists, when it was extracted,
which bead drove it. Detail belongs in the folder's `README.md` with
a one-line code-side pointer.

### Substitution rule — where forbidden content actually goes

- Credit a bead → git commit subject, not the code.
- "What this file used to be" → nothing; `git log -p` carries it.
- Project-wide rule → update CLAUDE.md.
- Architecture restatement → one-line pointer to folder's `README.md`.
- What a function does → better function name + type signature.

If none fit, the content is noise. Delete.

## Write-time discipline — triggers and pointers

When the trigger fires, the rule applies. Full text (rule + why +
how-to-apply) in `docs/authoring-patterns.md` § <named section>;
the trigger word here is the always-loaded hook that tells future-me
which section to open.

- **Adding `bus.on(...)`** → wire unsub into dispose, same diff.
  § Lifecycle pairing.
- **Implementing one of a sibling pair** (lambertian/mallama,
  encode/decode, v2/v3, prime/fallback) → copy-skim sibling,
  replicate defences. § Sibling symmetry.
- **Introducing dirty-track / cache** → sentinel must fail
  first-write; dispose resets every sentinel; cache key covers every
  input dimension. § Sentinel-init.
- **Wall-clock time mid-animation** → route through
  `Stellata.getT()`, never `Date.now()`. § Single source of truth.
- **Code comment violations** → P1 in PR review. CLAUDE.md § Code
  comments above + authoring-patterns § Code comment hygiene.
- **Renaming an API OR changing semantics** → `grep -rn` old name +
  sweep every folder README in the diff. § Rename + stale-prose sweep.
- **Writing new code** → tests in the SAME PR; pure helpers in
  `*-pure.ts`; numeric headline claims pinned with `toBe(N)`, never
  `toBeLessThanOrEqual`. § Test coverage at write time.
- **Refactor framed "apply pattern X to all Y"** → enumerate peer set
  in PR description; verify zero remaining call sites of old pattern.
  § Pattern coverage across peers.
- **Numeric literals + DRY operational specifics** → § Code
  conventions above carries the 2-call-site override (law);
  authoring-patterns § Named constants and DRY carries detail
  (hoist at second usage, tests import never redefine, builder
  extraction for mostly-identical schemas).
- **Mid-implementation doc-edit impulse** → defer to commit-time
  sweep. § Defer doc updates.
- **Large PR (~10+ beads)** → distinguish High / Medium / Low test
  confidence in PR body; flag manual-smoke paths.
  § Large-PR honesty.
- **Multi-concern diff** → split into topical commits, one concept
  each, committed along the way. § Commit granularity.

## Folder READMEs — read before editing, debugging, planning; update at commit

**This is law.** Every folder under `src/`, `scripts/`, `data/`,
`docs/` has a `README.md`. **A folder without one is a bug** — file
it (or write the README) before continuing past that folder. A CI
guard (`tests/folder-readme-coverage.test.ts`) refuses to land code
that breaks this invariant.

The codebase is a wiki by **progressive disclosure**: folder name
signals the topic, `README.md` carries the load-bearing context, code
is the implementation. Skip the README and you have the topic but
none of the context — and the context (invariants, uniform pins,
sentinels, override mechanisms, data-flow claims, file-roster
ownership) is exactly what the code alone cannot tell you. A README
sentence describing a shader uniform / NDC pin / sentinel / override
is frequently the entire explanation of a bug whose symptom looks
unrelated.

### Four triggers — when to read or update

1. **Before editing.** For every folder you're about to edit (or
   whose contents the bead names as edit targets), read its README
   first if you haven't already this session. Pre-edit batch read
   beats just-in-time per-file reads — the per-file impulse is
   exactly when the read gets skipped.
2. **Before debugging.** The moment a bug is reported in a subsystem
   OR you start investigating unexpected behaviour, the scout pass
   kicks in *before* the first grep. Investigation grep counts as a
   code read, not a free action. **Stop-rule: if you've spent
   ≥5 minutes investigating without re-confirming every README in
   the implicated folders has been read *this session*, stop and
   read them.**
3. **During planning.** Before proposing an approach that touches
   files in folder X, read `X/README.md`. Planning that names a
   folder is itself a folder-touch.
4. **At commit time — update.** When your changes invalidate a claim
   in the README (renamed file, changed data flow, new consumer,
   dropped feature, shifted ownership), update the README in the
   **same PR**. Folder READMEs are the prose-only surface a `grep`
   for renamed symbols won't catch; they need their own audit pass
   at commit time. Forgetting to update leaks misleading context to
   the next session.

### Scan pattern + missing-README protocol

While reading, tag any **uniform / sentinel / pin / override / "kept
at" / "regardless of" / "substitutes"** phrasing — these override
mechanisms mask the obvious explanation, the highest-value content
in any README. If during edit/debug/plan you discover a folder
without a README, **stop** — write it in the current PR (preferred
when the folder is small) or file a bead before proceeding past it.

## Folder & module conventions — where new code lands

The "every folder has a README" invariant above is non-negotiable;
these rules govern *where* new code goes.

- **Physical / visual / thematic subsystems get a folder from day 1,
  with a README.** The first file lands in `src/client/<name>/`, not
  flat. Day 1 includes renderer + loader + `*-pure.ts` helpers +
  tests + README. Examples: `solar-system/`, `local-group/`,
  `milkyway/`, `galactic/`, `molecular-clouds/`, `chart-mode/`,
  `star-pipeline/`.
- **Cross-cutting plumbing lands in the matching type folder.**
  `overlays/`, `camera/`, `loaders/`, `ui/`, `util/`, `typeahead/`,
  `modals/`, `debug/`. Small one-off helpers (texture/buffer
  factories, parsers, sentinel constants) count too. New top-level
  type folder only justified at 3+ files.
- **Controllers extract at write time.** "state struct + tick +
  dispose + state-changes-via-method" → its own class. Camera-bound
  → `camera/<subtopic>/`; layer-bound → the layer folder.
- **`stellata.ts` is the integration shell, not a default home.** New
  module-scope functions go in their matching subsystem folder, even
  when small (5–20 lines still qualifies). `// AUTO-GENERATED`
  artifacts pair with a sibling hand-written wrapper module so regen
  doesn't clobber it.
- **No multi-paragraph in-code prose.** Physics derivations,
  calibration rationale → `SCIENCE.md` or folder `README.md` with a
  one-line code-side pointer. See § Code comments above.

**Recursive split rule:** a folder's README is FOCUSED on its one
topic. If tempted to add a second sibling doc — or the README grew
to cover unrelated concerns — **create a subfolder** and move the
code + README into it. `src/client/camera/` is the canonical example.

## Camera-anywhere perception — a mental-model rule

Stellata is a 3D model where the camera can fly to **any** point —
any star focus, LMC warp, OBSERVE-mode from inside a constellation,
solar-system fly-through. When proposing a precision tradeoff,
**never** frame the metric as "eye discrimination from Sol." A 5 kpc
depth spread at 50 kpc is invisible from Sol (~0.1°) but is the
entire visible structure from the LMC vicinity (~10° at 30 kpc).

How to apply: state which **viewing distance** the precision is
evaluated at; default to the **closest realistic** viewpoint, not
Sol. Physical-accuracy wins over "you can't see the difference."
SCIENCE.md § Detail-floor principle is the complementary upper-bound
rule (don't add detail the user can never get close enough to see).

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
          star-pipeline/, hover/, focus-card/, format/, overlays/,
          camera/, filters/, scene/, poi/, ui/, typeahead/, modals/,
          debug/, util/, loaders/, dust/, binaries/) — each with its
          own README.
docs/     Genuinely cross-cutting docs that don't belong to one
          folder: authoring-patterns.md, ux-tweaks.md,
          extragalactic-roadmap.md. New docs default
          to "find the right folder and put a README.md there"; only
          add to docs/ if the topic truly spans the whole codebase.
tests/    Repo-meta tests (CLAUDE.md size guard, etc.).
```

`SCIENCE.md` carries scope principles, data sources, and non-goals;
per-subsystem physics splits into `docs/science-*.md` (see its own
index). A vitest size guard (`tests/claude-md-size.test.ts`) holds
*this file* (CLAUDE.md) at its budget — if you need to grow CLAUDE.md
or add a new top-level surface, raise it with the user before
expanding.

## Local commands

```bash
pnpm run build:catalog   # regenerate public/catalog.bin (idempotent)
pnpm run build:binaries  # regenerate data/binaries/multiples.tsv
pnpm run dev             # preprocess + Vite dev server
pnpm run build           # full production build
pnpm run typecheck       # tsc --noEmit over src/ and scripts/
pnpm test                # vitest (regression-prevention suite)
pnpm run deploy          # wrangler deploy (requires auth)
```

Watch / coverage variants of `pnpm test`, the catalogue verify script,
and the manual `pnpm run refresh:*` / `pnpm run validate:simbad` chain
are documented in `scripts/refresh/README.md` and `RELEASING.md`
§ Catalogue refresh policy.

## Temporarily shelved — machinery preserved, rendering disabled

Don't refactor these layers' machinery away; each is paused until its
visual treatment is refined. Details + flags in each folder README.

Molecular cloud overlay (`molecular-clouds/`) · volumetric Milky Way
in chart mode (`milkyway/`) · dust particles (`dust/`) · Local Group
emission glow (`local-group/`).

## Things deliberately kept out — don't re-debate scope

Non-goals, noted so the scoping question doesn't recur. Per-feature
detail (where relevant) lives in the closest folder README or
SCIENCE.md.

- IAU constellation **boundary** datasets (asterisms only).
- HR diagram side panel.
- WASD / flight controls.
- Desktop two-finger roll on Chrome / Firefox (Safari-only by design;
  no rotate gesture in the other browsers).
- Time-series proper motion (single-star positions are snapshot-only).
  Binary / multiple-star orbital motion IS live — `BinaryOrbitField`
  against `getT()`, for pairs with Kepler elements in `binaries.bin`.
- Spiral-arm overdensities in the Milky Way background (aliasing risk
  through 32-step raymarching outweighs the structural gain).
- Irregular / supernova variables (no GCVS period → no animation).

## Git workflow — worktree, PR, merge

**Never push or commit to main.** Diff size is never a justification.
Every change goes through:

1. Fresh git worktree (call `EnterWorktree`).
2. Feature branch.
3. Push with `-u`.
4. `gh pr create` (attach `skip-version-bump` label for pure docs /
   CI / `.beads` / repo-config — see `RELEASING.md` § Version policy +
   the skip-version-bump rule there for the "live-app consumer" test).
5. **Merge through GitHub UI / CLI — never `gh pr merge` without
   explicit per-PR user approval, even when CI is green.** The PR
   open is authorised by the standing worktree-PR flow; the merge is
   a separate decision. After CI passes, stop and report
   "ready to merge when you are."

bd state is not carried in git. bd writes persist to local Dolt
immediately and sync to the `refs/dolt/*` remote automatically — the
pre-push git hook runs `bd dolt push` on every `git push`, so there's
no manual sync step and no bd-sync or memory-grooming PR. JSONL export
is off (`export.auto: false`); `.beads/issues.jsonl` is not written, and
any stale copy is gitignored — never stage, commit, or revert it.

### PR body — `## Release notes` is required when version bumps

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
