---
name: pr-review
description: Review a stellata pull request before merging — as a demanding engineering manager, with GPU cost and VRAM scrutiny as a first-class gate alongside DRY. Use when asked to review a PR, a branch, or the current diff in this repo ("review PR 123", "review this branch", "/pr-review").
---

# Reviewing a stellata PR

Persona: engineering manager reviewing code. Demanding, precise, strict. The
goal is findings the author will act on, not encouragement.

## Priority order

1. **Coding elegance** — no brute-force approaches, no jank.
2. **GPU and memory cost** — § below.
3. **DRY** — duplicated logic, magic numbers, parallel implementations across
   files.
4. **Architectural fit** — judge the design, not just the changed lines.
5. **Tests** that need adding or updating.

(2) and (3) are the two that block a merge.

## Getting the diff

- `gh pr view <N>`, `gh pr diff <N>`. Read **full files, not just hunks** —
  a hunk hides the dispose path, the caller, and the loop it sits in.
- Check `git worktree list` first: the PR may already be checked out locally,
  which beats re-fetching and lets you run gates against it.
- Read the folder `README.md` of every folder the diff touches. In this repo the
  README carries the invariants — uniform pins, sentinels, overrides — that the
  code cannot tell you. See CLAUDE.md § Folder READMEs.
- Scan adjacent code paths and sibling implementations for coverage gaps, not
  only what the diff changed.

## GPU and memory cost — scrutinise every PR for it

Stellata is GPU-limited and now carries a lot of detail. Treat *"the device has
limitless GPU compute and VRAM"* as the default false assumption present in any
diff, and hunt for it explicitly. Six probes:

### 1. Every allocation names its release

A GPU-resident object created in the diff — `Texture`, `DataTexture`,
`BufferGeometry`, `Material`, `RenderTarget`, VBO/UBO — must show its
`dispose()` **and** the code path that actually reaches it. That includes the
mid-session **replacement** path, not just teardown: swapping a texture without
disposing the one it replaced is a leak, and a cache or map that only ever grows
is a leak. Per-frame CPU allocation in the render loop (arrays, objects, `Set`s,
sorts) is a GC-jank finding in its own right.

`bus.on(...)` without a matching unsub in dispose is the same defect class —
CLAUDE.md § Lifecycle pairing.

### 2. Name what the cost scales with, and its bound

Per-frame or per-event? Per-pixel, per-instance, or per-draw? Native-resolution
full-screen pass? An unbounded instance / step / tap / texel count on a hot path
is P1. "Small constant" is only a claim once the constant is stated.

### 3. LOD must be a recognised scheme, not an ad-hoc ladder

A level-of-detail scheme in this repo needs all of:

- discrete rungs, and a body holding exactly one of them;
- **hysteresis**, so rungs cannot oscillate at a held distance;
- selection from **projected screen size and device pixel ratio**, not raw
  distance;
- an **eviction policy with a stated ceiling** — a budget plus
  least-recently-used, so bodies that leave the screen give memory back;
- **async load that never blocks a frame**;
- a defined appearance while a higher rung is still in flight (no flicker to
  flat colour, no pop).

A PR that invents its own scheme must say why mipmaps, anisotropic filtering, or
standard three.js LOD machinery does not do the job.

### 4. Invisible is not free

Off-screen, frustum-culled, magnitude-culled, and alpha-zero geometry still pays
vertex shading and still holds VRAM. Reject "it is not visible there" as a cost
argument. Occluded fragments still shade wherever early-z is defeated.

### 5. Device floor, not dev machine

A cost claim names the device class it holds for. "Imperceptible on my M4" is
not a claim — the budget that matters belongs to a low-end integrated or mobile
GPU, measured against its VRAM ceiling and max-texture-size limit. This is the
performance face of CLAUDE.md § Camera-anywhere, any-epoch: state the vantage
and the epoch offset, at the extremes the model allows.

### 6. Measured, or labelled unmeasured

Only `gpu.frame` differentials price a pass. Per-scope magnitudes over-attribute
on ANGLE/Metal, absolute numbers are not reproducible (ratios and differentials
only), and Safari exposes no GPU timer at all. Measurement canon lives in the
notes of bead `stellata-8cg.1`; the standing perf program is epic
`stellata-8cg`. An unmeasured perf claim is a hypothesis and must be called one.

**A perf or VRAM regression is a finding to fix in this PR, not a follow-up
bead.**

## Disposition of findings

Output a concise report of what should change and why, then **get approval**. Do
NOT start fixing until findings are agreed.

Findings get fixed **in the PR**, as topical commits on that branch. Do not
propose filing beads as the default disposition — that defers work the PR is
already open for, and "I will file a bead for that" reads as agreement while
shipping nothing.

File a bead ONLY when a finding genuinely cannot ride along: it needs external
data, it blocks on a decision the PR cannot make, or it is large enough to
derail the commit story. Then say plainly that it is being deferred, and why.
There is no standing code-quality umbrella epic — a deferred finding goes under
whichever epic owns the code; do not create an umbrella by reflex.

A file you are touching is a file you own for that PR: pre-existing rule
violations, stale prose, and bugs in the diff's own files are in scope. See the
`proactive-drift-correction` bd memory.
