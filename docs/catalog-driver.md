# Catalogue driver — Gaia-native membership + classic-ID label overlay

Design gate for the AT-HYG-retirement epic (`stellata-3bsf`, phase 1 of
three; phase 2 = magnitude completeness `stellata-cns`, phase 3 = Gaia
DR4 `stellata-3f8`). Every pin below is binding on the implementation
children; § 9 traces decisions to beads. The naming-authority ladder
(proper/Bayer display names, search aliases) has its own gate
(`stellata-wgp3.1`) and is **not** decided here — this gate covers
membership, identifier sourcing, field sourcing, parity, and SID
migration.

Measured numbers: AT-HYG audit of 2026-07-27 over
`data/athyg/athyg_33_classic_ids.csv` (317,175 rows) and the frozen
cross-walks under `data/gaia/`; shipped-catalog count 329,657 records
(2026-07-27 build). External tables verified against VizieR TAP
2026-07-27 (row counts below are what TAP serves — the ingest path
`scripts/refresh/` will consume).

## 1. The driver model — membership is a frozen list plus a floor

Today "the catalogue" is defined by AT-HYG's classic-IDs subset:
membership, identifiers, V magnitude, colour, spectral string, and
constellation all flow from one CSV whose merge logic we don't control
and whose cross-matches we cannot audit. Astrometry and distances
already left (direction cascade + distance stack,
`docs/science-catalog-ingestion.md` § Driver astrometry); this epic
moves everything else.

The replacement separates three concerns AT-HYG conflated:

```
membership(floor) = INHERITED SPINE ∪ MAGNITUDE PULL(floor)
labels            = classic-ID overlay (frozen CDS joins) + spine backstop
fields            = per-field source cascades keyed on gaia_source_id
```

- **Inherited spine** (§ 3): a frozen, committed enumeration of every
  AT-HYG-derived record in the final AT-HYG-driven build — its
  designation set, its resolved `gaia_source_id` (empty for the
  no-Gaia residual), and the printed values needed where Gaia supplies
  nothing. This is AT-HYG's last act: after the swap the file is data,
  AT-HYG the catalogue is not consulted.
- **Magnitude pull**: the Gaia-native `V ≤ floor` union term. Phase 1
  ships with it **off** — membership is exactly the spine, so record
  parity is satisfied by construction. Phase 2 (`stellata-cns`) turns
  it on at V ≤ 11; deepening later is a re-pull, not a redesign.
- Classic stars fainter than any future floor (Proxima V = 11.1, the
  faint Gliese tail) ship forever because the spine term never drops —
  the "classic rescue tier" IS the spine.

Companion promotion (`multiples.tsv` secondaries) is driver-independent
and unchanged; only its anchor records re-derive fields.

Why not "membership = the classic-ID overlay joins"? Measured: the
frozen mechanical cross-walks reproduce a `gaia_source_id` for 302,477
of the 314,865 gaia-bearing rows (§ 4). The ~12.4k residual carry
source_ids AT-HYG obtained by routes we cannot replay from frozen
inputs (its own merge history). A join-driven membership would silently
drop them; re-deriving them positionally is forbidden
(`stellata-dch`: source-ID anchoring, never position). Enumerating
them is exactly the "bounded, enumerable rescue list" the epic calls
for — the honest bound is ~14.7k rows (12.4k unreproducible-gaia +
2,310 no-gaia), not 2,310.

## 2. Decision 1 — identifier spine: frozen CDS files, not live SIMBAD

Per `data/README.md` § Frozen external data: the build never touches
the network; live SIMBAD/VizieR resolution is **rejected** for the
identifier spine (unreproducible, unauditable, and SIMBAD's
component-level cross-IDs churn). SIMBAD stays what it is today —
enrichment (sp_type, WDS cross-IDs) pulled by explicit refresh
scripts. The spine sources, all verified via VizieR TAP 2026-07-27:

