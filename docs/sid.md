# Stellata ID (SID) — universal stable object identity

Design gate for the SID epic (`stellata-efju`, B0). Every pin below is
binding on the implementation beads B1–B5; each bead's acceptance
criteria trace to a section here (§ 11). Companion README:
[`data/sid/README.md`](../data/sid/README.md) (registry file roster).

Measured numbers: § 4.2's bucket table is from the ledger's mint build
of 2026-07-10 (**327,452 records**, app 2.17.4); § 6.2's dry run is
frozen at the 2026-07-07 `dr2_neighbourhood` pull against the
2026-07-06 build's 5,085-id risk set (the committed request +
neighbourhood snapshots stay that pair so the classification is
replayable). Both supersede the epic description's earlier
323,603-record measurement.

## 1. Problem

Catalogue row indices are absmag-sorted at build time, so they
reshuffle every rebuild. The URL wire
(`src/client/util/url-state/url-state.ts`) references a star as
HIP-if-present else row index — only ~36% of stars carry a HIP, so the
rest fall back to the volatile index and a shared link's focus /
pointer / POIs silently drift to a different object after a catalogue
rebuild. POIs are HIP-only *and* star-only; clouds ride a separate
1-byte index namespace. Every future object type (exoplanets, moons,
probes, extragalactic tiers) would need yet another parallel encoding.

## 2. Identity model — three layers

The bug is a conflation of three identity layers that need different
properties:

| Layer | Currency | Stability | Owner |
| --- | --- | --- | --- |
| **Runtime** | array index (`catalog.bin` record index, `clouds.json` position, …) | volatile per build — fine, it's an array slot | each loader |
| **Wire** | **SID** — dense small integer, LEB128 on the wire | frozen forever | committed ledger (§ 4) |
| **External** | designations: `hip:32349`, `gaia_dr3:294…`, `cloud:orion-a`, … | stable but heterogeneous, huge, sparse | upstream catalogues |

