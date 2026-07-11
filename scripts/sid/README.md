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
                          allocation (§§ 4.1, 4.4), per-record designation
                          extraction (starDesignations) + read-only
                          resolution (resolveSids, mint = error),
                          ledger/retirements codecs, head snapshot +
                          append-only checks (§§ 4.3, 4.5). Tests import
                          its constants — never redefine them.
registry-io.ts            Filesystem access to the committed registry:
                          canonical data/sid/ paths, loadStoredEdges, and
                          loadRegistry (validated read; throws
                          LedgerUnavailableError on an LFS-stub ledger).
                          Shared by allocate, build-catalog, and the stamp.
allocate.ts               npm run sid:allocate — the ONLY writer of
                          ledger.tsv (+ retirements bootstrap +
                          ledger-head.json). Reads the BUILT artifacts:
                          catalog manifest/chunks, search-index.json,
                          catalog-row-index-map.json, clouds.json,
                          local-group.json, data/sid/sol-objects.tsv.
                          Run build:catalog / build:clouds /
                          build:local-group first.
                          npm run sid:check (--check) — read-only CI
                          mode: same walk, zero writes; would-mint
                          objects and orphaned synth keys both fail.
                          Runs as its own CI check against the built
                          artifacts, making ledger ⟷ build consistency
                          a per-PR invariant.
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
stamp-sibling-sids.ts     Stamps the frozen sid onto clouds.json /
                          local-group.json after their emitters run — the
                          tail of build:clouds / build:local-group (also
                          npm run sid:stamp). See § Sibling-artifact
                          stamping.
sibling-artifacts.ts      SIBLING_ARTIFACTS spec (file / arrayKey / ns /
                          kind per sibling) + siblingArtifactObjects, shared
                          by allocate (minting) and the stamp (resolving) so
                          the namespace→kind mapping is defined once.
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

A Stage-5 filter change that mass-drops optical pairs orphans every
synth key those pairs minted; the reported "candidates" are then
surviving siblings with *different letters* — different physical
stars, never bridge targets. Resolve as successor-less retirements:
map each orphan key to its sid through `ledger.tsv`, append
`sid<TAB>date<TAB>reason<TAB>` rows to `retirements.tsv` (script the
mapping; one shared reason string per cause), re-run `sid:allocate`,
then `npm run build:catalog`. Before writing, verify attribution: the
Stage-7 count diff must conserve the donor tier's population into the
new verdicts, or some orphans belong to a different change. CI's
`sid:check` keeps main permanently consistent, so on an up-to-date
branch every orphan/mint is attributable to the current change —
the count-diff check then just confirms it.

## Sibling-artifact stamping

`clouds.json` and `local-group.json` carry an in-record `sid` (docs/sid.md
§ 7). Because `build-clouds.py` is Python, resolution is NOT duplicated into
either emitter — `stamp-sibling-sids.ts` post-processes the built artifact,
resolving each object's `cloud:<id>` / `lg:<id>` through the shared
`resolveSids` and writing the frozen sid in. It runs as the tail of
`npm run build:clouds` and `npm run build:local-group` (and `npm run
sid:stamp` does both). Like the catalog build it is a pure consumer: an
unallocated slug hard-fails with instructions to run `sid:allocate` (new
object) or add a `sameas-overrides.tsv` bridge (renamed slug). The catalog's
stellar sids are written in-record at build time instead
(`scripts/catalog/README.md` § SID allocation); the Sol system's are pinned
client-side in `src/client/solar-system/sol-object-sids.ts`.