| Source | CDS/ESA id | Rows (TAP) | Supplies | Citation |
|---|---|---|---|---|
| Tycho-2→DR3 cross-walk | `gaiadr3.tycho2tdsc_merge_best_neighbour` | 2,518,330 (in-tree) | TYC → `gaia_source_id` | Marrese et al. 2022 (DR3 cross-match); already `data/gaia/gaia_dr3_tyc_xmatch.tsv` |
| HIP→DR3 cross-walk | `gaiadr3.hipparcos2_best_neighbour` | 99,525 (in-tree) | HIP → `gaia_source_id` | already `data/gaia/gaia_dr3_hip_xmatch.tsv` |
| Tycho-2 HD identifications | `IV/25/tyc2_hd` | 353,527 | HD ↔ TYC (with `n_HD`/`n_TYC` ambiguity flags) | Fabricius, Makarov, Knude & Wycoff 2002, A&A 386, 709 |
| Cross index | `IV/27A/catalog` | 3,690 | Bayer + Flamsteed ↔ HD/HIP | Kostjuk N.D. 2004, VizieR IV/27A |
| Bright Star Catalogue 5th rev. | `V/50/catalog` | 9,110 (9,096 with HD) | HR ↔ HD | Hoffleit & Warren 1991 |
| CNS5 | `J/A+A/670/A19/cns5` | 5,909 (corrected 2023-12-13) | GJ ↔ Gaia EDR3 source_id ↔ HIP, component letters | Golovin, Reffert, Just, Jordan, Vani & Jahreiß 2023, A&A 670, A19 |
| Hipparcos main (V slice) | `I/239/hip_main` | 118,218 | printed Johnson V (`Vmag`) for the bright/printed tier | ESA 1997, SP-1200 |

Caveats verified at the gate:

- **IV/27A as served by TAP is the Bayer/Flamsteed-bearing subset**
  (3,690 rows; HR 8832 absent, max recno 3,690; 2,757 Flamsteed +
  2,185 Bayer). It is sufficient as the Bayer/Flamsteed designation
  source and is used for nothing else — HR routes via V/50, HD via
  IV/25, HIP natively. Display rendering of Bayer glyphs is
  `stellata-wgp3` (Stellarium sky culture), which consumes these
  designations, not a replacement for them.
- **CNS5 beats hand-rolling Gliese**: modern (2023), actively
  curated, carries GJ ↔ Gaia EDR3 (same source_id space as DR3) ↔ HIP
  directly, plus system/component structure. V/70A (CNS3) is not
  ingested.
- V/50's 14 HD-less HR entries (novae, non-stellar) resolve through
  the spine backstop or are listed in the parity ledger.

New frozen files land per `data/README.md`'s recipe (one folder per
source, README with provenance + refresh script under
`scripts/refresh/`). SCIENCE.md § Data sources gains one row per
source in the ingest PR (`stellata-3bsf.2`), not before.

## 3. The inherited spine — file shape and provenance

One committed TSV (proposed `data/athyg/inherited-spine.tsv`, LFS),
generated **once** by a one-shot script at swap time
(`stellata-3bsf.4`) from the final AT-HYG-driven build plus the AT-HYG
CSV, then frozen. One row per AT-HYG-derived record:

```
tyc  hip  hd  hr  gl  flam  bayer  proper  gaia_source_id  ra  dec  dist  mag  ci  spect  rv  *_src
```

- `gaia_source_id` — the record's resolved id (empty for the no-Gaia
  residual). These are DR3-namespace ids; under DR4 they remain valid
  designations and bridge via the SID DR-reconciliation
  (`docs/sid.md` § 6) — the spine file itself never rewrites.
- Printed columns (`ra dec dist mag ci spect rv` + provenance) are
  consumed **only** where the per-field cascade (§ 5) bottoms out —
  i.e. the no-Gaia rows and per-field gaps. For everything else the
  spine contributes membership + designations only.
- The 2,310 no-Gaia rows (2,298 with TYC, 916 with neither Gaia nor
  HIP, 11 with neither TYC nor HIP) are ordinary spine rows whose
  `gaia_source_id` is empty — there is no separate keep-list file.
  191 of them resolve via the HIP cross-walk backfill and carry that
  id.
