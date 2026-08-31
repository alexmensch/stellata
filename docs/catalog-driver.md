# Catalogue driver — Gaia-native membership + classic-ID label overlay

The contract governing how catalogue membership, identifiers, and
per-field values are sourced once AT-HYG is retired as the driver.
Astrometry and distances left AT-HYG earlier (direction cascade +
distance stack, `docs/science-catalog-ingestion.md`); this document
covers everything else. The decision record — audit empirics, per-child
traceability, phase sequencing — lives in bd (epic `stellata-3bsf`,
design gate `stellata-3bsf.1`). External tables verified against
VizieR TAP 2026-07-27; § 5's value sources (I/360 GSPC, I/259, SIMBAD)
verified against VizieR/ESA TAP and SIMBAD 2026-08-14
(`stellata-3bsf.21`). The naming-authority ladder (proper/Bayer
display names, search aliases) is `docs/star-naming.md`.

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
cross-IDs churn). SIMBAD supplies enrichment values only (sp_type, WDS
cross-IDs, and § 5's bibcoded bottom-of-cascade value tiers) — never
identity. The authoritative source per identifier:

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
  (3,690 rows; HR 8832 absent). Used for nothing else — HR routes via
  V/50, HD via IV/25, HIP natively. It is the Bayer/Flamsteed source
  for the **V > 6.5 tail only**: the naming gate adopted the IAU
  WGSN naked-eye catalogue as the primary designation source, since it
  ships the Greek glyph natively and covers 1,494 of our 1,522 Bayer
  records (`docs/star-naming.md` § 2). IV/27A's own ASCII conventions
  and its 111 GCVS-style contaminants are normaliser inputs there,
  never a stored form.
- **CNS5 beats hand-rolling Gliese**: modern, curated, carries
  GJ ↔ Gaia EDR3 (same source_id space as DR3) ↔ HIP directly, plus
  component structure. V/70A (CNS3) is not ingested. **CNS5 is
  volume-limited to 25 pc**, which bounds it to ~62% of AT-HYG's `gl`
  labels (measured at ingest, 2026-07-28): 91% of the 1,126 misses lie
  beyond 25 pc (median 31 pc, p90 89 pc), in the Gliese-Jahreiß / NLTT
  supplement numbering CNS5 does not enumerate. Those labels come from the
  spine backstop, not a second Gliese source. Only the keyed/covered pair
  behind that ~62% is pinned in build-counts — the distance figures are
  derived prose, so recompute before gating on them
  (`data/classic-ids/README.md` § Coverage).
- V/50's 14 HD-less HR entries are non-stellar (novae/SNe, four
  clusters, M 31): out of scope by class, pinned as an exact set in
  the parity ledger's gates.

The frozen files landed in `data/classic-ids/` (plus the `I/239` V slice
in `data/hipparcos/`), joined into a source_id-keyed overlay by
`pnpm run build:classic-ids`. **The overlay covers 62–96% of AT-HYG's
labels per identifier and has no row at all for 115 of the 178 stars at
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
the AT-HYG CSV, then frozen. **313,257 rows**, one per AT-HYG-derived
record (shipped 2026-07-28; `scripts/catalog/spine/`):

```
tyc  hip  hd  hr  gl  flam  bayer  proper  gaia_source_id
ra  dec  dist  mag  ci  spect  rv  pm_ra  pm_dec
pos_src  dist_src  mag_src  rv_src  pm_src  spect_src
```

- The identifier columns carry the values the **build resolved**, not the
  raw cells: `gaia_source_id` has been through the native → HIP-cross-walk
  precedence and both binding gates; the three `multiples.tsv` HD-only
  primaries carry their backfilled HIP + source_id; and ξ UMa B, the one
  collocated AT-HYG double promotion merges rather than twins, carries the
  source_id that merge writes. That is what makes each record's designation
  set — and so its SID — identical by construction. Every other column is
  the AT-HYG cell verbatim.
