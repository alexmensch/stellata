# Science — sources, formulas, and modelling decisions

This file is the canonical record of every external dataset that goes
into Stellata, the physics that's applied to it at build and render
time, and the deliberate simplifications made along the way. It serves
two audiences:

- **Claude Code sessions** — when adding or changing anything science-driven,
  read this first to understand the sources, the model in use, and what
  has been explicitly ruled out.
- **Human readers** — a self-contained reference describing what's
  scientifically grounded in the visualisation, and where the simplifications
  live.

Implementation details live in the docs under `docs/`; this file points
into them where relevant.

## Scope principles

Three overarching principles govern how the model is built and which
detail is in scope at which range. Every individual modelling decision
below should be consistent with these.

### Data fidelity — "best possible model based on current observational data and knowledge"

Stellata is a physical-accuracy project, not a stylised visualisation.
The catalog grows in well-defined releases (Gaia DR4 expected late 2026),
not continuously, so one-time data-processing investment pays off forever.
There is no manual review path — 300k+ stars cannot be hand-checked, so
the data-processing infrastructure itself has to be correct.

When scoping data-processing / cross-match / catalog-ingest work:

1. **Default to the hard upfront generalised solution, not a famous-
   star carve-out + heuristic fallback.** The "tier just beyond the
   famous ones" is always the trap — solve the class of problem, not
   the visible exemplars. If "the system would need 20 hand-curated
   overrides" the system is wrong, not the data.
2. **Prefer official source-ID cross-walks** (HIP numbers, Gaia source
   IDs, NSS catalogs, SIMBAD identifiers) over position-based matching
   when the cross-walk exists. Position-based matching is the fallback,
   not the primary strategy.
