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
  component_tokens.py             WDS component-letter token helpers
                                  (truncated-form expansion, parent /
                                  child tokens) shared by subdivide.py
                                  and build-runtime-binaries.py.
  subdivide.py                    Synthesized sub-pair injection — ORB6
                                  orphan pairs + curated component
                                  overrides (pre-Stage-2), binding seeds
                                  (post-Stage-2), Gaia-NSS inner pairs
                                  (post-Stage-3). See § Sub-pair
                                  synthesis.
  stage2_resolve.py               WDS-component → Gaia DR3 source_id
                                  cascade (orb6_hip → athyg_gaia_native →
                                  simbad_xid → ccdm_hip → AT-HYG
                                  position-match), with same-letter +
                                  Aa→A propagation. Also hosts the
                                  binding-integrity audit + enforcement
                                  (audit_binding_integrity) — see
                                  § Binding-integrity audit.
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
  stage5_optical.py               Six-tier physical-vs-optical
                                  classification (WDS-notes → orbit-on-
                                  file → separation-limit → both-Gaia
                                  (+escape velocity) → asymmetric-Gaia →
                                  mag-gap). Physical-boundness gates reuse
                                  Stage 4's Kepler / parallax-anchor
                                  helpers.
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
                                  per kept WDS pair (incl. synthesized
                                  sub-pairs), plus standalone rows for
                                  SIMBAD-known components the pair
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
  orb6_component_overrides.tsv    Hand-curated WDS component letters for
                                  ORB6 rows with a blank components
                                  field (YY Gem → Ca,Cb). Applied before
                                  orphan sub-pair synthesis. See
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
   with zero code change. ~14.2k companions promoted into the
   current build (~36% via real Gaia/HIP keys, ~64% via synthetic).
3. **Runtime side artifact** (`scripts/binaries/build-runtime-binaries.py`).
   Reads multiples.tsv + `public/catalog-row-index-map.json`
   (which now carries a `bySynth` section alongside `byGaia` and
   `byHip`), emits `public/binaries.bin` — one fixed-size record
   per physical pair carrying Kepler elements + sep+PA +
   hierarchical parent-relation index. The Python `resolve_idx`
   walks gaia → hip → synth in priority order; the synth key is
   composed from the pair's expanded `comp` tokens (WDS-truncated
   forms like `Aa1,2` resolve through the same `synth-…-Aa2` key
   the catalog minted). Both pair ends then prefer a distinct synth
   slot over their id-first resolve: promotion mints a synth record
   only after judging a row's ids inherited and stripping them, so
   when one exists it is always the truer target than the blended
   member row the inherited id lands on.
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
| `orb6_hip` | The pair has an ORB6 entry with a published HIP for the primary, and Gaia DR3's `hipparcos2_best_neighbour` cross-walk covers that HIP. Strongest tier — ORB6's HIP attribution is human-curated — but gated on a WDS-coordinate sanity check (`_orb6_hip_matches_pair_coord`): ORB6 occasionally carries a typo'd HIP that points at an unrelated star tens of degrees away (ε Equ STF2737 lists HIP 103579 for the true HIP 103569), so a HIP whose known position sits >5′ from the pair's WDS precise coord is dropped entirely and the component falls through to the coordinate-validated tiers below. |
| `athyg_gaia_native` | HIP-mediated: ORB6's HIP, an AT-HYG row's HIP, or a CCDM sibling's HIP routes through AT-HYG's own `gaia` column when Gaia's published HIP→DR3 cross-walk misses (AT-HYG's source_id coverage is broader). Also reused for the position-match pass below, which lands on the same AT-HYG-native field by a different path. |
| `simbad_xid` | The component is in `data/simbad/simbad_wds_xids.tsv` — SIMBAD's curated `(WDS-J id, component letter) → (Gaia DR3 source_id, HIP)` map. Reaches sub-arcsec components that ORB6 doesn't enumerate (η Cas A/B/C, ξ UMa A/B, ζ Cnc A/B/C, α Cen A/B/Proxima). |
| `ccdm_hip` | The pair's WDS id matches a Hipparcos CCDM identifier; one of the CCDM-sibling HIPs sits within 10″ of the WDS precise coord (PM-propagated from J1991.25). Routes that HIP through Gaia's HIP cross-walk and AT-HYG-native fall-through. |
| `position_pm` / `position_nopm` | Reserved placeholders in `RESOLVE_VIA_VALUES` for a future PM-propagated match against `data/gaia/gaia_dr3_astrometry.tsv`. Not yet wired. |
| `unresolved` | All strategies missed. The component still binds a HIP whenever any tier surfaced one — Stage 3's HIP2 long-baseline fallback can attach astrometry to a Gaia-source-less Sirius A or α Cen B from the bare HIP. |

