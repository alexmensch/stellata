# Washington Double Star Catalog (WDS) + ORB6

The source-of-truth catalogue for visually-resolved double-star
geometry (ρ, θ, component magnitudes, HIP/HD cross-IDs) and the
companion ORB6 catalogue of computed orbital elements. Together they
recover binary-pair structure that AT-HYG collapses to a single row.

```
wds_summ.txt       ~20 MB, LFS. Main summary, ~157k pair systems.
wds_notes.txt      ~3.8 MB, LFS. Per-pair notes prose.
wds_refs.txt       ~3.4 MB, LFS. Discoverer codes + references
                   (committed but not parsed today).
orb6_orbits.txt    ~1.1 MB, LFS. Sixth catalog of visual binary
                   orbits — ~4k systems with full (P, T, e, a, i,
                   ω, Ω) fits.
```

## Provenance

- **WDS citation**: Mason B. D., Wycoff G. L., Hartkopf W. I.,
  Douglass G. G., Worley C. E. 2001, *AJ* 122, 3466.
  DOI: [10.1086/323920](https://doi.org/10.1086/323920).
- **ORB6 citation**: Hartkopf W. I., Mason B. D., Worley C. E.
  2001, *AJ* 122, 3472.
  DOI: [10.1086/323923](https://doi.org/10.1086/323923).
- **Maintainers**: U.S. Naval Observatory (WDS) and Georgia State
  University (ORB6), continuously updated.
- **Source URLs**: http://www.astro.gsu.edu/wds/ — `Webtextfiles/`
  for the summary / notes / refs, `orb6/` for the orbits.
- **Licence**: Public domain (U.S. Government work).
- **Format**: fixed-width text. Field offsets documented upstream
  in `wdsweb_format.txt` and the ORB6 ReadMe (consulted but not
  committed).
- **Retrieved**: 2026-05-11.

## Consumed by

`scripts/binaries/build-binaries.py`:

- `wds_summ.txt` → Stage 1 row parse (every WDS pair → primary +
  secondary letter decomposition).
- `wds_notes.txt` → Stage 5 optical-pair filter tier 1 (flag chars
  `{T, V, Z}` keep, `{S, U, X, Y}` reject).
- `orb6_orbits.txt` → Stage 2 (`orb6_hip` resolution tier) +
  Stage 4 (`orb6` / `orb6_spectroscopic` orbital-element selection).

See [`scripts/binaries/README.md`](../../scripts/binaries/README.md)
for the seven-stage cross-match pipeline and SCIENCE.md § Multiple-
star pipeline for the science rationale.
