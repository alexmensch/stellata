# Repo-meta tests

Tests that exercise the repository itself rather than any one
subsystem. Picked up by the top-level `vitest` run alongside every
in-tree `*.test.ts`.

```
agents-md-size.test.ts   Size guard for AGENTS.md. Holds the file at
                         360 lines / 17.5 KB so it stays load-once-per-
                         session affordable; the failure message
                         explains the wiki convention and the
                         AGENTS.md → folder-README → docs/ decision
                         flow. Also asserts CLAUDE.md is still the
                         symlink to AGENTS.md that keeps Claude Code
                         and every other harness on one file.
astronomy-constants-sync.test.ts
                         Parity pin between util/astronomy-constants.ts
                         and the build-script copy.
artifact-freshness.test.ts  Built-artifact coherence: fails (not skips)
                         when public/catalog-manifest.json exists but
                         public/binaries.bin is missing or older than
                         multiples.tsv / the row-index map — the state
                         where the binaries-dependent suites would
                         silently self-skip and "npm test green" means
                         less than it reads. Self-skips on fresh clones
                         and LFS pointer stubs.
bundle-content.test.ts   Deployed-bundle guard: no source-tree file
                         types (.md/.txt/.py/.ts) under public/; dust
                         assets restricted to the sync allowlist.
                         Self-skips when public/ is unbuilt.
cadence-layer-declarations.test.ts
                         Source scan over the SHIPPED scene-layer
                         registrations: the `realtime` count is pinned at
                         ZERO, the static/clock split is pinned, and every
                         inline register({…}) in the shell must carry a
                         timeBehaviour. A scan rather than a unit test
                         because the live registry needs WebGL and a
                         synthetic one proves nothing about the roster the
                         app runs — the invariant was previously asserted
                         in three READMEs and enforced by nothing
                         (src/client/scene/README.md § Declaring how time
                         moves a layer).
cadence-pulsation-bound.test.ts
                         Tripwire on the render cadence's 30 s cap: the
                         shipped catalogue's fastest unsuppressed variable
                         must not pulse a JND faster than that, or "one
                         frame per 30 s at 1×" silently stops being true.
                         Pinned at the measured 32.36 s, not bounded — the
                         margin is 8 % and rests on the period field's
                         0.1 d quantum, so a refresh has to trip
                         something. Imports the runtime's own
                         buildPulsationSuppressMask rather than
                         re-deriving the eclipser rule. Self-skips when
                         public/ is unbuilt.
code-comment-rules.test.ts
                         Comment-hygiene scanner over `*.ts` / `*.js` /
                         `*.py` under src/ and scripts/ (AGENTS.md
                         § Code comments): forbidden bead IDs, PR
                         numbers and [[wikilinks]], plus the 3-line
                         module-docstring cap, whose pre-existing
                         offenders sit in the sibling allowlist .txt and
                         are meant to shrink. `.glsl` is NOT scanned, so
                         shader comments rest on review alone.
commit-sweep-guard.test.ts
                         Pins the commit-time doc-sweep hook's contract.
doc-pointer-resolution.test.ts
                         Every `<file>.md § <Heading>` pointer under src/,
                         scripts/, tests/, docs/, data/, research/ plus the
                         repo-root docs resolves to a heading that exists —
                         the codebase's wiki links, checked. Scans .ts .js
                         .glsl .md .py, and pins the pointer total. Grammar,
                         resolution order and the two limits it cannot see:
                         § Doc-pointer resolution below.
folder-readme-coverage.test.ts
                         The "every folder under src/, scripts/, data/,
                         docs/ has a README.md" invariant (AGENTS.md
                         § Folder READMEs).
perf-guard.test.ts       Behavioural pins for scripts/hooks/perf-guard.sh's
                         two gates: every launch spelling denied unarmed and
                         allowed under a fresh marker (including the
                         non-pnpm managers and a launch on its own line in a
                         multi-line command, both of which once bypassed
                         it), every mention or Write of the marker denied
                         armed or not, and the fail-closed paths — no git
                         checkout, unreadable marker age. The protocol and
                         the escape routes are asserted in the deny reason.
prime-guard.test.ts      Behavioural pins for the bd-prime session hook.
readme-size.test.ts      450-line cap per folder README — length is a tax
                         on every future session, so the answer over the
                         cap is a folder split, not a rewording pass.
readme-guard.test.ts     Behavioural pins for scripts/hooks/readme-guard.sh:
                         drives the hook's PreToolUse JSON contract over a
                         throwaway git repo in os.tmpdir(). Covers the
                         never-existed-README exemption for a folder the
                         session is creating, and the neighbouring cases
                         that must stay gated (unread README on disk,
                         committed folder missing one).
shader-frag-depth.test.ts
                         gl_FragDepth roster: only star.frag.glsl may
                         write frag depth (a static write defeats
                         early-z draw-wide). Allowlist shrinks to empty
                         when the WebGPU port lands the depth-honest
                         redesign (star-pipeline README § Depth
                         encoding).
sid-ledger-guard.test.ts Append-only CI guard for data/sid/ (docs/sid.md
                         § 4.5): structural validity, head-snapshot
                         integrity, frozen-prefix check vs the git
                         merge-base. No UPDATE_* escape hatch — a prefix
                         rewrite means editing the guard itself with
                         explicit user sign-off. Self-skips where
                         ledger.tsv is an LFS pointer stub (the bare CI
                         test job); runs for real in the sid-ledger-guard
                         job and locally.
three-version-audit.test.ts
                         Tripwire pinning the three version the runtime
                         audit below was last run against. Fails on any
                         bump of the dependency range.
tsl-frag-depth.test.ts   The frag-depth roster's TSL half — no node
                         material may write depthNode / frag_depth. The
                         allowlist starts empty and should stay empty; the
                         failure message carries the two patterns that
                         replace a fragment depth write.
tsl-loop-control.test.ts A TSL authoring trap, not a policy: a concise
                         arrow returns its expression, so `() => Break()`
                         hands the jump back as the branch's output and it
                         emits twice — unreachable WGSL, warned on every
                         boot. Brace the body.
webgpu-import-boundary.test.ts
                         No value import of three/webgpu or three/tsl
                         outside src/client/webgpu/, so the ~1 MB second
                         copy of three's core stays out of the WebGL2
                         bundle (src/client/webgpu/README.md § Import
                         boundary).
doc-pointer-pure.ts      Not a test — extraction, resolution and heading
                         matching for doc-pointer-resolution.test.ts.
                         Behaviour is documented in § Doc-pointer
                         resolution below, not in the module.
walk-files.ts            Not a test — the recursive file walk the
                         scanners above share (code-comment-rules,
                         bundle-content, shader-frag-depth, both TSL
                         rosters), taking `include` / `skipDir`
                         predicates. Follows symlinked directories, which
                         public/ carries.
```

