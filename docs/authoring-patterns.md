# Authoring patterns — consistency at the seam

Stellata's instances of the write-time consistency rules. The rules
themselves live at user level, in the code-standards bundle: the `code-craft`
skill's `references/write-time-patterns.md` (lifecycle pairing, sibling
symmetry, sentinel-init, single source of truth, named constants, rename
sweep, test coverage, peer coverage, doc updates) and the always-on block in
`~/.claude/CLAUDE.md` (DRY, commit granularity, large-PR honesty). Each
section below names the generic section it narrows and adds only what is
true here: the stellata spelling, the representative finding, and the gate
that enforces it.

## Lifecycle pairing

Narrows write-time patterns § Lifecycle pairing.

- Each `bus.on()` subscription returns or stores an unsub that the
  dispose path calls.
- Each pool / buffer that grows has a hard cap or `shrinkIfIdle`, OR an
  explicit "we don't bother" comment with bound math.
- Each `subarray` / `Uint8Array.subarray` view returned across a method
  boundary documents its lifetime ("invalidated after grow / detach")
  OR returns a copy.

Representative finding: `EventBus` had no `clear()` so cross-session
subscriptions leaked. The fix wired `clear()` into the dispose path in
the same diff.

## Sibling symmetry

Narrows write-time patterns § Sibling symmetry. Common pairs in stellata:
lambertian vs mallama phase factors; encode vs decode for URL state; v2 vs v3
schema; pickStar prime vs fallback; reserved-bit decode vs ignore.

Representative finding: `empiricalPhaseFactor` didn't clamp α while
`lambertianPhaseFactor` did. The sibling pair needs to clamp
identically or document the asymmetry as intentional.

## Sentinel-init for dirty-track

Narrows write-time patterns § Sentinel-init for dirty-tracking and caches.
The sentinels used here are `NaN`, `-Infinity`, or a poison string like `\0`.
A label cache key covers text + font-load + CSS class + scale, not just text.

Representative finding: `pointerEvents = ""` sentinel matched
steady-state so first-frame write was skipped, leaving the overlay
unresponsive until the second frame.

## Single source of truth for time / camera state / world offset

Narrows write-time patterns § Single source of truth for shared state. Code
that needs the wall-clock-derived `t` reads it via `Stellata.getT()` — never
`Date.now()` directly. Code that mutates a state struct mid-animation (e.g.
`WarpState.pEnd` shifted across origin recentre) either makes the entire
struct frame-coherent OR adds an explicit invariant comment naming which
fields are valid in which phase.

Representative finding: `PlanetBodyField.attachHost` called
`Date.now()/1000` instead of routing through `getT()`; that drifted from
the live-`t` clock the rest of the solar-system layer reads.

## Code-comment hygiene

