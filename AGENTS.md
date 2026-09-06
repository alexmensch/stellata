# Stellata — project notes for coding agents

Project context and non-obvious constraints for future agent sessions. Read
this before editing. `CLAUDE.md` is a symlink to this file, because Claude Code
reads only that name; every other harness reads `AGENTS.md`. Standing personal
rules (worktree/PR flow, code comments, DRY, PR-body style) live in the
user-level `~/.claude/CLAUDE.md` and are not restated here; this file carries
what is specific to stellata.

## What this is

Browser-based interactive 3D star catalog viewer. Loads the ~390k-star
catalog derived from AT-HYG v3.3 + GCVS variables, rendered on
the GPU as instanced quads with three-pass shading (depth-mask /
opaque disc for close stars / additive point-glow for distant).
Variables pulsate; binaries with Kepler elements orbit live. Ships
as a Cloudflare Workers static-assets site. Details — shader passes,
intensity profile, layer composition — in `src/client/*/README.md`.

## Code comments — what CI enforces here

The rule (default none, the gate, forbidden categories, 1–3-line module
docstrings, the substitution table) is a standing global rule. Stellata adds
enforcement: `tests/code-comment-rules.test.ts` scans `*.{ts,js,py}` under
`src/` and `scripts/`. Literal forms that fail the suite:

- **Bead IDs**, any form — `(stellata-9mm.NNN)`, `9mm.NNN`, `dch.NN`, `per the
  dch.NN probe`, `documented in stellata-…`; bead-relative time refs
  (`pre-dch.NN`, `since dch.NN`); bead-ID-tagged section banners
  (`// --- foo (stellata-dch.NN) ---`).
- **PR / issue numbers** — `(see PR #N)`, `(extracted in PR #N)`.
- **`[[memory-key]]` wikilinks** — invisible without bd.
- **Module docstrings over 3 lines** — the allowlist
  (`tests/code-comment-rules-allowlist.txt`) grandfathers pre-existing
  offenders and is intended to shrink; new files must stay under the cap.

CI can't catch a comment that merely restates `README.md` / `SCIENCE.md` /
`AGENTS.md` prose. Write order catches that one:
`docs/authoring-patterns.md` § Code-comment hygiene.

## Write-time discipline — triggers and pointers

Trigger fires → rule applies. Full text (rule + why + how-to-apply)
in `docs/authoring-patterns.md` § <named section>; the trigger word
here is the always-loaded hook pointing to which section to open.

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
- **Code comment violations** → P1 in PR review. § Code-comment hygiene.
- **Renaming an API OR changing semantics** → `grep -rn` old name +
  sweep every folder README in the diff. § Rename + stale-prose sweep.
- **Writing new code** → tests in the SAME PR; pure helpers in
  `*-pure.ts`; numeric headline claims pinned with `toBe(N)`, never
  `toBeLessThanOrEqual`. § Test coverage at write time.
- **Refactor framed "apply pattern X to all Y"** → enumerate peer set
  in PR description; verify zero remaining call sites of old pattern.
  § Pattern coverage across peers.
- **Numeric literals** → hoist at the second usage; tests import the
  constant and never redefine it. § Named constants and DRY.
- **Mid-implementation doc-edit impulse** → defer to commit-time
  sweep. § Defer doc updates.
- **Large PR (~10+ beads)** → distinguish High / Medium / Low test
  confidence in PR body; flag manual-smoke paths. § Large-PR honesty.
- **Multi-concern diff** → split into topical commits, one concept
  each, committed along the way. § Commit granularity.
- **A frozen table lacks a column you need** → run the re-pull; you
  have network access. Never scope a design around it or hand the
  fetch back. `scripts/refresh/README.md` § Who runs a refresh.
- **Adding or touching a render layer, pass, or per-frame buffer
  write** → read `docs/render-rules.md` first (visible-count draws,
  liveness gating, single-writer buffers, measurement canon).

## Folder READMEs — read before you touch the folder; update at commit

**Law.** Every folder under `src/`, `scripts/`, `data/`, `docs/` has a
`README.md` — a folder without one is a bug; file it or write it
before continuing past that folder. CI
(`tests/folder-readme-coverage.test.ts`) enforces this invariant, and
`tests/readme-size.test.ts` caps each at **450 lines** — `readme-guard`
charges the nearest README before any code read, so length is a tax on
every future session. Over the cap → § Split, don't shave.

