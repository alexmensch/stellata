---
name: stellata-pr-review
description: Stellata's extension of the user-level `pr-review` skill — GPU and VRAM cost, the perf-pin tier, folder-README-first reading, bead and epic drift, and the `reviewed` label. `pr-review` loads it for every review of a stellata pull request, branch or diff; load it directly only if `pr-review` is already in context without it.
---

# Reviewing a stellata PR

Load `pr-review` first if it is not already in context; it carries the
persona, priority order, diff-efficiency measure, plan-drift hunt and
disposition of findings. This skill adds what is true only here. Where a
section below names one of `pr-review`'s sections, it narrows that section;
it never replaces it.

## Priority order — stellata readings

- **(2) Resource and performance cost** is § GPU and memory cost below.
- **(5) Architectural fit**: a diff touching `src/client/stellata.ts` is
  checked against [the integration-shell rule](/AGENTS.md#folder--module-conventions--where-new-code-lands) —
  any new field, tick or module-scope function landing there is a finding.
- **(7) Plan drift** is § Epic drift below.

## Getting the diff — the design docs are the folder READMEs

`pr-review`'s "read the design docs first" means the folder `README.md` of
every folder in the diff's file list, before any source file in it —
[Folder READMEs](/AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit).
`readme-guard` blocks the source read until you do, but only per file; batch
the reads up front, including folders the diff implicates without editing.

## GPU and memory cost — scrutinise every PR for it

Stellata is GPU-limited. Treat *"the device has limitless GPU compute and
VRAM"* as the default false assumption in any diff. These narrow
`pr-review`'s four probes and add two.

### 1. Every allocation names its release

A GPU-resident object created in the diff — `Texture`, `DataTexture`,
`BufferGeometry`, `Material`, `RenderTarget`, VBO/UBO — must show its
`dispose()` **and** the code path that reaches it, replacement path included.
Per-frame CPU allocation in the render loop (arrays, objects, `Set`s, sorts)
is a GC-jank finding in its own right. `bus.on(...)` without a matching unsub
in dispose is the same defect class —
[Lifecycle pairing](/docs/authoring-patterns.md#lifecycle-pairing).

### 2. Name what the cost scales with, and its bound

Per-frame or per-event? Per-pixel, per-instance, or per-draw?
Native-resolution full-screen pass? An unbounded instance / step / tap /
texel count on a hot path is P1.

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

A PR that invents its own scheme must say why mipmaps, anisotropic filtering,
or standard three.js LOD machinery does not do the job.

### 4. Invisible is not free

Off-screen, frustum-culled, magnitude-culled, and alpha-zero geometry still
pays vertex shading and still holds VRAM. Reject "it is not visible there" as
a cost argument. Occluded fragments still shade wherever early-z is defeated.

### 5. Device floor, not dev machine

"Imperceptible on my M4" is not a claim — the budget that matters belongs to
a low-end integrated or mobile GPU, measured against its VRAM ceiling and
max-texture-size limit. This is the performance face of
[Camera-anywhere, any-epoch](/AGENTS.md#camera-anywhere-any-epoch--a-mental-model-rule): state the
vantage and the epoch offset, at the extremes the model allows.

### 6. Measured, or labelled unmeasured

Only `gpu.frame` differentials price a pass. Per-scope magnitudes
over-attribute on ANGLE/Metal, absolute numbers are not reproducible (ratios
and differentials only), and Safari exposes no GPU timer at all. Measurement
canon is [§ 9](/docs/render-rules.md#9-measurement-canon) (the empirics behind it in bead
`stellata-8cg.1`); the standing perf program is epic `stellata-8cg`.

**A render-path diff without a `## Perf` section is a blocking finding.** A
render path is any `.ts` or `.wgsl` under `src/client/` outside the
folders [Perf pin](/RELEASING.md#perf-pin) exempts. Refuse the review until the
section is there. A `✗` row without an `accepted: <row> <reason>
(<bead-id>)` line is P1, and the bead must exist. Only the frame row and the
`|compute` row are marked, each on the statistic its own `metric` column
names — a `·` row is recorded and not gated, the `floor` and `spread`
columns never mark, and reading a wall-clock median as a verdict is the
mistake the pin exists to prevent. A diff that adds or moves a
compute dispatch answers on the compute row; a `~` on the frame row alone
says nothing about it.

**Review the tier the section claims, because the guard cannot.** Tier 2 —
passes, buffers, draw counts, the catalogue or the instrument — carries the
`--against-pin` table, the pin commit, the adapter slug and the state-guard
line per context, and re-takes the pin in the same PR. Tier 1 — per-frame
code touched, structure unchanged — carries the `--against-pin` table over
mw120|webgpu and sol|webgpu alone, the other three rows listed as not
measured, and names the pin commit it read against. Tier 0
carries a reachability argument in prose and no table. The claim worth
auditing is the tier itself: a diff that reaches a pass or a draw count is
Tier 2 however small it looks, and under-claiming the tier is the way this
gate gets quietly avoided.

## Diff efficiency — calibration

`diff-shape.sh`'s default buckets fit this tree unchanged (`.wgsl` is
source, `tests/` and `*.test.*` are tests, `.tsv` is data). The prose
threshold stays at the default 25%: landed stellata commits run 20–68% on
this measure, so it is a deliberate tightening, not the status quo. The usual
offender is a comment block restating what the folder README now says.

## Epic drift

`pr-review`'s plan-drift hunt, read with stellata's names: the plan is the
closing bead's parent chain up to the root, the design doc is the folder
README, and "settled" is spelled SETTLED.

- The tracker search is `bd search <the thing you changed>`.
- The raw description is `bd show <id> --json`.
- The edit goes through `--body-file` / `--design-file` — inside a worktree
  the only workable route, since the guard rejects `$( )`.
- The re-read is `bd show`. A line starting with `+` or `-` renders as a
  bullet; reword rather than ship a mangled spec.

A deferred finding's bead goes under whichever epic owns the code
(`stellata-beads` skill § Choosing the parent epic).

## Mark the PR reviewed once the fixes are on it

`gh pr edit <N> --add-label reviewed`, after the agreed fixes are committed and
pushed. The label says a review happened and its findings landed, which is what
a reader of the PR list cannot otherwise tell from a green tick.

Add it only once every agreed finding is pushed — a finding deferred to a bead
counts as landed, an unpushed commit does not. A review that ends in approval
with no changes agreed earns it too; a review whose findings the author has not
acted on does not. Do not wait on CI for it (§ Never wait on PR CI checks in
the user-level `~/.claude/CLAUDE.md`), and do not treat it as approval to
merge, which stays a separate per-PR decision.