- Auditability: the generator emits per-column counts pinned in
  build-counts; the parity ledger (§ 6) references spine rows by
  line; `data/athyg/README.md` documents the file as *generated
  provenance data* (source: AT-HYG v3.3 final build, date, app
  version), distinct from the frozen upstream CSV, which stays
  committed but leaves the build's input set.

Sol remains the hand-emitted special record (one of the ~30
printed-position tier-3 rows) — a spine row like any other.

## 4. Decision 2 — how HD reaches Gaia

**Primary route: HD → TYC (IV/25) → source_id (tycho2tdsc merge).**
Measured 2026-07-27: every HD-bearing AT-HYG row also carries a TYC id
(`hd_no_tyc = 0` over 297,059 HD rows), so this route covers the HD
overlay entirely wherever the cross-walk resolves. The HIP route
(IV/27A/HIP columns → `hipparcos2_best_neighbour`) is the
**cross-check**, not a second authority: where both routes resolve,
disagreement goes to the parity ledger's review queue.

Empirical confidence, measured over the frozen in-tree files:

- 301,606 of 316,193 TYC-bearing rows resolve through
  `gaia_dr3_tyc_xmatch.tsv`, and their source_id agrees with AT-HYG's
  `gaia` column **301,606 / 301,606** — AT-HYG's gaia assignments for
  the TYC-routed bulk *are* this cross-walk's output, so the swap
  re-derives rather than re-litigates them.
- Of the 13,259 gaia-bearing rows the TYC walk misses: 680 resolve
  via the HIP walk in agreement, **2 disagree** (the entire measured
  identity-churn surface today), 9,068 have a HIP absent from
  `hipparcos2_best_neighbour`, 3,509 have no HIP. The last two
  buckets (~12.6k rows) are the unreproducible-gaia population the
  spine carries (§ 1).