Before any tier runs, Stage 1's `build_indices` applies a one-sided
**magnitude-consistency gate** to every HIP-anchored Gaia binding —
both Gaia's `hipparcos2_best_neighbour` xwalk rows and AT-HYG's own
`gaia` cells (which ingest the same xwalk). The xwalk has no magnitude
check, so a HIP too saturated for a DR3 source best-matches whatever
source IS nearby: the resolvable companion (Castor A → B's source) or
a faint background star (α Cen B → a G=20.9 source). A bound source
with `G − V > 1.0` (`GAIA_BINDING_G_MINUS_V_REJECT_MAG`) cannot carry
the light the HIP names — the physical ceiling is ~+0.1 for the bluest
stars plus ~+0.75 of equal-blend headroom; red stars run G *brighter*
so the gate never fires on them — and is unbound at the ingest
boundary (AT-HYG cells scrubbed to `None`, xwalk rows dropped from
`hip_to_gaia` / `src_to_hip`). The bare HIP survives for Stage 3's
HIP2 fallback. Unverifiable bindings (no V, source outside the
astrometry pull, no G) are trusted. Counted `xwalk_hip_mag_rejected` /
`athyg_gaia_mag_rejected` in the Stage-7 snapshot.

The position-match pass deserves its own note. AT-HYG's stored
ra/dec is documented as J2000 but HIP-sourced rows are empirically at
J1991.25 (the HIP1 native epoch), while GJ / Tycho-sourced rows are
closer to J2000. Stage 2 and Stage 3 share `iter_pair_athyg_matches`
to walk the pair-iteration cascade (primary match against the WDS
precise_coord, then predicted-secondary match with primary-row
exclusion, with the wide-pair short-circuit at the WDS overflow
sentinel `999.9″` — `parse_wds_sep_pa` collapses that ρ to None, and
the predicted-secondary match skips a None ρ). The default matcher,
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

ρ = 0 sub-resolution pairs get two special rules. Every positional
match (CCDM sibling pick, predicted-secondary AT-HYG match) is
SKIPPED for them — the (ρ, θ) prediction degenerates onto the
primary's own coordinate, so a nearest-neighbour pick can only
coin-flip onto a sibling component's identity (1 Equ Ab once bound
B's HIP 103569 and B's AT-HYG photometry this way). Instead,
`propagate_blend_identity` gives a secondary that bound nothing of
its own the primary's gaia / hip / AT-HYG row — the WDS blend
convention (Castor CIA 29 lists HIP 36850 on both sides of Aa,Ab) —
and `propagate_within_system` re-runs so the blend binding reaches
the letter's other pair rows. Secondaries carrying ANY binding of
their own are left untouched.

### Binding-integrity audit (enforced)

After every binding pass, `audit_binding_integrity` groups bindings
per WDS system and detects two contradiction shapes the cascade +
propagation can leave behind: (a) one Gaia source bound to disjoint
letters (not ancestor/descendant, not compound-contained, not
sub-resolution blend-mates), and (b) one letter bound to different
sources on different rows. A source cannot be two stars, and two
letters at a measured ρ > 0 cannot be one source — so the blend-mate
exemption applies only to ρ = 0 sub-resolution pairs, not to measured
ones. Each contradiction is arbitrated geometrically: predicted
tangent-plane offsets (E = ρ·sin θ, N = ρ·cos θ) composed over a BFS
chain of pair rows from an uncontested astrometric reference letter,
versus the contested source's actual Gaia offset (min error over
J2016.0 and the PM-propagated WDS edge epoch). The winner is decisive
when its error clears a flat `2″` floor (no separation-scaling — a
wide pair's chain accumulates measurement error, so scaling the
tolerance up with ρ would rubber-stamp a source sitting arcseconds
off the winner) and beats the runner-up by ≥2×, or — for a
disconnected system graph — when geometry refutes every reachable
candidate and leaves exactly one unreachable home.

