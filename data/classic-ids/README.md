# Classic-designation cross indexes

The frozen CDS tables that carry HD / HR / Bayer / Flamsteed / GJ
designations, plus the source_id-keyed overlay joined out of them. This
is the identifier half of the AT-HYG retirement — `docs/catalog-driver.md`
§ 2 decides the sources, § 4 the HD→Gaia route and the ambiguity /
precedence policy.

```
tyc2_hd.tsv                        ~7.4 MB, LFS. HD ↔ Tycho-2 (353,527 rows).
cross_index.tsv                    ~94 KB, LFS. Bayer / Flamsteed ↔ HD/HR/HIP
                                   (3,690 rows).
bsc5.tsv                           ~136 KB, LFS. HR ↔ HD (9,110 rows).
cns5.tsv                           ~182 KB, LFS. GJ ↔ Gaia EDR3 ↔ HIP
                                   (5,909 rows).
classic_id_overlay.tsv             ~11 MB, LFS. Pipeline-derived: every
                                   designation above keyed on Gaia DR3
                                   source_id (357,538 rows, post-gate).
hd_hip_route_disagreements.tsv     21 rows. Pipeline-derived review queue
                                   (§ HD-route cross-check below).
rejected_bindings.tsv              187 rows. Pipeline-derived review queue —
                                   the bindings the gate dropped
                                   (§ The binding gate).
```

## Provenance

Every table is a whole-table column slice pulled over CDS/VizieR TAP by
`scripts/refresh/refresh-classic-ids.py` (`pnpm run refresh:classic-ids`),
verified against VizieR 2026-07-28. Licence: public domain via CDS for
all four; cite the paper per table.

- **`tyc2_hd.tsv`** ← VizieR `IV/25/tyc2_hd`. Fabricius, Makarov, Knude &
  Wycoff 2002, *A&A* 386, 709 — the HD identifications for Tycho-2.
  Columns `tyc1`/`tyc2`/`tyc3` stay as three upstream integers; the
  `"1-381-1"` key the Gaia best-neighbour cross-walks use is composed at
  parse time, so the committed file remains a faithful slice. `n_hd` /
  `n_tyc` are the upstream ambiguity flags (394 rows with `n_hd` > 1,
  16 with `n_tyc` > 1).
- **`cross_index.tsv`** ← VizieR `IV/27A/catalog`. Kostjuk N.D. 2004 —
  the HD-DM-GC-HR-HIP-Bayer-Flamsteed cross index. As TAP serves it this
  is the Bayer/Flamsteed-bearing subset only (3,690 rows; HR 8832 is
  absent), which is all we ask of it — HR routes via `bsc5.tsv`, HD via
  `tyc2_hd.tsv`. 2,185 rows carry a Bayer letter, 2,757 a Flamsteed
  number. `bayer` is IV/27A's own lowercase three-letter form (`alf`,
  `kap`), **not** AT-HYG's (`Alp`) — and neither is canonical:
  `docs/star-naming.md` § 4 stores the Unicode glyph, sourced from the
  IAU WGSN naked-eye catalogue, and demotes this table to the V > 6.5
  tail; both ASCII conventions are normaliser inputs there. 111 of
  these cells are GCVS-style variable designations (`R And`, `RZ Cas`,
  `V380 Cyg`), not Bayer letters, and the ladder rejects them from the
  Bayer tier. `cst` is the
  constellation the Bayer / Flamsteed designation belongs to — never the
  IAU-positional constellation the catalogue assigns per record
  (`docs/catalog-driver.md` § 5).
- **`bsc5.tsv`** ← VizieR `V/50/catalog`. Hoffleit & Warren 1991, Bright
  Star Catalogue 5th revised ed. Supplies HR ↔ HD (9,096 of 9,110 rows
  carry an HD; the 14 HD-less entries resolve through the inherited spine
  or land in the parity ledger). `name` is the BSC's own designation
  string (`"3Alp Lyr"`), committed for the naming ladder and read by
  nothing today.
