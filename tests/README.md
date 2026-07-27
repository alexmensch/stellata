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
sid-ledger-guard.test.ts Append-only CI guard for data/sid/ (docs/sid.md
                         § 4.5): structural validity, head-snapshot
                         integrity, frozen-prefix check vs the git
                         merge-base. No UPDATE_* escape hatch — a prefix
                         rewrite means editing the guard itself with
                         explicit user sign-off. Self-skips where
                         ledger.tsv is an LFS pointer stub (the bare CI
                         test job); runs for real in the build-catalog
                         job and locally.
```

Per-subsystem tests live next to their code (`*.test.ts` / `*.test.py`
co-located with the module under test); only repo-wide invariants
belong here.

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
deliberate outlier (`local-group-emission-calibration.test.ts` renders
every viewpoint × object and takes ~9 s) rather than lifting the
global.