**Photocentre blends.** A source bound to *both sides of a measured
(ρ > 0) pair* is a genuine Gaia blend — one photocentre for two
components Gaia could not resolve (Castor A/B, saturated at ~5″).
Enforcement unbinds a blend loser only when geometry lands the source
essentially ON one component (winner error within a tight `1″` floor,
i.e. a crosswalk error masquerading as a blend, e.g. σ CrB's C/E
collapse); a larger error means the source is the blend centroid
sitting *between* the components, so the conflict is `skipped` and the
blended-away member is left for the downstream slot-minting machinery
(the Acrux/Castor shape). A letter_sources conflict on a letter that
is itself part of a skipped blend is skipped for the same reason. All
other ambiguous conflicts unbind every contested binding conservatively.

Enforcement (`apply=True`) is live: losers unbind (gaia → None; hip →
None when it cross-walks to the contested source or is a HIP the
winning component also carries — the shared blend-HIP), then the
propagation passes re-run and sub-letters orphaned *within an enforced
system* inherit their bound parent token (20312's Aa/Ab follow A, not
sibling BC). Verdicts are counted (Stage-7 `binding_conflicts_*` /
`arbitrated_geometric` / `arbitrated_unbound_ambiguous` /
`arbitration_skipped_no_reference` / `arbitration_skipped_photocentre_blend`)
and written to `public/binding-integrity-verdicts.tsv` (gitignored
audit surface). This is what re-homes the ~7 duplicate-relation
mis-associations the writer previously collapsed; a source cannot be
two stars at measured different separations.

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

## Sub-pair synthesis (`subdivide.py`)

Some orbits have no WDS pair row to live on — every downstream stage
walks WDS pairs, so those orbits were unreachable. Three passes at
three points in the pipeline:

- **ORB6 component overrides (Stage 1).**
  `data/binaries/orb6_component_overrides.tsv` stamps curated WDS
  component letters onto ORB6 rows whose fixed-width components field
  is blank because the catalog names the pair only by its
  variable-star designation (YY Gem = Castor Ca,Cb). Keyed on
  `(wds_id, discoverer)`; curation wins over the parsed field.
- **ORB6 orphan pairs (pre-Stage-2).** One synthesized `WdsPair` per
  ORB6 `(wds_id, components)` key that names a clean sub-pair (both
  sides single-component tokens after WDS truncated-form expansion —
  the fixed-width misalignment garbage `"95"` / `"a,Ab"` is filtered)
  with no WDS row — ~33 pairs, 64 Psc Aa,Ab and Castor Ca,Cb among
  them. A blank-components WDS row under the same `(wds_id,
  discoverer)` is the same physical pair and donates its ρ/θ/mags/
  date/notes; otherwise the pair is sub-resolution (ρ = 0.0, no
  photometry) and the precise coord falls back to ORB6's own
  coordinate prefix. The synthesized components then ride the normal
  Stage 2 cascade (orb6_hip fires for primaries — the ORB6 entry key
  matches by construction), and
  `seed_synthesized_component_bindings` backstops what the cascade
  missed: an unresolved primary inherits the in-system parent-token
  component's binding (Ca ← C), an unresolved secondary inherits the
  pair primary's (the blend convention).
