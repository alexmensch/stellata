# Catalogue cross-match — binary-system pipeline

Developer walk-through of `scripts/binaries/build-binaries.py` — how
WDS pairs cross-match against ORB6 + AT-HYG + GCVS + CCDM + HIP2 +
Gaia (xmatches, NSS, 5p astrometry) + SIMBAD WDS cross-IDs + SIMBAD
per-component spectra to produce `data/binaries/multiples.tsv`. The
science of *why* the choices below are made (Gaia DR3 parallax bias,
NSS detectability regimes, HIP2 long-baseline corrections) is in
`SCIENCE.md`; this file is the engineering side — layered strategies,
numeric thresholds, provenance fields.

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
`scripts/README.md`.

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
                                  per-pair WDS sep+PA+epoch+Δmag columns
                                  + system-anchor inheritance for tight
                                  inner binaries + SIMBAD standalone
                                  augmentation.
  stage7_counts.py                Build-counts + build-rates snapshot
                                  writer (mirrors
                                  scripts/catalog/build-counts.ts).
  mass_estimate.py                Spectral-class-aware mass-ratio q
                                  backfill from Cox 2000 §15.2 /
                                  Pecaut & Mamajek 2013 tables.
  build-runtime-binaries.py       Read multiples.tsv +
                                  public/catalog-row-index-map.json,
                                  emit public/binaries.bin (v1 BIN1,
                                  72-byte records, one per physical
                                  pair). Detects hierarchical chains
                                  (Algol Aa1,Aa2 inside Aa,Ab) via
                                  WDS component-letter prefix
                                  matching, writes records in
                                  topological outer-before-inner
                                  order. Run via
                                  npm run build:binaries-runtime.
  build-binaries.test.py          stdlib unittest pins for Stages 1-7.
  build-runtime-binaries.test.py  stdlib unittest pins for the pure
                                  helpers (_split_components,
                                  _parent_token, assign_parent_relations,
                                  topological_walk_order) and the
                                  write_binary parent-index remapping.
  build-binaries-expected.json    per-strategy / per-tier count snapshot
                                  (UPDATE_BUILD_COUNTS=1).
  build-binaries-rates-expected.json
                                  per-strategy rate snapshot — catches
                                  population-mix shifts that don't move
                                  absolute counts.
  build-runtime-binaries-expected.json
                                  pair-emission count snapshot for
                                  build-runtime-binaries.py.

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
                                  walk didn't reach. Carries per-pair
                                  sep_arcsec, pa_deg, sep_pa_epoch_jd,
                                  dmag for the static-placement and
                                  Δmag-imputation paths. Consumed by
                                  scripts/catalog/companion-promotion.ts
                                  (build-time, surfaces companions in
                                  catalog.bin), build-runtime-binaries.py
                                  (emits public/binaries.bin), and the
                                  Tier A validation harness. (LFS)
  component_sptype_overrides.tsv  Hand-curated per-component MK types —
                                  Stage 6's top spectral tier
                                  (spect_via=curated). See
                                  data/binaries/README.md.
