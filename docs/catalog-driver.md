# Catalogue driver — Gaia-native membership + classic-ID label overlay

The contract governing how catalogue membership, identifiers, and
per-field values are sourced once AT-HYG is retired as the driver.
Astrometry and distances left AT-HYG earlier (direction cascade +
distance stack, `docs/science-catalog-ingestion.md`); this document
covers everything else. The decision record — audit empirics, per-child
traceability, phase sequencing — lives in bd (epic `stellata-3bsf`,
design gate `stellata-3bsf.1`). External tables verified against
VizieR TAP 2026-07-27. The naming-authority ladder (proper/Bayer
display names, search aliases) has its own design gate and is not
covered here.

## 1. The driver model

Three concerns AT-HYG conflated are separated:

```
membership(floor) = INHERITED SPINE ∪ MAGNITUDE PULL(floor)
labels            = classic-ID overlay (frozen CDS joins) + spine backstop
fields            = per-field source cascades keyed on gaia_source_id
```

- **Inherited spine** (§ 3): a frozen, committed enumeration of every
  AT-HYG-derived record in the final AT-HYG-driven build. After the
  swap the spine file is data; AT-HYG the catalogue is not consulted.
- **Magnitude pull**: the Gaia-native `V ≤ floor` union term. It ships
  **off** at the swap — membership is exactly the spine, so record
  parity holds by construction. The completeness phase turns it on
  (V ≤ 11); deepening later is a re-pull, not a redesign.
- Classic stars fainter than any floor (Proxima V = 11.1, the faint
  Gliese tail) ship forever because the spine term never drops — the
  "classic rescue tier" IS the spine.

Membership is **not** derived by re-joining the classic catalogues:
the frozen cross-walks cannot reproduce a `gaia_source_id` for a
~14.7k-row residual (measured 2026-07-27) that AT-HYG matched by
routes we cannot replay, and re-deriving them positionally is
forbidden (source-ID anchoring, never position). The spine enumerates
them instead.

Companion promotion (`multiples.tsv` secondaries) is
driver-independent and unchanged; only its anchor records re-derive
fields.

## 2. Identifier sources — frozen CDS files, not live SIMBAD

Per `data/README.md` § Frozen external data, the build never touches
the network; live SIMBAD/VizieR resolution is **rejected** for the
identifier spine (unreproducible, unauditable, component-level
cross-IDs churn). SIMBAD stays enrichment-only (sp_type, WDS
cross-IDs), as today. The authoritative source per identifier:

| Source | CDS/ESA id | Rows (TAP) | Supplies | Citation |
|---|---|---|---|---|
| Tycho-2→DR3 cross-walk | `gaiadr3.tycho2tdsc_merge_best_neighbour` | 2,518,330 (in-tree) | TYC → `gaia_source_id` | already `data/gaia/gaia_dr3_tyc_xmatch.tsv` |
| HIP→DR3 cross-walk | `gaiadr3.hipparcos2_best_neighbour` | 99,525 (in-tree) | HIP → `gaia_source_id` | already `data/gaia/gaia_dr3_hip_xmatch.tsv` |
| Tycho-2 HD identifications | `IV/25/tyc2_hd` | 353,527 | HD ↔ TYC (with `n_HD`/`n_TYC` ambiguity flags) | Fabricius, Makarov, Knude & Wycoff 2002, A&A 386, 709 |
| Cross index | `IV/27A/catalog` | 3,690 | Bayer + Flamsteed ↔ HD/HIP | Kostjuk N.D. 2004, VizieR IV/27A |
| Bright Star Catalogue 5th rev. | `V/50/catalog` | 9,110 (9,096 with HD) | HR ↔ HD | Hoffleit & Warren 1991 |
| CNS5 | `J/A+A/670/A19/cns5` | 5,909 (corrected 2023-12-13) | GJ ↔ Gaia EDR3 source_id ↔ HIP, component letters | Golovin, Reffert, Just, Jordan, Vani & Jahreiß 2023, A&A 670, A19 |
| Hipparcos main (V slice) | `I/239/hip_main` | 118,218 | printed Johnson V (`Vmag`) for the bright/printed tier | ESA 1997, SP-1200 |

Caveats verified at the gate:

- **IV/27A as served by TAP is the Bayer/Flamsteed-bearing subset**
  (3,690 rows; HR 8832 absent). Sufficient as the Bayer/Flamsteed
  designation source; used for nothing else — HR routes via V/50, HD
  via IV/25, HIP natively. Bayer *display* rendering (Greek glyphs)
  belongs to the naming-ladder gate, which consumes these
  designations.