- **Gaia-NSS inner pairs (post-Stage-3).** A component whose own
  source has an `nss_two_body_orbit` row while its pair partner is a
  DIFFERENT resolved source hosts an unresolved companion of its own
  — the orbit is interior to that component, not the pair's (Stage
  4's distinct-source gate stops the misattribution). One synthesized
  inner pair per `(wds_id, source_id)`, named one hierarchy level
  down from the deepest carrier token (`A` → `Aa,Ab`, `Aa` →
  `Aa1,Aa2`) — ~521 pairs. Skipped when the carrier token has no
  deeper WDS convention (compound / digit-bearing), the child tokens
  already exist in the system, the NSS row is outside the
  detectability regime, or the elements can never render (missing
  P/T/e, or missing ω on a non-circular fit). Children inherit the
  carrier's identifiers and astrometry; the pair is sub-resolution by
  construction (ρ = 0.0, `discoverer=GNSS`).

Synthesized pairs then flow through Stages 4-7 like any WDS pair:
Stage 4 attaches the orbit through its normal routes, Stage 5 keeps
them (both-Gaia tier for blended children, orbit-on-file otherwise),
Stage 6 emits them with system-anchor positions, and
`build-runtime-binaries.py` nests them under their outer pair via the
component-letter hierarchy. Build counters:
`synthesized_orb6_orphan_pairs`, `synthesized_nss_inner_pairs`.

**Shared-slot re-homing (blended siblings).** An inner pair's primary
must resolve to its parent component's catalog slot — the shared-slot
invariant the runtime walk + focal-frame ride depend on (see
`src/client/binaries/README.md` § Hierarchical walk). When a sibling
shares its identifier with the system primary (Castor A & B blend to one
Gaia source; A & B of 02398-4254 share a HIP Gaia later split), the inner
pair's own id-first resolve lands on the wrong sibling. Two coupled
corrections in `build-runtime-binaries.py`: `assign_parent_relations`
picks the *bound* parent (has-orbit, then tightest sep) over a
coincidental element-less wide pair, and `override_inner_primary_indices`
re-homes each inner pair's primary onto that parent's member slot.
`companion-promotion.ts`'s post-pass makes the baked catalog placement
agree (see `scripts/catalog/README.md` § Companion promotion).

A blended primary the synth re-home can't reach (its component was dropped
by promotion, or it's a compound / secondary-side collapse) still resolves
onto the anchor, producing a duplicate `(primary, secondary)`. `write_binary`
emits one record per relation, and when duplicates collide it keeps the
orbit-bearing member (`pair_has_orbit`; ties keep first in walk order) so the
system's live motion survives the dedup rather than an element-less wide
pair winning by walk position. Each drop is classified
(`same_relation_alias`): when on each side the two pairs' canonical comp
tokens are equal, hierarchy-related, or compound-contained, the two rows
name the SAME physical link at different granularity (18025+4414 `AB` vs
`Aa,B`) — a correct, permanent dedup counted
`pairs_dropped_same_relation_alias`. Disjoint letters on either side mean
two DISTINCT stars collapsed onto one record; those are counted
`pairs_dropped_duplicate_relation`, a ratchet toward zero — each is a
missing minted slot (current floor: θ¹ Ori's `Bb,Bc` / `Bb,Bd`, whose
Ba/Bb sub-letter blend the inner-pair hierarchy owns).

## Stage 4 — Orbital element selection per pair

Picks the most-trustworthy set of orbital elements per pair, then
converts to a canonical (P, T, e, a, i, ω, Ω, q, distance) tuple. Routes
in `ORBIT_VIA_VALUES`, in priority order:

