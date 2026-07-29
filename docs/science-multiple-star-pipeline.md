# Multiple-star pipeline

Split out of `SCIENCE.md` § Multiple-star pipeline — the science
side (detection philosophy, blend-split math, worked examples). The
engineering side (layered strategies, file roster) lives in
`scripts/catalog/README.md` and `scripts/binaries/README.md`. Spans
`scripts/catalog/`, `scripts/binaries/`, `data/wds/`.

AT-HYG's classic-IDs subset is a single-row-per-system table. Bright
multi-component systems collapse into one row — the brighter primary's
HIP / HD entry — and the visually-distinguishable secondaries
(Sirius B's white dwarf, α Cen B, Procyon B, Algol B/C, every
component of Castor, η Cas, ξ UMa, ζ Cnc, the Trapezium) are absent.
Recovering binary-pair geometry on top of AT-HYG therefore needs an
external pipeline keyed off catalogues that resolve every component
individually.

The architectural consequence of the data-fidelity principle stated in
`SCIENCE.md` § Scope principles is two-fold: **prefer official source-ID
cross-walks over position-based matching whenever the cross-walk
exists**, and **default to the generalised solution, not famous-star
carve-outs + heuristic fallbacks**. Position-based matching fails
systematically on exactly the famous bright close binaries: Gaia's
published 5-parameter PM for Sirius, α Cen, Castor, Algol, Procyon is
corrupted by orbital wobble, so backward-propagating it to J2000 lands
them tens of arcsec off their WDS positions and any position-based
cross-match misses them.

## Architecture

Five layers feed the binary-system pipeline; the boundary between them
is intentional so each can evolve independently as upstream catalogues
update.

**Layer 1 — committed reference data.** Frozen under `data/` per the
freshness policy in `scripts/README.md` § Frozen external data:

- **Washington Double Star Catalog (WDS)** + **Sixth Catalog of Orbits
  of Visual Binary Stars (ORB6)** — Mason et al. 2001, *AJ* 122, 3466
  (WDS); Hartkopf, Mason & Worley 2001, *AJ* 122, 3472 (ORB6).
  Maintained at the U.S. Naval Observatory and Georgia State
  University. Provides ρ/θ separations, position angles, component
  magnitudes, spectral types, HIP/HD cross-IDs (WDS) and full visual
  orbital element fits (P, T, e, a, i, ω, Ω) for ~4k systems (ORB6).
- **Hipparcos van Leeuwen 2007 reduction** — van Leeuwen 2007,
  *A&A* 474, 653, DOI 10.1051/0004-6361:20078357. VizieR I/311/hip2.
  Improved Hipparcos astrometry; the long-baseline PM fallback for
  bright-binary Gaia contamination.
- **CCDM-keyed Hipparcos visual-doubles flag** — Hipparcos main
  catalogue `CCDM` + `MultFlag` columns, as described in `SCIENCE.md`
  § Data sources.
- **Gaia DR3 cross-walks** — `gaiadr3.hipparcos2_best_neighbour`,
  `gaiadr3.tyco2tdsc_merge_best_neighbour`, queried per Gaia
  Collaboration et al. 2023, *A&A* 674, A1,
  DOI 10.1051/0004-6361/202243940. Committed as
  `data/gaia/gaia_dr3_hip_xmatch.tsv` + `gaia_dr3_tyc_xmatch.tsv`.
- **Gaia DR3 5-parameter astrometry** — `gaiadr3.gaia_source`,
  queried for the deduped source_id list the WDS resolution stage
  produces. Per-source RA/Dec/parallax/PM with errors and ref_epoch
  J2016.0; ~99% coverage on resolved WDS components. Committed as
  `data/gaia/gaia_dr3_astrometry.tsv`.
- **Gaia DR3 NSS two-body orbits** — `gaiadr3.nss_two_body_orbit`,
  the non-single-star catalogue, with Thiele-Innes orbital fits
  (Halbwachs et al. 2023, *A&A* 674, A9,
  DOI 10.1051/0004-6361/202243969). Covers the period regime
  P < ~3 yr / sub-arcsec separation where Gaia's astrometric mission
  detects orbits directly. Committed as
  `data/gaia/gaia_dr3_nss_two_body.tsv`.