3. **Hand-curated overrides** (e.g. `data/local-group/overrides.tsv`)
   are acceptable only for truly singular edge cases where no canonical
   source resolves them, or for objects a catalog excludes by
   construction (M31, M33 in LVDB's `dwarf_all`) — not as a substitute
   for systematic data engineering.
4. **Ship-less-accurate-now vs ship-more-accurate-later: prefer the
   latter for catalog/data work.** UX and rendering polish can iterate;
   the catalog underpinning the model can't be re-shipped without
   re-rendering everything.
5. **All matching/processing must keep working when external catalogs
   upgrade.** When refactoring a cross-match, ask: does this depend on
   hand-tuned values that won't survive a DR4 swap? If yes, the
   refactor isn't done.
6. **Validation matters at scale.** Spot-checking 5 famous stars
   doesn't tell you what's happening at star #150,000. When shipping a
   new processing stage, build a parallel automated check (compare
   against SIMBAD distances for a random sample, etc.) in the same
   change.

### Detail gradient — highest-density measurable info near Earth, simpler model further out

Per-object near, statistical far. When scoping a layer beyond the
AT-HYG catalog reach, prefer statistical / aggregate sources (HiPS-
derived counts, binned populations) over hand-extending per-object
data. Each tier in the catalogue ecosystem (CDS / VizieR / Gaia /
HiPS surveys) earns its keep in a specific distance regime — pick
the one matched to the layer being added rather than the most
familiar.

### Defer detail until zoom affordance

Defer per-object detail rendering (textures, atmospheric haloes,
banding, surface shading, day-night phase, ring systems, exoplanet
bodies) until the user can actually navigate close enough to see it.

Stellata bodies are billboarded discs sized via θ = 2·atan(R/d). At
any host-relative camera distance more than a few thousand body-radii,
every object floor-clamps to the pixel-size minimum and per-detail
differences become invisible. Coding the detail before the user can
perceive it is wasted effort and wasted bundle.

When scoping a new visual layer, ask first: at what camera-to-object
distance is this detail perceptible? If the answer is closer than the
user can navigate to under existing focus + minDistance affordances,
defer the detail until the renderer exposes a closer-zoom affordance
(per-planet detail waits on planet focus; per-exoplanet detail waits
on the exoplanet ingest pass) and ship the layer without it. Don't
reach for shader complexity to compensate for a perceptual constraint
that's better fixed by a camera affordance.

Same logic generalises beyond planets — any catalog object rendered as
a billboarded disc has the same regime: detail beyond a single
representative colour earns its keep only when the user can fly close
enough to see it.

## Data sources

- **Gaia DR3** (astrometry, photometry, astrophysical parameters,
  non-single-star orbits): ESA / DPAC, https://gea.esac.esa.int/archive/ —
  Gaia Collaboration, Vallenari A. et al. 2023, *A&A* 674, A1. Licence
  CC-BY-4.0. Per-source ADQL pulls under `data/gaia/`; per-table provenance in
  `data/gaia/README.md`. Three roles the rest of the model rests on:
    - **Sky direction and parallax** — 5-parameter solutions are tier 1 of the
      direction cascade and the input Bailer-Jones inverts (below).
    - **Johnson V** — `G` and `BP − RP` transformed through **Riello M., De
      Angeli F., Evans D. W. et al. 2021, *A&A* 649, A3** § *Photometric
      relationships with other photometric systems* (`G − V` as a cubic in
      `BP − RP`, σ = 0.03017 mag over −0.5 ≤ `BP − RP` ≤ 5.0). Every record's
      absolute magnitude is derived from this V, so it sets what the whole
      scene looks like; DR3 ships EDR3's photometry unchanged, so the EDR3
      calibration applies. Gaia's CCDs saturate below `G` = 4.0, where the
      printed Hipparcos tier below takes over — the bound is calibrated
      against the printed-vs-transformed |ΔV| distribution rather than
      assumed (`scripts/catalog/photometry/README.md`).
    - **Astrophysical parameters** — `gspphot ∪ gspspec` Teff / log g / [M/H]
      feed the spectral resolver and the Stefan-Boltzmann radii.
    - **Synthetic photometry** — Johnson-Kron-Cousins B and V integrated from
      each source's own BP/RP spectrum (`gaiadr3.synthetic_photometry_gspc`,
      **Gaia Collaboration, Montegriffo P., Bellazzini M., De Angeli F. et al.
      2023, *A&A* 674, A33**). B − V from it is the ci cascade's tier below the
      Table-5.9 relation, and unlike that relation it measures the individual
      star rather than fitting a population — which is what lets it serve the
      red rows the relation's colour bound excludes
      (`scripts/catalog/photometry/README.md` § The ci cascade).
- **AT-HYG v3.3** (stellar catalogue): https://codeberg.org/astronexus/athyg
  — maintained by David Nash. **No longer consumed.** Membership is the
  primaries-derived manifest at `data/membership/membership-manifest.tsv`,
  which the record build walks; every field on a record is sourced from a
  first-order catalogue this build pulls itself. What survives of AT-HYG is
  the frozen `data/athyg/inherited-spine.tsv`, read only for its record of
  AT-HYG's merge decisions — which designations name one star, and which Gaia
  source it bound — that no primary supplies. Licence CC-BY-SA-4.0 follows the
  subset it derives from (`data/athyg/athyg_33_classic_ids.csv`). Contract:
  `docs/catalog-driver.md` § 3 and § 3.1.
