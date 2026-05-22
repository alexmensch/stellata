# Catalogue cross-match

Developer walk-through of how stars in `data/athyg/`, `data/wds/`,
`data/orb6/`, `data/gaia/`, `data/hipparcos/`, `data/simbad/`,
`data/bailer-jones/`, and `data/gcvs/` resolve to records in
`public/catalog.bin` and rows in `data/binaries/multiples.tsv`. The
science of *why* the choices below are made (Gaia DR3 parallax bias,
Bailer-Jones priors, LMC kinematic identification, Apsis pipelines) is
in `SCIENCE.md`; this file is the engineering side — the layered
strategies, their numeric thresholds, and the provenance fields each
strategy stamps onto its output.

## When to read this

- You're refreshing external catalogues — Gaia DR4 landed, AT-HYG cut a
  new release, B-J republished posteriors, SIMBAD updated sp_type
  bibcodes. See § Refreshing data below.
- You're adding a star to the Tier-A validation corpus
  (`scripts/catalog/known-stars.tsv`).
- You're debugging why a specific star doesn't render at its expected
  position, distance, or spectral colour. See § Debug recipes.
- You're extending the multi-star pipeline — adding a new astrometry
  route, a new optical-pair filter tier, or a new SIMBAD-anchored
  cross-ID side-file.

## Files in this area

The binary-system pipeline. `scripts/binaries/` is the orchestration
shell + per-stage modules; `data/wds/` + `data/binaries/` carry the
inputs and pipeline output. The single-star catalog build under
`scripts/catalog/` and its data inputs (Gaia / B-J / SIMBAD sample /
AT-HYG / GCVS / Hipparcos / Stellarium) live in
`docs/build-and-data.md`.

```
scripts/binaries/
  build-binaries.py               WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2
                                  + Gaia (HIP/Tyc xwalks, NSS, 5p
                                  astrometry) + SIMBAD WDS xids + SIMBAD
                                  per-component sp_type →
                                  data/binaries/multiples.tsv.
                                  Orchestration shell; per-stage logic in
                                  stage{2..7}_*.py.
  parsers.py                      Row dataclasses + parse functions for
                                  every reference catalogue (Stage 1).
  indices.py                      IdentifierIndices builder (HIP/Tyc →
                                  Gaia, src_id → astrometry / NSS / AT-HYG,
                                  HIP → HIP2 / CCDM, CCDM → HIP-list,
                                  etc.). Built once at Stage 1; every
                                  Stage 2-7 lookup is O(1).
  stage2_resolve.py               WDS-component → Gaia DR3 source_id
                                  cascade (orb6_hip → athyg_gaia_native →
                                  simbad_xid → ccdm_hip → AT-HYG
                                  position-match), with same-letter +
                                  Aa→A propagation.
  stage3_astrometry.py            Per-component astrometry routing
                                  (gaia_5p / gaia_nss_systemic /
                                  hip2_long_baseline / unresolved).
                                  HIP2 is the Gaia-saturated
                                  bright-primary fallback.
  stage4_orbits.py                Per-pair orbital-element selection
                                  (gaia_nss / orb6 / orb6_spectroscopic /
                                  none). Inline Heintz 1978 /
                                  Halbwachs+ 2023 Thiele-Innes → Campbell
                                  algebra.
  stage5_optical.py               Five-tier physical-vs-optical
                                  classification (WDS-notes → both-Gaia →
                                  asymmetric-Gaia → orbit-on-file →
                                  mag-gap).
  stage6_multiples.py             Emit data/binaries/multiples.tsv with
                                  per-component provenance columns +
                                  system-anchor inheritance for tight
                                  inner binaries + SIMBAD standalone
                                  augmentation.
  stage7_counts.py                Build-counts + build-rates snapshot
                                  writer (mirrors
                                  scripts/catalog/build-counts.ts).
  mass_estimate.py                Spectral-class-aware mass-ratio q
                                  backfill from Cox 2000 §15.2 /
                                  Pecaut & Mamajek 2013 tables.
  build-binaries.test.py          stdlib unittest pins for Stages 1-7.
  build-binaries-expected.json    per-strategy / per-tier count snapshot
                                  (UPDATE_BUILD_COUNTS=1).
  build-binaries-rates-expected.json
                                  per-strategy rate snapshot — catches
                                  population-mix shifts that don't move
                                  absolute counts.

data/wds/
  wds_summ.txt                    Washington Double Star summary
                                  (~20 MB, LFS).
  wds_notes.txt                   Per-pair WDS notes prose (LFS).
  wds_refs.txt                    WDS reference list (LFS).
  orb6_orbits.txt                 ORB6 sixth catalog of visual binary
                                  orbits (LFS).

data/binaries/
  multiples.tsv                   build-binaries.py output — two rows
                                  per kept WDS pair, plus standalone rows
                                  for SIMBAD-known components the pair
                                  walk didn't reach. Consumed today by
                                  the Tier A validation harness +
                                  ad-hoc debugging; the future per-frame
                                  binary-orbit runtime layer will read
                                  it directly (not merged into
                                  catalog.bin). (LFS)
```