- **SIMBAD WDS↔Gaia DR3 cross-IDs** — curated by CDS Strasbourg from
  SIMBAD's `ident` and `basic` tables (Wenger et al. 2000,
  *A&AS* 143, 9, DOI 10.1051/aas:2000332). Per-component cross-IDs
  between WDS pair identifiers (`WDS J<id><comp>`) and Gaia DR3
  source_ids. The principled cross-identification path for
  sub-arcsec sub-components ORB6 doesn't enumerate (η Cas A/B/C,
  ξ UMa A/B, ζ Cnc A/B/C, α Cen A/B/Proxima). Committed as
  `data/simbad/simbad_wds_xids.tsv`.
- **SIMBAD per-component spectral types** —
  `data/simbad/simbad_sptype.tsv`. SIMBAD curates per-component
  MK sp_type strings free of variability-type contamination (the
  schema separates sp_type from object-type `otype`), so a
  mixed-class pair like Sirius A0V + DA1.9 surfaces both spectra
  rather than AT-HYG's single inherited "A0V+DA" string.
- **Pulkovo MSC** — Tokovinin 2018, *ApJS* 235, 6 (author-updated
  VizieR copy, `J/ApJS/235/6`), committed as `data/msc/`. Curated
  ≥3-component hierarchies: compiled orbits for spectroscopic
  subsystems ORB6 and Gaia NSS never cover (AR Cas Aa,Ab; ν Sco
  Aa1,Aa2), per-component spectral types, and pair-side V magnitudes
  for sub-resolution pairs. Full source entry in `SCIENCE.md` § Data sources.
- **Curated per-component spectral types** —
  `data/binaries/component_sptype_overrides.tsv`. Literature MK
  types for spectroscopic sub-components no machine source
  enumerates (SIMBAD has no object for Algol Aa2): Algol Aa2 K0IV
  (Kolbas et al. 2015, MNRAS 451, 4150), δ Vel Ab A4V (Mérand et
  al. 2011, A&A 532, A50), σ Ori Ab B0.5V (Simón-Díaz et al. 2015,
  ApJ 799, 169), Castor Ab/Bb late-K / early-M (Stelzer & Burwitz
  2003, A&A 402, 719). Top tier of the Stage 6 spectral cascade;
  each entry cites its source in the file.

**Layer 2 — manual-run refresh scripts.** One per dataset, idempotent,
**not** wired into `pnpm run build`. Per the freshness policy: external
catalogues update on their own clock (Gaia DR3 → DR4 transition window;
WDS rolling daily; HIP2 frozen; SIMBAD rolling continuously), and
freezing the inputs at commit time keeps the build reproducible long-
term. All scripts share `scripts/refresh/refresh_lib.py` (TAP client
+ retry + batching + schema validation); SIMBAD pulls share
`scripts/refresh/simbad/` (specs / inputs / query / TSV plumbing).

**Layer 3 — catalogue builder.** `scripts/binaries/build-binaries.py`
orchestrates seven stages with explicit per-component provenance.
See `scripts/binaries/README.md` for the engineer-level walk-through; the
astronomer-relevant summary:

1. **Load** WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2 + Gaia
   cross-walks + Gaia astrometry + Gaia NSS + SIMBAD WDS xids +
   SIMBAD per-component spectra into identifier-keyed indices.