```

## Pipeline at a glance

Three build steps in order, with `data/binaries/multiples.tsv` and
`public/catalog-row-index-map.json` as hand-offs:

1. **Binary-system pipeline** (`scripts/binaries/build-binaries.py`).
   Reads WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2 + Gaia (xmatches, NSS,
   5p astrometry) + SIMBAD WDS cross-IDs + SIMBAD per-component
   spectra. Emits `data/binaries/multiples.tsv` — two rows per kept
   physical pair, plus standalone rows for SIMBAD-known WDS components
   the pair walk didn't reach. Run via `npm run build:binaries`. Seven
   stages, one module per stage under `scripts/binaries/`.
2. **Single-star catalogue build** (`scripts/catalog/build-catalog.ts`).
   Reads AT-HYG + multiples.tsv (companion promotion) + the SIMBAD
   sp_type / Gaia Apsis / Bailer-Jones / Gaia HIP-xmatch side-files +
   Stellarium constellations + GCVS + Hipparcos CCDM. Emits
   `public/catalog.bin` (v6, 80-byte records), `public/constellations.json`,
   `public/search-index.json`, `public/catalog-row-index-map.json`.
   Run via
   `npm run build:catalog`. Per-stage logic lives in sibling modules
   (`stars-parse.ts`, `catalog-pure.ts`, `gcvs-parse.ts`,
   `visual-doubles.ts`, `gaia-xmatch.ts`, `constellations.ts`,
   `companion-promotion.ts`).

   Companion promotion is the build-catalog seam that reads
   multiples.tsv: `scripts/catalog/companion-promotion.ts` adds
   first-class catalog records for the secondary of every physical
   pair whose identifier isn't already in AT-HYG. Promoted records
   carry `FLAG_BINARY_COMPANION_ONLY`, plus
   `FLAG_BINARY_COMPANION_SYNTHETIC` when the row carries no own
   gaia and no non-inherited HIP (Algol Ab and friends — see
   `scripts/catalog/README.md` § Companion promotion for the
   identifier gate). Positions come from the row's own Gaia 5p
   astrometry when distinct from the primary's, otherwise from a
   sky-tangent projection of the EXISTING catalog primary's xyz at
   the published WDS sep+PA. Absmag is imputed from primary + WDS
   Δmag when the row inherits its parent's AT-HYG photometry. The
   renderer / picker / hover / focus stack picks companions up
   with zero code change. ~8.6k companions promoted into the
   current build (half via real Gaia/HIP keys, half via synthetic).
3. **Runtime side artifact** (`scripts/binaries/build-runtime-binaries.py`).
   Reads multiples.tsv + `public/catalog-row-index-map.json`
   (which now carries a `bySynth` section alongside `byGaia` and
   `byHip`), emits `public/binaries.bin` — one fixed-size record
   per physical pair carrying Kepler elements + sep+PA +
   hierarchical parent-relation index. The Python `resolve_idx`
   walks gaia → hip → synth in priority order; the synth key is
   composed from the pair's expanded `comp` tokens (WDS-truncated
   forms like `Aa1,2` resolve through the same `synth-…-Aa2` key
   the catalog minted). When the secondary's id-first resolve
   lands on the primary's own row (blended photocentre: both rows
   carry the primary's gaia/hip), the writer retries the synth key
   before declaring the pair degenerate — companion promotion
   mints a synth record for exactly those rows.
   Run via `npm run build:binaries-runtime`.
   Loaded by `src/client/binaries/binaries-loader.ts`; consumed
   per-frame by the BinaryOrbitField runtime layer.

The Tier A validation harness (`scripts/catalog/known-stars.test.ts`)
reads multiples.tsv directly for per-component sanity checks
(SIMBAD spectral type, absmag-from-Δmag).

Build-time statistics for every phase land in snapshot JSONs:
`build-binaries-{expected,rates-expected}.json`,
`build-runtime-binaries-expected.json`,
`build-catalog-expected.json`,
`build-distance-outliers-expected.json` — each gates the next
build via `UPDATE_BUILD_COUNTS=1` refresh.

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
J1991.25 (the HIP1 native epoch), while GJ / Tycho-sourced rows are
closer to J2000. Stage 2 and Stage 3 share `iter_pair_athyg_matches`
to walk the pair-iteration cascade (primary match against the WDS
precise_coord, then predicted-secondary match with primary-row
exclusion, with the wide-pair short-circuit when ρ ≥ the WDS overflow
sentinel `999.9″`). The default matcher,
`match_athyg_position_either_epoch`, tries the row PM-propagated
J1991.25→J2000 first, then the unpropagated stored coord — propagated
wins on tie, the unpropagated retry covers high-PM GJ-anchored rows
(ξ UMa at -425/-581 mas/yr drifts ~5″ off under propagation, beyond
the 2″ tolerance).

The two stages compose:

- **Stage 2** binds identifiers — sets `c.athyg_row` always on match,
  and surfaces `gaia` / `hip` from the row when the row carries them
  (tagging `resolve_via=athyg_gaia_native` when a Gaia source binds).
  Opts OUT of secondary blend-inheritance because copying the
  primary's AT-HYG row to the secondary slot would also propagate the
  primary's Gaia source onto the secondary.
- **Stage 3** synthesizes astrometry — `attach_athyg_position_fallback`
  routes any remaining `unresolved` component through the same
  cascade, opting INTO blend-inheritance so Hipparcos-unresolved
  pairs (A, B sharing one AT-HYG row at sub-AU separation) both
  emit `astrometry_via=athyg_position`.

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
| `hip2_long_baseline` (Gaia-saturated) | The component has no usable Gaia parallax — either no Gaia source resolved at all (Sirius A, α Cen, Algol, Procyon) or the Gaia row exists with ra/dec but `parallax=NULL` because Gaia couldn't fit a 5p solution (Castor STF1110 AB). HIP is known and HIP2 covers it; HIP2 is the only parallax source available. |
| `athyg_position` | Post-pass after the Gaia / HIP2 cascade. For components still `unresolved`, the WDS precise_coord position-matches an AT-HYG row (dual-epoch: PM-propagated J1991.25→J2000 then unpropagated for GJ-anchored rows that store ra/dec at J2000). Position comes from the row's stored ra/dec; parallax = 1000/dist_pc. Canonical case: ξ UMa — Gaia source absent from `gaia_dr3_astrometry.tsv` (G≈4.3 saturated), HIP 55203 absent from HIP2 (van Leeuwen excluded orbit-corrupted entry), but AT-HYG carries the GJ-anchored distance 10.42 pc. |
| `unresolved` | None of Gaia 5p, HIP2, or the AT-HYG position-match reach the component. |

The HIP2-discrepancy 5″ gate runs against the **minimum** WDS ρ across
every pair row a source_id participates in. A primary that's in both a
tight AB pair and a wide AC pair always takes the tight ρ, so the same
physical star routes through HIP2 consistently across every pair row of
its system, never differently per row.

Stage 3 reports per-route counts in build log order. `astrometry_via` is
also written to every `multiples.tsv` row in Stage 6 (with a Stage-6-owned
extra value, `system_inherited`, for components that inherit a
system-anchor position because their own row resolved to `unresolved`).
The `athyg_position` route also surfaces the matched AT-HYG row reference
on `ResolvedComponent.athyg_row`; Stage 6's photometry / proper-name
lookup consults that reference first, ahead of the gaia / HIP indexes,
so AT-HYG-HD-only rows still surface their absmag / spect / proper name.

## Stage 4 — Orbital element selection per pair

Picks the most-trustworthy set of orbital elements per pair, then
converts to a canonical (P, T, e, a, i, ω, Ω, q, distance) tuple. Routes
in `ORBIT_VIA_VALUES`, in priority order:

| Route | When |
| --- | --- |
| `orb6` | ORB6 visual orbit with grade ∈ {1, 2, 3, 4, 5} (definitive → indeterminate). Best grade wins; ref-year secondary tiebreak. ORB6's `a` is the genuine relative A–B orbit — the only kind the renderer can animate — so this route outranks `gaia_nss`, where no solution type yields a relative semi-major axis (see the photocentre note below). |
| `gaia_nss` | Any component has an `nss_two_body_orbit` row AND the orbit is in Gaia's astrometric-detectability regime: `period < 3 yr` (`NSS_PERIOD_THRESHOLD_DAYS = 1095.75`) OR apparent photocentre semi-major axis `a0 < 1″` (`NSS_SEPARATION_THRESHOLD_MAS = 1000`). 95.8% of DR3 NSS rows pass the period gate; the few longer-period rows are picked up by the sub-arcsec branch. |
| `orb6_spectroscopic` | ORB6 grade ∈ {8, 9} — astrometric / interferometric without visual coverage (8) or spectroscopic (9). |
| `none` | Visual-only pair with no orbital information on file. |

The Thiele-Innes → Campbell algebra for NSS TI-derived solution types
(`Orbital`, `OrbitalAlternative*`, `OrbitalTargetedSearch*`,
`AstroSpectroSB1`) is inlined in `_thiele_innes_to_campbell` (Heintz
1978 / Halbwachs+ 2023 Appendix C). The ESA NSSTools package isn't a
dependency — the closed form is ~10 lines and NSSTools has been
unmaintained since 2022.

The TI constants describe the **photocentre's** orbit around the
system barycentre, not the relative A–B orbit (Halbwachs+ 2023): the
recovered semi-major axis is `a0 = |q − β|·a_rel`, where
`q = M₂/(M₁+M₂)` is the secondary's mass fraction (the same q the
pipeline stores per pair) and `β = F₂/(F₁+F₂)` its flux fraction — so
a0 → 0 for near-equal-brightness pairs. Reconstructing `a_rel` needs a
mass ratio AND a flux ratio we don't reliably have per pair, so `a_AU`
is left `None` for TI-derived rows rather than invented. With no `a`,
`build-runtime-binaries.py` never sets `has_orbit` and these pairs
place statically at their WDS sep+PA (Tier 3). The plane angles `i` /
`Ω` are shared between the photocentre and relative orbits and
populate as-is; `ω` is the photocentre's, which sits π away from the
secondary's relative-orbit ω whenever the primary carries most of the
flux.

Eclipsing solution types
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

The periastron epoch `T0` needs the same care, with a twist. Per
`orb6format.txt` its `T0_unit` code is `d` = truncated JD (the file
stores JD − 2,400,000, **not** a full JD — Algol Aa1,Aa2 carries
`41771.353` = HJD 2441771.353), `m` = MJD (JD − 2,400,000.5), or `y` =
fractional Besselian year. The twist: ORB6 mislabels ~50 truncated-JD
epochs with the `y` flag (e.g. WDS 04227+1503 Aa,Ab stores
`59501.496 y` for a 4-day pair), and the year formula throws those out
past JD 2e7. `_orb6_T0_jd` therefore validates a `y` conversion against
a physically-possible epoch window (Besselian years ≈1700–2600) and
retries the truncated-JD reading when it falls outside; unrecoverable
rows (and the non-conforming `c` / blank flags) get a `None` epoch and
place statically at the WDS observation epoch. `select_orbits_all`
asserts every emitted `T_jd` stays inside the window. A wrong epoch
isn't visible in a rendered orbit — baseline cancellation at
`sep_pa_epoch_jd` hides it — but it shifts the pair's configuration at
any *other* date, so conjunction / eclipse timing (Algol's minima
included) would miss published ephemerides without this normalisation.

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
P_days, T_jd, e, a_AU, i_rad, omega_rad, Omega_rad, q, dist_pc,
sep_arcsec, pa_deg, sep_pa_epoch_jd, dmag
```