- `gaia_source_id` is empty on 1,371 rows (the no-Gaia residual). Ids are
  DR3-namespace; under DR4 they remain valid designations and bridge
  via SID DR-reconciliation (`docs/sid.md` § 6) — the spine never
  rewrites.
- Printed columns are consumed **only** where a per-field cascade
  (§ 5) bottoms out. For everything else the spine contributes
  membership + designations only. `pm_ra`/`pm_dec` are there because two
  cascades bottom out at AT-HYG's printed proper motion — the direction
  cascade's `athyg_printed` tier and the space-motion velocity's
  `athyg_pm` tier, pinned as `directionAthygPrinted` /
  `velocityAthygPm` in build-counts (the pins are the authority; prose
  counts here have drifted once already) — and a frozen artifact cannot
  grow a column later.
- There is no separate keep-list file: no-Gaia rows are ordinary
  spine rows with an empty `gaia_source_id`.
- Per-column counts are pinned in build-counts, and asserted against the
  **committed** file rather than a regeneration: the spine is a snapshot of
  a build that no longer exists after the swap, so a rebuild-and-diff gate
  would demand rewriting the one file whose purpose is to stop moving. The
  file's byte length + sha256 are pinned in test source instead, and two
  parity gates hold it to the build it stands in for — row count against
  `recordCount` − `companionPromoted`, and the per-record designation
  multiset against the built artifacts
  (`scripts/catalog/spine/README.md` § Parity with the shipped build).
  `data/athyg/README.md` documents it as *generated provenance
  data* (source: AT-HYG v3.3 final build, dated), distinct from the
  upstream CSV, which stays committed but leaves the build's input
  set.

Sol is an AT-HYG row (`id` 1, addressable only by `proper = "Sol"`), so it
is a spine row like any other — no hand-emitted special case.

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

**Route agreement is not binding correctness.** Both walks are unvetted
best-neighbour tables and routinely land on the *same* wrong source for a
saturated star, so a mis-binding shows up as an agreement: the G = 20.95
background source beside α Cen B agreed on both routes while carrying
HD 128621 · HR 5460 · HIP 71681 · `alf Cen`. The assembled overlay is
therefore gated through the record build's own `resolveGaiaSourceId` checks
(G − V ≥ 1.0, sibling-letter attribution) before any count is taken, and
187 rows are dropped to `data/classic-ids/rejected_bindings.tsv`. **A
consumer keying labels off the overlay inherits this gate for free; one that
re-derives bindings from the raw cross-walks must re-apply it** —
`data/classic-ids/README.md` § The binding gate carries the reach bound.

**Ambiguity policy** (IV/25 `n_HD`/`n_TYC` > 1, and any designation
covering two records): mirrors `docs/sid.md` § 4.1 — such a
designation names a catalogue granularity, not one object. The overlay
attaches the label to every matching record; search dispatch resolves
to the brightest; such designations key no SID ledger row. Counts
pinned in build-counts (394 IV/25 rows flag `n_HD` > 1, 16 `n_TYC` > 1;
after the join 137 sources carry >1 HD and 7 HDs land on >1 source).

**Precedence:** mechanical overlay wins over spine designations on
disagreement — surfacing AT-HYG's cross-ID errors is the accuracy
point of the swap; Izar is the case that settles it (AT-HYG says HR 5505,
IV/27A and V/50 say 5506, and ε Boo IS HR 5506). Every flip is enumerated in
the parity ledger (`data/classic-ids/label_flips.tsv`, 719 rows: 133 flips,
419 additions, 37 suppressions, 130 dropped extras) with a curated override
file for cases where review finds the CDS join wrong (same pattern as
`wds_xids_overrides.tsv`; empty today).