- **Classic-designation cross indexes** (HD / HR / Bayer / Flamsteed /
  Gliese), the identifier half of the AT-HYG retirement and part of the
  membership term it derives from — four frozen
  VizieR tables under `data/classic-ids/`, joined onto Gaia DR3
  source_ids by `pnpm run build:classic-ids`. Per-table provenance,
  licences and the measured per-identifier coverage are in
  `data/classic-ids/README.md`; the sourcing decision is
  `docs/catalog-driver.md` § 2. Retrieved 2026-07-28, public domain via
  CDS:
    - `IV/25/tyc2_hd` — Fabricius, Makarov, Knude & Wycoff 2002,
      *A&A* 386, 709. HD ↔ Tycho-2, with the upstream `n_HD`/`n_TYC`
      ambiguity flags.
    - `IV/27A/catalog` — Kostjuk N.D. 2004. Bayer + Flamsteed ↔
      HD/HR/HIP (as TAP serves it, the Bayer/Flamsteed-bearing subset).
    - `V/50/catalog` — Hoffleit & Warren 1991, Bright Star Catalogue 5th
      revised ed. HR ↔ HD.
    - `J/A+A/670/A19/cns5` — Golovin, Reffert, Just, Jordan, Vani &
      Jahreiß 2023, *A&A* 670, A19. GJ ↔ Gaia EDR3 source_id ↔ HIP,
      volume-limited to 25 pc.
  Live SIMBAD/VizieR resolution is deliberately **not** used for the
  identifier spine — the build never touches the network, and
  component-level cross-IDs churn between queries.
- **IAU WGSN naked-eye catalogue + faint approved names** (`NEC.csv`,
  9,297 rows; `wgsnFaints.csv`, 132 rows; 2025-05 release under
  `data/iau-wgsn/`): IAU Division C Working Group on Star Names,
  https://exopla.net/iau-wgsn-catalogs/. Retrieved 2026-08-12, licence
  CC-BY-4.0. The naming AUTHORITY of `docs/star-naming.md`: the only
  source with an approval process for star names (509 approved names),
  and the only in-tree source of Unicode Greek Bayer / Flamsteed / Gould
  designations with component attribution. Supersedes the 2022 IAU-CSN
  text file. Normalised + keyed by `pnpm run build:wgsn`
  (`data/iau-wgsn/README.md`).
- **Hipparcos printed V and B − V** (`I/239/hip_main`, `HIP`+`Vmag`+`B-V`
  slice at `data/hipparcos/hip_main_vmag.tsv`): ESA 1997, SP-1200. The
  printed tier of the V-magnitude cascade for stars whose Gaia photometry
  is saturated or outside the Riello+ 2021 transform's validity range,
  and the printed tier of the ci cascade below the synthetic photometry —
  the only measured colour reaching the rows with no Gaia source at all.
  Public domain via CDS.
- **Tycho-2** (`I/259` `tyc2` + `suppl_1`, filtered to the mentioned TYCs
  at `data/tycho2/`): Høg E. et al. 2000, *A&A* 355, L27. Retrieved
  2026-08-25, public domain via CDS. The first-order source for the
  TYC-bearing rows Gaia does not reach — mean positions with **per-star,
  per-coordinate mean epochs**, proper motions, and BT/VT photometry, so
  the direction, PM and V cascades of `docs/catalog-driver.md` § 5 route
  here rather than to any printed cell. It reaches every one of the
  TYC-bearing membership rows; the mean epochs are what fix the
  printed cells' unpropagated staleness (~27″ worst case).
- **Gliese third catalogue of nearby stars** (`V/70A/catalog`, whole table
  at `data/gliese/gliese_v70a.tsv`): Gliese W., Jahreiss H. 1991,
  *Preliminary Version of the Third Catalogue of Nearby Stars*, CDS
  `V/70A`. Retrieved 2026-08-27, CDS/VizieR academic use. Printed Johnson
  V (+ B−V, spectral type, parallax, rv) — the V cascade's tier under
  Tycho-2, and the first-order catalogue every `mag_src=GJ` cell was
  transcribing: over all 16 rows it serves, its `Vmag` reproduces the
  printed cell exactly. CNS5 does not retire it — the newer catalogue
  publishes no Johnson V at all (Gaia `G`/`BP`/`RP`, 2MASS, WISE only).
- **GCVS 5.1** (variable-star catalogue + cross-identification):
  http://www.sai.msu.su/gcvs/gcvs/ — Samus et al, Sternberg Astronomical
  Institute. `data/gcvs/gcvs5.txt` (main file) + `data/gcvs/crossid.txt`
  (Hip/HD/Tyc/etc. → GCVS name mappings). Free for research/educational
  use with attribution.