## Pipeline at a glance

Two build steps, run in order, with `data/binaries/multiples.tsv` as the
hand-off:

1. **Binary-system pipeline** (`scripts/binaries/build-binaries.py`).
   Reads WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2 + Gaia (xmatches, NSS,
   5p astrometry) + SIMBAD WDS cross-IDs + SIMBAD per-component
   spectra. Emits `data/binaries/multiples.tsv` — two rows per kept
   physical pair, plus standalone rows for SIMBAD-known WDS components
   the pair walk didn't reach. Run via `npm run build:binaries`. Seven
   stages, one module per stage under `scripts/binaries/`.
2. **Single-star catalogue build** (`scripts/catalog/build-catalog.ts`).
   Reads AT-HYG + the SIMBAD sp_type / Gaia Apsis / Bailer-Jones /
   Gaia HIP-xmatch side-files + Stellarium constellations + GCVS +
   Hipparcos CCDM. Emits `public/catalog.bin` (v6, 80-byte records),
   `public/constellations.json`, `public/search-index.json`. Run via
   `npm run build:catalog`. Per-stage logic lives in sibling modules
   (`stars-parse.ts`, `catalog-pure.ts`, `gcvs-parse.ts`,
   `visual-doubles.ts`, `gaia-xmatch.ts`, `constellations.ts`).

The two outputs feed different runtime paths and are not merged. The
per-star renderer keys off `public/catalog.bin`; `data/binaries/multiples.tsv`
is consumed today by the Tier A validation harness
(`known-stars.test.ts`) and ad-hoc debugging, and will additionally
drive the future per-frame binary-orbit renderer layer when that
lands — a parallel runtime layer alongside the per-star,
planet-body, local-group, and other layers, not a merge into
`catalog.bin`. `build-catalog.ts` does not ingest `multiples.tsv`;
the per-component WDS detail rides into the runtime via the
binary-orbit layer's own loader. Both phases write their build-time
statistics into snapshot JSONs
(`build-binaries-{expected,rates-expected}.json`,
`build-catalog-expected.json`, `build-distance-outliers-expected.json`)
that gate the next build.

## Stage 2 — WDS component → Gaia DR3 source_id

Every WDS pair row decomposes into a primary and a secondary letter
(`AB` → `A`+`B`, `Aa,Ab` → `Aa`+`Ab`); each letter resolves through a
strict-priority cascade in `scripts/binaries/stage2_resolve.py`. The
canonical tag set is `RESOLVE_VIA_VALUES`:

| Tag | When it fires |
| --- | --- |
| `orb6_hip` | The pair has an ORB6 entry with a published HIP for the primary, and Gaia DR3's `hipparcos2_best_neighbour` cross-walk covers that HIP. Strongest tier — ORB6's HIP attribution is human-curated. |
| `athyg_gaia_native` | HIP-mediated: ORB6's HIP, an AT-HYG row's HIP, or a CCDM sibling's HIP routes through AT-HYG's own `gaia` column when Gaia's published HIP→DR3 cross-walk misses (AT-HYG's source_id coverage is broader). Also reused for the position-match pass below, which lands on the same AT-HYG-native field by a different path. |
| `simbad_xid` | The component is in `data/simbad/simbad_wds_xids.tsv` — SIMBAD's curated `(WDS-J id, component letter) → (Gaia DR3 source_id, HIP)` map. Reaches sub-arcsec components that ORB6 doesn't enumerate (η Cas A/B/C, ξ UMa A/B, ζ Cnc A/B/C, α Cen A/B/Proxima). |
| `ccdm_hip` | The pair's WDS id matches a Hipparcos CCDM identifier; one of the CCDM-sibling HIPs sits within 10″ of the WDS precise coord (PM-propagated from J1991.25). Routes that HIP through Gaia's HIP cross-walk and AT-HYG-native fall-through. |
| `position_pm` / `position_nopm` | Reserved placeholders in `RESOLVE_VIA_VALUES` for a future PM-propagated match against `data/gaia/gaia_dr3_astrometry.tsv`. Not yet wired. |
| `unresolved` | All strategies missed. The component still binds a HIP whenever any tier surfaced one — Stage 3's HIP2 long-baseline fallback can attach astrometry to a Gaia-source-less Sirius A or α Cen B from the bare HIP. |

