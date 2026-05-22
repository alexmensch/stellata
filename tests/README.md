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
```

Per-subsystem tests live next to their code (`*.test.ts` / `*.test.py`
co-located with the module under test); only repo-wide invariants
belong here.