- **CNS5 beats hand-rolling Gliese**: modern, curated, carries
  GJ ↔ Gaia EDR3 (same source_id space as DR3) ↔ HIP directly, plus
  component structure. V/70A (CNS3) is not ingested. **CNS5 is
  volume-limited to 25 pc**, which bounds it to ~61% of AT-HYG's `gl`
  labels (measured at ingest, 2026-07-28): 97% of the misses lie beyond
  25 pc, in the Gliese-Jahreiß / NLTT supplement numbering CNS5 does not
  enumerate. Those labels come from the spine backstop, not a second
  Gliese source.
- V/50's 14 HD-less HR entries resolve through the spine backstop or
  are listed in the parity ledger.

The frozen files landed in `data/classic-ids/` (plus the `I/239` V slice
in `data/hipparcos/`), joined into a source_id-keyed overlay by
`pnpm run build:classic-ids`. **The overlay covers 61–96% of AT-HYG's
labels per identifier and has no row at all for 112 of the 178 stars at
V ≤ 3** — Gaia saturates near G ≈ 3, so a source_id-keyed table
structurally cannot carry Vega, Sirius or Betelgeuse. The spine backstop
in § 1 is therefore load-bearing for a double-digit fraction of every
identifier, not a rare fallback: label parity (§ 6.2) is a property of
overlay ∪ spine and can only be gated once the spine ships.
Per-identifier figures and the three structural bounds behind them:
`data/classic-ids/README.md` § Coverage.

## 3. The inherited spine

One committed TSV (`data/athyg/inherited-spine.tsv`, LFS), generated
**once** by a one-shot script from the final AT-HYG-driven build plus
the AT-HYG CSV, then frozen. One row per AT-HYG-derived record:

```
tyc  hip  hd  hr  gl  flam  bayer  proper  gaia_source_id  ra  dec  dist  mag  ci  spect  rv  *_src
```

- `gaia_source_id` may be empty (the no-Gaia residual). Ids are
  DR3-namespace; under DR4 they remain valid designations and bridge
  via SID DR-reconciliation (`docs/sid.md` § 6) — the spine never
  rewrites.
- Printed columns are consumed **only** where a per-field cascade
  (§ 5) bottoms out. For everything else the spine contributes
  membership + designations only.
- There is no separate keep-list file: no-Gaia rows are ordinary
  spine rows with an empty `gaia_source_id`.
- The generator pins per-column counts in build-counts;
  `data/athyg/README.md` documents the file as *generated provenance
  data* (source: AT-HYG v3.3 final build, dated), distinct from the
  upstream CSV, which stays committed but leaves the build's input
  set.

Sol remains the hand-emitted special record — a spine row like any
other.

## 4. How HD reaches Gaia

**Primary route: HD → TYC (IV/25) → source_id (tycho2tdsc merge).**
Every HD-bearing AT-HYG row also carries a TYC id (audit 2026-07-27),
so this route covers the HD overlay wherever the cross-walk resolves.
The HIP route (IV/27A → `hipparcos2_best_neighbour`) is the
**cross-check**, not a second authority: where both routes resolve,
disagreement goes to the parity ledger's review queue.

The cross-check is measurably small and coherent: over IV/27A's
HD+HIP-bearing rows, 2,637 agree, **21 disagree**, 74 are HIP-only
(measured 2026-07-28). Every disagreeing pair differs only in its low
source_id digits — resolved close pairs where the two walks pick
different components. They are enumerated in
`data/classic-ids/hd_hip_route_disagreements.tsv`.

**Ambiguity policy** (IV/25 `n_HD`/`n_TYC` > 1, and any designation
covering two records): mirrors `docs/sid.md` § 4.1 — such a
designation names a catalogue granularity, not one object. The overlay
attaches the label to every matching record; search dispatch resolves
to the brightest; such designations key no SID ledger row. Counts
pinned in build-counts (394 IV/25 rows flag `n_HD` > 1, 16 `n_TYC` > 1;
after the join 137 sources carry >1 HD and 7 HDs land on >1 source).

**Precedence:** mechanical overlay wins over spine designations on
disagreement — surfacing AT-HYG's cross-ID errors is the accuracy
point of the swap — with every flip enumerated in the parity ledger
and a curated override file for cases where review finds the CDS join
wrong (same pattern as `wds_xids_overrides.tsv`).

## 5. Per-field cascades and rescue tiers

The bright and no-Gaia rescue tiers are **condition-driven, not
magnitude-bound**. Membership-wise both are spine rows; the tiers
select per-field sourcing:

| Field | Cascade (first hit wins) |
|---|---|
| direction / xyz | Gaia DR3 5p → HIP2 → printed (shipped direction cascade, unchanged) |
| distance | B-J posterior → LMC kinematic → HIP2 parallax → spine printed (shipped stack, unchanged) |
| V magnitude | Riello+ 2021 transform V = G − f(BP−RP) inside the transform's validity → printed HIP V (`I/239` Vmag) → spine `mag` |
| absmag | always derived from (V, distance) + build-time de-extinction — one code path, no tabulated absmag |
| ci (B−V) | published Gaia-photometry relation → spine `ci` where BP−RP is absent |
| spectral string | SIMBAD sp_type (in-tree, source_id-keyed) → spine `spect` |
| radial velocity | Gaia DR3 `radial_velocity` (added to the astrometry-catalog pull schema) → spine `rv` |
| constellation | IAU-positional assignment, catalogue-wide — an AT-HYG-free pipeline has no editorial `con` for any row |
| proper / Bayer display | naming-authority ladder (its own gate) |

- **Bright tier** = rows the direction cascade already routes to
  HIP2/printed, plus rows whose Gaia photometry is missing or outside
  the Riello validity range: printed `I/239` V applies. The validity
  bound is a build-time calibration pinned in build-counts with
  per-tier routing counts (same discipline as the direction cascade).
- **No-Gaia tier** = empty-`gaia_source_id` spine rows: every cascade
  bottoms out at the spine's printed columns.
- Photometric transforms cite **Riello et al. 2021, A&A 649, A3**
  (Gaia EDR3 photometry; Table C.2 relations). The ci relation chain
  is selected at implementation against the parity distribution; the
  contract here is the fallback (spine `ci`) and the acceptance
  mechanism (|Δci| distribution in the parity ledger), not the
  coefficients.
- GCVS variability keys on HIP/HD exactly as today — the overlay
  supplies both.

No binary-format change: the v9 layout, stride, and field set are
untouched by the driver swap. Record **order** still changes (absmag
re-derivation reshuffles the brightest-first sort) — see § 7.

## 6. Parity — the gate on any membership change

Any change to catalogue membership or field sourcing (the driver swap,
a floor move, a Gaia DR transition) is gated by a **parity ledger**
comparing the before and after builds, committed as a build artifact /
test fixture:

1. **Record parity.** Every prior record either produces a record
   resolving to the **same SID**, or appears on a dropped list with a
   reason code from a closed enum (`merge:<survivor>`,
   `split:<siblings>`, `out-of-scope`, `no-position`). No silent
   drops: a count that moves without a ledger entry fails the gate.
2. **Label parity.** Per-identifier coverage must not regress; every
   previously-named record keeps a name or is listed with a reason.
   Overlay-vs-spine designation flips are enumerated with disposition
   (§ 4 precedence).
3. **Field parity.** |ΔV|, |Δabsmag|, |Δci| distributions pinned
   (p50/p99/max) once reviewed; spectral-string change count pinned.
4. The dropped and merged lists must agree row-for-row with any SID
   ledger writes (§ 7).

The frozen regression corpora (known-stars, sky-position,
multi-star-regression) stay green throughout — they pin the
famous-star surface a driver change is most likely to disturb.

## 7. Identity and ordering rules

Applications of `docs/sid.md` (which remains the authority):

- **Presence ≠ identity.** A record a membership change stops
  producing is a presence event: its ledger row goes unreferenced —
  no retirement (`docs/sid.md` § 4.4). Retirements/reinstatements are
  written only for identity events (a duplicate pair collapsing onto
  one Gaia source is a merge; a class split follows the split rule),
  enumerated off the parity ledger.
- **SID stability through membership changes.** Allocation resolves by
  designation class, so a record that survives with any of its
  designations intact keeps its SID. The spine preserves designation
  sets by construction.
- **URL refs must be SID-encoded before any membership or ordering
  change.** Index-encoded star refs break under re-sorting alone —
  field re-derivation reshuffles record order even when membership is
  unchanged. The `sid:check` CI gate then ties ledger ⟷ artifact
  consistency into the same PR as the change.

## 8. Gaia DR transitions — what re-pulls and what never does

- The classic-side joins (IV/25, IV/27A, V/50, CNS5, I/239) are
  DR-independent and never re-pull.
- The DR-scoped hops swap tables: TYC→source_id and HIP→source_id move
  to the new release's best-neighbour analogues; per-source_id pulls
  (astrometry, Apsis, NSS, distance posteriors) re-run through
  `scripts/refresh/` (§ DR4 transition order); spine `gaia_dr3:` ids
  bridge through `docs/sid.md` § 6 reconciliation.
- The photometric transform (§ 5) gets the new release's successor
  calibration.
- A deeper magnitude pull re-runs § 6 in additive mode: existing
  records must not move (same SIDs, zero field deltas); new records
  only add.

**Dead patterns — do not rebuild:** a bright/fill two-tier hybrid
membership; positional joins at any stage; live SIMBAD in the build; a
keep-list file separate from the spine; membership re-derivation from
classic catalogues (they are label overlays).