2. **Resolve each WDS component to a Gaia DR3 source_id** via a strict
   priority cascade. ORB6's published HIP wins where it has one;
   AT-HYG-native gaia field (HIP-mediated) is next; SIMBAD's curated
   per-component WDS cross-ID is the principled fallback for
   sub-arcsec components; CCDM-sibling HIP position-match handles
   systems CCDM enumerates that the prior tiers missed; AT-HYG
   position-match (PM-propagated to J2000) is the final fall-through.
   ~99% of decomposing WDS pairs resolve at least one component
   through this cascade; the residual unresolved fraction is
   dominated by Aitken-only Tycho doubles with no Gaia coverage at
   all. ρ = 0 sub-resolution pairs (spectroscopic / interferometric
   companions WDS lists without a measured separation) follow the
   blend convention: no instrument separates the photocentre, so a
   secondary that bound nothing of its own inherits the primary's
   identifiers — the same convention WDS itself exhibits when it
   lists Castor's CIA 29 Aa,Ab with one HIP on both sides. Position
   matching is skipped for these pairs: with ρ = 0 the predicted
   secondary position degenerates onto the primary's own coordinate
   and a nearest-neighbour pick can only coin-flip onto a sibling
   component's identity.
   The pipeline also **synthesizes sub-pairs WDS never enumerates**:
   ORB6 carries ~30 orbit fits keyed to component pairs (64 Psc
   Aa,Ab, Castor Ca,Cb = YY Gem via a curated component mapping)
   with no WDS_SUMM row, and Gaia NSS carries ~500 two-body
   solutions belonging to one component of a wider resolved pair.
   Each gets a synthesized pair row so the orbit has a place to
   live; the components inherit the carrier's identifiers per the
   blend convention.
   Because the cascade fills gaps but never *reconciles* conflicts,
   different tiers can bind one Gaia source to two component letters
   that WDS geometry places at measured different separations — a
   physical impossibility (a source cannot be two stars at two
   separations). A **binding-integrity** pass audits every system for
   this: it composes the predicted tangent-plane offset of each
   contested letter from an uncontested reference letter along the
   chain of WDS ρ/θ measurements, compares it against the source's
   actual Gaia offset, and unbinds the letters geometry refutes,
   keeping the one the source actually sits on. When the two letters
   are the two sides of a *measured close pair* Gaia blended into one
   photocentre (Castor A/B at ~5″, both saturated), the source
   genuinely represents both and the arbitration abstains — the source
   stays bound and the blended-away member is placed by the downstream
   slot-minting machinery, exactly as for a spectroscopic blend. This
   re-homes companion relations the writer would otherwise collapse
   onto the wrong star (an ORB6 HIP mis-attributed to a sub-component
   put σ CrB's C and 13401-6033's Ca,Cb on the wrong sibling).
3. **Attach the most-trustworthy astrometric measurement** per
   component. Priority: Gaia DR3 5-parameter where the fit is clean
   (`ruwe ≤ 1.4` AND `ipd_frac_multi_peak ≤ 2%`); Gaia NSS
   centre-of-mass when the 5p is orbit-corrupted AND the source has
   an NSS row; HIP2 long-baseline when the system has any close
   companion (ρ ≤ 5″) AND Gaia-vs-HIP2 PM disagrees by >50 mas/yr on
   either axis (Hipparcos's J1991.25 measurement averages a different
   window of the orbit). Bright Gaia-saturated primaries with no
   Gaia source at all (Sirius, α Cen, Procyon, Algol) take HIP2 by
   construction.
4. **Select orbital elements per system.** ORB6 visual orbits
   (grades 1–5: definitive → indeterminate) win where present —
   ORB6's semi-major axis is the genuine relative A–B orbit. Gaia
   NSS covers the rest of its astrometric-detectability regime
   (period < ~3 yr OR apparent photocentre semi-major axis < 1″) —
   95.8% of DR3 NSS rows pass the period gate, plus the sub-arcsec
   long-period tail through the TI algebra. An NSS orbit describes
   the SOURCE's own two-body motion, so it only attaches to a pair
   whose partner shares the blended source (or carries none):
   when the partner is a different resolved star, the orbit belongs
   to the carrying component's own unseen companion and attaches to
   the synthesized inner pair instead — before this gate, a 4-day
   SB1 period could be stamped onto a centuries-period visual pair.
   The Thiele-Innes → Campbell algebra recovers
   (a0, i, Ω, ω) from NSS's stored (A, B, F, G) quartet via the
   Heintz 1978 / Halbwachs+ 2023 Appendix C closed form, inlined
   rather than imported from ESA's unmaintained NSSTools package —
   but the TI fit tracks the photocentre, so a0 = |q − β|·a_rel
   underestimates the relative separation by the mass-vs-flux
   fraction gap (and its ω is the photocentre's, π away from the
   relative orbit's when the primary carries most of the flux).
   ORB6 non-visual orbits (grade 8 interferometric-visibilities,
   grade 9 astrometric / spectroscopic, and the undocumented grade 7
   the catalog uses for photometric / eclipsing fits — YY Gem,
   EQ Tau, BX And) come next; Pulkovo MSC compiled orbits come last
   and attach to sub-resolution pairs only — MSC compiles from the
   same primary literature the routes above curate, so it never
   overrides them, and a pair with a measured WDS placement never
   acquires a compiled orbit it wasn't fit to.

   **Estimated scale for spectroscopic orbits.** No NSS solution
   type publishes a relative semi-major axis, and RV / eclipse
   photometry cannot constrain one — so for the non-visual routes
   the pipeline estimates it from Kepler's third law,
   a = M_total^⅓ · P_yr^⅔ AU, with M_total = M₁/(1−q) from the
   primary's spectral-class mass (Cox 2000 §15.2 / Pecaut & Mamajek
   2013, the same tables the q backfill uses; 1 M☉ when the type is
   unparseable). Where no mass ratio is derivable the companion is
   assumed at half the primary's mass (q = ⅓, near the SB1
   mass-ratio distribution's mode). Both estimates enter a ∝ M^⅓,
   so even a factor-2 mass error moves the rendered orbit scale by
   only ~26% — far better than not animating a measured period at
   all, and tagged `a_via=kepler_mass_estimate` in multiples.tsv so
   every estimated axis is auditable. Exactly-circular fits (e = 0)
   that publish no ω — periastron is undefined on a circle — get
   ω = π/2, which places conjunction (the eclipse, for edge-on
   systems) at the fitted T₀, matching the minimum-epoch convention
   eclipser ephemerides use. ORB6 *visual* orbits get none of these
   estimates: their pairs carry real measured placements, and a
   guessed mass ratio would move a rendered pair off its published
   geometry.