**Treat code-comment violations as P1 in PR review**, not P3 polish.
The comment rule is law — a comment earns its keep only when its absence
would cause a wrong call — and the forbidden patterns (bead-IDs, PR
references, "extracted from" history, `[[memory-key]]` wikilinks, oversized
module docstrings) rot fastest, with future sessions acting on them.
[Code comments](/AGENTS.md#code-comments--what-ci-enforces-here) lists the literal forms CI catches. The
recurring failure mode is "small leftover breadcrumb you didn't think
mattered" landing in a PR and then misleading every reader downstream.

Enforcement runs at CI time in `tests/code-comment-rules.test.ts`:

- **Forbidden-pattern scan** — strict for all `*.ts` / `*.js` / `*.py`
  files under `src/` and `scripts/`. Bead-IDs, PR refs, and memory-key
  wikilinks fail the suite immediately.
- **Module-docstring length** — 1-3-line cap with an allowlist
  (`tests/code-comment-rules-allowlist.txt`) grandfathering the
  pre-existing offenders. New files MUST stay under the cap. The
  allowlist is intended to **shrink**; the second test in the suite
  fails on stale entries (file removed, or docstring already trimmed)
  so cleanup progress is visible.

When the test fails:
- For forbidden patterns: drop the bead-ID / PR ref — credit a bead in the
  commit subject, not the code.
- For docstring length: trim to ≤3 lines and move detail to the folder
  `README.md` with a one-line code-side pointer. Don't add a new
  allowlist entry unless the file is genuinely out-of-scope to fix in
  this PR.

A comment restating README content written minutes earlier is the dominant
failure mode. When the prose lands in the same commit, `commit-sweep-guard`
denies it — [The restatement sweep](/scripts/hooks/README.md#the-restatement-sweep).
Prose from an earlier commit is invisible to it, and that case is caught by
write order:

- **Write the folder README prose first, code comments last** — one
  code-side statement of a contract maximum, usually the type or field
  docstring, with the prose in the README.
- **Re-run the gate at commit time**, diffing for comment lines you
  added. Comments written early in a diff predate the README update and
  need the re-audit; the gate is naming the concrete wrong action a
  future reader takes *without* the comment.
- **Test files carry intent in the `it()` / `describe()` title.** Add a
  fixture comment only where a non-obvious fixture choice would
  otherwise be "simplified" away in a later pass. The comment density
  in the existing binaries and test files reads as licence; it isn't.

## When to apply

These are write-time rules, not review-time rules:

- When adding a `bus.on(...)` call, find the dispose path of the file in
  the same diff and add the unsub.
- When adding `growCapacity` or `pool.push`, define the upper bound and
  a comment justifying it.
- When implementing one of a sibling pair, copy-skim the sibling and
  replicate every defence (or document the asymmetry as intentional).
- When adding a sentinel, write the first-write assertion explicitly.
- When reading time-of-day for ephemerides, route through
  `Stellata.getT()`.
- When opening a PR, run `npx vitest run tests/code-comment-rules` once
  before push to surface bead-ID / docstring violations before review.

## Named constants and DRY

Narrows write-time patterns § Named constants. Tuned values here are pixel
thresholds, mag-biases, near/far clamps and bit positions; mostly-identical
builders are wire-schema versions, materials differing only in blend
equation, and solvers differing only in tolerance or wrap convention.

### The star count is never a literal

Stellata's case of the generic rule "a quantity the system can compute is
never a literal". **Trigger: writing how many stars Stellata holds.** The
catalogue is the only thing that knows, and it has moved — binary components
are minted beyond the AT-HYG spine, so the shipped record count exceeds the
spine's 313,257 and drifts again on every refresh. A number typed into
copy is stale from the next build.

- **A surface a user reads** takes it live: `catalog.count` once the
  catalogue is loaded (the About modal), or `import.meta.env`
  `.VITE_STAR_COUNT` before it is (the requires-WebGPU gate,
  `index.html`). `vite.config.ts` reads that off the built catalogue's
  own header, and it is empty on a checkout with no artifacts — so
  every consumer needs a wording that survives having no number.
- **Prose cannot read anything**, so it rounds, and
  `tests/star-count-consistency.test.ts` re-derives the rounding from
  the header and fails when a refresh moves it.
- **`313,257` is a different quantity** — AT-HYG's frozen spine rows,
  documented in `catalog-driver.md`. It is not the number of stars
  drawn, and the two are not interchangeable.

## Rename + stale-prose sweep

Narrows write-time patterns § Rename and stale-prose sweep. A move includes
moving a README section into a new folder (the § Folder READMEs split).

- The search is `grep -rn "<old-name>" .`, skipping `node_modules`,
  `.git` and `public/`.
- The docs to re-read are every folder README in the diff —
  [Folder READMEs](/AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit) is the read/update protocol and this
  section its commit-time leg — plus `docs/*.md`, `SCIENCE.md`, `AGENTS.md`
  and `RELEASING.md`.
- `RELEASING.md` classifies version bumps: a user-visible behaviour change is
  at minimum a minor bump even if the diff is small.
- Numerical examples to recompute are arcseconds, AU and decimal precision.
- **Pointers are checked; the basename search is not.** Cite a section as
  `<path>.md#<slug>` — a markdown link in `.md`, the bare token in code —
  and `tests/doc-pointer-resolution.test.ts` fails the suite when the slug
  no longer names a heading or `<a id>` anchor in that file, so a split or
  a heading rename breaks the build until its inbound pointers are
  repointed. A bare `§ Heading` naming no file is unchecked. Grammar and
  resolution: [Doc-pointer resolution](/tests/README.md#doc-pointer-resolution).

Every other stale claim — a data-flow sentence, a file roster, "X doesn't
ingest Y" — is caught by the reader or not at all.

## Test coverage at write time

Narrows write-time patterns § Test coverage at write time. Pure helpers lift
to a `*-pure.ts` sibling; a numeric headline claim is pinned with
`expect(x).toBe(N)`, never `toBeLessThanOrEqual(N)`; a migration path such as
the v2→v3 URL rewrite is promoted from manual smoke to vitest.

Audit the diff before opening a PR:

1. Each new function or class has a vitest. If pseudo-private, lift
   to module scope or a `*-pure.ts` sibling first.
2. Each numeric claim in title / summary / release notes has a
   `toBe(N)` somewhere.
3. New typed-array plumbing has a read-back test with known values
   (trigger grow + shift, assert at known offsets).
4. Two-tier / N-tier control flow (prime vs fallback) exercises each
   tier; priority semantics is a separate assertion.

## Pattern coverage across peers

Narrows write-time patterns § Pattern coverage across peers. Peer sets here:
every SVG overlay, every event handler, every picker entry point, every
shader pass, every DRY blend. The canonical peer list comes from
[Repo layout](/AGENTS.md#repo-layout--the-structure-is-the-index) and the layer's folder README; a
deliberately deferred site gets a follow-up bead. Two peers on two strategies
(per-attribute dirty-track vs whole-frame signature dirty-track) record the
chosen one in the layer's `README.md`. Sibling hosts for a feature extended
to stars are clouds and planets.

## Defer doc updates — descriptions, not decisions

Narrows write-time patterns § Doc updates — defer descriptions, write
decisions now. The docs in question are `AGENTS.md`, folder `README.md`s,
`docs/` and `SCIENCE.md`; the design doc a settled decision goes into is the
folder README. At the commit sweep, new uniforms count among the things to
search the final diff for.