The position-match pass deserves its own note. AT-HYG's stored
ra/dec is documented as J2000 but HIP-sourced rows are empirically at
J1991.25. The position-match helper PM-propagates each AT-HYG row's
coord to `WDS_PRECISE_COORD_EPOCH` (J2000) using the row's own
`pm_ra` / `pm_dec` before measuring against the 2″ tolerance, so high-PM
stars (α Cen at ~3614 mas/yr) still match. Secondaries are predicted
from primary + WDS (ρ, θ), with a short-circuit when ρ exceeds the WDS
overflow sentinel (`999.9″`).

After the cascade, `propagate_within_system` (same file) smears each
letter binding across every WDS pair row in the same system that
references the same letter — η Cas A is the same physical star whether
it appears in the AB, AC, AD, …, AH rows. The bare letter `A` also
inherits from a resolved sub-letter `Aa` because Gaia rarely separates
the spectroscopic sub-components; the brighter `Aa` carries the system
flux and is the single Gaia source the renderer ever sees.

**Worked examples** (per-letter resolve_via):

- **Sirius A** → no Gaia source (saturated), HIP 32349 bound via
  `simbad_xid` / `ccdm_hip`; `resolve_via=unresolved`. Stage 3's HIP2
  long-baseline fallback engages.
- **Sirius B** → `simbad_xid` (the SIMBAD WDS xids side-file). Without
  this tier B would resolve via position-match onto A's source.
- **α Cen A** → no Gaia source; SIMBAD has the HIP, no DR3 source_id;
  `resolve_via=unresolved` + HIP bound. HIP2 long-baseline path.
- **α Cen B** → same shape as α Cen A.
- **Proxima** → `athyg_gaia_native` via the AT-HYG row's `gaia` cell
  (HIP-mediated lookup through HIP 70890).
- **Castor STF1110 A** → inherits from CIA 29 Aa via the sub-letter
  hierarchy pass; tagged with Aa's `resolve_via` value.
- **40 Eri B/C** (a tight inner binary inside the BC pair) → both
  components resolve to Gaia source_ids but their per-component 5p
  astrometry is blended; Stage 6's system-anchor inheritance
  backstops them (see below).

## Stage 3 — Per-component astrometry routing

Once a component has a Gaia source_id (or a bare HIP), Stage 3
(`scripts/binaries/stage3_astrometry.py`) picks the most trustworthy
astrometric measurement for it. Routes in `ASTROMETRY_VIA_VALUES`:

| Route | Gate |
| --- | --- |
| `gaia_nss_systemic` | The source_id has an `nss_two_body_orbit` row AND its Gaia 5p solution is flagged unreliable (`ruwe > 1.4` OR `ipd_frac_multi_peak > 0.02`). Gaia DR3's `gaia_source` table refits these stars to the centre of mass, so the same row's values surface with the NSS provenance tag, telling Stage 4 to prefer NSS orbital elements over ORB6. |
| `hip2_long_baseline` (orbit-corrupted PM) | The system has any pair with min ρ ≤ 5″ AND `|pmRA_gaia − pmRA_hip2| > 50 mas/yr` OR same on Dec. Hipparcos averages a different window of the orbit than Gaia's 2014–2017 mission baseline; for bright close binaries with both available, HIP2 is closer to the systemic motion. |
| `gaia_5p` | Default. The 5p row is clean and no orbit-correction signal fires. |
| `hip2_long_baseline` (Gaia-saturated) | The component never resolved to a Gaia source_id but a HIP is known and HIP2 covers it — Sirius A, α Cen, Algol, Procyon. HIP2 is the only astrometry available. |
| `unresolved` | Neither Gaia astrometry nor HIP2 reach the component. |

The HIP2-discrepancy 5″ gate runs against the **minimum** WDS ρ across
every pair row a source_id participates in. A primary that's in both a
tight AB pair and a wide AC pair always takes the tight ρ, so the same
physical star routes through HIP2 consistently across every pair row of
its system, never differently per row.

Stage 3 reports per-route counts in build log order. `astrometry_via` is
also written to every `multiples.tsv` row in Stage 6 (with a Stage-6-owned
extra value, `system_inherited`, for components that inherit a
system-anchor position because their own row resolved to `unresolved`).

## Stage 4 — Orbital element selection per pair

Picks the most-trustworthy set of orbital elements per pair, then
converts to a canonical (P, T, e, a, i, ω, Ω, q, distance) tuple. Routes
in `ORBIT_VIA_VALUES`:

