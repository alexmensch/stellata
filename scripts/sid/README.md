# SID registry tools

Build-time tooling for the Stellata ID registry: allocation of the
frozen `data/sid/ledger.tsv`, the Gaia DR-transition risk-set export,
and the DR reconciliation classifier. The full design — identity
model, canonical-key ladder, allocation, CI guard, DR procedure — is
`docs/sid.md`; the committed registry files are rostered in
`data/sid/README.md`. This README carries the tool contracts.

```
sid-pure.ts               Pure algebra: designation grammar (/docs/sid.md#3-designation-namespaces),
                          canonical-key ladder (/docs/sid.md#42-canonical-key--stability-first), same-as classes
                          (sameAsClasses, the one class build: allocate
                          and the membership parity matcher both call
                          it) + allocation (/docs/sid.md#41-same-as-equivalence-graph, /docs/sid.md#44-allocation), per-record designation
                          extraction (starDesignations) + read-only
                          resolution (resolveSids, mint = error),
                          parsers for every registry file, each taking
                          the declared file it reads (readTable in
                          exact mode, which also owns the LF / final-
                          newline / no-blank-line layout the head hash
                          relies on; a RegistryFile keeps each row's
                          rawLine from the same walk for the hash), head snapshot + append-only checks (/docs/sid.md#43-ledger--datasidledgertsv, /docs/sid.md#45-ci-guard).
                          Imports no declaration, so its many importers
                          reach no registry file through it. Tests import
                          its constants — never redefine them.
ledger-pure.ts            ledger.tsv's row shape, SID_KINDS and cell
                          encoding, apart from its declaration.
ledger-tsv.ts (+ test)    LEDGER — ledger.tsv's artifact codec, plus
                          ledgerFile. Every
                          registry file reads a sid as TableRow.id
                          (../util/tsv/README.md). The test round-trips
                          the committed ledger byte for byte.
events-pure.ts (+ test)   events.tsv's row shape, validateEvents, and the
                          retired-state count (retiredSids,
                          sidSuccessorPairs): out of service iff more
                          retire + merge events than reinstates.
events-tsv.ts (+ test)    EVENTS — events.tsv's artifact codec, plus
                          eventsFile; the test round-trips the committed
                          file.
allocation-lineage-pure.ts  Allocation as a lineage stage: its reason
                          codes, including the historical legacy.* codes
                          the migrated retirement rows carry.
sameas-source.ts          SAMEAS_OVERRIDES and SAMEAS_BRIDGES: the curated
                          edges, and data/sid/bridges/ as a folder source
                          whose *.tsv files are its members, so a new
                          bridge changes a reader's input set.
object-mints-source.ts    SOL_OBJECTS, SHELL_OBJECTS — the sol: / shell:
                          mint lists, declared.
stored-edges.ts           loadStoredEdges: overrides plus bridges, the
                          stored half of the same-as graph. Its own module,
                          so a reader of edges alone reaches no other
                          registry file.
catalog-designations.ts   Designation set per BUILT catalog record, from
                          catalog.bin + the two public/ sidecars (README.md#designation-extraction--where-each-namespace-comes-from). Shared by allocate and
                          the inherited spine's parity gate.
registry-io.ts            loadRegistry: the ledger, events and stored
                          edges, structurally validated (every event code
                          in the generated list), for a read-only consumer. Every file
                          is required; a suite that may meet an LFS-stub
                          ledger gates on isReadable(LEDGER) itself.
                          Shared by build-catalog and the stamp.
allocate-outputs.ts       ALLOCATE_OUTPUTS: what sid:allocate writes, the
                          ledger, events and ledger-head.json, declared;
                          tests/step-outputs.test.ts holds it.
allocate.ts               pnpm run sid:allocate — the ONLY writer of
                          ledger.tsv, appending each mint as one
                          LEDGER.encodeLine line and never rewriting a
                          committed one (+ ledger-head.json). The ledger
                          and events are required inputs. Reads the BUILT artifacts:
                          catalog manifest/chunks, search-index.json,
                          catalog-row-index-map.json, clouds.json,
                          local-group.json, data/sid/sol-objects.tsv,
                          data/sid/shell-objects.tsv.
                          Run build:catalog / build:clouds /
                          build:local-group first.
                          pnpm run sid:check (--check) — read-only CI
                          mode: same walk, zero writes; would-mint
                          objects and orphaned synth keys both fail.
                          Runs as its own CI check against the built
                          artifacts, making ledger ⟷ build consistency
                          a per-PR invariant.
export-dr-risk-set.ts     pnpm run sid:risk-set — source_ids of the
                          non-retired gaia_*-keyed ledger rows, written
                          as the next DR transition's neighbourhood-pull
                          request TSV (/docs/sid.md#61-procedure step 1),
                          through emitArtifacts to
                          build/sid/dr-risk-set-request.tsv
                          (dr-risk-set-outputs.ts; gitignored). Run by
                          hand at a DR transition, never by the build:
                          no step reads its output. Never the
                          committed DR2 request: that one is frozen as
                          half of the dry-run pair
                          (dr2-neighbourhood-source.ts), and
                          tests/step-outputs.test.ts fails if any step's
                          declared outputs cover either file.
dr-reconcile.ts           pnpm run sid:dr-reconcile — churn report for a
                          DR transition (/docs/sid.md#61-procedure classes),
                          plus the carried-1:1 same-as edges for human
                          review in build/sid/dr-reconcile-bridges.tsv
                          (dr-reconcile-outputs.ts; gitignored, a draft
                          reviewed and committed as
                          data/sid/bridges/<from>_<to>.tsv, never
                          committed itself). Defaults replay the committed DR2→DR3
                          dry-run inputs (/docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07):
                          dr2-neighbourhood-source.ts declares that pair.
                          --request= (a fresh sid:risk-set export) /
                          --neighbourhood= declare another transition's
                          files through the same module's
                          riskRequestSource / neighbourhoodSource, so
                          each file kind has one parse.
dr-reconcile-pure.ts      Pure classifier + request/neighbourhood TSV
                          readers. ACCEPT_MAS / MAG_REVIEW_DELTA live
                          here.
stamp-sibling-sids.ts     Stamps the frozen sid onto clouds.json /
                          local-group.json after their emitters run — the
                          tail of build:clouds / build:local-group (also
                          pnpm run sid:stamp). Every named target resolves
                          before one emitArtifacts call lands them all.
                          See README.md#sibling-artifact-stamping.
sibling-stamp-outputs.ts  SID_STAMP_OUTPUTS: the sibling artifacts sid:stamp
                          rewrites in place, as its emitArtifacts declaration
                          (../util/README.md). Side-effect free. The same
                          paths are their emitters' outputs too; the stamp
                          is an in-place transform after them.
sibling-artifacts.ts      SIBLING_ARTIFACTS spec (file / arrayKey / ns /
                          kind per sibling) + siblingArtifactObjects, shared
                          by allocate (minting) and the stamp (resolving) so
                          the namespace→kind mapping is defined once.
```