The last four columns carry WDS pair geometry — populated on both
component rows of a decomposing pair (standalone rows leave them
empty). `sep_arcsec` and `pa_deg` feed companion-promotion's
tangent-plane projection for the Tier-3 (no-orbit) path and the
runtime binaries.bin sep+PA fields. `sep_pa_epoch_jd` records the
WDS observation year (`date_last`) converted to JD via
`wds_year_to_jd`; the runtime `BinaryOrbitField` baselines orbital
animation at this epoch (ΔR(t) = R(t) − R(sep_pa_epoch_jd)) so the
stored placement is reproduced exactly at its measurement date.
`dmag` is the published apparent Δmag
(`mag_sec - mag_pri`) used to impute the companion's absmag when
the secondary row inherits its parent's AT-HYG photometry.

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

The `spect` column resolves through a three-tier cascade with
provenance in `spect_via`: `curated` →
`data/binaries/component_sptype_overrides.tsv`, hand-curated
literature types for components no machine source carries (SIMBAD's
WDS cross-IDs never enumerate Algol's Aa2, so its K0IV can only come
from here); `simbad` → SIMBAD's per-component sp_type, which beats
AT-HYG because AT-HYG inherits the same system-level spectral string
across all components (incorrect for mixed-class pairs like Sirius
A0V + DA1.9); `athyg` → the inherited per-system string; `none`.
The mass-ratio q backfill reads the resolved `spect`, so a curated
companion type also improves q for its pair.

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
