# Repo-meta tests

Tests that exercise the repository itself rather than any one
subsystem. Picked up by the top-level `vitest` run alongside every
in-tree `*.test.ts`.

```
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
claude-md-size.test.ts   Size guard for CLAUDE.md. Holds the file at
                         380 lines / 18 KB so it stays load-once-per-
                         session affordable; the failure message
                         explains the wiki convention and the
                         CLAUDE.md → folder-README → docs/ decision
                         flow.
readme-guard.test.ts     Behavioural pins for scripts/hooks/readme-guard.sh:
                         drives the hook's PreToolUse JSON contract over a
                         throwaway git repo in os.tmpdir(). Covers the
                         never-existed-README exemption for a folder the
                         session is creating, and the neighbouring cases
                         that must stay gated (unread README on disk,
                         committed folder missing one).
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
```

Per-subsystem tests live next to their code (`*.test.ts` / `*.test.py`
co-located with the module under test); only repo-wide invariants
belong here.

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
full 313k-record catalog and its derived buffers, so their tests are
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
