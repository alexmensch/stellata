# Authoring patterns — consistency at the seam

A bundle of consistency rules that catch a recurring class of subtle
bugs in stellata code. Each is the codified version of a retrospective
code-review finding; apply at write time, not at review time. These
patterns sit alongside the DRY override in `CLAUDE.md` § "Code
conventions" — together they define the write-time bar this codebase
holds itself to.

## Lifecycle pairing

Every long-lived resource has its teardown wired in the SAME diff that
introduces it.

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

Two sibling functions / helpers / branches must be defensively
symmetric. Common pairs in stellata: lambertian vs mallama phase
factors; encode vs decode for URL state; v2 vs v3 schema; pickStar
prime vs fallback; reserved-bit decode vs ignore.

If one clamps inputs, the other clamps. If one asserts a bit budget,
the other asserts. If one logs on degenerate input, the other logs.
Asymmetry invites "I'll just call X — same shape" mistakes downstream.

Representative finding: `empiricalPhaseFactor` didn't clamp α while
`lambertianPhaseFactor` did. The sibling pair needs to clamp
identically or document the asymmetry as intentional.

## Sentinel-init for dirty-track

When introducing dirty-track / cache patterns:

- The sentinel initial value MUST fail the comparison on first write
  (force first-write to land — choose `NaN`, `-Infinity`, or a
  poison-string like `\0` if the desired state can legitimately equal
  the natural sentinel).
- Hide / dispose / reset paths MUST reset every numeric sentinel and
  every cached input — not just visibility flags.
- Cache keys MUST include every input dimension that affects the cached
  output (text + font-load + CSS class + scale, not just text).

Representative finding: `pointerEvents = ""` sentinel matched
steady-state so first-frame write was skipped, leaving the overlay
unresponsive until the second frame.

## Single source of truth for time / camera state / world offset

Code that needs the wall-clock-derived `t` reads it via
`Stellata.getT()` — never `Date.now()` directly. Code that mutates a
state struct mid-animation (e.g. `WarpState.pEnd` shifted across origin
recentre) either makes the entire struct frame-coherent OR adds an
explicit invariant comment naming which fields are valid in which phase.

Representative finding: `PlanetBodyField.attachHost` called
`Date.now()/1000` instead of routing through `getT()`; that drifted from
the live-`t` clock the rest of the solar-system layer reads.

## Code-comment hygiene

**Treat code-comment violations as P1 in PR review**, not P3 polish.
The comment rule is law — a comment earns its keep only when its absence
would cause a wrong call — and the forbidden patterns (bead-IDs, PR
references, "extracted from" history, `[[memory-key]]` wikilinks, oversized
module docstrings) rot fastest, with future sessions acting on them.
CLAUDE.md § Code comments lists the literal forms CI catches. The
recurring failure mode is "small leftover breadcrumb you didn't think
mattered" landing in a PR and then misleading every reader downstream.

Enforcement runs at CI time in `tests/code-comment-rules.test.ts`:

- **Forbidden-pattern scan** — strict for all `*.ts` / `*.py` files
  under `src/` and `scripts/`. Bead-IDs, PR refs, and memory-key
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

CI catches the forbidden patterns; it can't catch a comment that merely
restates something already written elsewhere. That one is caught by
write order:

- **Write the folder README prose first, code comments last.** A comment
  restating README content written minutes earlier is the dominant
  failure mode — one code-side statement of a contract maximum, usually
  the type or field docstring, with the prose in the README.
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

The law is *extract at second usage, not third* — parameterise the differing
tolerances / wrap conventions / blend modes as arguments; that IS the
abstraction. This section carries the operational rules that follow.

1. **Hoist numeric literals at first sight of a second usage.** Any
   literal referenced in more than one place — or that encodes a
   tuned / calibrated value (pixel thresholds, mag-biases, near/far
   clamps, bit positions) — gets a named export at its canonical
   source module. If a literal is calibrated by feel, it MUST be
   named — the name documents intent.

2. **Tests IMPORT constants from production code, never redefine.**
   Redefining magic numbers in tests divorces them from the
   production value and lets calibration drift go undetected.

3. **Schemas / structures / functions that are mostly-identical
   share a builder.** When two versions of a wire schema differ in
   only a few entries, or two materials differ only in blend
   equation, or two parsers differ only in field projection, or two
   solvers differ only in tolerance / wrap convention — extract a
   builder / factory / helper and parameterise the differences.
   "Slightly different X and Y" between two call sites is the case
   FOR extracting, not against it.

4. **Comment-DRY counts.** If the same caveat appears verbatim in
   two consumer files, hoist the comment to the source helper.

The two-call-site threshold is firm. If a previous session left a
"copy-paste with attribution comment" or "lift later only if a third
site appears" note, treat it as a fileable defect, not precedent —
the "premature abstraction" default is overridden here.

## Rename + stale-prose sweep

When a PR renames or removes an API surface (function, method, event,
class, mechanism, named threshold) OR substantively changes the
**semantics** of code in a folder, treat it as a sweep, not just a
refactor.

1. `grep -rn "<old-name>" .` (skip `node_modules`, `.git`, `public/`)
   and triage every hit.
2. **Open every README.md in every folder touched by the diff.** Read
   as if seeing it the first time. Folder READMEs are the prose-only
   surface where grep alone misses stale claims — they describe data
   flow, file rosters, "X feeds Y", "X doesn't ingest Y." See
   CLAUDE.md § Folder READMEs for the read/update protocol; this
   section is its commit-time enforcement leg.