| Route | When |
| --- | --- |
| `orb6` | ORB6 visual orbit with grade ∈ {1, 2, 3, 4, 5} (definitive → indeterminate). Best grade wins; ref-year secondary tiebreak. ORB6's `a` is the genuine relative A–B orbit, so this route outranks `gaia_nss`, where no solution type yields a relative semi-major axis (see the photocentre note below — Stage 6 estimates one for the non-visual routes). |
| `gaia_nss` | A component has an `nss_two_body_orbit` row, its pair partner is NOT a different resolved source (a distinct-source partner means the orbit is interior to the carrying component — subdivide.py re-homes it on a synthesized inner pair), the orbit is in Gaia's astrometric-detectability regime: `period < 3 yr` (`NSS_PERIOD_THRESHOLD_DAYS = 1095.75`) OR apparent photocentre semi-major axis `a0 < 1″` (`NSS_SEPARATION_THRESHOLD_MAS = 1000`), AND the pair's WDS separation isn't far too wide to be that orbit (`_nss_separation_consistent`). 95.8% of DR3 NSS rows pass the period gate; the few longer-period rows are picked up by the sub-arcsec branch. |
| `orb6_spectroscopic` | ORB6 grade ∈ {7, 8, 9} — non-visual fits: 8 = interferometric-visibilities-only, 9 = astrometric / spectroscopic per orb6text.html; grade 7 is undocumented there but the file's grade-7 rows are photometric / eclipsing orbits (YY Gem, EQ Tau, BX And) with real fitted elements. |
| `none` | Visual-only pair with no orbital information on file. |