- **Hipparcos CCDM + MultFlag cross-reference**: VizieR
  `I/239/hip_main`, HIP main catalogue. We commit a three-column
  slice (`-out=HIP,CCDM,MultFlag`) as `data/hipparcos/hip_ccdm.tsv`, used as
  the HIP-keyed visual-doubles flag. CCDM links each Hipparcos
  star to the Catalog of the Components of Double and Multiple
  stars (Dommanget & Nys 1994); `MultFlag` is Hipparcos's own
  multiplicity confidence flag. A star is flagged as a visual
  double when both CCDM is non-blank *and* `MultFlag ∈ {C, G, O}`,
  which keeps Hipparcos-confirmed pairs and rejects CCDM-listed
  optical pairs (line-of-sight chance alignments) that Hipparcos
  did not model. Unlike TDSC there is no bright-star saturation
  gap (Sirius, Mizar, Castor, α Cen, Albireo all carry CCDM IDs
  with confirming `MultFlag`).
- **Washington Double Star Catalog (WDS)** + **Sixth Catalog of Orbits
  of Visual Binary Stars (ORB6)**: Mason et al (2001), AJ 122, 3466
  (WDS); Hartkopf, Mason & Worley (2001), AJ 122, 3472 (ORB6).
  Maintained continuously at the U.S. Naval Observatory and Georgia
  State University. Used to recover binary-pair geometry that AT-HYG
  collapses to a single row: visually-resolved separations ρ and
  position angles θ from WDS, full orbital element fits (P, T, e,
  a, i, ω, Ω) from ORB6 for ~4k systems. Raw fixed-width text files
  committed under `data/wds/`, downloaded directly from
  http://www.astro.gsu.edu/wds/:
    - `data/wds/wds_summ.txt` — main summary, ~157k pair systems
      with ρ/θ, component magnitudes, spectral types, HIP/HD
      cross-IDs (`Webtextfiles/wdsweb_summ2.txt`).
    - `data/wds/wds_notes.txt` — notes accompanying the catalog
      (`Webtextfiles/wdsnewnotes_main.txt`).
    - `data/wds/wds_refs.txt` — discoverer codes and references
      (`Webtextfiles/wdsnewref.txt`).
    - `data/wds/orb6_orbits.txt` — orbital elements
      (`orb6/orb6orbits.txt`).
  Field offsets are documented upstream in `wdsweb_format.txt` and
  the ORB6 ReadMe; consulted by `scripts/binaries/build-binaries.py`
  but not committed. Retrieved 2026-05-11. Public-domain
  (U.S. Government work).
