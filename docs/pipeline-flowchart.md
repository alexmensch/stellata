# Data pipeline flowchart

Mermaid flowchart of the full build pipeline: external data sources →
binary-system cross-match (`scripts/binaries/`) → single-star catalog
build (`scripts/catalog/`) → runtime binaries → parallel layers
(clouds, local group, dust, colour LUT) → validation → client
consumption. Node labels carry the reconciliation precedence chains
(distance refinement, direction cascade, binary identity resolution,
orbital-element precedence) rather than exploding each gate into its
own box — full detail for each stage lives in the corresponding
folder's `README.md` and `SCIENCE.md`.

Renders natively in GitHub's markdown viewer.

```mermaid
flowchart TD

  subgraph SRC["External Data Sources — data/ (frozen, network-free build)"]
    ATHYG["AT-HYG v3.3<br/>data/athyg/<br/>membership · IDs · names · mags · driver of catalogue identity"]
    GCVS["GCVS 5.1<br/>data/gcvs/<br/>variable periods + amplitudes"]
    CCDM["Hipparcos CCDM + MultFlag<br/>data/hipparcos/<br/>visual-double flags"]
    HIP2["HIP2 van Leeuwen<br/>data/hipparcos/<br/>full-precision astrometry"]
    WDS["WDS + ORB6<br/>data/wds/<br/>visual binary catalogue + orbital elements"]
    MSC["Pulkovo MSC<br/>data/msc/<br/>multi-star hierarchies + compiled orbits"]
    SIMBAD["SIMBAD<br/>data/simbad/<br/>sp_type · WDS↔Gaia cross-IDs"]
    GAIA["Gaia DR3<br/>data/gaia/<br/>astrometry · NSS orbits · Apsis · xmatches"]
    BJ["Bailer-Jones DR3<br/>data/bailer-jones/<br/>Bayesian distance posteriors"]
    STELL["Stellarium skyculture<br/>data/stellarium/<br/>HIP-indexed constellation lines"]
    DUSTSRC["Edenhofer 2023 dust map<br/>data/dust/ (raw)"]
    LVDB["Pace 2024 LVDB<br/>data/local-group/"]
    ZUCKER["Zucker 2020/2021 clouds<br/>data/molecular-clouds/"]
  end

  RF["Layer 2 refresh — scripts/refresh/*.py<br/>manual · infrequent · atomic writes<br/>never wired into pnpm run build"]
  RF -.-> GAIA
  RF -.-> BJ
  RF -.-> HIP2
  RF -.-> SIMBAD
  RF -.-> MSC

  subgraph BIN["STAGE 1 — scripts/binaries/build-binaries.py (pnpm run build:binaries)"]
    BIN1["Stage 1 — parse & index<br/>WDS summ/notes/refs, ORB6, MSC, SIMBAD xIDs"]
    BIN2["Stage 2 — resolve identity<br/>WDS component to Gaia source_id:<br/>orb6_hip &gt; athyg_gaia_native &gt; simbad_xid<br/>&gt; ccdm_hip &gt; position_match &gt; unresolved<br/>+ G-V mag-consistency gate<br/>+ binding-integrity audit (geometric arbitration)"]
    BIN3["Stage 3 — astrometry per component<br/>gaia_nss_systemic &gt; hip2_saturated<br/>&gt; hip2_pm_discrepant &gt; gaia_5p &gt; athyg_printed"]
    BIN4["Stage 4 — orbital elements per pair<br/>orb6(visual) &gt; gaia_nss &gt; orb6_spectroscopic<br/>&gt; msc(sub-resolution only) &gt; none"]
    BIN5["Stage 5 — optical vs physical filter<br/>WDS notes &gt; orbit-on-file &gt; 3D-sep limit(1pc)<br/>&gt; parallax+escape-velocity &gt; asymmetric-Gaia<br/>&gt; CPM epoch-baseline &gt; mag-gap heuristic"]
    BIN6["Stage 6 — emit multiples.tsv<br/>+ spectral-type: curated &gt; SIMBAD &gt; MSC &gt; AT-HYG &gt; none<br/>+ photometry: AT-HYG own &gt; inherited(dmag) &gt; Gaia-derived &gt; none<br/>+ subdivide.py sub-pair synthesis"]
    BIN7["Stage 7 — count/rate snapshot gate<br/>build-binaries-expected.json"]
    BIN1 --> BIN2 --> BIN3 --> BIN4 --> BIN5 --> BIN6 --> BIN7
  end

  WDS --> BIN1
  MSC --> BIN1
  SIMBAD --> BIN1
  ATHYG --> BIN2
  CCDM --> BIN2
  GAIA --> BIN2
  GAIA --> BIN3
  HIP2 --> BIN3
  GAIA --> BIN4
  MSC --> BIN4
  GCVS --> BIN6
  SIMBAD --> BIN6

  MULT[("data/binaries/multiples.tsv")]
  BIN7 --> MULT

  subgraph CAT["STAGE 2 — scripts/catalog/build-catalog.ts (pnpm run build:catalog)"]
    CAT1["Ingest AT-HYG rows<br/>drop: missing ra/dec/dist, missing absmag<br/>carries pos_src/dist_src/mag_src/pm_src provenance"]
    CAT2["Distance refinement cascade (order-dependent)<br/>AT-HYG dist<br/>then Bailer-Jones override (Gaia-sourced rows only)<br/>then HIP2 full-precision redistance (HIP-sourced rows)<br/>then LMC kinematic override (15deg cone + dPM under 0.5 mas/yr, snaps to 49.594 kpc)<br/>then MAX_DIST_PC 50,000 pc cutoff<br/>(recomputes absmag at every layer)"]
    CAT3["Direction cascade — shared with binaries Stage 3<br/>gaia_5p &gt; gaia_nss_systemic &gt; hip2_saturated<br/>&gt; hip2_pm_discrepant &gt; athyg_printed<br/>(AT-HYG's own x0/y0/z0 never consumed)"]
    CAT4["Build-time de-extinction<br/>via dust voxel grid (hard fail if absent)"]
    CAT5["Spectral classification<br/>curated HIP override &gt; SIMBAD by source_id<br/>&gt; SIMBAD by HIP &gt; Gaia GSP-Spec enum &gt; unknown"]
    CAT6["Colour / Teff resolution<br/>Gaia Apsis gspphot &gt; gspspec &gt; AT-HYG B-V<br/>&gt; spectral-class table &gt; WD Sion Teff &gt; solar"]
    CAT7["Physical radius — Stefan-Boltzmann"]
    CAT8["System-distance coherence<br/>anchor: clean Gaia 5p &gt; HIP2 &gt; Bailer-Jones &gt; inherited<br/>non-anchor members snap unless 3-sigma parallax gap"]
    CAT9["Companion promotion<br/>from multiples.tsv, FLAG_BINARY_COMPANION_ONLY rows"]
    CAT10["SID resolution"]
    CAT1 --> CAT2 --> CAT3 --> CAT4 --> CAT5 --> CAT6 --> CAT7 --> CAT8 --> CAT9 --> CAT10
  end

  ATHYG --> CAT1
  GCVS --> CAT1
  CCDM --> CAT1
  BJ --> CAT2
  HIP2 --> CAT2
  HIP2 --> CAT3
  GAIA --> CAT3
  GAIA --> CAT5
  GAIA --> CAT6
  SIMBAD --> CAT5
  STELL --> CONSTOUT
  MULT --> CAT9
  DUSTOUT --> CAT4

  CATBIN[("public/catalog.bin.i +<br/>catalog-manifest.json")]
  CONSTOUT[("public/constellations.json")]
  SEARCHOUT[("public/search-index.json")]
  RIMOUT[("public/catalog-row-index-map.json")]
  CAT10 --> CATBIN
  CAT10 --> CONSTOUT
  CAT10 --> SEARCHOUT
  CAT10 --> RIMOUT

  subgraph RTB["STAGE 3 — build-runtime-binaries.py (pnpm run build:binaries-runtime)"]
    RTB1["Join multiples.tsv with row-index-map<br/>emit Kepler elements per pair"]
  end
  MULT --> RTB1
  RIMOUT --> RTB1
  BINBIN[("public/binaries.bin")]
  RTB1 --> BINBIN

  subgraph PAR["Parallel layers — independent of star/binary chain"]
    CLOUDS1["build-clouds.py<br/>Z2021(precise ellipsoids) over Z2020(sphere aggregates)"]
    LG1["build-local-group.ts<br/>filter: confirmed_real and confirmed_galaxy, under 2 Mpc"]
    DUST1["build-dust.py then sync-dust.ts<br/>log10 density, uint8, 512-cubed voxels"]
    LUT1["blackbody-lut.ts<br/>Ballesteros B-V to Teff + Planck + CIE 1931"]
  end
  ZUCKER --> CLOUDS1
  LVDB --> LG1
  DUSTSRC --> DUST1
  CLOUDSOUT[("public/clouds.json")]
  LGOUT[("public/local-group.json")]
  DUSTOUT[("public/dust/*")]
  LUTOUT[("src/client/star-pipeline/blackbody-lut-data.ts")]
  CLOUDS1 --> CLOUDSOUT
  LG1 --> LGOUT
  DUST1 --> DUSTOUT
  LUT1 --> LUTOUT

  subgraph VAL["Validation — side-branch, gated"]
    VAL1["validate-distances.py<br/>Vaidman 2025 BA-supergiant cross-check"]
    VAL2["build-binaries-spotcheck.py<br/>vs spot_check_ground_truth.tsv"]
  end
  BJ --> VAL1
  MULT --> VAL2

  subgraph CLIENT["Client — pnpm run build:client (vite build)"]
    CLI1["loaders/* — read catalog.bin, binaries.bin,<br/>clouds.json, local-group.json, dust chunks"]
    CLI2["epoch-advance-pure.ts<br/>J2016.0 to model clock t (baked per-star velocity)"]
    CLI3["BinaryOrbitField / EclipsePhotometryField<br/>per-frame Kepler walk"]
    CLI4["star-pipeline render<br/>colour LUT + dust extinction + variable pulsation"]
    CLI1 --> CLI2 --> CLI3 --> CLI4
  end
  CATBIN --> CLI1
  BINBIN --> CLI1
  CLOUDSOUT --> CLI1
  LGOUT --> CLI1
  DUSTOUT --> CLI1
  LUTOUT --> CLI4

  classDef source fill:#2b6cb0,stroke:#1a365d,color:#fff
  classDef refresh fill:#718096,stroke:#4a5568,color:#fff,stroke-dasharray: 5 5
  classDef stage fill:#2c5282,stroke:#1a365d,color:#fff
  classDef output fill:#276749,stroke:#1a3c26,color:#fff
  classDef validation fill:#c05621,stroke:#7b341e,color:#fff
  classDef client fill:#553c9a,stroke:#322659,color:#fff

  class ATHYG,GCVS,CCDM,HIP2,WDS,MSC,SIMBAD,GAIA,BJ,STELL,DUSTSRC,LVDB,ZUCKER source
  class RF refresh
  class BIN1,BIN2,BIN3,BIN4,BIN5,BIN6,BIN7,CAT1,CAT2,CAT3,CAT4,CAT5,CAT6,CAT7,CAT8,CAT9,CAT10,RTB1,CLOUDS1,LG1,DUST1,LUT1 stage
  class MULT,CATBIN,CONSTOUT,SEARCHOUT,RIMOUT,BINBIN,CLOUDSOUT,LGOUT,DUSTOUT,LUTOUT output
  class VAL1,VAL2 validation
  class CLI1,CLI2,CLI3,CLI4 client
```