- **`cns5.tsv`** ← VizieR `J/A+A/670/A19/cns5`, the 2023-12-13 corrected
  version. Golovin, Reffert, Just, Jordan, Vani & Jahreiß 2023, *A&A*
  670, A19 — the fifth Catalogue of Nearby Stars. Carries
  GJ ↔ Gaia EDR3 source_id ↔ HIP directly plus component letters, which
  is why it beats hand-rolling Gliese from V/70A (CNS3, not ingested).
  5,237 of 5,909 rows carry an EDR3 source_id; 1,581 a HIP. **CNS5 is
  volume-limited to 25 pc** — see § Coverage.

## `classic_id_overlay.tsv` — the derived overlay

One row per Gaia DR3 source_id, written by
`scripts/catalog/classic-ids/build-classic-id-overlay.ts`
(`pnpm run build:classic-ids`). Columns:

```
gaia_source_id  hd  hr  hip  gj  bayer  flamsteed
```

- Cells are `|`-separated lists. Nothing is single-valued by
  construction: a designation naming a catalogue granularity rather than
  one object attaches to every matching record (7 HDs land on >1 source),
  and a record can carry several (137 sources carry >1 HD).
- `gj` is a bare CNS5 number with its component letter appended
  (`551C`). The `Gl` vs `GJ` prefix AT-HYG prints is a display choice and
  is deliberately not baked in here.
- `bayer` / `flamsteed` carry IV/27A's constellation (`alf Lyr`,
  `3 Lyr`).
- Rows are sorted by numeric source_id (ids exceed 2^53, so the sort is
  BigInt, matching the astrometry request files).

`hd_hip_route_disagreements.tsv` enumerates the 21 IV/27A rows whose
HD→TYC→source_id and HIP→source_id routes land on different sources
(every pair differs only in its low digits — resolved close pairs where
the two walks pick different components). The HD route is the authority;
these are a review queue for the parity ledger, not a mechanical
resolution.

## The binding gate

Both cross-walks the join routes through are **unvetted best-neighbour
tables**. Gaia's 5p fit fails on saturated stars, so a bright star's TYC or
HIP can land on a resolvable companion or a background source — and the
overlay would then assert that star's classic designations on a source that
is not the star. `applyBindingGate`
(`scripts/catalog/classic-ids/classic-id-overlay-pure.ts`) runs the SAME
`resolveGaiaSourceId` gates the record build applies in
`scripts/catalog/parse/stars-parse.ts`, so the two cannot drift on what
counts as a bad binding:

- **G − V ≥ 1.0 mag** (`GAIA_BINDING_G_MINUS_V_REJECT_MAG`) — 102 rows. The
  canonical case is the G = 20.95 background source beside α Cen B, which
  carried HD 128621 · HR 5460 · HIP 71681 · `alf Cen`.
- **Sibling-letter attribution** (SIMBAD WDS cross-IDs) — 85 rows. Catches
  the similar-brightness sibling that slips the magnitude gate: HD 70492 B's
  source carried HD 70492 · HIP 41098.

A firing gate drops the **whole row**, not just its `hip` cell: if the source
is not the star then every designation keyed on it is misattributed, and the
labels ride the inherited spine exactly as they do for a record the build
scrubs. The dropped bindings are enumerated in `rejected_bindings.tsv`
(`gaia_source_id`, `hip`, `v_mag`, `g_mag`, `reason`, `designations`; a blank
`designations` means the HIP was the row's only label, and a blank `g_mag`
means the sibling gate fired without needing one).

The HD/HIP route cross-check above cannot substitute for this. Both walks
routinely land on the *same* wrong source, so α Cen B counted among the 2,637
route agreements, not the 21 disagreements.

**The gate's reach is bounded by where a printed V exists.** The V comes from
`data/hipparcos/hip_main_vmag.tsv` keyed on a HIP the overlay row itself
carries — deliberately not from AT-HYG, which the overlay has to outlive. A
row with no HIP, or whose HIPs carry no printed V, cannot be vetted:
`gateSkippedNoHipVMag` pins that population at 257,926 rows, overwhelmingly
Tycho-only HD rows. 126 known mis-bindings sit inside it, reachable by no
committed table — only 9 have an HD in V/50, so a `Vmag` column on the BSC5
slice would not close the gap; the rest are faint-on-faint mismatches where
no magnitude signal separates the two sources. Resolving those is the spine's
own identity work (`stellata-3bsf.4`), not a photometric gate's.

## Coverage — the overlay is a union term, not the label authority

