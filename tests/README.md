# Repo-meta tests

Tests that exercise the repository itself rather than any one
subsystem. Picked up by the top-level `vitest` run alongside every
in-tree `*.test.ts`.

```
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
