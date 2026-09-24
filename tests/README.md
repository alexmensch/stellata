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
                         public/binaries.bin is missing, or any file its
                         stamp (build/stamps/binaries-bin.json) records —
                         input or output — has changed since — the state
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
                         Every `<file>.md § <Heading>` pointer in a
                         git-listed .ts .md .py file resolves to a
                         heading that exists — the codebase's wiki links,
                         checked. Grammar, scope, resolution order and the
                         two limits it cannot see: § Doc-pointer
                         resolution below.
folder-readme-coverage.test.ts
                         The "every folder under src/, scripts/, data/,
                         docs/ has a README.md" invariant (AGENTS.md
                         § Folder READMEs).
integration-shell-ratchet.test.ts
                         stellata.ts is wiring only (AGENTS.md § Folder &
                         module conventions). Every `Stellata` field is in
                         COMPOSITION (stays) or AWAITING_EXTRACTION
                         (shrinks to empty); a field in neither fails, and
                         so does a listed name the class no longer has.
                         Parses the class with the TypeScript compiler;
                         arrow-function properties count as methods.
                         Growing COMPOSITION is a review decision, never a
                         way to land state on the shell.
node-import-boundary.test.ts
                         src/client/ ships to a browser, so no module
                         there may import a `node:` builtin or a
                         `*-fixture.ts`. Test-only support that reads
                         data/ off disk takes the `-fixture` suffix and
                         is exempt by it; a type-only import of one still
                         crosses, since it erases before the bundler
                         runs. § Node import boundary below carries the
                         one limit it cannot see.
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
review-design-reminder.test.ts
                         Behavioural pins for
                         scripts/hooks/review-design-reminder.sh: silent
                         until a review starts, armed by a `/pr-review`
                         first word or a Skill call under any scope (not a
                         mention, not `/pr-reviewer`, not a path ending
                         `/pr-review`), scoped to its
                         session, never blocking, and one line long.
shader-frag-depth.test.ts
                         gl_FragDepth roster: no shader may
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
star-count-consistency.test.ts
                         The catalogue's own size, stated once. Rounds the
                         BUILT header to `PROSE_ROUNDED` (artifact-backed,
                         so it self-skips unbuilt), scans the corpus for
                         the superseded figure `MYTHOS` names — digit
                         separators included, which is how an
                         underscore-separated literal in a dust-cost
                         script outlived two count changes — and holds
                         every size figure on the four user-facing prose
                         surfaces to that one rounding, `public/llms.txt`
                         among them since `public/` is gitignored and no
                         directory root reaches it. The AT-HYG spine's own
                         row count is a different quantity and stays.
                         **This entry may not quote either figure: the
                         scan reads it.**
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
tsl-storage-narrowing.test.ts
                         A third TSL authoring trap: `toReadOnly()` narrows
                         the node it is called on rather than returning a
                         view, so narrowing a node a kernel assigns through
                         pins it read-only there too and the device refuses
                         that pipeline at boot — one invalid pipeline
                         discards the whole submit. Narrowing is allowed
                         only on a `storage()` call's own result; the
                         write/read pair builder is the one exemption
                         (src/client/webgpu/tsl/README.md § Storage
                         attributes).
tsl-standin-filters.test.ts
                         The other TSL authoring trap: DataTexture and
                         Data3DTexture default BOTH filters to nearest, and
                         the WGSL builder reads the pair at shader-BUILD
                         time — so a stand-in on the default bakes an
                         unfiltered textureLoad that the real map swapped
                         onto the node afterwards cannot undo. Every
                         construction under src/ must state its pair
                         (src/client/webgpu/solar-system/README.md § A
                         stand-in's filters); § TSL stand-in filters below
                         carries the scan's one limit.
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
walk-files.ts            Not a test — file enumeration the scanners above
                         share. `walkFiles` is a recursive walk taking
                         `include` / `skipDir` predicates, and follows
                         symlinked directories, which public/ carries.
                         `gitFiles` is git's list (tracked, optionally
                         untracked-but-not-ignored), for a scan whose
                         scope is the repo rather than a folder list.
                         Also `isProductionTs`, the include predicate the
                         TSL scanners share: a .ts that is neither a test
                         nor an ambient declaration.
                         webgpu-import-boundary.test.ts keeps
                         its own broader `isClientSource` — a declaration
                         file can carry an import, so that corpus wants
                         globals.d.ts in scope.
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
every pointer carrying a path.