Measured 2026-07-28 against the 317,175 AT-HYG rows, counting only rows
that resolve to a source_id the record build accepts AND carry the
identifier (counts pinned in
`scripts/catalog/classic-ids/classic-id-overlay-expected.json`). Both sides
run the gated resolution — a row whose only candidate binding the gates
scrub ships `gaia_source_id = 0`, so scoring it against an ungated binding
would credit a label no record carries:

| Identifier | AT-HYG rows keyed | Overlay reproduces | |
|---|---|---|---|
| hd | 294,969 | 283,279 | 96.0% |
| hip | 116,581 | 99,273 | 85.2% |
| hr | 8,675 | 7,287 | 84.0% |
| gl | 2,931 | 1,805 | 61.6% |
| bayer | 1,357 | 1,092 | 80.5% |
| flam | 2,551 | 2,030 | 79.6% |

**16,032 AT-HYG rows get no overlay entry at all** — 2,387 reach no
accepted source_id, and the rest resolve to one that neither
best-neighbour walk carries. That population is concentrated at the bright
end exactly as `docs/catalog-driver.md` § 5's bright tier predicts: **115 of
the 178 rows at V ≤ 3 have no overlay row**, Vega, Sirius, Procyon and
Betelgeuse among them. Gaia saturates near G ≈ 3, so the most famous
stars in the catalogue are absent from a source_id-keyed table by
construction, not by a join defect.

Three structural bounds behind the shortfalls:

1. **16,632 of IV/25's 353,330 Tycho ids are absent from
   `gaiadr3.tycho2tdsc_merge_best_neighbour`.** Any HD whose only route
   is one of those TYCs cannot be keyed. AT-HYG assigned a source_id to
   many of them through merge history we cannot replay — the same
   ~12.6k-row finding the design gate measured on the membership side,
   now visible on the label side.
2. **The HIP cross-walk holds 99,525 entries against AT-HYG's 117,961
   HIP-bearing rows.** HIP is a designation, so a HIP the walk omits is a
   label the overlay cannot attach.
3. **CNS5's 25 pc volume limit** caps the Gliese label: **91% of the 1,126
   `gl` misses sit beyond 25 pc (median 31 pc, p90 89 pc)** while 99% of
   the hits sit inside it. AT-HYG's `gl` column carries GJ numbers from
   the wider Gliese-Jahreiß and NLTT supplements that CNS5 does not
   enumerate.

   These four figures are derived, not pinned — recompute them from
   `classic_id_overlay.tsv` + AT-HYG's `dist` column rather than trusting
   the prose, and correct it here if it has drifted. The pinned
   `glKeyed` / `glCovered` pair is the only gated number.

None of this loses a record or a label: `docs/catalog-driver.md` § 1
defines labels as *overlay + spine backstop*, and the inherited spine
preserves every record's designation set. The measurement's real content
is that the backstop is **load-bearing for 4–39% of each identifier**,
not a rare fallback — so the spine must ship before the overlay can
replace AT-HYG's label columns (`stellata-3bsf.4`), and the parity gate
(`stellata-cns.7`) checks the union, never the overlay alone.

## Consumed by

`scripts/catalog/classic-ids/build-classic-id-overlay.ts` reads the four
frozen tables plus `data/gaia/gaia_dr3_{tyc,hip}_xmatch.tsv`, the gate's
evidence (`data/gaia/gaia_dr3_astrometry_catalog.tsv` for G,
`data/hipparcos/hip_main_vmag.tsv` for printed V,
`data/simbad/simbad_wds_xids.tsv` for component attribution), and
`data/athyg/athyg_33_classic_ids.csv` (the last only to measure label
parity). The three evidence files are **required, not optional** — without
them the join would key labels on sources the record build refuses, so a
missing one hard-fails rather than degrading. No runtime or `catalog.bin`
consumer yet — wiring the overlay into the record build is
`stellata-3bsf.4`.

## Refresh

`pnpm run refresh:classic-ids` re-pulls all four tables;
`--only <stem>` limits it to one, `--force` overrides the mtime skip.
Then `pnpm run build:classic-ids` regenerates the overlay — CI asserts
the committed overlay is byte-identical to what the committed code
produces, so the two always land in the same commit. The classic-side
joins are Gaia-DR-independent and never re-pull for a data release
(`docs/catalog-driver.md` § 8); only the TYC/HIP → source_id hops move.
