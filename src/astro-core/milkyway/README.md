# Milky Way band model

The band's physics, shared by the viewer's volumetric layer
(`/src/client/milkyway/`) and the pipeline steps that measure or bake
against it (`scripts/milkyway-calibration/`, `scripts/dust/`).

- `column/` — the density and dust profiles, the population tints and the
  CPU mirror of the band's raymarch. Its own README.
- `calibration/` — the published photometry the emissivity is solved
  against, the light ratio and disc colour derived from it, and the
  measured resolution-hole table. Its own README.