3. Open every other doc in the diff context (`docs/*.md`,
   `SCIENCE.md`, `CLAUDE.md`, `RELEASING.md`) and re-read. Stale
   prose is the most common drift class.
4. When changing semantics of a quantity referenced in a docblock,
   open the docblock and re-read its rationale. If your change
   invalidates the prose, update it.
5. Numerical sanity-check examples in docs (arcseconds, AU, decimal
   precision) need to be paste-computed themselves.
6. `RELEASING.md` classifies version bumps. A user-visible behaviour
   change is at minimum a minor bump even if the diff is small.

No test catches stale prose; the next reader is misled.

## Test coverage at write time

When writing code, add tests **in the same PR** for:

- **Pure helpers** — extract to module scope (or a separate
  `*-pure.ts` file) so they're testable, then test.
- **Numeric headline claims** in the PR description — pin with
  `expect(x).toBe(N)`, never `toBeLessThanOrEqual(N)`. The latter
  catches regressions past the bound but not what the headline
  claims.
- **Integration paths through new state machinery** — allocate /
  grow / write / flush / shift cycles for typed-array buffers,
  multi-tier reducers, lifecycle FSMs all need a read-back assertion,
  not just a "does not throw" smoke.
- **Auto-upgrade / migration paths** (e.g. v2→v3 URL rewrite) flagged
  as "manual smoke" in the test plan — promote to vitest.

Audit the diff before opening a PR:

1. Each new function or class has a vitest. If pseudo-private, lift
   to module scope or a `*-pure.ts` sibling first.
2. Each numeric claim in title / summary / release notes has a
   `toBe(N)` somewhere.
3. New typed-array plumbing has a read-back test with known values
   (trigger grow + shift, assert at known offsets).
4. Two-tier / N-tier control flow (prime vs fallback) exercises each
   tier; priority semantics is a separate assertion.

Manual-smoke fallback regresses between releases; automated tests
don't.

## Pattern coverage across peers

When a PR is framed as "apply pattern X to all the Y in this layer"
(every SVG overlay, every event handler, every picker entry point,
every shader pass, every DRY blend), **enumerate the set of Y
explicitly in the PR description AND verify the implementation
covers each.** One missed peer = the headline claim is false.

1. Before starting the refactor, write the explicit peer list in
   the PR description. Skim CLAUDE.md § Repo layout + the layer's
   folder README for the canonical peer list.
2. After implementing, `grep` for the OLD pattern and confirm ZERO
   remaining call sites in scope. If non-zero, convert them or call
   out as "deliberately deferred" with a follow-up bead.
3. If two peers end up with two strategies (per-attribute dirty-track
   vs whole-frame signature dirty-track), document the chosen
   strategy in the layer's `README.md` and reconcile.
4. Sister-layer extension — when extending a feature for one host
   (stars), check whether sibling hosts (clouds, planets) have the
   same surface and would benefit / drift if not extended too. File
   a bead for sibling work even if out of scope.

## Defer doc updates

Don't edit `CLAUDE.md`, `README.md`, `docs/`, or `SCIENCE.md` while
implementing a feature — treat code as the only deliverable until
commit time.

Why: mid-session doc edits become churn. Direction shifts, features
get dropped, parameters rename, knob values move; the paragraph
written early ends up describing something that no longer exists.

How to apply:

- During implementation, confine edits to code, shaders, tests.
- If a code comment references a doc section about to be wrong,
  leave it and surface at commit time.
- At commit time, grep the final diff for renames, removed knobs,
  new uniforms, behavioural shifts, anything user-visible. Open
  every relevant doc and update only what's now stale.

## Large-PR honesty

For large multi-bead PRs (~10+ issues bundled), proactively
distinguish code with strong test coverage from code that requires
manual verification.

Confidence categories at PR-open time:

- **High** — changed code paths exercised by unit / integration tests.
- **Medium** — tests cover adjacent code but not the integration point.
- **Low (needs eyeballs)** — user-visible paths with only unit-level
  coverage; constructor signature changes; callback rewiring;
  build-pipeline scripts; generated artifacts.

At PR-open time, audit the manual-smoke checklist against the diff —
every Low-coverage path needs an explicit smoke step. Distinguish
"tests pass" from "behaviour verified" in the PR body so reviewers
can prioritise their manual passes.

## Commit granularity

Prefer **small topical commits**: when a change touches multiple
concerns, split into separate commits each with a focused subject and
brief why-body. One concept per commit keeps the repo's story legible
and makes revert / bisect surgical.

**Commit along the way, not at the end.** Default: commit each
logical chunk as it completes during the session, not by
cherry-picking from a giant staged diff at end-of-session.
End-of-session staging gymnastics are error-prone.

Fall back to end-of-session reordering only when discovery order
diverges from logical commit order (e.g. you implemented a feature,
then mid-stream realised a refactor was needed underneath, and the
cleaner story is "refactor first, then feature on top"). When
mid-stream discovery is going to read backwards, either commit the
in-flight chunk on a temp branch and rebase later, or keep going and
reorder at end. NOT fine: silently letting the staging area grow
into an omnibus pile.

Err toward more commits, not fewer. Use HEREDOC for multi-line
messages.
