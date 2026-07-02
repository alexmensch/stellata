# Gaia DR3 — cross-walks, astrometry, NSS orbits, Apsis

Per-Gaia-source pulls keyed on Gaia DR3 `source_id`. Together they
supply: HIP/Tycho cross-IDs (so non-Gaia identifiers reach the
DR3 source space); 5-parameter astrometry for resolved sources;
two-body orbital solutions from the NSS pipeline; and `gspphot ∪
gspspec` astrophysical parameters (Teff, log g, [M/H], A0, GSP-Spec
spectral type enum).

```
gaia_dr3_hip_xmatch.tsv                ~3.7 MB, LFS. HIP → DR3 source_id.
gaia_dr3_tyc_xmatch.tsv                ~106 MB, LFS. Tycho-2 → DR3 source_id.
gaia_dr3_astrometry.tsv                ~1.2 MB, LFS. 5p astrometry for the
                                       resolved source_ids Stage 2 requests.
gaia_dr3_astrometry_catalog.tsv        ~45 MB, LFS. 5p astrometry for every
                                       catalog-resolvable source_id (~315k) —
                                       the direction-cascade input.
gaia_dr3_nss_two_body.tsv              ~90 MB, LFS. NSS two-body orbits.
gaia_dr3_apsis.tsv                     ~17 MB, LFS. gspphot ∪ gspspec
                                       Teff/logg/[M/H]/A0 + spectraltype_esphs.
gaia_astrometry_source_id_request.tsv  ~440 KB, LFS. Stage 2 → Stage 3 deduped
                                       source_id request list (build-binaries.py output).
gaia_catalog_source_id_request.tsv     ~6.3 MB, LFS. Full-catalog deduped
                                       source_id request list (export-astrometry-request.ts output).
```

## Provenance

- **Mission citation**: Gaia Collaboration, Vallenari A. et al. 2023,
  *A&A* 674, A1 (Gaia DR3 overview).
  DOI: [10.1051/0004-6361/202243940](https://doi.org/10.1051/0004-6361/202243940).
- **Upstream tables**: ESA Gaia Archive at
  https://gea.esac.esa.int/archive/.
- **Licence**: CC-BY-4.0 (Gaia data release policy).
- **Source tables** (queried via ADQL through astroquery):
  - `gaia_dr3_hip_xmatch.tsv` ← `hipparcos2_best_neighbour`.
  - `gaia_dr3_tyc_xmatch.tsv` ← `tyco2tdsc_merge_best_neighbour`.
  - `gaia_dr3_astrometry.tsv` ← `gaia_source` (binaries subset queried
    by deduped source_id).
  - `gaia_dr3_astrometry_catalog.tsv` ← `gaia_source` (full-catalog
    subset — same schema, same query, wider source_id list).
  - `gaia_dr3_nss_two_body.tsv` ← `nss_two_body_orbit`.
  - `gaia_dr3_apsis.tsv` ← `astrophysical_parameters` (gspphot ∪
    gspspec).

## Consumed by

- `scripts/catalog/build-catalog.ts` — HIP→DR3 backfill for the
  `gaia_source_id` field; Apsis Teff/logg/[M/H]/A0 + GSP-Spec
  `spectraltype_esphs` for the six-tier spectral resolver.
- `scripts/binaries/build-binaries.py` Stages 1–4 — HIP/Tyc
  cross-walks, per-component 5p astrometry, NSS orbital elements.

See [`scripts/catalog/README.md`](../../scripts/catalog/README.md)
and [`scripts/binaries/README.md`](../../scripts/binaries/README.md)
for the routing logic. SCIENCE.md § Data sources carries the
science-side rationale.

## Refresh

`npm run refresh:gaia-{hip,tyc,astrometry,astrometry-catalog,nss,apsis}` →
[`scripts/refresh/`](../../scripts/refresh/README.md). DR4 transition
order is documented there. Both astrometry pulls read a source_id
request file as input:

- `refresh:gaia-astrometry` reads `gaia_astrometry_source_id_request.tsv`,
  so it must run **after** a fresh `npm run build:binaries`.
- `refresh:gaia-astrometry-catalog` reads
  `gaia_catalog_source_id_request.tsv`, so it must run **after**
  `npm run build:astrometry-request` (which itself needs a fresh
  `refresh:gaia-hip` for the HIP→Gaia backfill).