The codebase is a wiki by **progressive disclosure**: folder name
signals the topic, README carries the load-bearing context —
invariants, uniform pins, sentinels, overrides, data-flow claims,
file-roster ownership — that code alone cannot tell you. A single
README sentence about a shader uniform / NDC pin / sentinel / override
is often the entire explanation for a bug whose symptom looks
unrelated.

### Split, don't shave

**Over the cap the default is a folder split, not a rewording pass.** The
observed failure is rounds of re-tightening already-tight prose to claw
back single lines: a session burnt, a denser and worse README. Reword only
genuinely redundant prose — a claim stated twice, superseded history
another doc carries; never delete invariants to fit.

Seam: the README's largest self-contained topic plus the leaf module
owning it. Right when the moved code imports nothing from the parent and a
session asking about that topic is better served landing in the subfolder.
The moved README may still document constants that stayed behind — say
where they live and it stays the authority. Wrong when the subfolder's
files all import back into the parent, or the topic has no module of its
own to move and the split would be README-only.

### Four triggers — when to read or update

1. **Before reading a folder's code — for any reason.** Editing it,
   reviewing a diff that lands in it, or answering a question about
   it: read that folder's README first if not already read this
   session. Batch the reads up front — per-file is exactly when the
   read gets skipped, and a well-written diff or PR body is the
   likeliest thing to convince you the read is redundant.
2. **Before debugging.** A bug report or unexpected behaviour
   triggers the scout pass *before* the first grep — investigation
   grep counts as a code read, not a free action. **Stop-rule:**
   ≥5 minutes investigating without confirming every implicated
   README read *this session* → stop and read them.
3. **During planning.** Before proposing an approach that touches
   files in folder X, read `X/README.md`. Planning that names a
   folder is itself a folder-touch.
4. **At commit time — update.** When changes invalidate a README
   claim (renamed file, changed data flow, new consumer, dropped
   feature, shifted ownership), update it in the **same PR** — a
   `grep` for renamed symbols won't catch stale prose, so it needs its
   own audit pass at commit time. Skipping it leaks misleading context
   forward.

### Scan pattern + missing-README protocol

While reading, tag **uniform / sentinel / pin / override / "kept at" /
"regardless of" / "substitutes"** phrasing — these mask the obvious
explanation and are a README's highest-value content. Discover a
folder without one during edit/review/debug/plan → **stop**: write it now
(preferred when small) or file a bead before proceeding past it.

## Folder & module conventions — where new code lands

The "every folder has a README" invariant above is non-negotiable;
these rules govern *where* new code goes.

- **Physical / visual / thematic subsystems get a folder from day 1,
  with a README.** First file lands in `src/client/<name>/`, not
  flat — day 1 includes renderer + loader + `*-pure.ts` helpers +
  tests + README. Examples: `solar-system/`, `local-group/`,
  `milkyway/`, `galactic/`, `molecular-clouds/`, `chart-mode/`,
  `star-pipeline/`.
- **Cross-cutting plumbing lands in the matching type folder.**
  `overlays/`, `camera/`, `loaders/`, `ui/`, `util/`, `typeahead/`,
  `modals/`, `debug/` — small one-off helpers (texture/buffer
  factories, parsers, sentinel constants) count too. New top-level
  type folder needs 3+ files to justify.
- **Controllers extract at write time.** "state struct + tick +
  dispose + state-changes-via-method" → its own class. Camera-bound
  → `camera/<subtopic>/`; layer-bound → the layer folder.
- **`stellata.ts` is the integration shell, not a default home.** New
  module-scope functions go in their subsystem folder even when small
  (5–20 lines qualifies). `// AUTO-GENERATED` artifacts pair with a
  hand-written wrapper module so regen doesn't clobber it.
- **No multi-paragraph in-code prose.** Physics derivations,
  calibration rationale → `SCIENCE.md` or folder `README.md` with a
  one-line code-side pointer.

**Recursive split rule:** a folder's README is FOCUSED on its one
topic. If tempted to add a second sibling doc — or the README grew
to cover unrelated concerns — **create a subfolder** and move the
code + README into it. `src/client/camera/` is the canonical example.

## Camera-anywhere, any-epoch — a mental-model rule

Stellata is a 3D model with two axes of freedom the user controls: the
camera flies to **any** point (star focus, LMC warp, OBSERVE mode,
solar-system fly-through), and the clock scrubs
3000 BC – 3000 AD (~5,000 yr of star propagation either way).

