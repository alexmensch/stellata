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
gaia_dr3_astrometry_catalog.tsv        ~58 MB, LFS. 5p astrometry +
                                       radial_velocity{,_error} for every
                                       catalog source_id, the classic-ID
                                       gate's candidates and the bound-pair
                                       siblings (378,105 rows) — tier 1 of
                                       the direction, rv, V and ci cascades,
                                       the binding gate's G evidence, and the
                                       parallax cascade's sibling tier.
gaia_dr3_nss_two_body.tsv              ~90 MB, LFS. NSS two-body orbits.
gaia_dr3_apsis.tsv                     ~20 MB, LFS. gspphot ∪ gspspec
                                       Teff/logg/[M/H]/A0 + spectraltype_esphs.
gaia_dr3_gspc.tsv                      ~31 MB, LFS. Johnson-Kron-Cousins B and
                                       V synthesised from each source's BP/RP
                                       spectrum, + fluxes, flux errors and the
                                       per-band validated-range flag. 342,464
                                       rows, pulled against the catalog request
                                       at its then-size of 378,111 ids — the ci
                                       cascade's tier below the Table-5.9
                                       relation.
gaia_astrometry_source_id_request.tsv  ~440 KB, LFS. Stage 2 → Stage 3 deduped
                                       source_id request list (build-binaries.py output).
