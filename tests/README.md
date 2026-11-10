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
                         Parity pin between astro-core/astronomy-constants.ts
                         and the build-script copy.
artifact-freshness.test.ts  Every stamp, judged as the runner judges it
                         (`buildFreshness`, `manualFreshness`;
                         /scripts/pipeline/README.md#freshness--one-mechanism),
                         one case per step on the loaded table. build/stamps/
                         and data/stamps/ hold only the table's steps'
                         stamps, and every manual step has its committed
                         record. Once any build stamp exists, every build
                         step's must exist and be fresh — a partial build
                         otherwise leaves the artifact-backed suites
                         self-skipping, and "pnpm test green" means less
                         than it reads. Each manual record must match the
                         disk, its `--describe` aside (the runner's check).
                         Self-skips the build cases with nothing built, and
                         a manual record whose files are LFS pointer stubs.
bundle-content.test.ts   Deployed-bundle guard: no source-tree file
                         types (.md/.txt/.py/.ts) under public/, no
                         `.staged` output a killed build left in public/
                         or dist/; each mirror's folders hold only its
                         declared outputs (MIRROR_STEPS, strays()).
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
citation-index.test.ts   The citation index, the tree's citations and the
                         private paper store agree. The checks are listed
                         once, in /data/papers/README.md#what-enforces-it.
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
doc-figures.test.ts      Every doc-figure marker in a tracked or untracked
                         .md or .html resolves to a snapshot number and
                         quotes it (/scripts/doc-figures/README.md#the-marker),
                         and the catalogue's size appears nowhere unmarked
                         outside the shrink-only exemption list
                         (/scripts/doc-figures/README.md#the-catalogues-size).
doc-pointer-resolution.test.ts
                         Every `<path>.md#<slug>` pointer in a
                         git-listed file of a kind `SCANNED_KINDS`
                         (doc-pointer-pure.ts) lists names a heading
                         or anchor that exists — the codebase's wiki
                         links, checked. Grammar, scope and resolution:
                         README.md#doc-pointer-resolution.
folder-readme-coverage.test.ts
                         The "every folder under src/, scripts/, data/,
                         docs/ has a README.md" invariant (/AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit).
readme-trees.ts          Not a test — `readmeTreeFolders`, the folder list
                         the folder-README suites scan: real directories
                         under src/, scripts/, data/, docs/, minus build
                         and cache dirs. Never follows a symlink, so the
                         private paper store (data/papers/pdf) and
                         anything inside it stay out of the walk.
                         Pinned by readme-trees.test.ts.
integration-shell-ratchet.test.ts
                         stellata.ts is wiring only (/AGENTS.md#folder--module-conventions--where-new-code-lands).
                         Every `Stellata` field is on COMPOSITION; a
                         field off it fails, and so does a listed name
                         the class no longer has.
                         Parses the class with the TypeScript compiler;
                         arrow-function properties count as methods.
                         Growing COMPOSITION is a review decision, never a
                         way to land state on the shell. Also: the
                         constructor calls no method that reaches (through
                         the methods it calls, never a callback) a field not
                         yet assigned — typecheck cannot see through a call,
                         so an extraction that turns a `T | null = null`
                         field into a constructed namespace boots to a throw
                         unless the namespace is built first.
late-read-contract.test.ts
                         The wave-2 read contract (/src/client/README.md#boot-in-two-waves),
                         four scans. A `for` loop bounded by `X.count`
                         where X's type is assignable to `Catalog` but not
                         to `CompleteCatalog` fails; this half uses the
                         type checker over src/client (~3 s), since a
                         syntactic scan cannot tell a catalogue's `count`
                         from a planet host's. And every public method or
                         getter returning `| null` on `Stellata`, or on a
                         class it exposes as a readonly namespace field
                         (keyed `namespace.method`), is classified in
                         NULLABLE_SHELL_RETURNS; a late slot there
                         converts to Late<T> and leaves the list. Every
                         src/client class field written `X | null` and
                         assigned outside its constructor is classified
                         in late-read-contract-fields.ts, the open defects
                         citing their beads. And `Catalog.loadedCount` is
                         read only in loaders/catalog-* and the per-chunk
                         walkers LOADED_COUNT_READERS lists, pinned by
                         read count per file. Each scan has a probe case.
late-read-contract-fields.ts
                         Not a test — NULLABLE_FIELDS, the field half's
                         classified list.
node-import-boundary.test.ts
                         src/client/ and the two shared trees ship to a
                         browser, so no module there may import a
                         `node:` builtin or a `*-fixture.ts`. Test-only support that reads
                         data/ off disk takes the `-fixture` suffix and
                         is exempt by it; a type-only import of one still
                         crosses, since it erases before the bundler
                         runs. README.md#node-import-boundary below carries the
                         one limit it cannot see.
vite-config-import-extensions.test.ts
                         Every relative import specifier in the root
                         Vite / Vitest configs' static import graphs carries its
                         file extension, which Vite's native config
                         loader needs. README.md#vite-config-import-extensions
                         below.
integration/             Tests that read the pipeline and the viewer
                         together. Own README.
pipeline-viewer-boundary.test.ts
                         One-way imports between scripts/ (the pipeline),
                         src/client/ (the viewer) and the two trees they
                         share. README.md#pipeline-viewer-boundary below.
record-codec-imports.test.ts
                         src/catalog-format/record/ imports nothing from
                         outside itself. README.md#record-codec-imports
                         below.
public-artifact-names.test.ts
                         Each public/ artifact name is spelled in one
                         TypeScript literal, its owner's.
                         README.md#public-artifact-names below.
page-teardown-contract.test.ts
                         Source scans behind util/page-teardown.ts's
                         contract (/src/client/util/README.md): no `window`
                         assignment under src/client outside `expose`,
                         and no `window` / `document` listener that
                         neither passes a `signal` nor is removed in its
                         own file (parsed with the TypeScript compiler, so
                         an inline arrow handler's options are still
                         read). Flag and pass cases for both.
pipefail-early-reader.test.ts
                         No scripts/**/*.sh that sets pipefail, or is
                         sourced by one that does, pipes into a reader
                         that can exit early: grep -q / -l / -m, head,
                         awk exit, sed q.
                         README.md#pipefail-early-readers below.
perf-guard.test.ts       Behavioural pins for scripts/hooks/perf-guard.sh's
                         two gates: every launch spelling denied unarmed and
                         allowed under a fresh marker (including the
                         non-pnpm managers and a launch on its own line in a
                         multi-line command, both of which once bypassed
                         it), every mention or Write of the marker denied
                         armed or not, and the fail-closed paths — no git
                         checkout, unreadable marker age. The protocol and
                         the escape routes are asserted in the deny reason.
paper-store-link.test.ts Behavioural pins for scripts/hooks/paper-store-link.sh
                         over a throwaway repo with real linked worktrees;
                         /scripts/hooks/README.md#how-paper-store-link-works.
pr-body-guard.test.ts    Behavioural pins for scripts/hooks/pr-body-guard.sh
                         over a throwaway repo with a stubbed `gh`, plus the
                         check that each body-guard workflow calls the
                         script the hook runs;
                         /scripts/hooks/README.md#how-pr-body-guard-works.
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
                         test job); runs for real in build-catalog's
                         full vitest and locally.
source-declarations.test.ts
                         Every TypeScript step's on the table, and every
                         closure-reading NON_STEP_WRITERS entry's (every tsx
                         entry of a chained script, and a writer it cannot
                         classify fails), import closure reads
                         each declared source and artifact it reaches
                         (/scripts/util/sources/README.md#reached-means-read);
                         a data/ path literal sits only in a declaring or
                         outputs module, across scripts/, src/, tests/ and
                         vite*.ts (named DATA_PATH_SPELLERS excepted,
                         data-files.ts pinned as the only production one),
                         and a DATA_FILES path in none of them, outputs
                         and declaring modules included;
                         defineSource / defineArtifact only
                         in a *-source.ts / *-tsv.ts module; every
                         package.json tsx command goes through the
                         launcher; every launched entry's top level is
                         declarations only (TypeScript's parser; no bare
                         call, guard, or value computed by main), and an
                         entry named like a declaring module runs nothing
                         when the walk imports it (entry-fixture.ts).
site-claims.test.ts      The homepage against what it states: figures are
                         published tokens, never literals · every saved-view
                         link decodes, and each sight's two anchors share
                         its take's end view · no sight clip autoplays or
                         preloads · every still's srcset widths exist ·
                         the source and reference counts
                         pinned, the subsystem table summing to the first ·
                         only on-site links stay in the tab, on both pages ·
                         the 404 page's masthead and footer are the
                         homepage's ·
                         theme-color and the manifest colours are --bg ·
                         every author-year a citation-index label.
                         /src/site/README.md#numbers-in-copy.
site-css-rules.test.ts   The public stylesheet answers to its container and
                         to the reader's font size, never to a viewport
                         measurement, and paints nothing it has not
                         tokenised. Groups: breakpoints · hardcoded values ·
                         measure · new-tab announcement · cascade order · the
                         filled pill · logical properties. Scans the file
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
step-coverage.test.ts    Every declareOutputs constant under scripts/,
                         imported from the *-outputs.ts module it must live
                         in and be exported from, is a steps.ts entry's or a
                         NON_STEP_WRITERS entry's; every build:/fetch:/
                         refresh: script is on one of the two or runs the
                         runner (../scripts/pipeline/README.md#the-model).
step-outputs.test.ts     Imports every TS emitArtifacts declaration the
                         step table and NON_STEP_WRITERS name, so one
                         that runs its step on import fails here; pins
                         every declared path inside the repo and one
                         producer per path; no file
                         or family may cover the frozen DR2 dry-run pair
                         (scripts/sid/dr2-neighbourhood-source.ts) but
                         refresh:gaia-dr2-neighbourhood's own re-pull of
                         the neighbourhood half.
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
vite-env.test.ts         absentCatalogueFor: only a production Vite build
                         refuses an unbuilt catalogue; every other mode
                         quotes the count snapshot
                         (/scripts/site/README.md#why-each-count-is-derived-where-it-is).
webgpu-import-boundary.test.ts
                         No value import of three/webgpu or three/tsl
                         outside src/client/webgpu/, so the ~1 MB second
                         copy of three's core stays out of the entry
                         bundle (/src/client/webgpu/README.md#import-boundary--nothing-webgpu-in-the-entry-bundle).
doc-pointer-pure.ts      Not a test — extraction, anchor collection, path
                         resolution and the scanned corpus, shared by
                         doc-pointer-resolution.test.ts and
                         citation-index.test.ts.
pipe-buffer.ts           Not a test — `pastPipeBuffer`, multi-line input
                         longer than any pipe buffer, for the hook suites'
                         pipefail cases.
git-fixture.ts           Not a test — `gitIn` and `commitFile`, a throwaway
                         repo's git runner and one-file commit, for suites
                         that drive a script over real history.
entry-fixture.ts         Not a test — `writeEntryFixture`, a throwaway
                         launchable entry (exports main and describe) whose
                         main logs each run's arguments, for the launcher
                         suites (emit-artifacts.test.ts and
                         source-declarations.test.ts).
import-specifiers.ts     Not a test — `importSpecifiers` (every specifier,
                         its form, and whether it is type-only),
                         `isRelativeSpecifier`, `resolveImportTarget` (the
                         repo path a relative specifier names) and
                         `isShippedSource` (not a test, `.d.ts` or
                         `*-fixture.ts`), shared by node-import-boundary,
                         pipeline-viewer-boundary, record-codec-imports
                         and vite-config-import-extensions.
walk-files.ts            Not a test — file enumeration the scanners above
                         share. `walkFiles` is a recursive walk taking
                         `include` / `skipDir` predicates, and follows
                         symlinked directories, which public/ carries.
                         A scan whose scope is the repo rather than a
                         folder list takes git's list instead,
                         /scripts/util/README.md#git-files.
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
unchecked. The sid registry's ledgers and events files are out because
the sid ledger guard freezes their existing rows. Tracking puts `.claude/skills` in; `.gitignore` keeps
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
full <!-- count:build-catalog/recordCount k2 -->980k<!-- /count -->-record catalog and its derived buffers, so their tests are
seconds long even solo — and their wall time scales with machine load:
under a full-suite run the slowest sit at 2.5–3.5 s locally, and CI's
corpus job runs three of those files concurrently on a 2-core runner.
At the 5 s default they went intermittently red on unrelated PRs, which
trains readers to re-run rather than read failures.

The timeout is a hang detector, not a perf gate — `slowTestThreshold`
is what surfaces slowness. Raise a test's own `{ timeout }` for a
deliberate outlier rather than lifting the global.
`/tests/integration/local-group-emission-calibration.test.ts` is the standing example: its
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

`node-import-boundary.test.ts` scans **direct** import specifiers in the
browser trees — `src/client/` and the two shared trees, `BROWSER_TREES` in
`scripts/util/source-trees.ts` — so a builtin anywhere the bundle reaches is caught where
it is written. What it cannot see is a builtin behind an import from outside
those trees, which the pipeline-viewer boundary already forbids.

## Vite config import extensions

`vite-config-import-extensions.test.ts` walks the modules each root config
loads — every `vite*.config.ts` and `vitest*.config.ts` — following static relative imports, and fails on any relative
specifier that does not name an existing file exactly as written: Vite's
`configLoader: 'native'` loads the config through Node, which adds no
extension, so `./vite.env` misses `vite.env.ts` despite its dot. A
type-only import's specifier is checked, since Vite flags it, but the walk
does not follow it — Node strips the import, so its target never loads.
Dynamic imports, and the rest of the repo, are out of scope. The walk is
pinned to reach `scripts/catalog/build-counts.ts` and
`scripts/util/sources/source.ts`, so an empty walk cannot pass.

## Pipeline-viewer boundary

`pipeline-viewer-boundary.test.ts` classifies every non-test, non-fixture
module under `src/` and `scripts/` into a tree and holds each import to its
direction:

| tree | root | may import |
| --- | --- | --- |
| shared physics | `src/astro-core/` | itself |
| format | `src/catalog-format/` | itself, astro-core |
| viewer | `src/client/` | itself, format, astro-core, the rest of `src/` |
| pipeline | `scripts/` | itself, format, astro-core, the rest of `src/` |
| tooling | `scripts/perf/`, `scripts/release/` | anything |
| integration | `tests/integration/` | anything |

Type-only imports count: a workspace package needs the dependency whether or
not the import survives erasure, and the trees are laid out so each lifts into
one unchanged. Tests and `*-fixture.ts` support are held to the same
directions, so no package would dev-depend on its consumer; a test that has
to read both sides lives in `integration/` (its own README), which nothing
else may import. The two
tooling roots drive or check the built viewer — the perf runner its frame-cost
instrument, the release check its share-URL grammar — so they read it by
design; the suite fails if either stops, so an unused exemption cannot
linger. A new fact both sides need goes into the format tree (a wire shape,
a file name, a rule over record fields) or astro-core (physics), never into
the side that happens to compute it first.

## Record codec imports

`record-codec-imports.test.ts` holds every shipped module under
`src/catalog-format/record/` to imports from within that folder, bare packages
included. The codec is the one statement of the `catalog.bin` bytes, read by the
pipeline and the viewer alike, so a domain rule reaching it from either side
would ride along into both. The pipeline-viewer boundary still admits
`astro-core` here; this test is narrower.

## Pipefail early readers

Under `set -o pipefail`, a pipeline fails if any stage does. A reader that
exits before its input ends (`grep -q` or `grep -l` at its first match,
`grep -m N` at its Nth, `head`, an awk `exit`, a sed `q`) closes the pipe
while the writer may still be writing; the writer dies of SIGPIPE, the
pipeline returns 141, and an `if` reads a match as no match. Whether it
happens depends on size: grep has to read a whole line before it can match,
so one line of any length is safe, while multi-line input past a pipe buffer
fails on every run. So the rule is applied to the form, not to input sizes:
such a reader takes a here-string (`grep -q x <<< "$var"`), which has no
writer process to kill.

Each hook suite feeds its sites input past a pipe buffer with the match on
line 1. Where the input is multi-line, that case fails on the pipe form.
Where `tr` or jq first flattens it to one line, it passes on both forms and
is kept as a pin: it fails once the flattening is gone and a pipe is back.

`pipefail-early-reader.test.ts` scans every `scripts/**/*.sh` that sets
pipefail, plus every library such a script sources with `.` or `source`
(matched by file name, followed through libraries that source others), since
a sourced file runs under its caller's options. There is no allowlist.
A reader is recognised behind `NAME=value` prefixes and `command`, and as
`egrep` / `fgrep`. Full-line comments are skipped, and quoted strings never
count as a grep flag. The matcher has its own flag and pass cases, and a case that the scan
finds the hooks at all, so a detector that stops seeing pipes fails instead
of passing on an empty scan.

## Public artifact names

`public-artifact-names.test.ts` parses every production TypeScript module
under `src/` and `scripts/`, plus `vite.config.ts`, and fails on a string or
template literal that spells a name outside its owner: the `public` folder
itself outside `scripts/util/paths.ts`; a name
`src/catalog-format/public-artifacts/` owns — a `public/` file, a mirrored
folder as `public/<dir>` or `<dir>/…`, the dust manifest — outside it; or
the catalogue manifest or a `catalog.bin.<i>` chunk outside
`src/catalog-format/record/`. Import specifiers are not names. Prose counts:
a loader's error message interpolates the constant too, so a rename reaches
it. Tests are not scanned; one that addresses a real artifact imports the
constant.