The SID is a surrogate key over the union of external designations,
optimised for compact, frozen, wire-embeddable referencing of exactly
the objects Stellata loads. External designations become **allocation
keys behind the SID** and never appear on the wire. SIMBAD remains
the cross-ID *authority* (we consume it; we don't re-do the science),
but its canonical id is a designation string, not a wire integer, and
it can't resolve our synthetic companions.

SID `0` is reserved as the none/invalid sentinel; allocation starts
at 1.

## 3. Designation namespaces

Grammar: `<namespace>:<key>`. Namespace is lowercase
`[a-z0-9_]+`; the key charset is namespace-defined but never contains
whitespace or tabs (TSV-safe). Release-versioned catalogues get
**release-scoped namespaces** (`gaia_dr3`, `gaia_dr4`, never bare
`gaia`) because their key spaces are not stable across releases;
frozen catalogues (HIP, HD…) are unversioned.

Current namespaces:

| Namespace | Key | Source | Stability class |
| --- | --- | --- | --- |
| `hip` | Hipparcos number | catalog.bin HIP field | frozen catalogue |
| `hd` | Henry Draper number | AT-HYG / search index | frozen catalogue |
| `hr` | Harvard Revised number | AT-HYG / search index | frozen catalogue |
| `gl` | Gliese/GJ designation, trimmed AT-HYG cell with whitespace collapsed to `_` (`gl:Gl_804`) | AT-HYG / search index | frozen catalogue |
| `gaia_dr3` | Gaia DR3 source_id | catalog.bin gaia field | release-scoped; cross-release identity via § 6 |
| `synth` | `<wds_id>-<comp>` (the runtime synth key minus its `synth-` prefix) | companion promotion | synthetic; churns under WDS re-pairing (§ 5) |
| `cloud` | `clouds.json` `id` slug | clouds pipeline | slug — rename requires a bridge (§ 4.1) |
| `lg` | `local-group.json` `id` slug | LVDB pipeline | slug — rename requires a bridge |
| `sol` | `sun`, `mercury` … `pluto` | committed list | frozen by us |

Reserved for future layers (see § 10): `pgc`, `ngc`, `ic`, `ugc`,
`messier` (extragalactic tiers — PGC runs past 3 million, which is
why the wire is LEB128 from day 1), `exo` (exoplanets), `moon`,
`probe`.

## 4. Registry — same-as graph + frozen ledger

Two build-time layers under `data/sid/`:

### 4.1 Same-as equivalence graph

Nodes are designations; edges assert "same physical object". One SID
per connected component. Edges split by the
**recompute-vs-store boundary**:

- **Recomputed every build** (never stored): all intra-release edges
  derivable from committed `data/` inputs — gaia↔hip
  (`gaia_dr3_hip_xmatch.tsv` via `gaia-xmatch.ts`), hip/hd/hr/gl
  co-designations (same AT-HYG row / search-index entry),
  synth↔WDS-component identity (`multiples.tsv`), WDS↔Gaia
  per-component (`simbad_wds_xids.tsv`, `stage2_resolve.py`), GCVS
  bridging (`bridgeGcvsByGaia`).
- **Stored** (committed, append-only): edges encoding a human or
  cross-release decision —
  - `data/sid/sameas-overrides.tsv` — curated merges (future
    cross-catalogue identities like M31 = `ngc:224` = `pgc:2557`),
    synth re-subdivision bridges (§ 5), slug-rename bridges.
  - `data/sid/bridges/<from>_<to>.tsv` (e.g. `gaia_dr3_dr4.tsv`) —
    machine-generated cross-release Gaia bridges from the § 6
    reconciliation, human-reviewed before commit.

Rule of thumb: **if an edge is derivable from committed `data/`
inputs at build time it is never stored; if it encodes a decision it
is always stored.**

A designation carried by more than one catalog record (an HD/HR/GL
number covering both members of an AT-HYG component pair) names a
catalogue granularity, not one object: it joins no class and can key
no ledger row. Policy detail in `scripts/sid/README.md` § Ambiguous
designations.

### 4.2 Canonical key — stability-first

Each equivalence class is keyed in the ledger by its **canonical
designation**, chosen at mint time by this preference ladder and then
**frozen forever** (append-only; later-acquired designations never
re-key a row):

```
sol > hip > hd > hr > gl > gaia_dr3 (then gaia_dr4, …) > synth > cloud > lg
```

Measured bucket sizes (2026-07-10 mint build):

| Bucket | Records | % |
| --- | --- | --- |
| hip | 117,671 | 35.94 |
| hd | 194,628 | 59.44 |
| hr | 0 | 0.00 |
| gl | 975 | 0.30 |
| gaia_dr3 | 5,161 | 1.58 |
| synth | 9,016 | 2.75 |
| sol | 1 | — |
| *keyless* | **0** | — |

Zero truly-keyless objects: the only Gaia-and-HIP-less non-synthetic
records are 53 stars, all carrying HD/HR/GJ. **No positional
fingerprint code** — every object is keyed by a real designation or a
synthetic one.

Why stability-first (vs highest-coverage-first, i.e. `gaia_dr3` at
the top): SID stability is identical either way — the class carries
all designations, and a `gaia_dr3:` string remains a valid designation
forever. The difference is operational: with stability-first, the set
of ledger rows exposed to Gaia data-release churn is *exactly* the
rows whose canonical key starts with `gaia_` — greppable from the
committed file (5,161 rows today) — and the "zero churn for
stable-designation holders" claim (§ 6) is a visible property of the
key column. Objects added later that carry only Gaia ids still get
`gaia_drN:` keys, so a future bulk expansion (~2M Gaia-only stars)
makes the ledger majority-Gaia-keyed without weakening any of this.

The hr bucket is empty today (every HR star also has HIP or HD) but
stays in the ladder — it costs nothing and future catalogue subsets
may hit it.

### 4.3 Ledger — `data/sid/ledger.tsv`

One row per allocated SID, append-only, sorted by sid (equivalently:
file order = allocation order). LFS (`data/sid/ledger.tsv` — the
overrides/bridges/head files stay regular git, mirroring the
`wds_xids_overrides.tsv` precedent).

```
sid	canonical_key	kind	first_seen
1	hip:32349	star	2026-07-15
…
```

- `sid` — uint32, dense, strictly ascending, never reused.
- `canonical_key` — § 4.2; unique across the file.
- `kind` — `star | cloud | galaxy | planet` (extensible enum; the
  runtime does NOT read this — kind at runtime comes from which
  artifact carries the sid, § 8).
- `first_seen` — ISO date of the allocation batch; frozen thereafter.

`data/sid/retirements.tsv` (append-only, same guard): retired SIDs
are recorded, never deleted from the ledger, never reused.

```
sid	retired	reason	successor_sid
```

`successor_sid` is set for merges (§ 6.1) so a retired SID arriving
on the wire can still resolve; empty for objects that genuinely left
the model (a parked SID resolves to nothing and wire consumers skip
it gracefully).

`data/sid/ledger-head.json` (regular git, tiny) pins the frozen
state: `{ "rows": N, "max_sid": M, "sha256": "…" }` for the ledger
and the same triple for retirements. It is rewritten mechanically by
the allocation tool on every append.

### 4.4 Allocation

`npm run sid:allocate` (B1, `scripts/sid/`) is the **only** writer of
ledger rows:

1. Build the same-as graph (recomputed edges + stored edges) over all
   current build artifacts (catalog record set, clouds.json,
   local-group.json, sol list).
2. Resolve every equivalence class against the ledger: a class
   matches if **any** of its designations is, or same-as-reaches, an
   existing canonical key.
3. Unmatched classes mint new rows: next sid, canonical key by § 4.2,
   today's date. Within one batch, mint order is deterministic:
   catalog record order (bright-first — commonly shared objects get
   short LEB128 encodings), then clouds.json order, then
   local-group.json order, then the sol list.
4. Rewrite `ledger-head.json`.

The catalogue build itself **never mints**: `build-catalog.ts` (B2)
resolves each record to its SID via the ledger and **hard-fails** on
any unallocated object, with instructions to run `sid:allocate`.
Same for the clouds / local-group / sol emitters (B3). This keeps
`npm run build` deterministic and network-free, and makes every
allocation an explicit, reviewable diff.

An object that disappears from a build (catalogue cut, WDS row
dropped) keeps its ledger row — the sid is simply absent from the
artifacts. If it returns later it resolves to the same SID. Explicit
retirement (§ 4.3) is reserved for identity-level events (merges,
dissolved synthetic components), not presence fluctuations.

### 4.5 CI guard

`tests/sid-ledger-guard.test.ts` (B1), modelled on the build-counts
snapshot gate but deliberately stricter:

1. **Structural** (always runs): sids unique, strictly ascending,
   dense from 1 through max; canonical keys unique and
   grammar-valid (§ 3); kind in enum; sid 0 absent;
   `ledger-head.json` exactly matches a recomputation over the
   working files.
2. **Append-only** (runs when a git base is resolvable, i.e. CI and
   any local checkout with `origin/main`): read the *base* head file
   via `git show <merge-base>:data/sid/ledger-head.json` — it is
   regular git, so no LFS smudge is needed — then assert the working
   ledger's first `base.rows` lines hash to `base.sha256`
   (prefix-frozen ⇒ no row was edited, deleted, or reordered) and
   every appended ledger row has `sid > base.max_sid`. Retirements get
   the same prefix-frozen check but no sid-monotonicity — a new
   retirement may legitimately retire an old sid.
3. There is **no `UPDATE_*` escape hatch** for the frozen prefix.
   Appends need no override (always legal); a prefix rewrite is a
   never-event that requires editing the guard test itself in the
   same PR with explicit user sign-off. This is intentionally heavier
   than `UPDATE_BUILD_COUNTS=1` — build counts describe a build,
   the ledger IS the identity contract.

The guard runs as its own CI check with real LFS content and full
history (`.github/workflows/test.yml`; LFS objects come from the shared
Actions cache, `.github/actions/lfs-cache`); in the bare `test` job it
sees an LFS pointer stub and self-skips.

The guard protects the ledger *file*; `npm run sid:check` (its own CI
check, against the built artifacts) protects its *consistency with the build*: a
read-only allocation walk that fails on any would-mint object or
orphaned synth key. The § 4.4 build hard-fail already blocks
unallocated objects from shipping; the check closes the other
direction — an object-set change (a Stage-5 filter dropping pairs, a
WDS re-lettering) cannot land without its allocation, retirement, or
bridge in the same PR, so main's ledger ⟷ artifact state is always
clean and any churn a working branch surfaces is attributable to that
branch alone.

## 5. Synthetic-key churn (WDS re-subdivision)

WDS re-pairing renames components (`Aa,Ab` → `Aa1,2` and similar), so
a `synth:<wds>-<comp>` designation can vanish from one WDS drop to
the next while the physical object persists. This is an active
failure mode, not a hypothetical.

**Ownership pin:** all synth-SID reconciliation lives in the
allocation tool (`scripts/sid/`); the binaries pipeline stays
sid-free. On `sid:allocate` (and the B2 build assert), a ledger row
whose canonical `synth:` key is absent from the current build's synth
set **hard-fails** with a candidate report: the orphaned key, every
current synth key under the same WDS root, and each candidate's
comp letters / sep / PA. Resolution is human, one line each in
`sameas-overrides.tsv`:

- **Bridge** — `synth:04357+1010-Aa,Ab` = `synth:04357+1010-Aa1,2`
  (same physical object, re-lettered), or
- **Retirement** — appended to `retirements.tsv` when the component
  genuinely dissolved (e.g. an unresolved aggregate that stopped
  being promoted).

The guard (§ 4.5) plus this fail-closed detection means a WDS refresh
can never silently re-point a synth-keyed SID at a different star.

## 6. Gaia data-release reconciliation

Gaia source_ids are **not stable across data releases**. Mitigation
is structural, then procedural:

- **Structural (98.4% of the catalogue):** every class holding a
  non-Gaia stable designation (hip/hd/hr/gl/synth/sol buckets in
  § 4.2) has **zero SID churn by construction** — the SID is pinned
  by the stable key; a DR bump merely attaches the new `gaia_dr4:`
  designation via the recomputed intra-release cross-walks
  (`scripts/refresh/README.md` § Refreshing data when DR4 lands).
- **Procedural (the 5,085 `gaia_*`-keyed rows, 1.56%):** carried
  forward via Gaia's official neighbourhood cross-match table for the
  transition (DR2→DR3: `gaiadr3.dr2_neighbourhood`; DPAC publishes
  the analogue for each release).

### 6.1 Procedure

Per DR bump. The classifier + risk-set exporter are B1 deliverables;
running them is a refresh-time task alongside
`scripts/refresh/README.md` § Refreshing data when DR4 lands.

1. Extract the at-risk canonical keys: the ledger rows whose key
   namespace is `gaia_*`.
2. Pull the official cross-match rows for those ids
   (`refresh:gaia-dr2-neighbourhood` is the DR2→DR3 instance; the DR4
   transition re-points table + request).
3. Classify each at-risk id by its candidate rows in the new release:

| Class | Rule | Action |
| --- | --- | --- |
| **carried 1:1** | exactly one candidate within `ACCEPT_MAS = 400` | append bridge edge `gaia_dr3:X = gaia_dr4:Y` to `bridges/` |
| **contested** | ≥2 candidates within 400 mas | manual review queue; resolve to bridge / split |
| **split** | one old id accepted by ≥2 new ids | SID survives on the photometrically dominant component (smallest \|Δmag\|; tie → smallest angular distance); siblings mint new SIDs |
| **merge** | ≥2 old ledger-bearing ids map to one new id | survivor = lowest (oldest) SID; others retired with `successor_sid` = survivor |
| **dropped** | no candidate within 400 mas | review (PM-propagation flag, Δmag, sky region); unrecoverable → **parked**: ledger row kept, no bridge, resolves to nothing until a future designation re-links it |

4. Additionally flag accepted matches with `|Δmag| > 1` for review
   (12 such in the dry run) — a same-position much-brighter source is
   a possible mis-match.
5. Emit a **churn diff report** (counts per class + per-object lines
   for everything non-1:1) committed alongside the bridge file and
   reviewed before merge.

Retired/parked SIDs never reuse their integer; wire refs to them
degrade gracefully (§ 8, § 9.4).

### 6.2 DR2→DR3 dry run (measured 2026-07-07)

Methodology: the risk set was derived from the built artifacts —
records with a Gaia source_id, no HIP (`catalog.bin`), no HD/HR/GJ
(`search-index.json`), excluding synthetic companions and Sol —
snapshotted to `data/gaia/gaia_dr2_neighbourhood_request.tsv`
(5,085 ids; B1 formalises the exporter). `npm run
refresh:gaia-dr2-neighbourhood` pulled all `dr2_neighbourhood` rows
for those DR3 ids (5,912 rows; `angular_distance` is in **mas**),
committed as `data/gaia/gaia_dr2_neighbourhood.tsv`. Classification
per § 6.1 with `ACCEPT_MAS = 400`.

| Class | Count | % of risk set |
| --- | --- | --- |
| carried 1:1 (unique ≤ 400 mas) | 4,852 | 95.42 |
| — of which same source_id kept | 4,469 | 92.11% *of accepted* |
| — match distance p50 / p90 / p99 / max (mas) | 0.2 / 2.5 / 108.2 / 375.9 | |
| — accepted with \|Δmag\| > 1 (review flag) | 12 | 0.25 |
| contested (≥2 ≤ 400 mas) | 0 | 0.00 |
| split (1 DR2 → 2 DR3, both ours) | 2 DR2 → 4 DR3 | 0.08 |
| dropped: rows but none ≤ 400 mas | 177 | 3.48 |
| dropped: no DR2 antecedent at all | 56 | 1.10 |
| **dropped total** | **233** | **4.58** |

Read-outs:

- **Worst-case SID churn on a real DR transition is bounded at 233
  objects = 0.072% of the catalogue.** Everything else is either
  structurally immune (98.4%) or carries forward mechanically
  (95.4% of the risk set, zero contested).
- 7.9% of *cleanly matched* sources changed source_id anyway
  (383 of 4,852) — direct empirical confirmation that a raw Gaia
  source_id is not a stable wire key, i.e. the SID indirection is
  necessary, not just tidy.
- The dropped tail overstates real churn: DR2→DR3 was the harshest
  transition (full astrometric re-solution), "no antecedent" means
  *new in DR3* (the analogue population in a DR3→DR4 bump becomes
  parked SIDs, which degrade gracefully), and the 177 near-misses
  (nearest candidate 0.4″–1.2″) are exactly what the § 6.1 manual
  review + PM-propagation check exists to recover.

## 7. Storage — sid in every artifact

In-record, not a runtime sidecar:

- **`catalog.bin` (B2):** `sid` uint32 appended to `RECORD_LAYOUT`
  in `catalog-pure.ts`; `BINARY_VERSION` + `MAGIC` bump; writer /
  loader / verify-catalog all index off the layout constants.
  Independent of the `stellata-87y` v7 velocity bump — related-linked;
  whoever lands second re-bumps.
- **`clouds.json` + `local-group.json` (B3):** additive `sid` field
  per object (both already carry stable `id` slugs the ledger keys
  on). No format-version bump: build regenerates artifacts and ledger
  together, and each loader hard-asserts sid presence + uniqueness at
  parse.
- **Sol system (B3):** ledger rows minted from the committed
  `data/sid/sol-objects.tsv` list (`sol:sun` + the `SOL_PLANETS`
  bodies — eight majors + Pluto). Client-side, a hand-written
  `SOL_OBJECT_SIDS` table in `src/client/solar-system/` pins
  body → sid, with a vitest that imports the ledger and asserts the
  table matches (tests import, never redefine). `sol:sun` is minted
  for the ledger's completeness; Sol's catalog record resolves to the
  same SID through the same-as edge, not a second allocation.
- **Loader maps (B4):** `catalog-loader.ts` inverts the sid column
  into `sidToIndex` / `indexToSid`, mirroring `hipToIndex`.

## 8. Runtime resolver (B4)

One global resolver built at boot from whatever artifacts attach:

- A **domain** is `{ kind, localIndexOf(sid) → localIndex | null }`
  (plus a reverse `sidOf` for the encoder), declared in a fixed roster
  at resolver construction and then either **attached** when its
  artifact lands or **concluded** absent when it never will: stars
  over `catalog.sid` at catalog load, planets from `SOL_OBJECT_SIDS`
  at boot, Local Group when its fetch resolves (concluded when the
  artifact is missing), clouds concluded at boot while the layer is
  shelved — re-enabling `attachClouds` must attach the domain
  (`src/client/util/sid-resolver/README.md`).
- `resolveSid(sid)` → `{ kind, localIndex }`, or `pending` while any
  registered-but-unattached domain remains, or `unknown` once all
  attached domains have disclaimed it.
- **Deferred-resolution contract (pin):** applying a URL must never
  block on a late artifact. Unresolved sids from `applyFromUrl`
  register as deferred intents (focus / to / POI); each domain attach
  flushes matching intents; intents for domains that never attach
  (shelved clouds) or sids no domain claims (a URL minted by a newer
  deploy carrying an object type this client doesn't ship) expire
  silently, leaving the rest of the decoded state applied. This is
  the runtime half of wire forward-tolerance.

Scope pin: identity substrate only. Focus behaviour per object type
is unchanged (planets / LG stay hover-only); the POI generalisation
epic (`stellata-o6nx.1`) and per-layer epics consume the resolver —
SIDs minted here make them pure consumers. Runtime identity-API
consolidation (routing today's index-keyed methods through the
resolver) is `stellata-9mm.227`.

## 9. Wire format v4 (B5)

### 9.1 SID ref

One universal encoding replaces all three parallel ref encodings
(`starRefFieldU24` focus/to, `u8CloudField` cloud/toc, HIP-only POI
entries): an **unsigned LEB128 SID** (the varint helpers already in
`url-state.ts`). No type tag on the wire — kind comes from the
resolver. LEB128 from day 1: sids ≤ 16,383 cost 2 bytes, ≤ 2,097,151
cost 3; PGC-scale expansion (> 2^24) changes nothing.

### 9.2 `FIELDS_V4`

`SCHEMA_VERSION = 4`. Changes vs v3, everything else carried
unchanged (vec3 sub-masks, quantised scalars, flags, worldOffset, t):

| Bit | Key | v3 | v4 |
| --- | --- | --- | --- |
| 14 | `focus` | 3-byte tag-bit HIP/index | LEB128 SID (any kind — a cloud focus is just a cloud-kind SID) |
| 15 | `to` | 3-byte tag-bit HIP/index | LEB128 SID |
| 16 | `cloud` | 1-byte cloud index | **retired** — folded into `focus`; do not reuse for ~6 months of deploy overlap |
| 17 | `toc` | 1-byte cloud index | **retired** — folded into `to` |
| 18 | `focusCleared` | zero-byte sentinel | unchanged |
| 19 | `pois` | 1-byte count + 3-byte HIPs | 1-byte count + LEB128 SID each, `POI_MAX_COUNT` cap kept, order preserved |

Default-focus semantics unchanged: Sol focus is encoded by omission;
`focusCleared` stays the explicit third state. Append-only bit policy
continues within v4 (unknown high mask bits are ignored by the
decoder).

### 9.3 Freeze before change

`FIELDS_V2` and `FIELDS_V3` were both derived from a shared
`buildFields` factory, so a ref-shape edit for v4 would have silently
corrupted both legacy decoders. B5 step 1 — landed before any v4
edit — snapshotted every legacy table into standalone frozen literal
arrays and committed a golden-blob corpus (real v1/v2/v3 `?v=` blobs
with their expected decoded fields) to `url-state.test.ts`, so v4
work provably cannot alter legacy decoding.

### 9.4 Migration semantics — exact table

`applyFromUrl` decodes any version and re-encodes v4 after the
existing 300 ms debounce (the v2→v3 auto-upgrade path, retargeted).
Row by row:

| Legacy field (v1/v2/v3) | Wire form | v4 resolution |
| --- | --- | --- |
| `focus` / `to`, HIP-tagged | v1: u32 tag-bit; v2/v3: u24 tag-bit | `hip → record index → sid` (hipToIndex → indexToSid). **Exact** — resolves to the same physical object; the rewrite pins it as a SID so it can never drift again. |
| `focus` / `to`, HIP-tagged, HIP unknown to this build | 〃 | drop the field (same as today's failed-HIP lookup); focus falls back to default. |
| `focus` / `to`, index-tagged | u32 / u24 raw index | **Best-effort**: resolve as *current-build* row index → sid. Pre-SID URLs sharing an index-addressed star may already point at the wrong object after any rebuild — decoding preserves the status quo, and the v4 rewrite freezes whatever the index resolves to *now*, so the reference stops drifting from this point on. |
| `focus` / `to`, index out of range | 〃 | drop the field. |
| `cloud` / `toc` | v1: u16 index; v2/v3: u8 index | **Best-effort**: current `clouds.json` order → cloud sid, emitted into v4 `focus` / `to`. Out-of-range → drop. |
| `pois` | count + u32 (v1) / u24 (v2/v3) HIPs | per entry `hip → sid`; unresolvable HIPs dropped (today they're silently unaddressable anyway); order preserved; count capped at `POI_MAX_COUNT`. |
| `focusCleared` | zero-byte bit | unchanged. |
| every other field | — | value-identical re-encode into the v4 field of the same bit. |
| absent presence bits | — | stay absent (fields keep canonical defaults). |
| v4 blob, decoder from an older deploy | version byte = 4 | unknown version → decode returns null → default view. Unavoidable on a SCHEMA_VERSION bump; single-deploy site makes the overlap window short. |
| unknown high mask bits in a v4 blob | — | ignored (forward tolerance for future append-only fields). |
| retired/parked SID arriving in v4 | LEB128 | `retirements.successor_sid` set → resolve to successor; else unresolved → deferred intent that expires (§ 8): the field degrades, the rest of the state applies. |

## 10. Adding a future object type — the recipe

The entire point of the SID: any object added to the model later
plugs into frozen identity with **no wire change and no ledger
migration**.

1. **Pick designation namespace(s)** (§ 3 grammar). Prefer an
   externally stable catalogue id (`pgc`, `ngc`, exoplanet-archive
   names); release-scope it if the upstream re-keys between releases;
   synthetic keys are allowed but adopt the § 5 bridge-on-churn
   policy from day 1.
2. **Add same-as edges** for cross-catalogue aliases — derived from
   the source's cross-ID columns where possible (recomputed), curated
   lines in `sameas-overrides.tsv` where not.
3. **Extend the allocation tool's input walk** to the new artifact
   and run `npm run sid:allocate` — new classes append to the ledger;
   the CI guard enforces append-only automatically.
4. **Carry `sid` in the artifact** (in-record field, like
   clouds/LG/catalog) and register a resolver domain on attach
   (§ 8) — deferred resolution then covers late/optional loading for
   free.
5. **Wire: nothing.** Focus / to / POI fields already carry any-kind
   LEB128 SIDs; older clients degrade per § 9.4's last rows.

## 11. Acceptance traceability

- **B1 registry substrate** (`stellata-efju.2`): same-as graph +
  boundary § 4.1; canonical ladder § 4.2; ledger + retirements +
  head files § 4.3; allocation tool § 4.4; CI guard § 4.5; synth
  churn detection § 5; DR-reconciliation classifier + risk-set
  exporter § 6.1/6.2.
- **B2 catalog sid field** (`stellata-efju.3`): § 7 catalog.bin +
  build hard-fail § 4.4.
- **B3 sibling artifacts** (`stellata-efju.4`): § 7 clouds / LG /
  sol-objects + `SOL_OBJECT_SIDS` pin test.
- **B4 runtime resolver** (`stellata-efju.5`): § 7 loader maps + § 8
  (domains, pending/unknown, deferred intents).
- **B5 v4 wire** (`stellata-efju.6`): § 9.1–9.4, including the
  freeze-first step and the golden-blob corpus.
- **POI generalisation** (`stellata-o6nx.1`): consumes § 8 + § 9;
  no identity work left in it.