gaia_catalog_source_id_request.tsv     ~7.2 MB, LFS. Full-catalog deduped
                                       source_id request list — the membership
                                       manifest's gaia_source_id column UNION
                                       the classic-ID binding gate's candidates
                                       UNION the kept-physical multiples.tsv
                                       pair members, 378,111 ids
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
- **Synthetic-photometry citation**: Gaia Collaboration, Montegriffo P.,
  Bellazzini M., De Angeli F. et al. 2023, *A&A* 674, A33 (Gaia DR3: The Galaxy
  in your preferred colours). DOI:
  [10.1051/0004-6361/202243880](https://doi.org/10.1051/0004-6361/202243880).
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
  - `gaia_dr3_gspc.tsv` ← `synthetic_photometry_gspc` (queried by the
    same catalog source_id request the astrometry pull reads).
  - `gaia_dr2_neighbourhood.tsv` ← `dr2_neighbourhood` (the DPAC
    DR2→(E)DR3 cross-match, Torra et al. 2021; queried by
    dr3_source_id).

## The GSPC validated-range flag — `1` means IN range

The archive publishes `b_jkc_flag` / `v_jkc_flag` as *"Flag indicating if
G mag and BP−RP color of the source lie in the validated range"* and
states no polarity. Montegriffo+ 2023 § 6.2 does: the flag *"has a value
of 1 if the G_BP−G_RP colour and G magnitude of the considered star are
within the ranges where standardisation and validation have been
performed. In practice, the X magnitude of a source with Xflag = 0 should
be considered as an extrapolation of the adopted standardisation."*

The paper gives no numeric box, so the region was measured against
`gaiadr3.gaia_source` (2026-08-15). `flag = 1` has sharp edges:

| axis | flag = 1 where | edge measured between | what sets it (§ 3.2) |
|---|---|---|---|
| `G` | ≳ 10.7 | the 10.50–10.75 and 10.75–11.00 bins | the BP/RP spectrometer configuration change at `G` ≈ 11.5 — onset of gates, window-class switch — which costs XP's *internal* calibration its millimag accuracy |
| `BP − RP` | −0.5 … ≈ 2.6 | the 2.5–2.6 and 2.6–2.7 bins | the Landolt/Stetson standard collections thin out past `BP−RP` ≈ 2 and disagree by 3–5% there |

(The faint side needs no bound — GSPC itself stops at `G` 17.65.)

**This catalogue is almost entirely outside that box**: 96% of it is
brighter than `G` 11, so only 7.0% of the pulled rows are flag-valid in
both bands, and **none at all** of the red rows the ci cascade needs. The
ci cascade therefore records the flag on the row and gates on a measured
colour bound instead — including what the bright edge above costs, which
is not only a standardisation matter (`scripts/catalog/photometry/
README.md` § Why the GSPC tier does not gate on the flag).

Two more things the paper settles about this table, both worth not
re-deriving:

- **The S/N > 30 per-band cut is already applied upstream** (§ 6.2, Eq.
  21): a band whose `flux/flux_error` fails it ships no magnitude at all.
  Verified over all 565,505 magnitudes held here — none is at or below
  30 — so **the build needs no S/N gate of its own**. It is also why B is
  absent where V is present: B is the JKC band the cut bites hardest
  after U (≈87% of GSPC sources keep it).
- **The four flux columns ship unconsumed, by design.** The build reads
  the two magnitudes and the two flags and nothing else; `*_flux_error` is
  an absolute flux in W nm⁻¹ m⁻², so it is unreadable without `*_flux`
  beside it, and the pair is what a future magnitude-uncertainty consumer
  would need. They are also two-thirds of the file: `FLUX_DECIMALS` in the
  pull writes float32's own 7 significant digits, and the committed TSV
  predates that constant by two digits per cell — it narrows on the next
  refresh, which nothing needs to be scheduled for.
- **The JKC flux units are correct.** The paper's note-added-in-proof
  erratum — units should read Hz⁻¹, not nm⁻¹ — covers the **SDSS and PS1**
  flux fields only, and the `y_ps1` hockey-stick bug likewise. Neither
  touches the JKC columns pulled here.

## Consumed by

- `scripts/catalog/build-catalog.ts` — `gaia_dr3_hip_xmatch.tsv` bridges the
  GCVS cross-reference onto `gaia_source_id`, so a record carrying no HIP
  still resolves a variable-star designation. It no longer backfills
  `gaia_source_id` itself: the record build reads each binding off the
  manifest column rather than re-deriving it
  (`scripts/catalog/membership/README.md` § The identifier columns are read,
  never re-derived), leaving the classic-ID overlay's binding gate as the
  cross-walk's only resolution consumer — the astrometry request reads the
  manifest column too (`scripts/catalog/astrometry-request/README.md`). Also: Apsis
  Teff/logg/[M/H]/A0 + GSP-Spec
  `spectraltype_esphs` for the six-tier spectral resolver;
  `gaia_dr3_astrometry_catalog.tsv` as direction-cascade tier 1 and
  the NSS source_id set for the `gaia_nss_systemic` routing tag
  (`scripts/catalog/distance/README.md` § Direction resolution). That same
  table's `phot_{g,bp,rp}_mean_mag` columns are the top tier of the Johnson V
  cascade every record's absmag is derived from — 311,071 of 313,257 stars
  (`scripts/catalog/photometry/README.md`). `gaia_dr3_gspc.tsv` is the ci
  cascade's tier below the Table-5.9 relation, for the red and saturated
  rows the relation's colour bound excludes.
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

`pnpm run refresh:gaia-{hip,tyc,astrometry,astrometry-catalog,nss,apsis,gspc,dr2-neighbourhood}` →
[`scripts/refresh/`](../../scripts/refresh/README.md). DR4 transition
order is documented there. Three pulls read a source_id request file as
input — `refresh:gaia-gspc` reads the same
`gaia_catalog_source_id_request.tsv` as the catalog astrometry pull, so
it has the same ordering constraint:

- `refresh:gaia-astrometry` reads `gaia_astrometry_source_id_request.tsv`,
  so it must run **after** a fresh `pnpm run build:binaries`.
- `refresh:gaia-astrometry-catalog` reads
  `gaia_catalog_source_id_request.tsv`, so it must run **after**
  `pnpm run build:astrometry-request` — which reads the membership manifest
  plus both cross-walks, so it runs after `refresh:gaia-hip` /
  `refresh:gaia-tyc`.
- `refresh:gaia-dr2-neighbourhood` reads
  `gaia_dr2_neighbourhood_request.tsv`, a frozen snapshot of the
  Gaia-only risk set derived from a built `public/catalog.bin` +
  `public/search-index.json` (recipe in docs/sid.md § DR2→DR3 dry
  run).
