# SID registry — frozen object-identity ledger

Committed home of the Stellata ID (SID) registry: the append-only
ledger that freezes one dense integer per physical object, plus the
stored same-as edges that can't be recomputed from other `data/`
inputs. Full design — identity model, canonical-key ladder,
allocation, CI guard, Gaia DR reconciliation, v4 wire — in
[`docs/sid.md`](../../docs/sid.md); this README is the file roster.

Unlike every sibling `data/` folder, this is **not** frozen external
data: the ledger is Stellata's own identity contract. It grows by
append only (`pnpm run sid:allocate`, the sole writer) and its frozen
prefix is CI-guarded — see docs/sid.md § 4.5 for what the guard
enforces and why there is no `UPDATE_*` escape hatch.

## Files

```
ledger.tsv              sid → canonical_key → kind → first_seen.
                        Append-only, sorted by sid, LFS.
retirements.tsv         sid → retired → reason → successor_sid.
                        Append-only; retired sids are never reused.
reinstatements.tsv      sid → reinstated → reason. Append-only; each
                        row cancels one retirement of that sid
                        (docs/sid.md § 4.3 counting semantics), so a
                        reappeared object resumes its original sid.
ledger-head.json        { rows, max_sid, sha256 } snapshot of the
                        ledger / retirements / reinstatements frozen
                        state; regular git so the CI guard can read
                        the merge-base version without LFS. Rewritten
                        mechanically by sid:allocate.
                        The sha256 covers the data lines only (each
                        LF-terminated); the header line is pinned
                        structurally by the guard instead.
sameas-overrides.tsv    Curated same-as edges (a → b → note):
                        cross-catalogue merges, synth re-subdivision
                        bridges (docs/sid.md § 5), slug-rename bridges.
                        Regular git, hand-edited.
sol-objects.tsv         The sol: namespace mint list (key → kind):
                        sun + eight majors + Pluto + the 18 major moons
                        (moons reuse kind=planet).
shell-objects.tsv       The shell: namespace mint list (key → kind):
                        local_bubble + heliopause (kind=shell). Boundary
                        shells Stellata generates/curates; client pin in
                        src/client/fresnel-shell/shell-object-sids.ts.
bridges/<from>_<to>.tsv Machine-generated cross-release Gaia bridges
                        (docs/sid.md § 6), human-reviewed per DR bump.
                        Directory appears with the first bridge.
```

Tooling (allocation, risk-set export, DR reconciliation) lives in
[`scripts/sid/`](../../scripts/sid/README.md) — including the
ambiguous-designation drop policy that decides which designations may
key a ledger row.

Derived-edge inputs (gaia↔hip cross-walks, AT-HYG co-designations,
`multiples.tsv` synth keys, `simbad_wds_xids.tsv`) live in their own
source folders and are recomputed each allocation run, never stored
here — docs/sid.md § 4.1 carries the recompute-vs-store boundary.