| Route | When |
| --- | --- |
| `gaia_nss` | Any component has an `nss_two_body_orbit` row AND the orbit is in Gaia's astrometric-detectability regime: `period < 3 yr` (`NSS_PERIOD_THRESHOLD_DAYS = 1095.75`) OR apparent semi-major axis `a < 1″` (`NSS_SEPARATION_THRESHOLD_MAS = 1000`). 95.8% of DR3 NSS rows pass the period gate; the few longer-period rows are picked up by the sub-arcsec branch. |
| `orb6` | ORB6 visual orbit with grade ∈ {1, 2, 3, 4, 5} (definitive → indeterminate). Best grade wins; ref-year secondary tiebreak. |
| `orb6_spectroscopic` | ORB6 grade ∈ {8, 9} — astrometric / interferometric without visual coverage (8) or spectroscopic (9). |
| `none` | Visual-only pair with no orbital information on file. |

The Thiele-Innes → Campbell algebra for NSS TI-derived solution types
(`Orbital`, `OrbitalAlternative*`, `OrbitalTargetedSearch*`,
`AstroSpectroSB1`) is inlined in `_thiele_innes_to_campbell` (Heintz
1978 / Halbwachs+ 2023 Appendix C). The ESA NSSTools package isn't a
dependency — the closed form is ~10 lines and NSSTools has been
unmaintained since 2022. Eclipsing solution types
(`EclipsingBinary`, `EclipsingSpectro`) read inclination and
arg_periastron directly from the catalogue columns; `a` and Ω are not
recoverable from eclipse photometry alone and remain `None`.
Spectroscopic solution types (`SB1`, `SB2`, `SB1C`, `SB2C`) populate
arg_periastron only when stored.

ORB6's `P_unit` column carries the period unit (`y` = year, `d` = day,
`c` = century, `h` = hour, `m` = minute). The `a_unit` column carries
arcseconds (`a`) or milliarcseconds (`m`, with `M` accepted as a known
typo). Unknown unit codes are skipped — Stage 4 prefers `None` over a
guessed conversion that would silently land on the wrong scale.

The mass-ratio `q` rides through this stage when present. Gaia NSS
`EclipsingSpectro` and SB2/SB2 / non-compact variants store
spectroscopic `mass_ratio` directly; everything else gets `q = None`
here and falls through to Stage 6's spectral-class mass-ratio backfill
below.

## Stage 5 — Optical-pair filter cascade

`scripts/binaries/stage5_optical.py` classifies each pair as physical or
optical and tags the decision with the tier that decided
(`OPTICAL_VIA_VALUES`):

| Tier | Tag | Rule |
| --- | --- | --- |
| 1 | `wds_notes_kept` / `_rejected` | WDS Notes flag chars: `{T, V, Z}` keep, `{S, U, X, Y}` reject. Other chars silent — tier falls through. |
| 2 | `gaia_kept` / `_rejected` | Both components carry a Gaia 5p row. Parallaxes must agree within 3σ on combined error (`BOTH_GAIA_PLX_GATE_SIGMA = 3.0`) AND per-axis PMs must each be within 5 mas/yr (`BOTH_GAIA_PM_GATE_DELTA_MASYR = 5.0`). |
| 3 | `asymm_kept` / `_rejected` | Exactly one component has a Gaia 5p row; the other has a HIP2 parallax anchor (Gaia-saturated bright primary). Gaia parallax vs HIP2 anchor at 3σ combined error. Catches Sirius A-C/D/E/F directly: anchor 378 mas vs Gaia <1 mas → enormous excess, reject. |
| 4 | `orbit_kept` | Stage 4 selected real orbital elements (gaia_nss, orb6, or orb6_spectroscopic). An empirical orbit fit is direct evidence of physical association and overrides the mag-gap heuristic — needed for cases like Sirius A-B where the white-dwarf companion creates a 9.9-mag gap. |
| 5 | `mag_heuristic_kept` / `_rejected` | Backstop. `|Δmag| ≤ 5` keep, otherwise reject. Used only when no other tier fired (typically Tycho-only systems where neither component has Gaia astrometry). Pairs with no usable mags either are kept on the absence-of-evidence-is-not-evidence-of-optical principle. |

The cascade short-circuits — once a tier produces a verdict the lower
tiers don't run. Stage 6 drops pairs classified as optical entirely; the
multiples.tsv emit never sees them. (The exception is the standalone
augmentation pass, which can still emit a SIMBAD-known component whose
parent pair was dropped — see Stage 6.)

## Stage 6 — multiples.tsv emit

`scripts/binaries/stage6_multiples.py` projects every Stage 2–5 output
into per-component rows. Canonical column order is
`MULTIPLES_TSV_COLUMNS`:

```
system_id, comp, hip, gaia_source_id,
x_pc, y_pc, z_pc, absmag, ci, spect, name,
source, regime,
resolve_via, astrometry_via, orbit_via, spect_via,
orbit_role,
P_days, T_jd, e, a_AU, i_rad, omega_rad, Omega_rad, q, dist_pc
```