**Ambiguity policy** (IV/25 `n_HD` / `n_TYC` > 1, and any designation
covering two records): mirrors `docs/sid.md` § 4.1 — a designation
carried by more than one record names a catalogue granularity, not one
object. The overlay attaches the label to every matching record
(today's AT-HYG behaviour); search dispatch resolves to the brightest,
as it already does; such designations key no SID ledger row. Counts
pinned in build-counts.

**Precedence:** mechanical overlay wins over spine designations on
disagreement, because surfacing AT-HYG's cross-ID errors is the
catalogue-accuracy point of this epic — with every flip enumerated in
the parity ledger and a curated override file available for the cases
where review finds the CDS join wrong (same pattern as
`wds_xids_overrides.tsv`).

## 5. Decision 3 — rescue tiers and per-field cascades

The two rescue tiers the epic names are **condition-driven, not
magnitude-bound**. Membership-wise both are spine rows; what the tiers
actually select is per-field sourcing:

| Field | Cascade (first hit wins) |
|---|---|
| direction / xyz | Gaia DR3 5p → HIP2 → printed (shipped: direction cascade, unchanged) |
| distance | B-J posterior → LMC kinematic → HIP2 parallax → spine printed (shipped stack, unchanged) |
| V magnitude | Riello+ 2021 transform V = G − f(BP−RP) where BP−RP exists and G is inside the transform's validity → printed HIP V (`I/239` Vmag) → spine `mag` |
| absmag | always derived from (V, distance) + build-time de-extinction — one code path, no tabulated absmag |
| ci (B−V) | published Gaia-photometry relation → spine `ci` where BP−RP is absent |
| spectral string (`s`) | SIMBAD sp_type (in-tree, source_id-keyed) → spine `spect` |
| radial velocity | Gaia DR3 `radial_velocity` (added to the astrometry-catalog pull schema) → spine `rv` |
| constellation | IAU-positional assignment, catalogue-wide (`stellata-sp4q.2` — hard prerequisite; an AT-HYG-free pipeline has no editorial `con` for any row) |
| proper / Bayer display | naming-authority ladder (`stellata-wgp3`) |

- **BRIGHT tier** = the rows the shipped direction cascade already
  routes to HIP2/printed (2,509 + 138 + 30), plus every row whose Gaia
  photometry is missing or outside the Riello validity range — 103 of
  the 178 V ≤ 3 rows have no Gaia row at all. Astrometry for them is
  k35's cascade, already an explicit tier; V comes from the printed
  `I/239` Vmag slice. The exact G validity bound for the transform is
  an implementation calibration (`stellata-3bsf.4`): initial working
  value G = 6, set where the printed-vs-transformed |ΔV| families
  cross in the parity data, then pinned in build-counts with per-tier
  routing counts (same discipline as the direction cascade).
- **NO-GAIA tier** = the empty-`gaia_source_id` spine rows: every
  cascade bottoms out at the spine's printed columns. No separate
  file, no positional fingerprints.
- Photometric transforms cite **Riello et al. 2021, A&A 649, A3**
  (Gaia EDR3 photometry; Table C.2 relations). V is decided (above);
  for ci the relation chain is selected at implementation from the
  published candidates (direct Johnson relation, or the
  BT/VT pair + ESA SP-1200 § 1.3 BT−VT → B−V) against the parity
  distribution — the gate pins the fallback (spine `ci`) and the
  acceptance mechanism (|Δci| distribution in the ledger), not the
  coefficients.
- GCVS variability keys on HIP/HD exactly as today — the overlay
  supplies both, so the cross-match is source-compatible unchanged.

No binary-format change: v9 layout, stride, and field set are
untouched at phase 1. Record **order** still changes (absmag
re-derivation reshuffles the brightest-first sort) — which is why the
URL-ref migration must land first (§ 7).

## 6. Decision 4 — record-parity contract

The contract `stellata-cns.7` (parity audit) measures against:

1. **Record parity.** For every record in the shipped catalog
   (329,657 at 2026-07-27): the new pipeline produces a record
   resolving to the **same SID**, or the record appears on a dropped
   list with a reason code from a closed enum (`merge:<survivor>`,
   `split:<siblings>`, `out-of-scope`, `no-position`). At phase 1 the
   expected dropped count is **zero** (membership is the spine by
   construction); any nonzero entry is a finding to review, not a
   tolerance to spend.
2. **Label parity.** Per-identifier coverage ≥ the AT-HYG baseline
   (hd 93.7%, hip 37.2%, hr 2.8%, gl 1.0%, flam 0.9%, bayer 0.5%,
   proper 0.2% of 317,175); every named record (12,071 today) keeps a
   name or is listed with a reason. Overlay-vs-spine designation
   flips are enumerated with disposition (§ 4 precedence).
3. **Field parity.** |ΔV|, |Δabsmag|, |Δci| distributions between the
   pre-swap and post-swap builds, pinned (p50/p99/max) once reviewed;
   spectral-string change count pinned; conIndex movement is owned and
   enumerated by `stellata-sp4q.2` (149 positional movers), not
   re-counted here.
4. The ledger is a committed build artifact / test fixture; a count
   that moves without a ledger entry fails the gate; the dropped and
   merged lists must agree row-for-row with the SID ledger writes
   (§ 7).

The existing corpora (known-stars, sky-position,
multi-star-regression) stay green throughout — they pin exactly the
famous-star surface a driver swap is most likely to disturb.

## 7. Decision 5 — SID migration policy

`docs/sid.md` already contains the load-bearing rules; this section
applies them, it does not extend them.

- **Zero expected ledger churn at phase 1.** Allocation resolves by
  designation class, not row identity (`docs/sid.md` § 4.4). The spine
  preserves every record's designation set, and the mechanical joins
  reproduce AT-HYG's source_ids exactly where they cover (§ 4) — so
  every surviving record resolves to its existing SID. New mints: none
  expected (no new objects at phase 1).
- **Presence vs identity.** A record the new pipeline doesn't produce
  is a *presence* event: its ledger row simply goes unreferenced —
  **no retirement** (`docs/sid.md` § 4.4 reserves retirement for
  identity events). Expected phase-1 presence drops: zero (§ 6.1).
- **Retirements/reinstatements** are written only for genuine identity
  events surfaced by the swap: an AT-HYG duplicate pair collapsing
  onto one Gaia source is a merge (survivor = lowest SID, others
  retired with `successor_sid`); a class the overlay splits across two
  sources follows the split rule. The measured candidate surface today
  is the 2 HIP-route disagreements plus whatever the `n_HD`/`n_TYC`
  ambiguity review yields — **tens of rows at most, not thousands**.
  `stellata-3bsf.5` therefore rescopes from "mass retirement event" to:
  enumerate identity events off the parity ledger, write their
  retirement/bridge lines, keep `sid-ledger-guard` green — and, in
  doing so, rehearse the exact machinery phase 3's DR4 reconciliation
  (`docs/sid.md` § 6.1) runs at scale.
- **Ordering.** Star URL refs move to SIDs (`stellata-3bsf.3`)
  **before** the swap. This is forced even though membership is
  parity-preserved: absmag re-derivation reshuffles record order
  (§ 5), and 62.8% of records encode by raw index today. The
  `sid:check` CI gate then guarantees ledger ⟷ artifact consistency
  lands in the same PR as the swap.

## 8. Phase implications — what this design buys later

**Phase 2 (`stellata-cns`, V ≤ 11).** Turn on the magnitude-pull union
term: one Gaia pull at G ≤ ~11.5 margin, V-filtered at build via the
same Riello transform (already `stellata-cns.3`'s spec). Everything
else is already in place: the overlay joins are membership-agnostic,
the field cascades apply to fill rows unchanged (fill rows are
Gaia-complete by selection), the spine term is untouched. SID: fill
rows mint `gaia_dr3:`-keyed ledger rows (~0.9M — the majority-Gaia
ledger `docs/sid.md` § 4.2 explicitly anticipates; LEB128 wire already
sized for it). Parity contract re-runs in additive mode: existing
records must not move (same SIDs, field deltas zero), new records only
add. The real cost is first-load/perf (`stellata-cns.1`/`cns.6`), as
that epic already states.

**Phase 3 (`stellata-3f8`, DR4).** The classic-side joins (IV/25,
IV/27A, V/50, CNS5, I/239) are DR-independent and never re-pull. The
DR-scoped hops swap tables: TYC→source_id and HIP→source_id move to
the DR4 best-neighbour analogues, per-source_id pulls (astrometry,
Apsis, NSS, B-J successor) re-run through `scripts/refresh/` (§ DR4
transition order already documented there), and the spine's
`gaia_dr3:` ids bridge through the § 6 reconciliation — the 233-object
worst case measured on DR2→DR3 bounds the churn. The Riello transform
gets its DR4-photometry successor calibration. Nothing in the driver
redesigns.

**What is dead and must not be rebuilt:** the two-tier bright/fill
hybrid (`stellata-cns.2`, closed as history); positional joins at any
stage (`stellata-dch`); live SIMBAD in the build; a separate keep-list
file distinct from the spine; membership re-derivation from classic
catalogues (they are label overlays).

## 9. Traceability

| Decision | Binding on |
|---|---|
| § 1 driver model, § 3 spine | `stellata-3bsf.4` (row driver), `stellata-cns.5` (floor filter + provenance flag) |
| § 2 spine sources | `stellata-3bsf.2` (overlay ingest: files, READMEs, refresh scripts, coverage counts) |
| § 4 HD route + precedence + ambiguity | `stellata-3bsf.2`, parity review queue in `stellata-cns.7` |
| § 5 cascades + bright/no-Gaia tiers | `stellata-3bsf.4`; conIndex prerequisite `stellata-sp4q.2`; display names `stellata-wgp3` |
| § 6 parity contract | `stellata-cns.7` (the audit is the gate on the swap) |
| § 7 SID policy + ordering | `stellata-3bsf.5` (rescoped), `stellata-3bsf.3` (lands first) |
| § 8 phase behaviour | `stellata-cns.3`, `stellata-3f8` |