**One mechanical exception, and it is an identity rule rather than a label
one: the merge may not turn an unambiguous spine designation into an ambiguous
one.** By the ambiguity policy above such a designation keys no ledger row, so
attaching an identifier a DIFFERENT record already holds deletes a working SID
key from both records and buys nothing — the star stays findable through the
record that holds it. Withheld and counted, 37 cells (p Eridani's HIP 7751,
Gl 277A's HIP 36626 which would otherwise go keyless).
Where a flip RENAMES a record's canonical key rather than colliding — CNS5
renumbering `Gl 157.1` to `GJ 9140` — the label flips and identity rides a
`data/sid/sameas-overrides.tsv` bridge, per § 7.

Record fields are single-valued and overlay cells are not, so the extra values
of an ambiguous designation are enumerated as dropped labels rather than
carried. Multi-valued identifiers are a wire + ledger change, not a merge
rule.

## 5. Per-field cascades and rescue tiers

**AT-HYG is not a source.** It is an opinionated amalgamation of
first-order catalogues (Tycho-2, Hipparcos, Gaia, Gliese), so no shipped
value may be attributed to it: every value traces to a first-order
catalogue pulled first-hand into `data/`. A value we cannot re-pull
ourselves cannot be defended or refreshed — traceability beats a
marginally better but unattributable number (decision 2026-08-15,
`stellata-3bsf.21`). The spine's printed columns are therefore a
**transition state, not a tier**: each cascade below names its
first-order replacement, the epic's value-half children retire the
printed consumption field by field, and `stellata-3bsf.8` removes it
entirely.

The bright and no-Gaia rescue tiers are **condition-driven, not
magnitude-bound**. Membership-wise both are spine rows; the tiers
select per-field sourcing. Struck-through tiers are the printed cells
being retired; the tier after each is its replacement:

| Field | Cascade (first hit wins) |
|---|---|
| direction / xyz | Gaia DR3 5p → HIP2 → Tycho-2 position, PM-propagated to J2016 (record's own TYC) → CNS5 astrometry (GJ) → SIMBAD coordinates (bibcoded) → curated (Sol) — ~~spine printed~~ |
| space-motion velocity | PM from whichever tier direction selected (Gaia / HIP2 / Tycho-2 / CNS5 / SIMBAD) + rv; zero tangential term where that tier carries no PM — ~~spine printed `pm_ra`/`pm_dec`~~ |
| distance | B-J posterior → LMC kinematic → HIP2 parallax → DR3 parallax inversion (in-tree pull) → CNS5 parallax → SIMBAD `plx_value` (bibcoded) — ~~spine printed~~ |
| V magnitude | Riello+ 2021 transform V = G − f(BP−RP) inside validity → printed HIP V (`I/239` Vmag) → Tycho-2 V = VT − 0.090(BT−VT) (SP-1200) → SIMBAD flux V → curated (Sol) — ~~spine `mag`~~ |
| absmag | always derived from (V, distance) + build-time de-extinction — one code path, no tabulated absmag |
| ci (B−V) | Gaia Table-5.9 relation, BP−RP ≤ 1.75 → printed `I/239` B−V (HIP) → GSPC synthetic B−V (BP−RP ≤ 3.0, a **measured** bound — see the ci bullet) → intrinsic spectral-class colour → solar — ~~spine `ci`~~ |
| spectral string | SIMBAD sp_type (in-tree; request set keyed source_id → HIP → TYC) → unknown — ~~spine `spect` display fallback~~ |
| radial velocity | SHIPPED — Gaia DR3 `radial_velocity` on a 5p row → SIMBAD `rvz_radvel` (bibcoded; Gaia-bibcode skip rule below) → zero radial term — ~~spine `rv`~~ |
| constellation (position) | IAU-positional assignment, catalogue-wide — an AT-HYG-free pipeline has no editorial `con` for any row |
| constellation (designation) | IV/27A `cst` by HD → by HIP → GCVS trailing abbreviation → positional |
| proper / Bayer display | naming-authority ladder (`docs/star-naming.md`) |

Value sources this contract adds (verified against VizieR/ESA TAP and
SIMBAD 2026-08-14; coverage sampled over the exact exposure buckets,
which were reproduced from the pinned counts before probing):

| Source | Id | Supplies | Citation |
|---|---|---|---|
| Gaia DR3 synthetic photometry (GSPC) | `gaiadr3.synthetic_photometry_gspc` / `I/360` | Johnson-Kron-Cousins B, V per `source_id` (+ fluxes, flux errors, per-band validated-range flags) — SHIPPED `data/gaia/gaia_dr3_gspc.tsv` | Gaia Collaboration, Montegriffo et al. 2023, A&A 674, A33 |
| Tycho-2 main + supplement 1 | `I/259` `tyc2`+`suppl_1`, filtered to mentioned TYCs | positions (per-star mean epochs), PM, BT/VT — keyed on the record's own TYC | Høg et al. 2000, A&A 355, L27 |
| Hipparcos main, B−V re-slice | `I/239/hip_main` | printed Johnson B−V (widens the existing V slice; 98.9% fill) | ESA 1997, SP-1200 |
| CNS5 astrometry re-slice | `J/A+A/670/A19/cns5` | ra/dec/parallax/PM for the GJ-keyed cohort (widens the existing id slice) | Golovin et al. 2023, A&A 670, A19 |
| SIMBAD values pull | `basic` + `flux` | rv / parallax / PM / coordinates with per-value bibcodes, V/B fluxes; keyed source_id → HIP → TYC → GJ, with a corroborated widening ladder over the source_ids that namespace misses | Wenger et al. 2000, A&AS 143, 9 |

Measured exposure and expected coverage (2026-08-14; pins in
`build-catalog-expected.json` unless noted):

- **ci** — SHIPPED (`stellata-3bsf.22`/`.25`, 2026-08-15). The exposure
  the spine's printed cell carried was 20,241: BP−RP > 1.75 (red) 18,281 ·
  no source_id 1,324 · G < 4 saturated 566 · photometry gaps 70. It now
  routes `printed_hip_bv` **10,341** · `gspc` **9,169** ·
  `spectral_derived` **279** · `solar_fallback` **1,525** — a 1,804-row
  derived residual against the ≈1.0–1.5k this section projected, and the
  right colour family since it is M-class dominated. **No Tycho BT−VT ci
  tier**: the SP-1200 colour transform's validity ends near BT−VT ≈ 1.8,
  exactly this population — adopting it would rebuild the out-of-validity
  transform the printed cell embeds. Extending the Table-5.9 relation past
  1.75 is equally inadmissible: note (k) publishes that range **for M
  giants only**, a luminosity class we cannot assert here.

  **Two corrections to what this section projected**, both measured at
  implementation and both recorded in
  `scripts/catalog/photometry/README.md` § Why the GSPC tier does not gate
  on the flag:

  1. *"GSPC reaches ≈90% of the red rows"* measured GSPC **row presence**
     (91.0% of the request set), not validity. The per-band flag reads
     `1` for in-range, not `0` — the archive publishes no polarity;
     Montegriffo+ 2023 § 6.2 does, and the numeric region was measured.
     It does not intersect the red rows on a single row of this
     catalogue, which is bright enough that 96% of it sits below the
     flag's bright bound. A flag-valid gate would have shipped the tier
     serving zero rows.
  2. GSPC therefore runs **outside** its standardisation, so it sits
     BELOW printed `I/239` B−V rather than above it, and carries a
     measured red bound of BP−RP 3.0. This is not the extrapolation the
     paragraph above rejects twice: GSPC integrates each star's own
     BP/RP spectrum through the passband, and § 6.2 calls a flag-0
     magnitude an extrapolation of the *standardisation* — the
     ground-tying correction — not of the integration. Out-of-flag
     values agree with the Table-5.9 relation as closely as in-flag ones
     (p50 0.023 vs 0.020) and with printed `I/239` B−V to p50 0.031–0.043
     up to BP−RP 3.0, breaking to 0.135 above it; § 3.2 independently
     reports the standardisation holding to <10 mmag on red giants out
     to BP−RP 3.5. The one caveat the paper adds rather than removes is
     on the **bright** side: past `G` ≈ 11.5 a BP/RP spectrometer
     configuration change costs XP's internal calibration its millimag
     accuracy, so this tier knowingly reads XP spectra outside their
     best-calibrated regime, bounded by the |Δ| measurement above.
- **rv** — SHIPPED (`stellata-3bsf.27`, 2026-08-15). The printed cell
  covered 7,126 rows (spine-wide `rv_src`: HYG 7,965 · OTHER 871 · G_R2 295
  non-first-order); the bibcoded SIMBAD tier covers **7,171**, dropping 689
  of the old set and adding 734 rows that never had a printed velocity.
  Residual `rvNone` **39,958**, pinned. The **skip rule fires on 307** rows,
  and the measurement justifying it is sharper than this section projected:
  over the 354 gate-withheld rows |Δrv| against the withheld Gaia value is
  p50 **0.0026 km/s** for a DR3 bibcode (the same value returning) against
  0.98 for DR2 and 3.01 for literature. The rule turns on the 2p blend, not
  on holding the competing value — 205 of the 307 are rows Gaia published an
  rv for, the other 102 rows it did not, and both are the same unseparated
  spectrum. A Gaia bibcode with no 2p solution behind it is an ordinary
  citation and is kept — 363 rows, 278 DR2 and 85 DR3, every DR3 one on a
  record carrying no `gaia_source_id` at all. Two corrections at implementation: `rvz_radvel`
  is a velocity only where `rvz_type` reads `v` (EGGR 252's `z` row reads
  243,879 km/s), and the tier ships one published-but-nonphysical value
  (EZ Aqr, 6,824.7 km/s). No quality or magnitude gate was added; the
  1500 km/s ceiling the velocity assembly already enforces now rejects a
  radial term breaching it **on its own**, so a bad rv costs a row its
  radial term rather than its tangential motion — pinned as
  `rvRadialRejected` 1, `velocityClamped` unmoved at 8.
  Full detail: `scripts/catalog/distance/radial-velocity/README.md`.
- **V** — `vCatalogued` 140: Tycho-2 reaches 123 by TYC; the GJ cohort
  (~16) routes CNS5/SIMBAD; Sol is curated.
- **direction / PM** — `directionAthygPrinted` 61 /
  `velocityAthygPm` 60. **Measured 2026-08-25**, once both ingests were in
  place, over the real 61-row cohort — this supersedes the projection this
  line carried (which read CNS5 8 and had no unreached bucket at all):

  | | Tycho-2 | CNS5 | SIMBAD | curated | none |
  |---|---|---|---|---|---|
  | direction | 43 | 4 | 9 | 1 (Sol) | **4** |
  | PM | 40 | 4 | 9 | — | 4 (zero tangential term) |

  The mean epochs also fix the printed cells' unpropagated staleness, ~27″
  worst case today. CNS5 measures 4 rather than the projected 8 because its
  25 pc volume limit does not carry GJ 3775 / 3981 / 4192 / 4212 — the same
  four the table counts as **none**: no TYC, no HIP, and a
  `gaia_source_id` DR3 has no row for because it is a DR2 id
  (`data/athyg/stale_gaia_source_ids.tsv`). **The none bucket is now
  reachable**: the values pull's widening ladder falls through to their own
  GJ and all four carry bibcoded coordinates and PM, so the SIMBAD tier
  takes them and `stellata-3bsf.26` re-measures the split rather than
  adjudicating four § 6 membership drops.
- **distance** — printed tail 1,199, today **unpinned** (the only
  cascade without a routing partition; the value work pins `distVia`):
  in-tree DR3 parallax 126 · CNS5 38 · SIMBAD parallax the ~1,035
  remainder (bibcodes typically Gaia DR2 — the printed cell's true
  upstream, now held first-hand). `applyBailerJonesOverride` currently
  gates on the spine's `dist_src` cell — an AT-HYG editorial value
  steering an owned cascade; eligibility re-keys on the record's own
  resolved-tier predicate.
- **spect** — the spine cell is already display-only
  (`resolveSpectralInfo` never classifies from it); it fills the
  hover/search string on the 1,394 `spectralFallback` rows (~672
  non-empty). The widened SIMBAD request set absorbs what it can;
  whatever remains displays as unknown.

Rules:

- **Residual policy — strict, first-hand only.** A tier is *owned* iff
  its value traces to a frozen in-tree file we pulled from a named
  catalogue, keyed on `gaia_source_id` / TYC / HIP / HD / GJ /
  designation. Spine printed cells never qualify — not even
  provenance-tagged transcriptions whose `*_src` names a citable
  upstream (considered and rejected: a value we cannot re-pull is a
  value we cannot verify). Rows no owned source reaches fall to derived
  tiers (spectral colour, zero rv, zero tangential term), **enumerated
  and pinned, never implied**. Cells with `*_src = OTHER` are
  unattributable and drop unconditionally. A row left with **no** owned
  distance or direction cannot ship silently: it becomes a membership
  event adjudicated through the § 6 parity ledger with an explicit
  dropped-list reason code. **Record survival is not a goal in
  itself** — the spine is not a relic whose every row must be rescued.
  The `spineDropped*` zero-pins are tripwires against *accidental*
  drops; a record whose provenance cannot justify its existence is
  dropped deliberately, on the ledger, with a reason.
- **SIMBAD's role — second-order by design.** SIMBAD aggregates
  first-order catalogues; it measures nothing, its "best value"
  selection is editorial, and it is a living database with no citable
  release. It is therefore never an authority: its tiers sit at the
  bottom of a cascade, for enumerated cohorts no first-order catalogue
  reaches, and every SIMBAD-sourced value ships with its `bibcode` —
  the bibcode is the source, SIMBAD the index that found it — frozen at
  retrieval like every pull. **Validation independence:** a row whose
  shipped value came from a SIMBAD tier is excluded from SIMBAD-based
  validation of that field (`validate:simbad`, the sample suites) — a
  value cannot verify itself, and including it would bias the accuracy
  metric toward artificial agreement.
- **rv Gaia-bibcode skip rule.** The 5p gate withholds Gaia rv for a
  physical reason (blended-RVS distrust), and SIMBAD frequently serves
  the same Gaia value under a Gaia DR bibcode. On rows where the
  record's own gate withheld Gaia rv, the SIMBAD tier skips values
  whose `rvz_bibcode` is a Gaia DR bibcode — falling to older
  literature or zero — so the pull cannot launder a withheld value back
  in. |Δrv| by bibcode class is measured at implementation.
- **Bright tier** = rows the direction cascade already routes to
  HIP2/printed, plus rows whose Gaia photometry is missing or outside
  the Riello validity range: printed `I/239` V applies. The validity
  bound is a build-time calibration pinned in build-counts with
  per-tier routing counts (same discipline as the direction cascade).
- **No-Gaia tier** = empty-`gaia_source_id` spine rows: every cascade
  bottoms out at **designation-keyed first-order tiers** (Tycho-2 by
  TYC, CNS5 by GJ, SIMBAD by HIP/GJ ident), no longer at the spine's
  printed columns.
- **Binding-gate note.** GSPC and the SIMBAD values pull consume the
  spine's already-gated `gaia_source_id`/HIP keys (same shape as Apsis
  and the astrometry catalog), so the § 4 gate does not re-run. Tycho-2
  and CNS5 value columns join on the record's own TYC/GJ designation —
  value joins, not identity joins, and never positional. The SIMBAD
  pulls' **widening ladder** is the one place a value join carries binding
  risk: a source_id SIMBAD's `ident` table lacks is retried on the
  record's own HIP, TYC then GJ, and a HIP or TYC names the catalogue
  entry, which for a close pair is the system rather than the component.
  Each widened binding is therefore adjudicated against SIMBAD's Gaia
  cross-IDs **across releases** — kept where SIMBAD holds the asking id
  under any release, vetoed where it holds a differing DR3 id, and the
  uncorroborated remainder counted per pull
  (`scripts/refresh/simbad/README.md` § The widening carries its own
  corroboration rule). Only DR3 can contradict: releases number the same
  star differently, which is why a DR2 id in the DR3 column reads as a
  release mismatch rather than a mis-binding. Fluxes come from the
  long-format `flux` table, never
  `allfluxes` — the wider view publishes no bibcode. **An unbibcoded
  value is dropped at write time**, whole quantity at a time, so the
  frozen file cannot hand a cascade a cell this policy forbids and
  admitting one is a re-pull rather than a filter change. Pull-wide it
  drops 2,045 B and 1,494 V fluxes as unattributable, which is what holds
  the `mag_src=GJ` cohort's V flux to 361 of 981
  (`data/simbad/README.md` § The values pull).
- Photometric transforms cite **Riello et al. 2021, A&A 649, A3**
  (Gaia EDR3 photometry; Table C.2 relations). The ci relation chain
  was left to implementation, against the parity distribution; the
  contract here is the fallback ladder and the acceptance mechanism (a
  measured |Δci| distribution), not the coefficients.
  **Settled:** `B−V = (G−V) − (G−B)`, both polynomials from DR3
  documentation Table 5.9 so `G` cancels and the difference is published
  rather than composed, gated at BP−RP ≤ 1.75 by that table's note (k).
  Coefficients, the measured |Δci| per colour bin, and what the
  conservative bound costs: `scripts/catalog/photometry/README.md`
  § The ci cascade. GSPC and `I/239` B−V are observed-convention like
  the relation (they de-redden at build time); the spectral and solar
  tiers stay intrinsic.
- **The designation constellation is keyed on the DESIGNATION, not on
  `gaia_source_id`.** A Bayer or Flamsteed name is fixed by nomenclature — it
  predates the 1930 Delporte boundaries and does not migrate when proper motion
  carries the star across one — so no positional or per-record editorial cell
  may supply it. IV/27A keyed on the record's own HD/HIP is the source: a
  designation → designation cross index asserts no binding to a Gaia source, so
  it needs no binding gate and, unlike the label overlay, reaches the bright
  tier Gaia saturation excludes (Fomalhaut). It covers 3,180 of the 3,303
  Bayer/Flamsteed-bearing records against the source_id route's 2,474, with
  zero disagreements. GCVS fills only what IV/27A leaves empty.
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
   (§ 4 precedence) — `data/classic-ids/label_flips.tsv` is that ledger, and it
   is the COMPLETE delta: the spine's designation multiset replayed through it
   must equal the built catalogue's, which is the gate that keeps "every SID is
   preserved by construction" checkable now that labels are no longer the
   spine's verbatim.
3. **Field parity.** |ΔV|, |Δabsmag|, |Δci| distributions pinned
   (p50/p99/max) once reviewed; spectral-string change count pinned.
4. The dropped and merged lists must agree row-for-row with any SID
   ledger writes (§ 7).

The frozen regression corpora (known-stars, sky-position,
multi-star-regression) stay green throughout — they pin the
famous-star surface a driver change is most likely to disturb.

The driver swap's instantiated ledger — all four axes, the disposed
review queues, and the identity-event enumeration (five Gliese
bridges, zero ledger writes) — is
`scripts/catalog/spine/README.md` § The swap parity ledger.

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

- The classic-side joins and slices (IV/25, IV/27A, V/50, CNS5, I/239,
  I/259) are DR-independent and never re-pull. The SIMBAD pulls are
  DR-independent too; they refresh on their own cadence.
- The DR-scoped hops swap tables: TYC→source_id and HIP→source_id move
  to the new release's best-neighbour analogues; per-source_id pulls
  (astrometry, Apsis, NSS, synthetic photometry, distance posteriors)
  re-run through `scripts/refresh/` (§ DR4 transition order); spine
  `gaia_dr3:` ids bridge through `docs/sid.md` § 6 reconciliation.
- The photometric transform (§ 5) gets the new release's successor
  calibration.
- A deeper magnitude pull re-runs § 6 in additive mode: existing
  records must not move (same SIDs, zero field deltas); new records
  only add.

**Dead patterns — do not rebuild:** a bright/fill two-tier hybrid
membership; positional joins at any stage; live SIMBAD in the build; a
keep-list file separate from the spine; membership re-derivation from
classic catalogues (they are label overlays).