5. **Classify each pair as physical or optical** via a tiered
   cascade — WDS Notes flag chars confirm or reject directly when
   set; the orbit-on-file override keeps pairs Stage 4 produced real
   orbital elements for (Sirius A-B, Procyon A-B with their
   white-dwarf companions); the separation limit rejects pairs more
   than ~1 pc apart in 3D; both-components-Gaia parallax (3σ on
   combined error) and escape-velocity checks are next; the
   asymmetric-Gaia gate handles Sirius A-C/D/E/F shaped cases where
   only the secondaries carry Gaia and the primary's HIP2 parallax is
   the anchor; the WDS epoch-baseline CPM test rejects background
   stars a high-proper-motion primary slid past (61 Cyg AH) when the
   secondary's distance is inherited; the mag-gap heuristic backstops
   the residual Tycho-only systems.
6. **Emit `data/binaries/multiples.tsv`** — two rows per kept
   physical pair (+ standalone rows for SIMBAD-known components the
   pair walk didn't reach), with explicit per-component provenance
   columns recording which tier of each cascade above decided.
   Spectral type resolves curated → SIMBAD per-component → MSC
   pair-side → AT-HYG per-system inherited; mass ratio `q` rides through
   from Gaia NSS / SB2 spectroscopy where present, with per-class
   mass-table backfill from Cox 2000 §15.2 / Pecaut & Mamajek 2013
   for visual orbits without spectroscopy.
7. **Assert against snapshots.** Per-stage counts gate
   `build-binaries-expected.json`; per-strategy rates gate
   `build-binaries-rates-expected.json`. A regression in either
   surfaces in the build log as a per-key diff and refuses to
   advance. Refreshes are explicit (`UPDATE_BUILD_COUNTS=1`); silent
   drift is impossible.

**Layer 4 — validation harness.** Three tiers covered in
`scripts/binaries/README.md`: a hand-curated Tier A known-stars corpus
(`scripts/catalog/validate/known-stars.tsv`) the binary catalogue must
reproduce; population-statistic Tier B snapshots
(`build-binaries-expected.json` +
`build-binaries-rates-expected.json`); a stratified random 10k SIMBAD sample
Tier C cross-checker (`validate-simbad-sample.ts` + the
`distance-regression-check.ts` build-time subset that surfaces in
`build-distance-outliers-expected.json` with hand-edited reasons).

**Layer 5 — documentation.** This file (astronomer audience —
sources, physics, decisions); `scripts/binaries/README.md` (engineer audience
— functions, thresholds, provenance fields); `scripts/README.md`
(formats — v9 byte plan, name table, search index).

## Blank-components tail — full ingest deliberately cut

73% of WDS rows (114,933) leave the `components` field blank (an
implied single A,B pair). The rescue tier ingests the high-confidence
subset (an ORB6 orbit or a SIMBAD xid anchors the system —
`scripts/binaries/README.md` § Blank-components rescue); the remaining
~112.8k-row tail was instrumented before deciding whether to ingest it
wholesale (`scripts/binaries/probe-blank-components-tail.py`):

- 22.0% of the tail resolves ≥1 component through the Stage-2 cascade,
  but overwhelmingly primary-only (21.7%) via position/CCDM matches —
  the population deferred as mostly wide optical doubles that would
  survive only on the Stage-5 mag-gap backstop.
- Only 1,269 pairs (1.1%) resolve distinct Gaia sources on BOTH ends —
  the subset Stage 5 can honestly 3D-vet.

Full ingest is cut: ~88k rows resolve nothing and would ride Stages
2–7 as dead weight, and the anchored-but-one-sided majority would
inflate the catalogue with unvettable pairs at ~3.7× the decomposing
volume. The narrow distinct-Gaia-both-ends second rescue tier (~1.3k
pairs) is tracked as its own follow-up.

## Worked examples

- **Sirius A-B.** Sirius A is Gaia-saturated (HIP 32349, no DR3
  source_id; ~378 mas via HIP2). Sirius B (the famous DA1.9 white
  dwarf, ~50× fainter at V) resolves to a Gaia DR3 source via
  SIMBAD's WDS xids side-file. The pair has a grade-2 ORB6 visual
  orbit (P = 50.13 yr), so Stage 4 produces real elements; Stage 5's
  optical-pair filter routes through the orbit-on-file tier and keeps
  the pair despite the 9.9-mag photometric gap. Sirius A's HIP2
  astrometry rides through Stage 3's Gaia-saturated branch into
  multiples.tsv; Sirius B's Gaia 5p astrometry rides through the
  default tier. Both components emit per their own spectral type
  (SIMBAD: A0V + DA1.9), not the inherited AT-HYG "A0m+DA" string.
- **α Cen A-B + Proxima.** Both A and B are Gaia-saturated; both
  carry HIPs (71683, 71681) but no DR3 source_id. SIMBAD's WDS xids
  bind the HIPs per-component; Stage 3 routes both through HIP2
  long-baseline (5″ companion gate engages on the AB pair). Proxima
  (HIP 70890) is the wider WDS member and resolves to its Gaia
  source via AT-HYG-native; its Gaia 5p astrometry rides through.
  Phase 5 will eventually derive the AB orbital geometry from the
  ORB6 grade-1 visual orbit (P = 79.91 yr, the canonical reference
  fit).
- **Algol.** β Per A-B-C is the classic eclipsing binary at
  ~28 pc. The inner AB pair has a Gaia DR3 NSS Eclipsing solution
  recovered from RVS spectra; Stage 4 routes through `gaia_nss` and
  reads inclination + arg_periastron directly from the NSS columns
  (eclipsing types don't constrain `a` from photometry alone). The
  wider AC pair takes the ORB6 visual orbit. Stage 5 keeps both
  pairs through the orbit-on-file override despite the magnitude gap
  to the C component.
- **Castor — the sextuple showcase.** WDS enumerates the AB visual
  pair (grade-3 ORB6, P = 459 yr) and both spectroscopic sub-pairs
  Aa,Ab (P = 9.21 d) and Ba,Bb (P = 2.93 d) as CIA 29 rows with
  published interferometric semi-major axes. The third pair —
  Castor C = YY Gem, the eclipsing M-dwarf twin pair at
  P = 0.814 d — exists in ORB6 only under its variable-star name
  with a blank components field, so a curated mapping
  (`data/binaries/orb6_component_overrides.tsv`) keys it to Ca,Cb
  and the pipeline synthesizes the pair row WDS lacks. ORB6's
  eclipse fit gives P and i = 86.5° but no semi-major axis; the
  Kepler estimate from two M0.5Ve table masses (Torres & Ribas
  2002: 0.599 + 0.601 M☉) lands at 0.0171 AU vs the published
  0.0182 AU. All six components render, three inner pairs animate,
  and YY Gem's eclipses come from real orbital geometry.
- **HIP 25733 — a Bailer-Jones refinement case.** AT-HYG's `dist_src`
  marks this row's catalogued 14.3 kpc as a Gaia DR3 inverse-parallax
  estimate (`G_R3`) with low S/N; Bailer-Jones's photogeometric
  posterior pulls it back to ~5–7 kpc. This is the dominant failure
  mode the B-J Layer 1 override is designed to rescue and is one of
  the cases the Vaidman 2025 validation harness pins.
- **An LMC supergiant — e.g. HDE 268743 / R 90, S Dor analogue.**
  AT-HYG's `dist_src = G_R3` plus a low-S/N Gaia parallax routes it
  through B-J first, which lands somewhere intermediate (5–20 kpc;
  B-J's smooth Galactic-density prior has no LMC). The LMC kinematic
  override fires on the second pass — sky-cone match + PM within
  ±0.5 mas/yr of (μ_α* = 1.85, μ_δ = 0.20) — and snaps `dist` to
  Pietrzyński 2019's 49.594 kpc. The bounded-scope cutoff then keeps
  it (49.594 kpc < 50 kpc); without the LMC layer it would either
  have been dropped or rendered as a Galactic foreground star at a
  catastrophic intermediate distance.

## Catalog-side binary detection

The Phase 3 build (`scripts/catalog/build-catalog.ts`) does its own
binary flagging at the single-star catalogue level — independent of
the WDS/ORB6 pipeline above and serving a different purpose. Both
sources OR onto the same `flags` bit so the chart-mode wings glyph
surfaces either, but neither pretends to recover orbital geometry.

**Geometric pass.** Spatial nearest-neighbour pass at separation
`BINARY_MAX_SEP_PC = 0.005 pc` (≈1030 AU). Rationale: at the
renderer's `minDistance = 0.005 pc` orbit, anything farther than that
subtends >45° from the camera — it wouldn't fit the viewport as a
visual "system". Yields only ~14 pairs from the classic_ids subset —
the brighter primary of most visual doubles has a classical ID, but
the secondary often doesn't, so the geometric pass can only see the
α Cen-style cases where both components survive the cut. Each side
stores the other's row index in `companionIdx`.

**CCDM + MultFlag HIP-keyed cross-match.** Hipparcos's `CCDM`
column links each HIP to the Catalog of the Components of Double
and Multiple stars (Dommanget & Nys 1994). CCDM alone is too
permissive — it tags wide line-of-sight optical pairs Hipparcos
didn't confirm — so the build script gates it with `MultFlag`,
keeping only `C` (component), `G` (resolved-in-field), and `O`
(orbit known) entries. A small curated `KNOWN_VISUAL_DOUBLES` set
in `scripts/catalog/multiplicity/visual-doubles.ts` recovers canonical visual
doubles Hipparcos modelled as single stars (Polaris, ε¹ Lyr,
61 Cyg A/B). Together with the CCDM pass this surfaces Sirius,
Mizar, Castor, α Cen, Albireo, γ And, ε Lyr, 70 Oph, Procyon,
Algol, etc. that the geometric pass misses. No `companionIdx` is
assigned — the secondary is usually not in the classic_ids subset,
and the renderer's zoom-fit code already guards on
`companion ≥ 0`.

The full WDS+ORB6 pipeline above (multiples.tsv) is the source of
truth for per-system orbital geometry. The catalog-side passes
consume it in two complementary ways:

1. **Companion promotion.** `scripts/catalog/companions/companion-promotion.ts`
   reads multiples.tsv and promotes the secondary of every physical
   pair whose identifier isn't already in AT-HYG into a first-class
   catalog.bin record. Position comes from the row's own Gaia 5p
   astrometry when available, otherwise from a sky-plane tangent
   projection of the primary's xyz using the published WDS sep + PA;
   absmag is imputed from the primary's AT-HYG absmag plus the WDS
   Δmag when the row inherits its parent's photometry. Promoted
   companions ride catalog.bin with `FLAG_BINARY_COMPANION_ONLY`
   set; the renderer / picker / hover / focus stack picks them up
   with zero code change.

   **Blended-away members and rejected-pair geometry.** A component
   whose only identifiers are a sibling's (Gaia/Hipparcos fit one
   photocentre over the pair) has no catalog record of its own even
   when it is a bright, physically distinct star — Acrux B (V ≈ 1.6)
   shares HIP 60718 with A. Promotion mints a slot for it and places
   it by its Stage-6 per-component offset from the system anchor,
   composed over the system's WDS ρ/θ measurements. Placement may
   consult geometry from Stage-5-REJECTED pair rows: a measured
   sep + PA is real astrometry regardless of how the boundness
   classifier judged the pair (Acrux AB's `U` note flag rejects the
   *pair*, not the measurement), so the rejected row's geometry
   places the member while the pair itself stays dropped. The minted
   record sits at the anchor's distance — no better distance exists
   anywhere for a component with no parallax of its own.

   **Blend light conservation.** A minted member's brightness comes
   from the WDS pair row's own published magnitudes (`wds_mag`:
   `M = m − 5·log₁₀(d_pc/10)` at the system distance) or from the
   anchor's magnitude plus the WDS Δmag. Its light is inside the
   anchor's magnitude only when the catalogue that produced that
   magnitude fit one photocentre over the pair — which is a property of
   that catalogue, not of the pair: a printed Hipparcos V holds one
   value per entry and so blends everything Hipparcos could not split,
   while a V transformed from Gaia G excludes any component Gaia gave
   its own source_id (HD 18455's Riello V is component A at 8.04, not
   the AB blend SIMBAD prints as 7.33). Where the light IS inside, the
   anchor dims so total system light stays what was measured. For
   Δmag-imputed
   members the pair is re-split jointly:
   `M_A = M_blend + 2.5·log₁₀(1 + 10^(−0.4·Δm))`, `M_B = M_A + Δm` —
   exact flux conservation for any Δm, reducing to "anchor barely
   dims" for a faint companion (Sirius B shifts A by 10⁻⁴ mag) and to
   an equal split at Δm = 0. This matters most for near-equal pairs:
   the naive alternative (subtract the member's `M_blend + Δm` flux)
   dumps the imputation bias onto the anchor and guts it (Capella
   −0.51 → +2.1); the joint split instead lands both components on
   their true values (Capella Aa → 0.19 vs canonical 0.14, Castor A →
   0.97 vs 0.96 from V = 1.93, 36 Oph A → 6.21 vs 6.20 from V = 5.07 —
   the AT-HYG magnitudes those records carried were blend photometry).
   For `wds_mag` members the member's brightness is independent, so
   its flux is subtracted directly (Acrux: A −4.21 blend →
   A′ = −3.48 + B = −3.43), guarded against a member as bright as the
   blend itself.

   **Gaia-photometry brightness for own-DR3 companions.** A companion
   that earned its own Gaia DR3 5p fit (position + parallax) but has no
   AT-HYG row carries no absmag through the AT-HYG path and — with no
   Δmag or per-component spectral type either — was dropped at promotion
   for want of a brightness. Its Gaia row does carry G + BP + RP, so
   Stage 6 (`scripts/binaries/stage6_multiples.py`,
   `gaia_photometry_absmag_ci`) derives an honest magnitude and colour
   from the component's own photometry, tagged
   `photometry_via = gaia_photometry`, which promotion's "own
   photometry" path then consumes. This recovers ~3.5k companions
   (`companionDroppedNoAbsmag` 6207 → 2553; the residual are
   system-inherited blends of tight inner binaries — no own 5p fit — and
   Gaia-NSS centre-of-mass sources whose G is the blended pair's, both
   deliberately excluded). Derivation:

   - **Absolute magnitude (Johnson V, the catalogue convention).**
     `M_G = G + 5·log₁₀(ϖ_mas) − 10`, then `M_V = M_G − (G − V)` with the
     Gaia EDR3 → Johnson `G − V` cubic in `(BP − RP)` (Riello et al.
     2021, Table 5.7; σ ≈ 0.030 mag, valid −0.5 < BP−RP < 5.0). Raw
     `M_G` is the fallback when BP or RP is missing (~0.3 mag redward
     bias for cool stars, but honest).
   - **Colour (Johnson B−V, the LUT convention).** `BP − RP → T_eff`
     (Montalto et al. 2021 fifth-order polynomial, valid 0.5 < BP−RP <
     5.0) → `B−V` via the catalogue's own Ballesteros (2012) inverse
     (`ballesteros_bv_from_teff`, mirroring
     `scripts/colour/blackbody-lut-pure.ts`). Routing colour through the
     Ballesteros manifold — rather than a direct Gaia→(B−V) fit — keeps
     the stored `ci` round-tripping to the Gaia-implied temperature
     through the same relation the renderer reads
     (`docs/science-stellar-modelling.md` § Star colour calibration),
     so a photometry-recovered companion lands on the same
     colour↔Teff locus as every other star. `ci` is left blank (→ the
     spectral / solar fallback) when BP/RP is absent or BP−RP is outside
     the T_eff polynomial's range.
   - **Extinction.** Both quantities are observed (the Gaia bands are
     reddened), so they carry `photometry_via = gaia_photometry` and are
     de-extincted downstream in build-catalog exactly like any observed
     absmag/ci — never treated as already-intrinsic.
   - **Guard.** Sources in `data/binaries/astrometry_exclusions.tsv`
     (blended photometry, e.g. Sirius B) are removed from the Gaia
     astrometry map at Stage 1, so they never reach this path — their G
     is blended too. The derivation is gated on `astrometry_via = gaia_5p`,
     which excludes inherited-position and NSS centre-of-mass routes. But
     `gaia_5p` alone is not proof of an *own* per-component fit: Stage 2's
     blend-identity propagation copies a partner's source onto a component
     that resolved nothing of its own, so both rows carry one source and
     both tag `gaia_5p`. When that shared source is AT-HYG-backed (the
     partner already carries the system light through the AT-HYG path),
     the derivation is suppressed — otherwise it would mint a twin of the
     partner.
   - **Blend split (shared source, neither in AT-HYG).** When a sub-arcsec
     pair Gaia fit as a *single* 5p source has neither component in AT-HYG
     (YY Gem = Castor Ca,Cb; ~100 pairs), the derived magnitude is the
     source's **combined** light and both components (plus any outer-pair
     row for the same source) carry it — collocated, so the system would
     render ~2× too bright. Companion promotion's blend-split post-pass
     (`companion-promotion.ts`, `companionBlendSplit`) divides the combined
     light evenly across the N collocated records the source backs: each is
     `2.5·log₁₀(N)` fainter than the blend (0.753 mag for a pair). Equal
     split is the honest default — a pair Gaia couldn't resolve is
     near-equal by construction, and it's exact for the equal M-dwarf
     eclipsing pairs that dominate; the mass-ratio `q` on these rows is the
     ⅓ pipeline placeholder, not a measured flux ratio, so a q-weighted
     split would fabricate skew. Total system light is preserved exactly;
     `ci` stays the shared (combined) colour.

   Sources for the Gaia→Johnson transforms (Ballesteros 2012 cited under
   `docs/science-stellar-modelling.md` § Star colour calibration):

   - Riello, M. et al. (2021). Gaia Early Data Release 3: Photometric
     content and validation. *A&A* 649, A3, Table 5.7 (G−V(BP−RP)).
     https://doi.org/10.1051/0004-6361/202039587
   - Montalto, M. et al. (2021). The all-sky PLATO input catalogue.
     *A&A* 653, A98 (BP−RP → T_eff fifth-order relation).
     https://doi.org/10.1051/0004-6361/202140717

2. **Runtime artifact.** `scripts/binaries/build-runtime-binaries.py`
   emits `public/binaries.bin` — one record per kept physical pair,
   carrying Kepler elements (when known) plus the sep+PA the
   `BinaryOrbitField` uses for per-frame orbital evaluation.
   `public/catalog-row-index-map.json` joins the runtime binary's
   primary/secondary indices back to catalog.bin record indices.

Implementation: `scripts/binaries/build-binaries.py` for the WDS+ORB6
pipeline (engineer walk-through in `scripts/binaries/README.md`);
`scripts/binaries/build-runtime-binaries.py` for the runtime artifact;
`scripts/catalog/build-catalog.ts` + `visual-doubles.ts` +
`companion-promotion.ts` for the catalog-side passes (see
`scripts/README.md` § Geometric binary inference and § TDSC double-
star cross-match for per-pass detail).

## Intra-system distance coherence

Two bound components measured independently carry parallax noise
larger than their true physical separation: at 50 pc a 2% parallax
error is a full parsec of radial scatter, five orders of magnitude
above a 100 AU pair's real depth. Rendering each member at its own
noisy distance splits the pair along the sightline — invisible from
Sol, but the entire visible geometry once the camera flies near the
system (the camera-anywhere principle in `SCIENCE.md` § Scope principles).

The catalog build therefore snaps the members of every kept-physical
WDS system to a per-system distance anchor
(`scripts/catalog/multiplicity/system-coherence.ts`). The anchor pick is
**purpose-aware parallax tiering**, not recency: a clean unsaturated
Gaia 5p parallax (RUWE ≤ 1.4, ipd_frac_multi_peak ≤ 2%, G ≥ 3) beats
HIP2 everywhere except where Gaia is saturated or binarity-corrupted —
and a member hosting its own unresolved sub-pair never anchors on its
Gaia parallax, because photocentre wobble on periods beyond Gaia's
baseline corrupts the fit without tripping RUWE. Members move
radially only when their parallax gap from the anchor is **not
significant at 3σ** of the combined parallax error — genuinely
measured hierarchy depth (α Cen–Proxima's 0.06 pc; 61 Cyg A/B)
survives; noise collapses. An anchor whose own rendered distance
contradicts its parallax evidence (μ¹ Sco: Bailer-Jones places the
RUWE-corrupted source at 1.7 kpc against HIP2's ~154 pc) disqualifies
the whole system — members keep their own distances rather than
following a bogus anchor. Direction is untouched (mas-accurate
regardless of parallax quality), and absmag + Stefan-Boltzmann radius
follow the distance change so apparent brightness is invariant.
Engineering detail: `scripts/catalog/multiplicity/README.md` § System distance
coherence.

