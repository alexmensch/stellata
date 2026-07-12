# Pulkovo MSC — Tokovinin Multiple Star Catalog

Three TSVs from VizieR `J/ApJS/235/6` (author-updated edition — orbit
rows carry post-2018 references like `Tok 2023`). Curated hierarchies
of ≥3-component stellar systems: per-pair observing status, per-side
photometry + spectral types, and orbital elements including the
spectroscopic subsystems ORB6 and Gaia NSS never cover (AR Cas Aa,Ab,
ν Sco Aa1,Aa2).

```
msc_systems.tsv     One row per pair in a hierarchy (14.6k). prim/sec/
                    parent labels + obs_type, period, separation, PA,
                    per-side Vmag + SpT + mass estimates.
msc_orbits.tsv      Orbital elements per pair (4.6k): per + per_unit
                    (d/y; ~16 rows blank), t0 (Besselian year OR
                    JD−2,400,000 — no unit flag; consumers disambiguate
                    by magnitude), e, a_arcsec, node_deg (Ω),
                    longp_deg (ω), incl_deg (i), K1/K2/V0 for SBs.
                    Visual orbits carry the full set; spectroscopic
                    subsystems carry P/T/e/ω/K1 with no i, a, or Ω.
msc_components.tsv  Per-component rows (12.5k): SpT, V/B mags,
                    separation from the main component, HIP/HD, plx.
```

## Label convention — NOT raw WDS letters

`prim` / `sec` / `parent` / `syst` are Tokovinin's hierarchy labels.
Top-level letters match WDS, but subsystems are re-labelled: a union
label names a pair treated as one object (`Aab` = the Aa+Ab pair), and
sub-labels shift one level relative to WDS where MSC subdivides deeper
(ν Sco: MSC `Aab,Ac` is WDS `Aa,Ab`; MSC `Aa,Ab` is WDS `Aa1,Aa2`).
`parent` is the union label a pair constitutes (`*` = system root;
`t` / `X` = non-hierarchical or unattributed ties — unmappable).
`scripts/binaries/msc_map.py` converts labels to WDS tokens by walking
each system's parent tree top-down; consumers never join on the raw
labels.

## Provenance

- **Citation**: Tokovinin A. 2018, *ApJS* 235, 6 (updated MSC).
  Maintained by the author; VizieR copy tracks updates.
- **VizieR**: `J/ApJS/235/6` (`systems`, `orbits`, `catalog` tables),
  CDS TAP `https://tapvizier.cds.unistra.fr/TAPVizieR/tap`.
- **Retrieved**: 2026-07-11.
- **Licence**: CDS/VizieR standard academic use; cite Tokovinin 2018.

## Consumed by

- `scripts/binaries/build-binaries.py` Stage 1/2 (inner-pair synthesis
  for MSC orbits with no WDS pair row), Stage 4 (`msc` orbit route,
  sub-resolution pairs only), Stage 6 (per-component `spect` tier
  `msc`; pair `dmag`/`mag_pri`/`mag_sec` fill where WDS has none).

## Refresh

`python3 scripts/refresh/refresh-msc.py` (no pnpm target; venv per
`scripts/refresh/README.md` § One-time setup).
