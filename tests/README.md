# Repo-meta tests

Tests that exercise the repository itself rather than any one
subsystem. Picked up by the top-level `vitest` run alongside every
in-tree `*.test.ts`.

```
agents-md-size.test.ts   Size guard for AGENTS.md. Holds the file under
                         the test's MAX_LINES / MAX_BYTES so it stays
                         load-once-per-session affordable; the failure message
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
                         (/src/client/scene/README.md#declaring-how-time-moves-a-layer).
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
                         `*.py` under src/ and scripts/ (/AGENTS.md#code-comments--what-ci-enforces-here):
                         forbidden bead IDs, PR
                         numbers and [[wikilinks]], plus the 3-line
                         module-docstring cap, whose pre-existing
                         offenders sit in the sibling allowlist .txt and
                         are meant to shrink.
commit-sweep-guard.test.ts
                         Pins the commit-time doc-sweep hook's contract.
doc-pointer-resolution.test.ts
                         Every `<path>.md#<slug>` pointer in a
                         git-listed .ts .md .py .sh file names a heading
                         or anchor that exists — the codebase's wiki
                         links, checked. Grammar, scope and resolution:
                         README.md#doc-pointer-resolution.
folder-readme-coverage.test.ts
                         The "every folder under src/, scripts/, data/,
                         docs/ has a README.md" invariant (/AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit).