Per-subsystem tests live next to their code (`*.test.ts` / `*.test.py`
co-located with the module under test); only repo-wide invariants
belong here.

## Doc-pointer resolution

`doc-pointer-pure.ts` owns the grammar and matching behind
`doc-pointer-resolution.test.ts`. This section is the authority; the
module carries one-line pointers back here.

**What counts as a pointer.** A path ending `.md`, optionally
backticked, then `§`, then the section name. A leading `~` or `/`
disqualifies the path — the user's global rules live outside the repo
and cannot be resolved. The name runs to the first clause terminator,
except that a period before a digit stays in, so a numbered section
survives the cut. `§ <named section>` and `§ …` cite the syntax rather
than naming a section and are skipped.

**Corpus.** Only pointers that name a file. A bare `§ 5` whose document
is implied by context is not checked, so "every pointer resolves" means
every pointer carrying a path. The pointer total is pinned by the suite:
a matcher regression that stops *seeing* pointers would otherwise leave
it green, which is the direction that reads as success.

**Where a path resolves.** Pointers are written root-relative and
file-relative in the same folder, so both readings are tried: the
referring file's own directory first, then the repo root — which is how
`SCIENCE.md` and `AGENTS.md` are cited from anywhere — then
`src/client/`, the shorthand `docs/` uses for subsystem READMEs. A
`../` chain that climbs out of the repo resolves to nothing.

**What a pointer may name.** `#` headings, and also the bold leaders the
READMEs use for named sub-topics — ordered-list leaders included, and
those whose closing `**` falls on the next line — and a Files roster's
backticked module name, which is how a pointer names one file's entry.
63 of the tree's pointers name a leader rather than a heading, so this
is house style, not tolerance.

**Wrapping.** A section name wraps with the comment around it, so each
line is joined with its successor before matching. A path wrapped at one
of its own slashes rejoins with no space, and its second half alone
reads as a bare `README.md` — suppressed, since the previous join
already saw it whole. The two windows straddling a pointer both see it;
the longer reading wins, and on a tie the later one, whose window starts
on the line the pointer is actually on. That collapse is scoped to
adjacent lines: widen it and a stale pointer that happens to be the
opening of a valid one elsewhere in the file is dropped unchecked.