**Scope is git's.** Every tracked or untracked-but-not-ignored file with
a scanned extension, symlinks excluded (`CLAUDE.md` would double
`AGENTS.md`). `.gitignore` already keeps `.claude/skills` in and the rest
of `.claude` — `worktrees/` above all — out, so no folder list exists to
drift. One case per extension asserts the scan finds pointers in that
file type, so an extension that carries none has no business in the
list.

**A blind matcher fails on synthetic input, never on the tree.** A
regression that stops *seeing* pointers leaves the resolution check green
by finding nothing — the direction that reads as success. Each grammar
form therefore has its own extraction case in the suite; narrowing the
pattern fails the case for the form it dropped. Never pin a whole-tree
pointer count instead: every docs PR moves it, so any two branches
touching docs conflict on the one line.

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

## TSL stand-in filters

The scan resolves each construction's assignment target — a local, a
`this.` field, or `<unassigned>` for an inline one nothing can reach — and
demands a `minFilter` and a `magFilter` write to that target somewhere in
the same file. Which filter is correct is the site's call, matching the
texture it stands in for; the guard only refuses the constructor default.

**The one limit: the pair is matched per target NAME, not per block.** Two
constructions in one file sharing a target name (`const tex` twice, the
common spelling) pass together as soon as either sets its filters. Every
current site is one construction per file, so widening it would be
speculative — but a second `tex` in a file that already has one is outside
what this catches.

**A shared `applyLinearFilters(tex)` helper does not satisfy this scan, by
design.** Both writes must be literal and in the construction's own file,
so the obvious de-duplication of the two-line assignment turns every call
site into an offender. That is the intended trade: the pair is a per-site
decision about the texture being stood in for, and a helper spells one
answer across sites that do not share the question — the A_V placeholder
is nearest for a reason the dust volume's is not. Duplication of two
literal lines is the smaller cost.

## The three upgrade audit

`three` is the one dependency whose breakages are mostly **invisible to
typecheck**: node graphs compile to WGSL at pipeline creation, renderer
internals are reached through casts, and the `examples/jsm` modules carry no compatibility
promise at all. A green typecheck after a bump means nothing about whether the
scene still renders. So the surface below is audited by hand, against the
installed copy in `node_modules/three`, and
`three-version-audit.test.ts` fails until `AUDITED_THREE_RANGE` is moved —
which is the only thing making the audit non-optional.

Work every line, then record the findings in the PR body:

- **`WebGPUBackend.getRenderCacheKey` still keys on the program ids plus
  attachment 0's format alone** — the reason every material on the HDR target
  swaps its fragment graph with the target mode
  (`src/client/webgpu/hdr/README.md` § The gate becomes the output struct).
- **`NodeMaterial.setupOutput` still wraps the output under `premultipliedAlpha`
  and `fog`, and `buildCode` still tests `isOutputStructNode` on the top-level
  node** — § Two material flags silently demote the struct, same README.
- **A render target's auto-created depth texture is still `Depth24Plus` under
  `reversedDepthBuffer`** — § The depth format is requested, not asserted.
- **`renderer.backend.device` and `renderer.backend.get(…)`** in
  `src/client/webgpu/timestamps/timestamp-probe.ts`,
  `src/client/webgpu/extinction/extinction-parity.ts` and
  `src/client/loaders/dust-voxel-readback.ts` — cast through `unknown`, so tsc
  sees nothing.
- **`readRenderTargetPixelsAsync` still allocates its landing array per call**
  — `src/client/webgpu/hdr/README.md` § Reduction prices that.
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
full 390k-record catalog and its derived buffers, so their tests are
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

## Node import boundary

`node-import-boundary.test.ts` scans **direct** import specifiers only, which
is the one thing it cannot see: a browser module importing a `scripts/` module
that itself reaches for `node:fs` crosses the boundary transitively and the
scan reads both as clean. Sharing a `*-pure` module with the build tree is the
established pattern here — `star-naming-pure`, `catalog-pure`,
`blackbody-lut-pure` — and stays legal precisely because such a module holds no
builtin of its own. Keep it that way: the suffix is the contract.
