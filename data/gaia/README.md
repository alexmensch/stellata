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
gaia_dr3_astrometry_catalog.tsv        ~49 MB, LFS. 5p astrometry +
                                       radial_velocity{,_error} for every
                                       catalog source_id plus the classic-ID
                                       gate's candidates (~313k) — tier 1 of
                                       the direction, rv, V and ci cascades,
                                       and the binding gate's G evidence.
gaia_dr3_nss_two_body.tsv              ~90 MB, LFS. NSS two-body orbits.
gaia_dr3_apsis.tsv                     ~17 MB, LFS. gspphot ∪ gspspec
                                       Teff/logg/[M/H]/A0 + spectraltype_esphs.
gaia_astrometry_source_id_request.tsv  ~440 KB, LFS. Stage 2 → Stage 3 deduped
                                       source_id request list (build-binaries.py output).
gaia_catalog_source_id_request.tsv     ~6.2 MB, LFS. Full-catalog deduped
                                       source_id request list — the spine's
                                       gaia_source_id column UNION the
                                       classic-ID binding gate's candidates
                                       (scripts/catalog/astrometry-request/).
gaia_dr2_neighbourhood_request.tsv     ~100 KB, LFS. DR3 source_ids of the
                                       Gaia-only catalog stars (no HIP/HD/HR/GJ)
                                       — the SID DR-churn risk set, frozen at
                                       the 2026-07-06 build so the pull below
                                       stays consistent with it. Regenerate
                                       from the ledger with `pnpm run
                                       sid:risk-set` (docs/sid.md § 6.1) only
                                       alongside a fresh neighbourhood pull.
gaia_dr2_neighbourhood.tsv             ~320 KB, LFS. DR2 ↔ DR3 cross-match
                                       candidates for that risk set. NOTE:
                                       angular_distance is in mas, not the
                                       arcsec the best_neighbour tables use.
```

## Provenance

- **Mission citation**: Gaia Collaboration, Vallenari A. et al. 2023,
  *A&A* 674, A1 (Gaia DR3 overview).
  DOI: [10.1051/0004-6361/202243940](https://doi.org/10.1051/0004-6361/202243940).
- **Photometry citation**: Riello M., De Angeli F., Evans D. W. et al. 2021,
  *A&A* 649, A3 (Gaia EDR3 photometric content and validation). DOI:
  [10.1051/0004-6361/202039587](https://doi.org/10.1051/0004-6361/202039587).
  Its § *Photometric relationships with other photometric systems* gives the
  `G − V` cubic in `BP − RP` the V cascade transforms through; DR3 ships EDR3's
  photometry unchanged, so the EDR3 calibration is the one that applies.
- **Upstream tables**: ESA Gaia Archive at
  https://gea.esac.esa.int/archive/.
- **Licence**: CC-BY-4.0 (Gaia data release policy).
- **Source tables** (queried via ADQL over the synchronous Gaia TAP
  endpoints — `scripts/refresh/README.md` § Gaia TAP):
  - `gaia_dr3_hip_xmatch.tsv` ← `hipparcos2_best_neighbour`.
  - `gaia_dr3_tyc_xmatch.tsv` ← `tyco2tdsc_merge_best_neighbour`.
  - `gaia_dr3_astrometry.tsv` ← `gaia_source` (binaries subset queried
    by deduped source_id).
  - `gaia_dr3_astrometry_catalog.tsv` ← `gaia_source` (full-catalog
    subset — same schema, same query, wider source_id list).
  - `gaia_dr3_nss_two_body.tsv` ← `nss_two_body_orbit`.
  - `gaia_dr3_apsis.tsv` ← `astrophysical_parameters` (gspphot ∪
    gspspec).
  - `gaia_dr2_neighbourhood.tsv` ← `dr2_neighbourhood` (the DPAC
    DR2→(E)DR3 cross-match, Torra et al. 2021; queried by
    dr3_source_id).

## Consumed by

- `scripts/catalog/build-catalog.ts` — `gaia_dr3_hip_xmatch.tsv` bridges the
  GCVS cross-reference onto `gaia_source_id`, so a spine row carrying no HIP
  still resolves a variable-star designation. It no longer backfills
  `gaia_source_id` itself: the record build reads each binding off the spine
  column rather than re-deriving it (`scripts/catalog/spine/README.md`),
  leaving the classic-ID overlay's binding gate as the cross-walk's only
  resolution consumer — the astrometry request reads the spine column too
  now (`scripts/catalog/astrometry-request/README.md`). Also: Apsis
  Teff/logg/[M/H]/A0 + GSP-Spec
  `spectraltype_esphs` for the six-tier spectral resolver;
  `gaia_dr3_astrometry_catalog.tsv` as direction-cascade tier 1 and
  the NSS source_id set for the `gaia_nss_systemic` routing tag
  (`scripts/catalog/distance/README.md` § Direction resolution). That same
  table's `phot_{g,bp,rp}_mean_mag` columns are the top tier of the Johnson V
  cascade every record's absmag is derived from — 311,071 of 313,257 stars
  (`scripts/catalog/photometry/README.md`).
- `scripts/binaries/build-binaries.py` Stages 1–4 — HIP/Tyc
  cross-walks, per-component 5p astrometry, NSS orbital elements.
- `scripts/sid/dr-reconcile.ts` (`pnpm run sid:dr-reconcile`) — replays
  the request + neighbourhood pair as the docs/sid.md § 6.2 dry run;
  `scripts/sid/dr-reconcile-pure.test.ts` pins that classification
  end-to-end.

See [`scripts/catalog/README.md`](../../scripts/catalog/README.md)
and [`scripts/binaries/README.md`](../../scripts/binaries/README.md)
for the routing logic. SCIENCE.md § Data sources carries the
science-side rationale.

## Refresh

`pnpm run refresh:gaia-{hip,tyc,astrometry,astrometry-catalog,nss,apsis,dr2-neighbourhood}` →
[`scripts/refresh/`](../../scripts/refresh/README.md). DR4 transition
order is documented there. Both astrometry pulls read a source_id
request file as input:

- `refresh:gaia-astrometry` reads `gaia_astrometry_source_id_request.tsv`,
  so it must run **after** a fresh `pnpm run build:binaries`.
- `refresh:gaia-astrometry-catalog` reads
  `gaia_catalog_source_id_request.tsv`, so it must run **after**
  `pnpm run build:astrometry-request` — which reads the spine alone and so
  no longer waits on `refresh:gaia-hip`.
- `refresh:gaia-dr2-neighbourhood` reads
  `gaia_dr2_neighbourhood_request.tsv`, a frozen snapshot of the
  Gaia-only risk set derived from a built `public/catalog.bin` +
  `public/search-index.json` (recipe in docs/sid.md § DR2→DR3 dry
  run).