**Two limits, both asserted rather than assumed.** Matching is a
word-boundary character prefix in either direction, so `§ Time` will not
resolve to `## Timescales`. But:

- **Two shared opening words are enough.** A pointer routinely names a
  heading's opening and runs straight on in prose, so the first two
  words are the citation. A rename leaving those two alone reads as a
  truncated citation and passes. Tightening to strict prefix-only was
  tried: it rejects 24 legitimate pointers.
- **A bold sentence can stand in for a renamed heading.** Because a
  leader is a legitimate target, prose that opens with the same two
  words is an equally legitimate one. `hdr/exposure/README.md` carries
  both an `## Adaptation` heading and a bold sentence starting
  "Adaptation is deliberately absent…", so renaming the heading would
  not fail the guard. 104 pointers match more than one candidate this
  way. Narrowing it would cost the leader support above, which more
  pointers depend on than are exposed by this.

## The three upgrade audit

`three` is the one dependency whose breakages are mostly **invisible to
typecheck**: shader chunks resolve at GL compile time, renderer internals are
reached through casts, and the `examples/jsm` modules carry no compatibility
promise at all. A green typecheck after a bump means nothing about whether the
scene still renders. So the surface below is audited by hand, against the
installed copy in `node_modules/three`, and
`three-version-audit.test.ts` fails until `AUDITED_THREE_RANGE` is moved —
which is the only thing making the audit non-optional.

Work every line, then record the findings in the PR body:

- **`<common>` still supplies every helper our GLSL calls.** r185 dropped
  `luminance()` and `transposeMat3()`; a shader calling a removed helper is a
  runtime-only compile failure.
- **The log-depth define name and the `gl_FragDepth` spelling** three injects
  into non-raw materials — `src/client/star-pipeline/README.md` § Depth
  encoding turns on the raw/non-raw split.
- **`resolveIncludes` still runs before the raw-material gate** in
  `WebGLProgram`, or the `stellata_*` chunks stop resolving in the raw star
  shaders.
- **The `WebGLState.drawBuffers` re-issue condition** —
  `src/client/hdr/attachments/README.md` § The cache the gate rides. A gate
  three decides to reopen is scene-wide exposure drift, not an error.
- **`getInternalDepthFormat` still returns `DEPTH_COMPONENT24`** for the
  seam's target — `src/client/hdr/README.md` § Three attachments.
- **The four `logdepthbuf` includes `src/client/util/orbit-line.ts` strips by
  string replace** are still present verbatim in three's line shader.
- **`renderer.properties.get(tex).__webglTexture`** in
  `src/client/loaders/dust-loader.ts` — cast through `unknown`, so tsc sees
  nothing.
- **Who owns `LineMaterial.resolution`** — three writes it per frame from
  `LineSegments2.onBeforeRender`; `src/client/galactic/coord-spheres/README.md`
  is why nothing app-side does.
- **Every `TrackballControls` member `src/client/camera/controls/` touches**,
  including the `!noZoom || !noPan` gate its distance clamp sits behind
  (`src/client/camera/controls/input/README.md`).

## Suite-wide timeouts

`vitest.config.ts` pins `testTimeout` / `hookTimeout` to **30 s**, not
vitest's 5 s default. The artifact-backed corpus suites
(`multi-star-regression`, `known-stars`, `sky-position`) each sweep the
full 380k-record catalog and its derived buffers, so their tests are
seconds long even solo — and their wall time scales with machine load:
under a full-suite run the slowest sit at 2.5–3.5 s locally, and CI's
corpus job runs three of those files concurrently on a 2-core runner.
At the 5 s default they went intermittently red on unrelated PRs, which
trains readers to re-run rather than read failures.

The timeout is a hang detector, not a perf gate — `slowTestThreshold`
is what surfaces slowness. Raise a test's own `{ timeout }` for a
deliberate outlier rather than lifting the global.
`local-group-emission-calibration.test.ts` is the standing example: its
three brute-force tests run 1.6 s / 3.6 s / 6.5 s solo and each carries
`{ timeout: 120_000 }`.

**Budget for roughly an order of magnitude, not a factor of two.** A
seconds-long CPU-bound test is not competing with the other 4 600 tests
for a core, it is competing with whatever else the machine is doing —
a dev server, a second agent session, another suite. The 3.6 s test above
was measured at **47.7 s** in one full-suite run, a 13× amplification, and
it was the 30 s global rather than any real hang that failed it. Anything
over ~1 s solo wants its own timeout before it becomes a load-dependent
flake that trains readers to re-run.