An NSS orbit is keyed to a Gaia **source**, not a WDS pair, so it can
leak onto the wrong pair when a saturated / blended primary shares its
source across several visual companions. The distinct-source gate stops
the leak only when the partner is a *different* resolved source; a
partner that shares the blended source or resolved to nothing slips
through. `_nss_separation_consistent` is the backstop: it projects the
pair's WDS ρ to AU at the system distance and rejects the orbit when that
exceeds `NSS_SEPARATION_SANITY_RATIO` × a Kepler upper-bound relative
semi-major axis (at `NSS_MAX_SYSTEM_MASS_MSUN`) for the NSS period — a
bound orbit's projected separation can't outrun its apastron. Sub-
resolution / synthesized inner pairs carry ρ = 0 and are exempt (the
orbit's true home). Canonical failure: υ⁴ Eri, where the 0.97-day inner
orbit was attaching to the 5.5″ and 49″ visual companions.

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
is left `None` here; Stage 6's `finalize_renderable_elements`
estimates it from Kepler's third law for the non-visual routes
(§ Stage 6). The plane angles `i` /
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

The mass-ratio `q` rides through this stage when present. Only Gaia NSS
`EclipsingSpectro` solutions publish `mass_ratio` (Gaia's M_S/M_P ratio,
converted here to the `q = M₂/(M₁+M₂)` fraction the rest of the pipeline
stores); everything else gets `q = None` here and falls through to Stage
6's spectral-class mass-ratio backfill below.

## Stage 5 — Optical-pair filter cascade

`scripts/binaries/stage5_optical.py` classifies each pair as physical or
optical and tags the decision with the tier that decided
(`OPTICAL_VIA_VALUES`):

| Tier | Tag | Rule |
| --- | --- | --- |
| 1 | `wds_notes_kept` / `_rejected` | WDS Notes flag chars: `{T, V, Z}` keep, `{S, U, X, Y}` reject. Other chars silent — tier falls through. |
| 2 | `orbit_kept` | Stage 4 selected real orbital elements (gaia_nss, orb6, or orb6_spectroscopic). An empirical orbit fit is the strongest evidence of physical association and wins over every gate below, including the separation limit — a close pair's Gaia parallaxes are routinely blend-corrupted, so a few-pc parallax split does not beat a tracked relative orbit, and NSS orbits that could leak onto a genuinely wide (unbound) companion are already blocked upstream by Stage 4's separation-sanity gate. Needed for Sirius A-B (grade-2 ORB6 orbit past a 9.9-mag WD gap) and the nearby CPM pairs (η Cas, 61 Cyg, Struve 2398) whose orbital PM split would otherwise trip the velocity gate. |
| 3 | `sep_limit_rejected` | The pair's two components sit more than the physical bound-pair limit apart in 3D (`SEPARATION_LIMIT_PC = 1.0`) — a line-of-sight optical double. Each component's distance is its own parallax (Gaia or HIP2), or the system parallax anchor when it has none; the on-sky term is the WDS ρ at the reference distance, the radial term the parallax-derived depth gap counted only when significant (`RADIAL_SEPARATION_SIGMA = 3.0` of the combined error). Fires off a well-measured own parallax (`SEPARATION_POE_MIN = 5.0`). Pollux F: own ~297 pc vs its partner's inherited ~10.4 pc. |
| 4 | `gaia_kept` / `_rejected` | Both components carry a Gaia 5p row. A 3σ parallax disagreement on combined error (`BOTH_GAIA_PLX_GATE_SIGMA = 3.0`) rejects only when the implied 3D separation also exceeds the physical limit — the same guard as tier 5, so a close visual pair's blend-corrupted Gaia parallaxes can't split a within-limit pair. A within-limit disagreement (and an agreement) falls to the escape-velocity sub-gate, which rejects a transverse velocity too large to be bound — `v_transverse > ESCAPE_VELOCITY_SAFETY_FACTOR (2.5) × sqrt(2·G·M/r)`. `v_transverse` is from the PM difference (a lower bound on v_rel, so the gate can only reject); `M` is the pair's spectral-table mass (`compute_pair_masses`, generous default when unknown); `r` is the same projected+radial separation. Replaces the old 5 mas/yr per-axis PM cut, which mistook a nearby bound pair's real orbital PM split for optical contamination. |
| 5 | `asymm_kept` / `_rejected` | Exactly one component has a Gaia 5p row; the other has a HIP2 parallax anchor (Gaia-saturated bright primary). Gaia parallax vs HIP2 anchor at 3σ combined error (`ASYMM_PLX_GATE_SIGMA = 3.0`), rejecting only when the implied 3D separation also exceeds the physical limit — a HIP2-vs-Gaia zero-point offset can't split a bound pair. Backstop for a poe < 5 Gaia parallax; the well-measured Sirius A-C/D/E/F-shaped splits (anchor 378 mas vs Gaia <1 mas → a ~kpc split) reject upstream at tier 3, so this tier rejects nothing in the current corpus. |
| 6 | `mag_heuristic_kept` / `_rejected` | Backstop. `|Δmag| ≤ 5` keep, otherwise reject. Used only when no other tier fired (typically Tycho-only systems where neither component has Gaia astrometry). Pairs with no usable mags either are kept on the absence-of-evidence-is-not-evidence-of-optical principle. |

Two physical-boundness criteria underpin tiers 3–4, both mechanical:

- **Separation limit (tier 3).** Bound stellar pairs can't exceed the
  Galactic tidal-disruption limit for field binaries (~1 pc); a wider 3D
  separation is a line-of-sight optical double. The gate compares the
  pair's own two components against each other (not a cross-pair anchor),
  so a real inner binary of an optically-projected member — both
  components at the same true distance — is kept. Radial separation is
  counted only when the parallax difference clears the combined-error
  threshold, which keeps a HIP2-vs-Gaia systematic (AU Mic B/C's 0.89 pc
  apparent gap) from splitting a bound pair.
- **Escape velocity (tier 4/5).** A bound pair needs `v_rel < sqrt(2·G·M/r)`.
  Only the transverse component is measurable (Δpm × distance), so the
  gate is a lower bound and can only reject. Masses come from
  `mass_estimate.py` spectral estimates (~2× uncertain ⇒ ~1.4× on
  v_escape), so the 2.5× safety factor keeps genuine orbital motion
  (v_transverse < v_escape) from tripping it — η Cas AB: v_transverse
  ≈ 2.9 km/s vs v_escape ≈ 8 km/s, kept.

The gates reuse Stage 4's Kepler / parallax-anchor helpers
(`kepler_semimajor_axis_au`, `compute_system_parallax_anchors`,
`first_astrometry_field_per_system`) so the boundness logic stays DRY
with the NSS separation-sanity gate.

The cascade short-circuits — once a tier produces a verdict the lower
tiers don't run. Stage 6 drops pairs classified as optical entirely; the
multiples.tsv emit never sees them. (The exception is the standalone
augmentation pass, which can still emit a SIMBAD-known component whose
parent pair was dropped — see Stage 6.) The separation-limit and
escape-velocity gates depend on the full Gaia DR3 astrometry pull being
current — see [`data/gaia/README.md`](../../data/gaia/README.md) for the
refresh ordering (`build:binaries` regenerates the request list, then
`refresh:gaia-astrometry` re-pulls before the next build).

## Stage 6 — multiples.tsv emit

`scripts/binaries/stage6_multiples.py` projects every Stage 2–5 output
into per-component rows. Canonical column order is
`MULTIPLES_TSV_COLUMNS`:

```
system_id, comp, hip, gaia_source_id, hd,
x_pc, y_pc, z_pc, absmag, ci, spect, name,
source, regime,
resolve_via, astrometry_via, orbit_via, spect_via,
photometry_via, a_via,
orbit_role,
P_days, T_jd, e, a_AU, i_rad, omega_rad, Omega_rad, q, dist_pc,
sep_arcsec, pa_deg, sep_pa_epoch_jd, dmag,
anchor_sep_arcsec, anchor_pa_deg, mag_pri, mag_sec
```

`x_pc/y_pc/z_pc` are emitted at the **J2016.0** scene epoch:
`_position_pc` PM-propagates each component's direction from its native
epoch (`ComponentAstrometry.ref_epoch` — Gaia J2016.0, HIP2 J1991.25,
AT-HYG J1991.25) to `CATALOG_SCENE_EPOCH`, mirroring the single-star
cascade in `scripts/catalog/direction-cascade.ts`. This keeps a promoted
secondary's baked xyz on the same epoch as its primary so the static
relative sep/PA is the pair's true J2016.0 geometry, not corrupted by
(epoch gap × systemic PM). See `data/README.md` § Reference epoch.

`hd` carries the HD number from the component's AT-HYG row, with the
pair primary falling back to the coord-validated ORB6 entry's HD
(stashed on the Stage-2 `ResolvedComponent`). It is the join key for
`build-catalog.ts`'s identifier backfill on HD-only AT-HYG systems
(ξ UMa — see `scripts/catalog/README.md` § Companion promotion);
counted `multiples_hd_populated`. Two other Stage-6 accounting
mechanisms guard silent drops: WDS summary rows duplicated on
(wds_id, discoverer, components) are collapsed at the parse boundary
(`dedup_wds_pair_rows`, most-observed row wins — Pismis 24 CD carried
two contradictory geometries; counted
`wds_duplicate_pair_rows_dropped`), and Stage-5-kept pairs with no
astrometry and no system anchor — which never reach the TSV — are
counted `multiples_pairs_dropped_no_position` with a capped
`log_dropped_pair_sample` build-log sample, mirroring the Stage-5
separation-limit audit line.

The last four columns carry WDS pair geometry — populated on both
component rows of a decomposing pair (standalone rows leave them
empty). `parse_wds_sep_pa` translates two WDS sentinels to None at the
parse boundary so neither reaches downstream consumers. -1 is the
no-measurement sentinel (spectroscopic / interferometric inner pairs
given only at the orbital-element level, Spica) written in both ρ and
θ, so `sep_arcsec` and `pa_deg` both empty. 999.9 is the field-width
overflow marker (ultra-wide pairs whose ρ can't localise the secondary);
only the ρ field overflows, so `sep_arcsec` empties while `pa_deg` keeps
its real angle. Left unhandled the 999.9 ρ baked Alsephina F at
999.9″ × 24.7 pc ≈ 24,695 AU. They feed
companion-promotion's tangent-plane projection for the Tier-3
(no-orbit) path and the runtime binaries.bin sep+PA fields. `sep_pa_epoch_jd` records the
WDS observation year (`date_last`) converted to JD via
`wds_year_to_jd`; the runtime `BinaryOrbitField` baselines orbital
animation at this epoch (ΔR(t) = R(t) − R(sep_pa_epoch_jd)) so the
stored placement is reproduced exactly at its measurement date.
`dmag` is the published apparent Δmag
(`mag_sec - mag_pri`) used to impute the companion's absmag when
the secondary row inherits its parent's AT-HYG photometry.
`mag_pri` / `mag_sec` carry the pair row's WDS apparent magnitudes
themselves (both rows; a row's OWN mag is `mag_pri` when it is the
pair primary) — promotion's `wds_mag` absmag path anchors a minted
member's brightness on its own WDS magnitude at the system distance
when neither Δmag path applies.

`anchor_sep_arcsec` / `anchor_pa_deg` carry each component's best WDS
offset from the SYSTEM ANCHOR letter (the most canonical kept-pair
primary token, matching the WDS-root anchor companion promotion
resolves), composed by `compute_anchor_offsets` over a BFS of the
system's pair geometry. A direct measured anchor→component edge
(kept, then Stage-5-rejected) wins over any composed chain — a
blended member sits within measurement error of the anchor, so a
chain through a distant third star cancels to ~zero (Acrux: AC ∘ CB
≡ 0 vs the honest rejected-AB 3.5″); chains then fill in tier order
kept → +rejected → +compound-photocentre-proxy. Rejected rows
contribute geometry only — the pair itself stays dropped; a sep+PA
measurement is real astrometry regardless of boundness
classification. Blank when no chain reaches the component. Consumed
by companion promotion's pair-row-primary escape (see
`scripts/catalog/README.md` § Companion promotion).

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
- **Renderable-element finalization.** After the q backfill,
  `finalize_renderable_elements` backstops the quantities the runtime's
  `has_orbit` contract requires, for the NON-VISUAL orbit routes only
  (`ESTIMATED_ELEMENT_ORBIT_VIAS` = gaia_nss + orb6_spectroscopic —
  those pairs are sub-resolution, so an estimate can only add motion,
  never contradict a measured WDS placement; estimating for visual
  pairs would widen the baked-vs-R(epoch) disagreement ratchet in
  `multi-star-regression.test.ts`): `q` ←
  `UNKNOWN_COMPANION_MASS_RATIO_Q` (⅓ — companion at half the
  primary's mass) when no catalog value and no spectral estimate
  exists; `ω` ← π/2 (`CIRCULAR_ORBIT_OMEGA_RAD`) when the fit is
  exactly circular and publishes none — degenerate, not missing, and
  π/2 puts conjunction at T₀ per the eclipser minimum-epoch
  convention; `a_AU` ← Kepler `a³ = M_total·P²` with
  `M_total = M₁/(1−q)` from the primary's spectral-table mass when the
  orbit source published no relative semi-major axis (every NSS
  solution type; ORB6 rows whose a″→AU conversion lacked a parallax).
  The `a_via` column carries the provenance: `catalog` (orbit source
  published it), `kepler_mass_estimate`, or `none`. SCIENCE.md
  § Multiple-star pipeline carries the error analysis (a ∝ M^⅓).

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

The `absmag` / `ci` columns resolve with provenance in `photometry_via`:
`athyg_own` (the component's own AT-HYG row); `athyg_system_inherited`
(the AT-HYG row is the system primary's, shared via a single HIP entry —
promotion switches to Δmag imputation); `gaia_photometry` (no AT-HYG
row, but the component's own Gaia 5p source carries G + BP/RP + parallax,
so `gaia_photometry_absmag_ci` derives `M_V` from `M_G − (G−V)` and `ci`
from `BP−RP → T_eff → B−V`); `none` (no photometry source). The
`gaia_photometry` path is gated on `astrometry_via = gaia_5p` over the
post-exclusion Gaia astrometry map, plus a partner-share check: when
Stage 2's blend-identity propagation put the partner's source on this
component (both rows carry one source) AND the partner is AT-HYG-backed,
the derivation is suppressed — the partner already carries the system
light, so deriving here would mint a twin. A symmetric blend (neither
component in AT-HYG) still derives the source's COMBINED magnitude;
companion promotion's blend-split post-pass divides it across the
collocated records the source backs (see `scripts/catalog/README.md`
§ Companion promotion). It recovers the ~3.5k own-DR3 companions that
would otherwise drop at promotion for a blank absmag; see SCIENCE.md
§ Multiple-star pipeline (companion promotion) for the transforms and
source citations.

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