- **Pulkovo Multiple Star Catalog (MSC)**: Tokovinin (2018),
  *ApJS* 235, 6,
  DOI [10.3847/1538-4365/aaa1a5](https://doi.org/10.3847/1538-4365/aaa1a5)
  — author-maintained curated hierarchies of ≥3-component systems,
  VizieR `J/ApJS/235/6` (`systems`, `orbits`, `catalog` tables).
  Supplies what WDS/ORB6/Gaia-NSS miss: hierarchy-resolved
  spectroscopic subsystems with compiled orbital elements
  (AR Cas Aa,Ab; ν Sco Aa1,Aa2), per-component spectral types, and
  pair-side V magnitudes for sub-resolution pairs WDS publishes
  without photometry. Committed as three TSVs under `data/msc/`
  (label convention + column detail in `data/msc/README.md`);
  refresh via `scripts/refresh/refresh-msc.py`. Because MSC compiles
  from the same primary literature the other orbit sources curate, its
  orbit route ranks below ORB6 and Gaia NSS and fires for
  sub-resolution pairs only (`scripts/binaries/README.md` § Stage 4).
  Retrieved 2026-07-11. CDS/VizieR standard academic use; cite
  Tokovinin 2018.
- **SIMBAD WDS↔Gaia DR3 cross-identifications** (CDS Strasbourg).
  Curated per-component cross-IDs between WDS pair identifiers
  (`WDS J<id><comp>`) and Gaia DR3 source_ids, drawn from SIMBAD's
  `ident` and `basic` tables. Stage 2 of `scripts/binaries/build-binaries.py`
  uses this as the principled cross-identification path — SIMBAD
  reliably stores Gaia DR3 source_ids per WDS component for the
  well-known multi-component systems (η Cas A/B/C, ξ UMa A/B,
  ζ Cnc A/B/C, α Cen A/B/Proxima).
  Refresh: `scripts/refresh/refresh-simbad-wds-xids.py` runs a
  two-phase TAP pull (WDS identifiers → SIMBAD oids, then oids →
  cross-IDs) and commits `data/simbad/simbad_wds_xids.tsv` (~23k
  components, ~1.2 MB,
  regular git). Public access policy: SIMBAD is open via CDS's TAP
  service at `simbad.cds.unistra.fr/simbad/sim-tap`; cite Wenger et
  al (2000), A&AS 143, 9.
- **SIMBAD bibcoded values** (CDS Strasbourg). Radial velocity,
  parallax, proper motion, coordinates and Johnson B/V fluxes, each
  carrying the `bibcode` of the measurement SIMBAD compiled it from —
  the bottom tier of the per-field cascades in
  `docs/catalog-driver.md` § 5, where SIMBAD is the index and the
  bibcode is the source. Values SIMBAD publishes without one are
  dropped at write time rather than shipped for a consumer to filter,
  so every column's value count equals its bibcode count. Scoped to an
  enumerated cohort (the spine rows whose printed cell is non-first-order,
  plus the no-Gaia tier — the one request set still keyed on the spine rather
  than the manifest), keyed `gaia_source_id` → HIP → TYC → GJ, and committed
  as `data/simbad/simbad_values.tsv` (11,037 rows, ~2.7 MB, LFS).
  Refresh: `pnpm run refresh:simbad-values`. Fluxes come from the
  long-format `flux` table rather than the `allfluxes` view, which
  publishes no bibcode. Retrieved 2026-08-15; per-cohort coverage in
  `data/simbad/README.md` § The values pull. Same citation as above.
- **Gaia DR2↔(E)DR3 cross-match** (`gaiadr3.dr2_neighbourhood`):
  Torra et al. 2021, *A&A* 649, A10,
  DOI [10.1051/0004-6361/202039637](https://doi.org/10.1051/0004-6361/202039637)
  — the DPAC-published mapping between DR2 and (E)DR3 source_ids with
  per-pair angular distance (mas), magnitude difference, and a
  PM-propagation flag. Queried by `dr3_source_id` for the Gaia-only
  catalog stars (no HIP/HD/HR/GJ designation) and committed as
  `data/gaia/gaia_dr2_neighbourhood.tsv` (+ the request-file snapshot
  of that risk set). Retrieved 2026-07-07. Empirical input to the
  Stellata-ID DR-reconciliation dry run — `docs/sid.md` § DR2→DR3
  dry run. Licence CC-BY-4.0 (Gaia data release policy).
- **Stellarium modern sky culture** (constellation stick figures):
  https://github.com/Stellarium/stellarium/tree/master/skycultures/modern
  — MIT-licensed JSON, HIP-indexed polylines. Committed as
  `data/stellarium/stellarium-modern-skyculture.json`; essentially never changes.
- **Edenhofer 2023 3D dust map** (interstellar extinction + ISM density):
  https://doi.org/10.5281/zenodo.8187943 — Gordian Edenhofer & Greg Green.
  Downloaded via the `dustmaps` Python package and resampled by
  `scripts/dust/build-dust.py` onto a 512³ Cartesian voxel grid in ICRS pc.
  Produces `data/dust/chunk_*.bin` (64 chunks, 128 MiB total, LFS) plus
  `data/dust/particles.bin` (50K importance-sampled dust points, LFS).
  Density in E_ZGR per parsec; A_V/E_ZGR ≈ 2.742 at V band.
- **Planet surface/cloud maps** (per-body equirectangular textures,
  retrieved 2026-07-18): NASA Photojournal mosaics for Mercury
  (MESSENGER, PIA15063), Jupiter (Cassini, PIA07782), and Pluto (New
  Horizons, PIA11707) — public domain; NASA Earth Observatory's The Blue
  Marble 2002 for Earth's day side — public domain;
  Björn Jónsson's Galileo Venus cloud map, Cassini + Voyager 2 Saturn
  map, Voyager Neptune map, and Saturn-ring radial profiles
  (https://bjj.mmedia.is/) — free use with attribution; USGS Viking
  MDIM 2.1 colorized mosaic for Mars — public domain. Uranus and
  Neptune ring strips are built from authored tables of occultation +
  Voyager 2 ring parameters (French et al. 1991 in *Uranus*; Porco
  et al. 1995 in *Neptune and Triton* — per-file rows in
  `data/textures/src/README.md`). Frozen in
  `data/textures/src/` (per-file table in its README), downsampled to
  ≤2048-wide lazy-load JPEGs by `scripts/textures/build-textures.py`.
  Venus deliberately shows the cloud deck, not the Magellan radar
  surface; Uranus ships texture-less (featureless cyan + limb
  darkening is the accurate rendering); Neptune's map depicts its
  1989 Voyager appearance with a reconstructed north polar region;
  Mercury's monochrome mosaic is tinted to its near-neutral
  gray-brown visible appearance and Pluto's un-imaged southern band
  is filled with the map's feathered mean colour (per-body colour
  rationale in data/textures/README.md § Colour fidelity).
- **Moon surface maps** (13 of the 18 major moons, retrieved
  2026-07-19): NASA SVS CGI Moon Kit (LROC WAC) for the Moon; USGS
  Galileo/Voyager global mosaics for the Galileans (Io + Ganymede in
  colour; Europa + Callisto grayscale, tinted); USGS Cassini ISS
  938 nm mosaic for Titan (tinted to the visible haze orange);
  Schenk/LPI 2014 Cassini enhanced-colour mosaics (PIA18434–18439)
  for the mid-sized Saturnians, chroma-halved toward their true
  near-neutral ice tones; Schenk's Voyager 2 mosaic (PIA18668) for
  Triton — all public domain. The Uranian moons ship texture-less
  (Voyager southern-hemisphere coverage only). Per-file provenance
  in `data/textures/src/README.md`.
- **IAU rotation elements** (pole RA/Dec + prime meridian per body,
  the nine planets AND the 18 major moons): IAU WG on Cartographic
  Coordinates and Rotational Elements 2015 report (Archinal et al.
  2018, https://doi.org/10.1007/s10569-017-9805-5), values as
  distributed in NAIF `pck00011.tpc`; linear terms only (see
  `docs/science-solar-system.md` § Planet rotation). Every moon is
  tidally locked — its Ẇ equals the orbital mean motion, test-pinned
  against the JPL mean elements. Tables in
  `src/client/solar-system/planets/rotation-elements-pure.ts`.
- **Deep-space probe trajectories** (the five Sun-escape probes —
  Pioneer 10/11, Voyager 1/2, New Horizons; retrieved 2026-07-25):
  JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api),
  `EPHEM_TYPE=VECTORS` heliocentric state vectors on ICRS equatorial
  axes (`REF_PLANE=FRAME`, `CENTER='500@10'`), 30-day steps from each
  spacecraft SPK's first epoch to 2050. Committed as
  `data/probes/{id}.json` (~450 KB plain text); refresh via
  `pnpm run fetch:probes`, never at build time. Linear interpolation
  between 30-day samples is a visualisation, not an ephemeris — it is
  pinned only at the ~0.3 AU coherence level against the planet
  ephemerides at each probe's known closest-approach epochs.
  Public-domain (U.S. Government work).

- **Milky Way integrated properties and structure** (the volumetric band's
  photometric anchors; constants only, apart from the BC03 grid below):
    - **Bland-Hawthorn & Gerhard 2016**, *ARA&A* 54, 529
      (DOI 10.1146/annurev-astro-081915-023441). Table 2 gives the Galaxy's
      global absolute magnitudes and colour indices as an external observer
      would measure them (M_V = −21.37, B−V = 0.73, from Licquia, Newman &
      Brinchmann 2015's Milky Way analogues); § 5.1 gives the thin/thick
      disc scale heights (300 ± 50 / 900 ± 180 pc), the thin-disc scale
      length (2.6 ± 0.5 kpc), and the thick-disc normalisations
      (f_ρ = 4 ± 2 %, f_Σ = 12 ± 4 %). The review is explicit that the
      quoted magnitudes and colour indices come from different calibrations
      and are mutually inconsistent at the ~0.1 mag level, and that older
      direct-integration values run dimmer and bluer (Bahcall & Soneira
      1980: M_V = −20.5; de Vaucouleurs 1983: M_B = −20.2 ± 0.15).
    - **Leinert et al. 1998**, *A&AS* 127, 1
      (DOI 10.1051/aas:1998105) — "The 1997 reference of diffuse night sky
      brightness". Table 24's integrated starlight at 0.55 µm
      (λI_λ = 577 / 250 × 10⁻⁹ W m⁻² sr⁻¹ toward the Galactic centre / the
      NGP, i.e. 22.92 / 23.83 mag/arcsec²) is what the band is CHECKED
      against. These are SKY-model predictions (Wainscoat et al. 1992) for
      *total* starlight, so they include the resolved stars the catalogue
      draws separately — at the NGP that overlap is two thirds of the
      light, and the check subtracts it (24.99, not 23.83). The
      subtraction is only meaningful at the pole, where extinction is
      ~0.03 mag and a de-extincted catalogue sum and an observed sky model
      are commensurable.
    - **Licquia & Newman 2015**, *ApJ* 806, 96
      (DOI 10.1088/0004-637X/806/1/96) — hierarchical Bayesian
      meta-analysis giving M\* = 6.08 ± 1.14 × 10¹⁰ M⊙ split
      0.91 ± 0.07 bulge / 5.17 ± 1.11 disc, i.e. B/T = 0.150 in stellar
      **mass**. Chabrier IMF.
    - **Flynn et al. 2006**, *MNRAS* 372, 1149
      (DOI 10.1111/j.1365-2966.2006.10911.x) — the local Galactic disc
      column's measured mass-to-light ratios, (M/L)_B = 1.4 ± 0.2,
      (M/L)_V = 1.5 ± 0.2, (M/L)_I = 1.2 ± 0.2. Measured for the Milky
      Way rather than modelled, and the paper states the result agrees
      with population synthesis at solar-neighbourhood IMFs.
    - **Bruzual & Charlot 2003**, *MNRAS* 344, 1000
      (DOI 10.1046/j.1365-8711.2003.06897.x) — GALAXEV SSP grids,
      `data/bc03/`. Supplies Υ\*_V for the bulge's old, metal-rich
      population, which is what turns Licquia & Newman's mass B/T into
      the V-band light ratio the solve actually needs.
  Bland-Hawthorn & Gerhard's M_V = −21.37 is the INPUT: both components'
  density0 is solved so the proxy volumes integrate to it at the V-band
  LIGHT B/T derived from the three sources above. The two Leinert checks
  then disagree with it by 1.68 mag
  at the pole and 1.02 toward the centre, in the same direction, and no
  shape parameter bridges that — `docs/science-galactic-structure.md`
  § The luminosity solve argues it out;
  `src/client/milkyway/calibration/README.md` carries the numbers.

> **Molecular cloud sources.** Zucker et al. 2020 + 2021 cloud
> distances, 3D bounding boxes, and radial profiles drive the
> molecular-cloud presence layer (`scripts/clouds/build-clouds.py`,
> `data/molecular-clouds/`; physics model in
> `docs/science-molecular-clouds.md`). Cloud masses come from Zucker 2021
> Table 3's NICEST extinction-map column (`mass_nicest`); the
> Leike-map alternative saturates in dense gas and underestimates by
> up to ~14× (the paper's own `mass_ratio` column), so it is not used
> for display (the Leike-resolution `mass_leike` / `max_ak_leike`
> columns do calibrate the presence-pass density model).


## Where the topic-specific detail lives

This file carries scope principles, data-source policy, and the
project-wide non-goals list. Per-subsystem physics, formulas, and
modelling decisions split out into `docs/`:

```
docs/science-catalog-ingestion.md      The merge AT-HYG performed and
                                        what replaced it, Bailer-Jones +
                                        LMC-kinematic distance overrides,
                                        driver astrometry, current-epoch
                                        space-motion propagation. The
                                        durable contract that retired
                                        AT-HYG as the driver is
                                        docs/catalog-driver.md.
docs/science-stellar-modelling.md      Physical radius, brightness/
                                        size perception model, colour
                                        temperature routing + Teff
                                        calibration, variable pulsation.
docs/science-solar-system.md           Planet rendering, phase
                                        functions, heliopause boundary.
docs/science-local-group.md            Wireframe layer + per-object
                                        luminosity/density model for
                                        the volumetric emission
                                        raymarch.
docs/science-galactic-structure.md     Galactic coordinate frame,
                                        Milky Way density profiles,
                                        interstellar dust extinction,
                                        constellation stick figures.
docs/science-molecular-clouds.md       Extinction units chain,
                                        calibrated Zucker density model,
                                        taxonomy + embedded-star
                                        cavities, isosurface presence
                                        pass, anti-aliasing rules.
docs/science-multiple-star-pipeline.md Binary/multiple detection
                                        philosophy, blend-split math,
                                        worked examples.
```

## Modelling decisions deliberately not made

These are the science-flavoured items from the project-wide scope list
in `AGENTS.md`. Restated here so the rationale lives alongside the
science it relates to.

- **Constellation boundaries as 3D structures.** The IAU (Delporte
  1930) boundary arcs are modelled — they resolve the constellation of
  any position, catalogued or not
  (`src/client/constellation-boundaries/README.md`) — but only as a
  Sol-frame projection. An asterism line's endpoints are real stars and
  distort correctly as the camera flies; a boundary has no 3D referent
  and describes nothing from another star, so it is never given depth.
- **Spiral-arm overdensities** in the Milky Way volumetric background.
  The Reid et al. masers offer a maser-anchored spiral model that could
  ride atop the smooth disc profile, but the smooth band reads
  convincingly enough that re-introducing higher spatial frequency
  (and the aliasing risk it carries through 32-step raymarching) isn't
  worth the complexity.
- **Irregular / supernova variables.** GCVS entries without a period are
  skipped — can't animate without one.
- **Asteroids and minor planets.** Ceres, Vesta, the Trojans, NEOs.
  Separate ephemeris source, and not visible as discs at any camera
  distance the app currently exposes.
- **Time-evolving heliopause shape.** Solar-cycle variation in the
  upwind boundary is real (~few AU peak-to-peak) but well below the
  layer's coarse 122-AU anchor; we treat the shell as static.
- **Jupiter's rings.** Normal optical depth ≤ 10⁻⁵ (main ring ~10⁻⁶)
  is three orders of magnitude below the smallest 8-bit-representable
  opacity (1/255 ≈ 4×10⁻³) — at the true-opacity policy the strip
  would be identically zero. Physically honest: Jupiter's rings are
  invisible in backscattered visible light (they were discovered in
  forward scatter, which the ring shader doesn't model). See
  `data/textures/README.md` § Ring strips.
