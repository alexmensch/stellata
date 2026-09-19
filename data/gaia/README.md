# Gaia DR3 — cross-walks, astrometry, NSS orbits, Apsis

Per-Gaia-source pulls keyed on Gaia DR3 `source_id`. Together they
supply: HIP/Tycho cross-IDs (so non-Gaia identifiers reach the
DR3 source space); 5-parameter astrometry for resolved sources;
two-body orbital solutions from the NSS pipeline; `gspphot ∪
gspspec` astrophysical parameters (Teff, log g, [M/H], A0, GSP-Spec
spectral type enum); and the magnitude-bounded population that is
membership's second term.

```
gaia_dr3_hip_xmatch.tsv                ~3.7 MB, LFS. HIP → DR3 source_id.
gaia_dr3_tyc_xmatch.tsv                ~106 MB, LFS. Tycho-2 → DR3 source_id.
gaia_dr3_astrometry.tsv                ~1.2 MB, LFS. 5p astrometry for the
                                       resolved source_ids Stage 2 requests.
gaia_dr3_astrometry_catalog.tsv        ~58 MB, LFS. 5p astrometry +
                                       radial_velocity{,_error} for every
                                       catalog source_id, both binding gates'
                                       candidates and the bound-pair
                                       siblings (379,133 rows) — tier 1 of
                                       the direction, rv, V and ci cascades,
                                       the G evidence the overlay gate and the
                                       membership derivation weigh, and the
                                       parallax cascade's sibling tier.
gaia_dr3_magnitude_pull.tsv            ~200 MB, LFS. Every gaia_source row at
                                       G <= 11 (1,247,240) on the SAME schema
                                       as the two astrometry pulls — the
                                       magnitude term of membership
                                       (docs/catalog-driver.md § 1), floor-
                                       agnostic below V <= 11. Not keyed on a
                                       request set: its selection is the
                                       magnitude bound itself.
gaia_dr3_nss_two_body.tsv              ~90 MB, LFS. NSS two-body orbits.
gaia_dr3_apsis.tsv                     ~20 MB, LFS. gspphot ∪ gspspec
                                       Teff/logg/[M/H]/A0 + spectraltype_esphs.
gaia_dr3_gspc.tsv                      ~31 MB, LFS. Johnson-Kron-Cousins B and
                                       V synthesised from each source's BP/RP
                                       spectrum, + fluxes, flux errors and the
                                       per-band validated-range flag. 342,953
                                       rows, pulled against the catalog request
                                       at its then-size of 378,840 ids — the ci
                                       cascade's tier below the Table-5.9
                                       relation.
gaia_astrometry_source_id_request.tsv  ~440 KB, LFS. Stage 2 → Stage 3 deduped
                                       source_id request list (build-binaries.py output).
gaia_catalog_source_id_request.tsv     ~7.2 MB, LFS. Full-catalog deduped
                                       source_id request list — the membership
                                       manifest's gaia_source_id column UNION
                                       the classic-ID binding gate's candidates
                                       UNION the membership derivation's
                                       candidates UNION the kept-physical
                                       multiples.tsv pair members, 379,135 ids
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
  - `gaia_dr3_magnitude_pull.tsv` ← `gaia_source` (same schema again,
    selected on `phot_g_mean_mag` rather than on a source_id list).
  - `gaia_dr3_nss_two_body.tsv` ← `nss_two_body_orbit`.
  - `gaia_dr3_apsis.tsv` ← `astrophysical_parameters` (gspphot ∪
    gspspec).
  - `gaia_dr3_gspc.tsv` ← `synthetic_photometry_gspc` (queried by the
    same catalog source_id request the astrometry pull reads).
  - `gaia_dr2_neighbourhood.tsv` ← `dr2_neighbourhood` (the DPAC
    DR2→(E)DR3 cross-match, Torra et al. 2021; queried by
    dr3_source_id).

## The floor is apparent magnitude, seen from Sol

`V <= 11` is **apparent** Johnson V — what a photometer at Sol measures — not
absolute magnitude and not a distance bound. It derives from Gaia's
*observed* `phot_g_mean_mag`, so interstellar dust is in it: the build
subtracts the Sol→star extinction when it derives `absmag`
(`../../scripts/catalog/distance/dust/README.md` § Why the build subtracts),
but membership is decided on the reddened value the archive publishes.

Catalogue completeness is therefore a Sol-centred bubble whose radius depends
on how luminous the star is, which is the shape worth holding rather than the
magnitude (AGENTS.md § Camera-anywhere, any-epoch):

| Star | `M_V` | Complete to |
|---|---|---|
| supergiant | −7 | 39,800 pc |
| B main sequence | −1 | 2,512 pc |
| Sun-like | +4.8 | 171 pc |
| early M dwarf | +9 | 25 pc |
| mid M dwarf | +12 | 6 pc |

Dust shortens every row of that along a plane sightline, so the bubble is not
round either. The pulled population is accordingly dominated by distant
luminous stars rather than by the solar neighbourhood — by naive parallax
inversion **0.7%** of the 1,247,240 rows lie inside 50 pc and **72%** beyond
500 pc.

**Apparent is forced, not preferred.** Gaia is an apparent-magnitude-limited
survey, so no absolute-magnitude-complete population exists to select from: a
star nobody detected has no measured distance to convert. What follows for a
consumer is that "complete to `V <= 11`" is a claim about Sol's sky and never
about the modelled volume — moving the camera outward does not arrive
somewhere the catalogue stays complete around it.

## Why the floor carries no margin

`gaia_dr3_magnitude_pull.tsv` selects on `G` alone, at `G <= 11`, and that
is complete for a `V <= 11` floor with nothing to spare and nothing needed.

The V cascade's top tier is `V = G − f(BP−RP)`, `f` the Riello+ 2021 cubic
(`scripts/catalog/photometry/README.md`). **`f` is negative across its whole
validity range**, peaking at **−0.02680** at `BP−RP` 0.0331, so every source
the transform accepts has `V >= G + 0.0268`. A `V <= 11` source therefore
cannot carry `G` above **10.97208** — which is exactly the maximum the
archive reports over that population, and the count of `V <= 11` sources in
`11 < G <= 11.5` is **0** (ESA TAP, 2026-09-19). `{V ≤ 11} ⊂ {G ≤ 11}`,
strictly. `v-magnitude-pure.test.ts` pins the peak so a successor
calibration that turned it positive fails rather than silently shortening
the pull.

**The intuition a margin protects against is the wrong sign.** Gaia's `G`
passband is broader than Johnson V, so `G` is the *brighter* number, and the
pull over-reaches the floor rather than falling short of it: the filter in
`cns.5` drops the red rows whose `V` exceeds 11. Adding 0.5 mag of margin
would carry **725,768** rows past the floor — every one of them `V > 11` by
construction, and ~120 MB of LFS to hold them.

Moving the floor is a re-pull, not a redesign, and costs about four minutes
of wall clock — which is the other half of why no margin is warranted.

### What the filter keeps, and what falls through it

Running the shipped `rielloVMagnitude` over every row — the function itself,
so this is the population the V cascade's top tier admits rather than a
restatement of the cubic:

| | rows |
|---|---|
| `V <= 11`, transform applies | **929,929** |
| `V > 11`, transform applies | 312,475 |
| no transformed V | 4,836 |
| | 1,247,240 |

**929,929, not the 930,562 an ESA TAP count of the same population reports.**
The difference is exactly the **633** saturated rows that carry an in-range
colour: `calibratedPhotometry` refuses `G` below
`GAIA_PHOTOMETRY_SATURATION_G`, and a TAP predicate written as a colour range
alone does not. The gate is the authority — those 633 are among the brightest
stars in the sky and reach their V through the printed tier instead.

The 4,836 rows no transform serves, against whether the membership term this
pull is unioned with (`docs/catalog-driver.md` § 1) already holds them:

| cohort | rows | of those, bound in the manifest |
|---|---|---|
| saturated, `G < 4` | 634 | 624 |
| `BP-RP > 5` | 3,250 | 211 |
| a band missing | 943 | 18 |
| `BP-RP < -0.5` | 9 | 2 |

**Only the saturated cohort is covered by a designation**, so completeness for
the other three rests on something else. For the red rows it rests on the
physics and holds: at `BP-RP` 5 the relation already gives `V ≈ G + 3.56`, so
every one of them is far past the floor however the extrapolation is read.
The **943** with no colour at all are the genuine residue — `G` 6.95 to
10.99992, no tier able to reach them, and 925 carrying no designation for a
printed tier to key on. `V >= G + 0.0268` does not bound them from above, so
`G <= 11` decides nothing about their floor membership. `stellata-cns.11` owns
the rule; until it settles they are dropped, unledgered.

## The record total the floor implies — ~990,299

The catalogue is not the magnitude pull. It is the pull's `V <= 11` population
**unioned** with the membership manifest and deduped on `source_id`, and the
size of the overlap was the open question blocking every sizing decision under
`stellata-cns`. Measured on the committed files, 2026-09-19:

| term | count |
|---|---|
| `V <= 11` source_ids from the pull | 929,929 |
| distinct `gaia_source_id` in the manifest | 370,994 |
| in both | **327,701** |
| source_id union | **973,222** |
| manifest rows carrying no `gaia_source_id` | 5,938 |
| rows the build promotes to their own record | 11,139 |
| **records** | **~990,299** |

That replaces the `[930,562 … 1,307,491]` bracket with one number, and makes
the catalogue **2.55x** today's 388,071 records. The last term is the only
soft one: it is today's gap between 376,932 manifest rows and 388,071 built
records, carried forward on the assumption that promotion is driven by the
classic-ID population rather than by the deep one.

**43,293 of the manifest's bindings sit outside the kept set** — stars fainter
than the floor that the classic-ID term keeps deliberately (Proxima, `V ≈
11.1`), plus the 855 pull rows no transform served that a designation reaches
anyway. The floor bounds the magnitude term, never the catalogue.

Reproduce by streaming the pull through `rielloVMagnitude` and intersecting
the kept `source_id`s against the manifest's `gaia_source_id` column. **Key on
strings**: a Gaia `source_id` runs to 19 digits and loses precision silently
as a float64.

### What that costs on the wire

`RECORD_SIZE` is 100 bytes (`scripts/catalog/record/README.md`), so the record
array is linear in the count. Compression measured on a build of today's
catalogue — 388,071 records, 38,814,407 bytes over three chunks — is **0.6545**
for `gzip -9` and **0.6224** for brotli quality 5. Sizes in MiB, as the build
log prints them:

| | today | at `V <= 11` |
|---|---|---|
| `catalog.bin` raw | 37.0 | 94.4 |
| `gzip -9` | 24.2 | **61.8** |
| brotli-5 | 23.0 | **58.8** |

61.8 MiB is 64.8 MB decimal, which supersedes the **~82 MB gz** `cns.6` was
written against — that figure scaled the 1,247,240 pull count rather than the
record total. Read the projections as an upper bound: the deep population
carries more absent enrichment than today's, and sentinel runs compress better
than measured values.

Two sidecars scale alongside and are in none of those numbers:
`search-index.json` (17.9 MB raw, 4.3 MB gz today) and
`catalog-row-index-map.json` (12.7 MB, 5.3 MB), the second keyed on
`source_id` and so tracking the union directly. `cns.6` owns the chunking
call these totals drive.

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
  manifest column, where `build:membership` derived it from both cross-walks,
  CNS5 and SIMBAD through the binding gates
  (`scripts/catalog/membership/README.md` § The binding is derived) — the
  membership generator and the classic-ID overlay build are the cross-walks'
  two resolution consumers, and the astrometry request reads the manifest
  column plus both of their candidate sets
  (`scripts/catalog/astrometry-request/README.md`). Also: Apsis
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

`pnpm run refresh:gaia-{hip,tyc,astrometry,astrometry-catalog,nss,apsis,gspc,magnitude,dr2-neighbourhood}` →
[`scripts/refresh/`](../../scripts/refresh/README.md). DR4 transition
order is documented there. `refresh:gaia-magnitude` has no input beyond its
own magnitude bound, so it runs at any point in that order. Three pulls read
a source_id request file as input — `refresh:gaia-gspc` reads the same
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