**Anti-pattern: evaluating a tradeoff from one vantage, at one moment.**
Any error vanishes if you pick the observer and the instant that hide it
— from Sol, today, most of the model rounds away. Inadmissible whatever
is being traded (precision, detail, a dropped term, a substituted
default), and it smuggles in Sol-relative vocabulary: "depth" and
"sideways" split a quantity into a part that matters and a part that
doesn't purely by where Sol sits.

How to apply: state the **vantage** and the **epoch offset** behind any
claim, defaulting to the extremes the model allows — closest realistic
viewpoint, clock's limit. "Negligible / invisible / doesn't matter"
without both is not a claim. Physical accuracy is the mandate; "you
can't see the difference" never overrides it. SCIENCE.md § Defer detail
until zoom affordance is the complementary upper-bound rule (don't add
detail the user can never get close enough to see).

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
          subfolder per subsystem (solar-system/, local-group/, milkyway/,
          galactic/, molecular-clouds/, chart-mode/, star-pipeline/, hover/,
          focus-card/, format/, overlays/, camera/, filters/, scene/, poi/,
          ui/, typeahead/, modals/, debug/, util/, loaders/, dust/, binaries/,
          chrome-lines/, render-gate/) — each with its own README.
docs/     Genuinely cross-cutting docs that don't belong to one
          folder: authoring-patterns.md, render-rules.md, ux-tweaks.md,
          extragalactic-roadmap.md. New docs default to "find the
          right folder and put a README.md there"; only add to docs/
          if the topic truly spans the whole codebase.
tests/    Repo-meta tests (AGENTS.md size guard, etc.).
.claude/  Harness config, deliberately outside this index: hook wiring
          for Claude Code. Bodies live in scripts/hooks/ (own README).
```

`SCIENCE.md` carries scope principles, data sources, and non-goals;
per-subsystem physics splits into `docs/science-*.md` (see its own
index). A vitest size guard (`tests/agents-md-size.test.ts`) holds
*this file* (AGENTS.md) at its budget — if you need to grow AGENTS.md
or add a new top-level surface, raise it with the user before
expanding.

## Local commands

```bash
pnpm run build:catalog   # regenerate public/catalog.bin (idempotent)
pnpm run build:binaries  # regenerate data/binaries/multiples.tsv
pnpm run dev             # preprocess + Vite dev server
pnpm run build           # full production build
pnpm run typecheck       # tsc --noEmit
pnpm test                # vitest
pnpm run deploy          # wrangler deploy (requires auth)
```

Watch/coverage variants of `pnpm test`, the catalogue verify script,
and the manual `pnpm run refresh:*` / `pnpm run validate:simbad` chain
are documented in `scripts/refresh/README.md` and `RELEASING.md`
§ Catalogue refresh policy.

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Git workflow — stellata gates

The worktree → feature branch → `push -u` → PR → approval-gated-merge flow is
a standing global rule; **never push or commit to main**, and diff size is
never a justification. What this project adds:

- **`skip-version-bump` label** on `gh pr create` for pure docs / CI /
  `.beads` / repo-config changes — see `RELEASING.md` § Version policy, the
  "live-app consumer" test.
- **`## Release notes` is required whenever the version bumps.** Every PR with
  a `package.json` version bump fills that block in the PR body (Summary /
  New features / Bugfixes / Changes). The deploy workflow extracts it and
  publishes it to the GitHub release page for the version this PR ships,
  replacing the flat auto-generated notes. `release-notes-guard` CI fails the
  PR if the section is empty (HTML comments don't count); `skip-version-bump`
  PRs are exempt. Detail in `RELEASING.md`.
- **bd state isn't carried in git.** Writes persist to local Dolt immediately
  and sync to `refs/dolt/*` automatically — the pre-push hook runs
  `bd dolt push` on every `git push`, so no manual sync and no bd-sync PR.
  JSONL export is off (`export.auto: false`); `.beads/issues.jsonl` isn't
  written, and any stale copy is gitignored — never stage, commit, or revert
  it.

---

**Everything below this line is generated and rewritten in place by `bd`, and
has the LOWEST precedence in this file.** Where it conflicts with a rule above
or with a standing global rule, the rule above wins. Specifically, its
"Session Completion" checklist does **not** override § Git workflow: the push
it mandates is to the session's feature branch (never `main`), merging still
needs explicit per-PR approval, and its manual `bd dolt push` step is already
handled by the pre-push hook.

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