Three system-level mechanisms run at emit time:

- **System-anchor inheritance.** Tight inner binaries (40 Eri B/C inside
  the BC pair, Castor C/D, σ Ori's trapezium components) blend in Gaia
  DR3 and never get per-component 5p fits. `compute_system_anchors`
  picks one (x, y, z, dist) tuple per `wds_id` from the first component
  with real astrometry (primary preferred); any component whose own row
  is `unresolved` inherits that anchor and gets `astrometry_via =
  system_inherited`. At parsec scales the offset between inner-binary
  components and the system primary is sub-AU — below any measurable
  effect.
- **Standalone augmentation.** After the pair walk, any
  `(wds_id, component)` SIMBAD has a cross-ID for that isn't already
  emitted gets a standalone row with `orbit_role = standalone` and
  `system_id` prefixed `-_<comp>`. Captures SIMBAD-known components
  WDS doesn't enumerate as a side of any decomposing pair.
- **Mass-ratio q backfill.** When Stage 4 produced orbital elements but
  no `q` (visual ORB6 with no spectroscopic counterpart),
  `mass_ratio_from_components` in `scripts/binaries/mass_estimate.py`
  parses both components' spectral strings (SIMBAD per-component
  preferred, AT-HYG inherited fallback) into class / subclass / lum
  class and reads a `q = M_secondary / (M_primary + M_secondary)` off
  per-class mass tables for MS / III / IV / I (Cox 2000 §15.2, Pecaut &
  Mamajek 2013). White dwarfs default to 0.6 M☉; carbon / S / WR
  default to 3.0 M☉; unparseable rows return `None` and `q` stays
  blank.

The `spect` column carries SIMBAD's per-component sp_type when
available, falling back to AT-HYG's per-system string. SIMBAD wins
because AT-HYG inherits the same system-level spectral string across
all components (incorrect for mixed-class pairs like Sirius A0V + DA1.9
where AT-HYG carries one type for both). Provenance lands in
`spect_via`: `simbad`, `athyg`, or `none`.

## Stage 7 — Build-counts and rates snapshots

`scripts/binaries/stage7_counts.py` writes two snapshot JSONs the build
asserts against on every run:

- **`build-binaries-expected.json`** pins absolute per-stage counts
  (resolution-tier counts, astrometry-route counts, orbit-source
  counts, optical-classification counts, per-`spect_via` counts).
- **`build-binaries-rates-expected.json`** pins per-strategy rates as
  fractions (resolve rate, NSS-vs-ORB6 ratio, optical rejection rate,
  HIP2 fallback share, …). Catches a regression that shifts the
  population mix without shifting absolute count totals.

Refresh both via `UPDATE_BUILD_COUNTS=1 npm run build:binaries`.

## Phase 3 — Single-star catalogue build

`scripts/catalog/build-catalog.ts` orchestrates; the per-row pipeline is
in `scripts/catalog/stars-parse.ts` (`readStars`). Each AT-HYG row
walks through:

1. **Gaia source_id resolution** (`resolveGaiaSourceId` in
   `catalog-pure.ts`). AT-HYG's native `gaia` column wins where
   present; otherwise the HIP cross-walk
   (`data/gaia/gaia_dr3_hip_xmatch.tsv`) supplies it. The HIP
   cross-walk fall-through resolves the ~191 HIP-bearing AT-HYG rows
   whose `gaia` column is blank.
2. **Bailer-Jones (DR3) distance override** (`applyBailerJonesOverride`
   in `catalog-pure.ts`). Eligible rows — those with a Gaia source_id
   AND `dist_src ∈ {G_R3, G_R2}` — swap `dist`, `x0/y0/z0`, and
   `absmag` for the B-J posterior (`r_med_photogeo` preferred,
   `r_med_geo` fallback). Other `dist_src` values (`HIP`, `GJ`, `N`,
   `OTHER`) keep their AT-HYG values — these are non-Gaia parallaxes
   that B-J would silently regress onto its 10–40 kpc Galactic prior
   tail.
3. **LMC kinematic override** (`applyLmcKinematicOverride`). Rows
   inside the 15° LMC cone (centre RA 5.25067 h / Dec −69.19°,
   Pietrzyński 2019) whose proper motion is within ±0.5 mas/yr of the
   LMC bulk centre-of-mass PM (μ_α* ≈ 1.85, μ_δ ≈ 0.20; van der Marel
   & Kallivayalil 2014) get distance snapped to 49,594 pc. Runs
   **after** B-J so it overrides B-J's mis-anchored value on the same
   rows — B-J's smooth Galactic prior has no LMC.