integration-shell-ratchet.test.ts
                         stellata.ts is wiring only (/AGENTS.md#folder--module-conventions--where-new-code-lands).
                         Every `Stellata` field is in
                         COMPOSITION (stays) or AWAITING_EXTRACTION
                         (shrinks to empty); a field in neither fails, and
                         so does a listed name the class no longer has.
                         Parses the class with the TypeScript compiler;
                         arrow-function properties count as methods.
                         Growing COMPOSITION is a review decision, never a
                         way to land state on the shell.
late-read-contract.test.ts
                         The wave-2 read contract (/src/client/README.md#boot-in-two-waves),
                         two halves. A `for` loop bounded by `X.count`
                         where X's type is assignable to `Catalog` but not
                         to `CompleteCatalog` fails; this half uses the
                         type checker over src/client (~3 s), since a
                         syntactic scan cannot tell a catalogue's `count`
                         from a planet host's. And every public method or
                         getter on `Stellata` returning `| null` is
                         classified in NULLABLE_SHELL_RETURNS; a late slot
                         there converts to Late<T> and leaves the list.
node-import-boundary.test.ts
                         src/client/ ships to a browser, so no module
                         there may import a `node:` builtin or a
                         `*-fixture.ts`. Test-only support that reads
                         data/ off disk takes the `-fixture` suffix and
                         is exempt by it; a type-only import of one still
                         crosses, since it erases before the bundler
                         runs. README.md#node-import-boundary below carries the
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
sid-ledger-guard.test.ts Append-only CI guard for data/sid/ (/docs/sid.md#45-ci-guard):
                         structural validity, head-snapshot
                         integrity, frozen-prefix check vs the git
                         merge-base. No UPDATE_* escape hatch — a prefix
                         rewrite means editing the guard itself with
                         explicit user sign-off. Self-skips where
                         ledger.tsv is an LFS pointer stub (the bare CI
                         test job); runs for real in the sid-ledger-guard
                         job and locally.
site-claims.test.ts      No figure on a public page is a literal: each
                         readout cell must still carry its %VITE_*%
                         substitution rather than a number. Then the
                         derivations behind them
                         (scripts/site/site-metrics.ts) — the credited
                         source count pinned, the per-subsystem table
                         still summing to it, and the reference scan
                         bounded both ways, since a pattern that matches
                         nothing and one that matches ordinary prose fail
                         in opposite directions.
                         /src/site/README.md#numbers-in-copy.
site-css-rules.test.ts   The public stylesheet answers to its container and
                         to the reader's font size, never to a viewport
                         measurement, and paints nothing it has not
                         tokenised. Eleven assertions in four groups: no
                         width/height media query, no pixel type size, every
                         font-size a Utopia scale step, every grid minimum
                         guarded by min() · no colour literal outside :root,
                         every space a scale step, every leading/tracking/
                         weight/radius a token · the CUBE cascade order
                         (compositions → blocks → utilities) with every
                         utility declaration !important · no physical box
                         property and no text-align: left/right. A bespoke
                         clamp() is the drift the scale-step rules catch —
                         it breaks the property that a heading and the space
                         above it move together; an unguarded minmax() is
                         the one that overflows at the 32px root WCAG
                         1.4.4's 200% text resize implies. Scans the file
                         with comments stripped, so prose naming a property
                         cannot register as CSS.
                         /src/site/styles/README.md#house-style,
                         /src/site/styles/README.md#responsiveness-has-no-breakpoints.
site-dev-routing.test.ts The dev server's routing table held against the
                         deploy's: both legacy share transports 301,
                         /app/** gets the application document, the root
                         gets the homepage, everything else 404s. Pairs
                         with src/worker.test.ts, which pins the same
                         table on the production side.
skill-guard.test.ts      Behavioural pins for scripts/hooks/skill-guard.sh,
                         one describe per skill gate (cube-css, code-craft);
                         /scripts/hooks/README.md#how-skill-guard-works.
star-count-consistency.test.ts
                         The catalogue's own size, stated once. Rounds the
                         BUILT header to `PROSE_ROUNDED` (artifact-backed,
                         so it self-skips unbuilt), scans the corpus for
                         the superseded figure `MYTHOS` names — digit
                         separators included, which is how an
                         underscore-separated literal in a dust-cost
                         script outlived two count changes — and holds
                         every size figure on the five user-facing prose
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
tsl-frag-depth.test.ts   The frag-depth roster — no node material may
                         write depthNode / frag_depth (a static write
                         defeats early-z draw-wide). The
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
                         (/src/client/webgpu/tsl/README.md#storage-attributes).
tsl-standin-filters.test.ts
                         The other TSL authoring trap: DataTexture and
                         Data3DTexture default BOTH filters to nearest, and
                         the WGSL builder reads the pair at shader-BUILD
                         time — so a stand-in on the default bakes an
                         unfiltered textureLoad that the real map swapped
                         onto the node afterwards cannot undo. Every
                         construction under src/ must state its pair
                         (/src/client/webgpu/solar-system/README.md#a-stand-ins-filters);
                         README.md#tsl-stand-in-filters below
                         carries the scan's one limit.
webgpu-import-boundary.test.ts
                         No value import of three/webgpu or three/tsl
                         outside src/client/webgpu/, so the ~1 MB second
                         copy of three's core stays out of the entry
                         bundle (/src/client/webgpu/README.md#import-boundary--nothing-webgpu-in-the-entry-bundle).
doc-pointer-pure.ts      Not a test — extraction, anchor collection and
                         path resolution for doc-pointer-resolution.test.ts.
```

The recursive file walk the scanners above share lives in
`scripts/util/walk-files.ts` — `scripts/site/site-metrics.ts` reads the
same corpus at build time, so it is repo plumbing rather than a test
helper. `walkFiles` is a recursive walk taking `include` / `skipDir`
predicates, and follows symlinked directories, which public/ carries.
`gitFiles` is git's list (tracked, optionally untracked-but-not-ignored),
for a scan whose scope is the repo rather than a folder list. It carries
`isProductionTs` too, the include predicate the three
TSL scanners share: a `.ts` that is neither a test nor an ambient
declaration. `webgpu-import-boundary.test.ts` keeps its own broader
`isClientSource` — a declaration file can carry an import, so that corpus
wants `globals.d.ts` in scope.

Per-subsystem tests live next to their code (`*.test.ts` / `*.test.py`
co-located with the module under test); only repo-wide invariants
belong here.

## Doc-pointer resolution

`doc-pointer-pure.ts` owns the grammar behind
`doc-pointer-resolution.test.ts`; this section is the authority.

**What a pointer is.** One token, `<path>.md#<slug>`: a path ending
`.md`, then `#`, then a GitHub heading slug. Markdown writes it as a link
target, `[Heading words](<path>.md#<slug>)`, so GitHub and editors can
follow it; code comments and fenced blocks write the bare token. A
markdown file citing its own section writes `[Heading words](#<slug>)`,
checked against that file's anchors; inside its fenced blocks it names
itself instead (`README.md#<slug>`), since a fence renders no link. A pointer
never wraps across lines — a token split at a slash reads as a shorter path
and fails to resolve, which is the loud direction. A path after `~` or
another `/` is not a pointer: the user's global rules and URLs live outside
the repo.

**Where a path resolves.** GitHub's reading, and only that: a leading `/`
is the repo root, anything else is relative to the citing file. A `../`
chain that climbs out of the repo resolves to nothing.

**What a slug may name.** A heading, slugged the way GitHub slugs it
(`github-slugger` over a `marked` lexer pass, so a `#` line inside a fenced block
is never a heading, and a repeated heading takes `-1`, `-2`), or an explicit
`<a id="…"></a>` anchor. A cited bold leader or Files-roster entry carries
such an anchor at the start of its line. Matching is exact set membership:
any rename of a cited heading fails the suite, subtitle and all.

**The section sign lives only in numbered link text.** Markdown may
write it as the opening of a link's text before a number —
`[§ 3.5](#<slug>)` — and nowhere else; code carries none at all.
Anything the resolver cannot see therefore fails the suite instead of
rotting: a section named without its file, and a file followed by the
sign. A section of an outside paper is `Sect. 6.2`; a section of a
user-level skill or of `~/.claude/CLAUDE.md` is quoted by name. Runtime
strings (log lines, error messages, test titles) name the concept in
words; a message that sends its reader to a doc carries the token.

**Scope is git's.** Every tracked or untracked-but-not-ignored file with
a scanned extension (or a scanned name, for `.gitignore`), symlinks
excluded (`CLAUDE.md` would double `AGENTS.md`). Files Git LFS stores
are out — the pulled survey tables, about 1 GB — so a hand-written
comment in one (`data/classic-ids/cross_index_corrections.tsv`) is
unchecked. `data/sid/retirements.tsv` is out because the sid ledger
guard freezes its existing rows. Tracking puts `.claude/skills` in; `.gitignore` keeps
`worktrees/` out, so no folder list exists to drift. Untracked files
count, so a new doc is checked before its first `git add` — and a local
draft with a broken pointer fails the suite here while CI never sees
it. One case per extension asserts the scan finds pointers in that
file type, so an extension that carries none has no business in the
list.

**A blind matcher fails on synthetic input, never on the tree.** A
regression that stops *seeing* pointers leaves the resolution check green
by finding nothing — the direction that reads as success. Each grammar
form therefore has its own extraction case in the suite; narrowing the
pattern fails the case for the form it dropped. Never pin a whole-tree
pointer count instead: every docs PR moves it, so any two branches
touching docs conflict on the one line.

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
  ([The gate becomes the output struct](/src/client/webgpu/hdr/README.md#the-gate-becomes-the-output-struct)).
- **`NodeMaterial.setupOutput` still wraps the output under `premultipliedAlpha`
  and `fog`, and `buildCode` still tests `isOutputStructNode` on the top-level
  node** — [Two material flags silently demote the struct](/src/client/webgpu/hdr/README.md#two-material-flags-silently-demote-the-struct), same README.
- **A render target's auto-created depth texture is still `Depth24Plus` under
  `reversedDepthBuffer`** — [The depth format is requested, not asserted](/src/client/webgpu/hdr/README.md#the-depth-format-is-requested-not-asserted).
- **`renderer.backend.device` and `renderer.backend.get(…)`** in
  `src/client/webgpu/timestamps/timestamp-probe.ts`,
  `src/client/webgpu/extinction/extinction-parity.ts` and
  `src/client/loaders/dust-voxel-readback.ts` — cast through `unknown`, so tsc
  sees nothing.
- **`readRenderTargetPixelsAsync` still allocates its landing array per call**
  — [Reduction](/src/client/webgpu/hdr/README.md#reduction--an-asynchronous-readback) prices that.
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
