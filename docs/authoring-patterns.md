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

Representative finding: `mallamaPhaseFactor` didn't clamp α while
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
CLAUDE.md § "Code comments — overrides the system prompt" defines the
forbidden patterns (bead-IDs, PR references, "extracted from" history,
`[[memory-key]]` wikilinks, oversized module docstrings) as "law" — they
rot fastest, and future sessions act on them. The recurring failure
mode is "small leftover breadcrumb you didn't think mattered" landing
in a PR and then misleading every reader downstream.

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
- For forbidden patterns: drop the bead-ID / PR ref. Substitution table
  is in CLAUDE.md § "Substitution rule" — credit a bead in the commit
  subject, not the code.
- For docstring length: trim to ≤3 lines and move detail to the folder
  `README.md` with a one-line code-side pointer. Don't add a new
  allowlist entry unless the file is genuinely out-of-scope to fix in
  this PR.

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