4. **`MAX_DIST_PC = 50_000` bounded-scope cutoff**
   (`stars-parse.ts:34`). Drops rows still beyond LMC depth after both
   overrides. The cutoff is a function of which populations are
   currently modelled, not a primary include/exclude filter — see
   SCIENCE.md § Stellar catalog ingestion.
5. **Spectral classification** (`resolveSpectralInfo` in
   `catalog-pure.ts`). Three tiers keyed by Gaia source_id:
   - SIMBAD `sp_type` from `data/simbad/simbad_sptype.tsv`
     (`classifyFromSimbad` — strict MK parser handling MK, WD, sd, kAm
     composite, Yerkes lowercase `dM`/`gK`, carbon / S / WR).
   - Gaia DR3 GSP-Spec `spectraltype_esphs` from
     `data/gaia/gaia_dr3_apsis.tsv` (`classifyFromGspspec` — letter-only
     enum; no subclass or luminosity class).
   - `SPECTRAL_UNKNOWN` (classIdx=8 / lumClass=255 / neutral 5000 K).
6. **Physical radius** (`physicalRadius`). Stefan-Boltzmann from absmag
   and the resolved (Teff, BC). White dwarfs special-cased to 0.013 R☉.
   Clamped to [0.08, 2500] R☉.

After the per-row pass, the build step does GCVS cross-match
(`bridgeGcvsByGaia` — Gaia source_id first, then HIP, then HD), CCDM
visual-doubles flagging (`visual-doubles.ts` — CCDM groups + a tiny
curated `KNOWN_VISUAL_DOUBLES` set for Polaris / ε¹ Lyr / 61 Cyg that
the MultFlag gate drops), and writes the 80-byte v6 record per star
including the seven `float32` Apsis fields (gspphot + gspspec — see
`docs/build-and-data.md` § Binary catalog format for the byte plan).

## Multi-layer distance refinement

The distance any rendered star carries is the output of an in-order
stack. From `data/athyg/athyg_33_classic_ids.csv` to
`public/catalog.bin`:

```
AT-HYG `dist` column (whatever dist_src carries)
   │
   ▼
[ Layer 1: Bailer-Jones DR3 override ]   only when dist_src ∈ {G_R3, G_R2}
   │                                       AND gaia_source_id present
   │                                       AND bjMap has the source_id
   ▼
[ Layer 2: LMC kinematic override    ]   only when in 15° LMC cone
   │                                       AND |Δμ_α*|, |Δμ_δ| ≤ 0.5 mas/yr
   ▼
[ Layer 3: MAX_DIST_PC = 50_000 gate ]   drops anything beyond LMC depth
   │
   ▼
public/catalog.bin record
```

The **ordering matters and is non-commutative.** B-J runs first because
the LMC stars carry Gaia source_ids that B-J's map covers; if LMC
override ran first, B-J would clobber the kinematic snap back onto its
mis-anchored prior tail. The MAX_DIST_PC gate runs last so it's a
bounded-scope statement about what the model currently represents —
Sol out to and including the LMC — not a primary include/exclude
filter. Future Magellanic-system or M31 layers extend the cone+PM
pattern of Layer 2 and bump the cutoff in sync.

`scripts/catalog/distance-regression-check.ts` then sweeps the
finished catalogue and writes
`scripts/catalog/build-distance-outliers-expected.json` — two snapshot
sections:

- **Self-consistency outliers.** Catches a row whose final distance has
  drifted from its AT-HYG input beyond the per-`dist_src` threshold
  (3× for HIP / GJ / N; 30× for G_R3 / G_R2 since B-J legitimately
  re-anchors low-S/N Gaia parallaxes). Flags an override misfire on
  HIP-anchored rows; the wide tolerance on G_R3/G_R2 catches only
  catastrophic Bailer-Jones moves.
- **SIMBAD-anchored outliers.** Catches a row whose final distance
  disagrees with SIMBAD's parallax-derived distance by more than 5×
  (`SIMBAD_DISTANCE_THRESHOLD`) on the random 10k stratified sample
  in `data/simbad/simbad_sample.tsv`.

