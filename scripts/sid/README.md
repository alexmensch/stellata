# SID registry tools

Build-time tooling for the Stellata ID registry: allocation of the
frozen `data/sid/ledger.tsv`, the Gaia DR-transition risk-set export,
and the DR reconciliation classifier. The full design — identity
model, canonical-key ladder, allocation, CI guard, DR procedure — is
`docs/sid.md`; the committed registry files are rostered in
`data/sid/README.md`. This README carries the tool contracts.

```
sid-pure.ts               Pure algebra: designation grammar (§ 3),
                          canonical-key ladder (§ 4.2), same-as classes +
                          allocation (§§ 4.1, 4.4), ledger/retirements
                          codecs, head snapshot + append-only checks
                          (§§ 4.3, 4.5). Tests import its constants —
                          never redefine them.
allocate.ts               npm run sid:allocate — the ONLY writer of
                          ledger.tsv (+ retirements bootstrap +
                          ledger-head.json). Reads the BUILT artifacts:
                          catalog manifest/chunks, search-index.json,
                          catalog-row-index-map.json, clouds.json,
                          local-group.json, data/sid/sol-objects.tsv.
                          Run build:catalog / build:clouds /
                          build:local-group first.
export-dr-risk-set.ts     npm run sid:risk-set — source_ids of the
                          non-retired gaia_*-keyed ledger rows, written
                          as the neighbourhood-pull request TSV (§ 6.1
                          step 1). --out=<path> to write elsewhere.
dr-reconcile.ts           npm run sid:dr-reconcile — churn report for a
                          DR transition (§ 6.1 classes); --bridges-out
                          writes carried-1:1 same-as edges for human
                          review. Defaults replay the committed DR2→DR3
                          dry-run inputs (§ 6.2).
dr-reconcile-pure.ts      Pure classifier + request/neighbourhood TSV
                          readers. ACCEPT_MAS / MAG_REVIEW_DELTA live
                          here.
```

The append-only CI guard is `tests/sid-ledger-guard.test.ts` (repo-meta:
it guards committed data, not this folder's code). It self-skips where
`ledger.tsv` is an LFS pointer stub — the bare CI `test` job — and runs
for real in the `build-catalog` job (`lfs: true`) and locally.

## Designation extraction — where each namespace comes from

Per catalog record: `hip:` + `gaia_dr3:` from the record fields,
`hd:`/`hr:`/`gl:` from its `search-index.json` entry, `synth:` from
`catalog-row-index-map.json` `bySynth` (runtime `synth-` prefix
stripped), `sol:sun` from `FLAG_IS_SOL`. Clouds and Local Group carry
their artifact `id` slugs; planets come from `data/sid/sol-objects.tsv`
(the `sun` row is not a second object — it rides the Sol record,
realising the § 7 same-as edge). `gl:` keys have whitespace collapsed
to `_` (`gl:Gl_804`) to satisfy the § 3 no-whitespace grammar.

## Ambiguous designations are dropped, not assigned

A designation carried by more than one record (57 `hd:`, 11 `hr:`,
1 `gl:` in the 2026-07-10 build — always an AT-HYG component pair
sharing one catalogue number, e.g. 3 Peg A/B on `hd:205811`) names a
catalogue granularity, not one physical object. Assigning it to either
record would freeze an arbitrary claim into the append-only ledger;
unioning through it would fuse two distinct objects' identities. So it
is excluded from the same-as graph entirely — it can neither key a
ledger row nor merge classes. Every affected record keys off its own
unique HIP/Gaia id; a record whose ONLY designation is ambiguous would
hard-fail allocation as keyless (zero such records today).

## Ownership pin — synth churn resolves here

All synth-key reconciliation (WDS re-lettering, docs/sid.md § 5) lives
in this folder's allocation flow; the binaries pipeline stays
sid-free. `sid:allocate` hard-fails on a ledger `synth:` key absent
from the current build, printing sibling candidates (comp/sep/PA from
`data/binaries/multiples.tsv`); resolution is a human bridge line in
`data/sid/sameas-overrides.tsv` or a retirement. Missing `cloud:`/`lg:`
slugs only warn — but a slug RENAME still needs a bridge, or the old
sid parks and the new slug mints a fresh identity.