The append-only CI guard is `tests/sid-ledger-guard.test.ts` (repo-meta:
it guards committed data, not this folder's code). It self-skips where
`ledger.tsv` is an LFS pointer stub — the bare CI `test` job — and runs
for real in `build-catalog`, checked out with the full history its
merge-base check reads, and locally.

The LFS-stub predicates themselves (`isLfsPointer`, `isLfsPointerFile`,
and `lfsContentReadable`) live in `scripts/util/paths.ts`, not here — see
that folder's README for why; a suite gating on a declared file takes
`isReadable(declared)` (`scripts/util/sources/`).

## Designation extraction — where each namespace comes from

`catalogRecordDesignations` (`catalog-designations.ts`) owns the catalog
half of this, so `sid:allocate` and
`scripts/catalog/membership/membership-manifest-gate.test.ts` cannot derive
different sets from the same artifacts.

Per catalog record: `hip:` + `gaia_dr3:` from the record fields,
`hd:`/`hr:`/`gl:` from its `search-index.json` entry — plus a second `hd:` or
`hr:` per `hda`/`hra` alias, since both numbers name the star
(`scripts/catalog/classic-ids/label-merge/README.md`) — `synth:` from
`catalog-row-index-map.json` `bySynth` (runtime `synth-` prefix
stripped), `sol:sun` from `FLAG_IS_SOL`. Clouds and Local Group carry
their artifact `id` slugs; planets, moons, and probes all come from
`data/sid/sol-objects.tsv`, which is scoped by system membership rather
than object class — the row's `kind` column carries the class (the
`sun` row is not a second object: it rides the Sol record, realising
the [§ 7](/docs/sid.md#7-storage--sid-in-every-artifact) same-as edge). Boundary shells come from
`data/sid/shell-objects.tsv` (same `key\tkind` format, `shell:` ns).
`gl:` keys have whitespace collapsed
to `_` (`gl:Gl_804`) to satisfy the [§ 3](/docs/sid.md#3-designation-namespaces) no-whitespace grammar.

## Ambiguous designations are dropped, not assigned

A designation carried by more than one record — **68 in the 2026-09-08
build: 57 `hd:`, 11 `hr:`**, always a component pair sharing one
catalogue number — names a
catalogue granularity, not one physical object. Assigning it to either
record would freeze an arbitrary claim into the append-only ledger;
unioning through it would fuse two distinct objects' identities. So it
is excluded from the same-as graph entirely — it can neither key a
ledger row nor merge classes. A stored edge (`sameas-overrides.tsv`,
`bridges/`) naming one would put it back, so `sameAsClasses` throws on it
and every allocation and resolution fails. Every affected record keys off its own
unique HIP/Gaia id; a record whose ONLY designation is ambiguous would
hard-fail allocation as keyless (zero such records today).

Re-derive the count rather than trusting this line — `sid:check` prints one
line per dropped designation, and the total moves with membership:

```bash
pnpm run sid:check | grep -c '^ambiguous (dropped)'
```

## Ownership pin — synth churn resolves here

All synth-key reconciliation (WDS re-lettering, [§ 5](/docs/sid.md#5-synthetic-key-churn-wds-re-subdivision)) lives
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
stars, never bridge targets. (The reverse — a pipeline refinement
re-promotes a component whose sid was retired — is a `reinstate`
event in `data/sid/events.tsv`, [§ 4.3](/docs/sid.md#43-ledger--datasidledgertsv).) Resolve as
successor-less retirements: each orphan's sid gets a `retire` event in
`data/sid/events.tsv`. Before writing, verify attribution: the
Stage-7 count diff must conserve the donor tier's population into the
new verdicts, or some orphans belong to a different change. CI's
`sid:check` keeps main permanently consistent, so on an up-to-date
branch every orphan/mint is attributable to the current change —
the count-diff check then just confirms it.

## Sibling-artifact stamping

`clouds.json` and `local-group.json` carry an in-record `sid` ([§ 7](/docs/sid.md#7-storage--sid-in-every-artifact)).
Because `build-clouds.py` is Python, resolution is NOT duplicated into
either emitter — `stamp-sibling-sids.ts` post-processes the built artifact,
resolving each object's `cloud:<id>` / `lg:<id>` through the shared
`resolveSids` and writing the frozen sid in. It runs as the tail of
`pnpm run build:clouds` and `pnpm run build:local-group` (and `pnpm run
sid:stamp` does both). Like the catalog build it is a pure consumer: an
unallocated slug hard-fails with instructions to run `sid:allocate` (new
object) or add a `sameas-overrides.tsv` bridge (renamed slug). The catalog's
stellar sids are written in-record at build time instead
([SID allocation](/scripts/catalog/README.md#sid-allocation)); the Sol system's are pinned
client-side in `src/client/solar-system/sol-object-sids.ts`.