Both snapshots carry hand-edited `reason` strings ("LMC kinematic snap
legitimate", "ρ Cas yellow hypergiant — SIMBAD's 1/π is the noisy
Hipparcos value") that survive `UPDATE_DISTANCE_OUTLIERS=1` refreshes via
`mergeReasonsFromSnapshot`. Add a new outlier → fill the reason; remove
or change → the build fails until the snapshot updates.

## Gaia DR3 Apsis astrophysical parameters

Apsis (Gaia DR3's astrophysical-parameters pipeline) publishes two
independent solutions per source — `gspphot` (photometric fit to BP/RP
+ parallax) and `gspspec` (spectroscopic fit to RVS spectra). Each
solution emits (Teff, log g, [M/H]); gspphot additionally emits
`azero_gspphot` (line-of-sight extinction at 547.7 nm); gspspec
additionally emits `spectraltype_esphs` (a letter enum: O/B/A/F/G/K/M/
CSTAR/unknown).

`scripts/refresh/refresh-gaia-apsis.py` pulls all seven floats plus the
sp_type enum per source_id into `data/gaia/gaia_dr3_apsis.tsv`. The
build writes all seven `float32` Apsis cells per v6 record at offsets
52–79; `NaN` (`NO_APSIS`) when absent. Apsis coverage on the
catalogue is ~99.6% matched; ~85% have a non-null Teff in at least one
of gspphot or gspspec (the population the renderer's colour LUT can
re-key off Apsis-direct Teff rather than the Ballesteros B-V relation).

The downstream consumers — all already wired — pull Apsis fields from
`catalog-loader.ts`'s per-array views:

- **Star colour LUT** (`src/client/shaders/star-color-routing-pure.ts`).
  Six-tier `pickTeffSource`: `teff_gspphot` → `teff_gspspec` →
  Ballesteros(B-V) → spectral-class T_TABLE → WD Sion Teff → solar
  fallback. Apsis is the **intrinsic** Teff (gspphot fits include A0
  explicitly), so dust reddening composes downstream without
  double-counting extinction.
- **Spectral classification fall-through** (`resolveSpectralInfo` in
  `catalog-pure.ts`). When SIMBAD has no sp_type for the Gaia source_id,
  Apsis's `spectraltype_esphs` enum is the second tier. The letter is
  the only signal — no subclass, no luminosity class — but the rendered
  colour ramp anchored on it is still preferable to the unknown
  sentinel.
- **Future Phase 5 consumers** (camera-anywhere geometric occlusion
  photometry, mass-ratio refinement for giants). Direct `logg_gspphot`
  / `teff_gspphot` reads per record; no rebuild needed.

## Validation harness

Three tiers, all snapshot-pinned:

- **Tier A — known-stars corpus.** `scripts/catalog/known-stars.tsv`
  carries ~50 hand-curated systems (single stars + multiples) with
  expected HIP, Gaia DR3 source_id, distance ± 1σ, absmag, spectral
  type, and per-companion (HIP, source_id, absmag) tuples.
  `scripts/catalog/known-stars.test.ts` loads `public/catalog.bin` via
  the runtime loader and asserts every row matches within tolerance.
  Adding a row → see § Adding to the known-stars corpus below.
- **Tier B — population statistics.**
  `scripts/catalog/build-counts.ts` (`compareBuildCounts`) + the two
  per-build snapshot JSONs gate every absolute count and rate the build
  emits. The diff format in `formatCountDiff` is the same in both Phase
  2 and Phase 3 — `scripts/binaries/stage7_counts.py` mirrors
  `scripts/catalog/build-counts.ts` so the per-strategy assertion shape
  reads identically across the two builds.
- **Tier C — SIMBAD random sample.**
  `scripts/catalog/validate-simbad-sample.ts` cross-checks the built
  `public/catalog.bin` against a stratified random 10k SIMBAD sample
  in `data/simbad/simbad_sample.tsv`. Manual run; the
  distance-regression check above is the build-time automated subset
  of the same cross-check.

## Adding to the known-stars corpus

`scripts/catalog/known-stars.tsv` is tab-separated with comment lines
preserved. To add a star or system:

1. Pick the system. Confirm the WDS id (empty for single stars), the
   primary HIP and Gaia DR3 source_id (`SIMBAD` or VizieR resolve), a
   trusted distance ± 1σ, the expected absmag, and the MK spectral type.
2. For multiples, list each companion's letter, HIP, source_id, and
   absmag in the `companions` column as
   `comp_letter:hip:gaia_id:absmag` tuples joined by semicolons.
3. Append the row. Run `npm test -- known-stars` to confirm the row
   passes against the current `public/catalog.bin`. The test parses the
   spectral string via `classifyFromSimbad` so the format must be
   SIMBAD-canonical MK.
4. If the test fails on a row you expected to pass, the discrepancy is
   genuine — either the catalog has a bug or the expected values are
   wrong. Don't relax the tolerance to silence; investigate.

## Refreshing data when DR4 / new AT-HYG lands

The full Gaia data-release transition takes coordinated refreshes
because the source_id space changes; partial refreshes leave the
catalogue inconsistent. Order matters:

1. **Swap AT-HYG.** Drop the new `athyg_3X_classic_ids.csv` into
   `data/athyg/`. Re-run `npm run build:catalog` to confirm parse + drift
   against the expected snapshot. (The build will fail loudly because
   the side-files are still keyed to DR3.)
2. **Refresh the Gaia DR4-keyed side-files** in any order — they're
   independent pulls keyed on the deduped source_id list:
   `refresh-gaia-hip-xmatch.py`, `refresh-gaia-tyc-xmatch.py`,
   `refresh-gaia-astrometry.py`, `refresh-gaia-nss.py`,
   `refresh-gaia-apsis.py`, `refresh-bailer-jones.py`.
   Each commits its TSV under `data/gaia/` or `data/bailer-jones/`.
3. **Refresh HIP2 + SIMBAD if upstream republished** — these are
   keyed on HIP / SIMBAD `oid` respectively, so they don't change
   under a Gaia DR transition unless their own pipeline updated.
4. **Re-run `npm run build:binaries`** then **`npm run build:catalog`**.
   Both build steps reassert against their snapshots; the count diffs
   are the first place to look for regressions.
5. **`UPDATE_BUILD_COUNTS=1` then `UPDATE_DISTANCE_OUTLIERS=1`** to
   refresh both snapshots once the new build is reviewed. Re-edit the
   `reason` strings on the distance-outliers snapshot for any new
   outliers.
6. **Re-run Tier A and Tier C.** Tier A's known-stars table may need
   per-row source_id updates if Gaia DR4's source_ids changed for the
   tracked stars (Gaia publishes a DR3↔DR4 cross-walk during the
   transition window). Tier C's `simbad_sample.tsv` should be
   refreshed via `refresh-simbad-sample.py` to re-stratify against the
   new AT-HYG.

## Debug recipes

**"Star X renders at the wrong distance."** First check the distance-
outliers snapshot — if the star is listed, the reason explains it. If
not:

1. Find the AT-HYG row: `grep '\bX\b' data/athyg/athyg_33_classic_ids.csv`
   (use the proper name, HIP, or HD as the search key).
2. Check `dist_src`. If `G_R3` or `G_R2`, the row is B-J-eligible.
3. Check `gaia` column. If blank, the HIP cross-walk in
   `data/gaia/gaia_dr3_hip_xmatch.tsv` should have backfilled it; if
   the HIP isn't in the cross-walk either, the star is Gaia-saturated
   and falls through B-J entirely.
4. Find the B-J posterior:
   `grep '^<source_id>' data/bailer-jones/bailer-jones-dr3.tsv`. If the
   posterior is the one rendered, the override fired correctly; if the
   posterior is far from the rendered value, B-J didn't fire (eligibility
   gate or missing source_id).
5. If the star is in the LMC cone, check its `pm_ra`, `pm_dec` columns
   against the LMC PM tolerance (±0.5 mas/yr of (1.85, 0.20)). PMs
   outside tolerance leave the star at its B-J posterior — likely
   intermediate-wrong if it's a real LMC member with anomalous PM.

**"A pair appears as spurious optical / spurious physical."** The
multiples.tsv row carries the answer via `optical_via`:

1. `grep '^<wds_id>' data/binaries/multiples.tsv`. If the pair is
   absent, Stage 5 rejected it — the build log line names the tier.
2. Tier 1 (WDS notes): check `data/wds/wds_notes.txt` and
   `data/wds/wds_summ.txt` for the flag chars. The WDS catalogue is
   the upstream source of truth — if its flag is wrong, file with
   USNO, not Stellata.
3. Tier 2 / 3 (Gaia / asymmetric): the build log shows
   `BOTH_GAIA_PLX_GATE_SIGMA = 3.0` and the per-component parallax
   values; check whether the cited 3σ excess is genuine. Catastrophic
   parallax failures on saturated stars route through Tier 3's
   HIP2 anchor.
4. Tier 4 (orbit on file): if the pair has Stage 4 orbital elements,
   `orbit_kept` always wins. Check Stage 4's `orbit_via` value for
   provenance.
5. Tier 5 (mag-gap): the backstop. If you disagree with a
   `mag_heuristic_rejected` decision, the more durable fix is usually
   to surface the pair in a higher tier (e.g. a SIMBAD WDS cross-ID
   so it routes through `simbad_xid` in Stage 2).

**"A famous-star ID resolves to the wrong record."** Check the
`gaia_source_id` field on the AT-HYG row and on the SIMBAD cross-ID
side-file:

```
grep '\b<HIP>\b' data/athyg/athyg_33_classic_ids.csv
grep '<source_id>' data/simbad/simbad_wds_xids.tsv
grep '<source_id>' data/simbad/simbad_sptype.tsv
```

`source_id` is the join key for all Phase 3 side-files; HIP is a
secondary key SIMBAD also tracks. If both side-files agree but the
rendered star is wrong, the issue is in the AT-HYG → catalog
mapping — most likely the row's `dist_src` or the position-match path
in `stars-parse.ts`.
