# Request-scoped Gaia DR3 pulls

The four pulls that ask `gaiadr3.*` for a list of ids rather than a whole
table, on the TypeScript runtime's `request` scope
([pull/README.md](../pull/README.md)):

| Step | Table | Request | Output |
|---|---|---|---|
| `refresh:gaia-astrometry` | `gaia_source` | `gaia_astrometry_source_id_request.tsv` (`build:binaries`) | `gaia_dr3_astrometry.tsv` |
| `refresh:gaia-astrometry-catalog` | `gaia_source` | `gaia_catalog_source_id_request.tsv` (`build:astrometry-request`) | `gaia_dr3_astrometry_catalog.tsv` |
| `refresh:gaia-gspc` | `synthetic_photometry_gspc` | the catalogue request | `gaia_dr3_gspc.tsv` |
| `refresh:gaia-dr2-neighbourhood` | `dr2_neighbourhood` | `gaia_dr2_neighbourhood_request.tsv` (frozen) | `gaia_dr2_neighbourhood.tsv` |

Every file is under `data/gaia/`; output and request paths are `DATA_FILES`'
(`/src/catalog-format/pipeline-outputs/`). Each request is read through
`sourceIdRequestSource`, the request format's one parse
(`../../catalog/astrometry-request/`); the DR2 request's declaration is
`DR2_NEIGHBOURHOOD_REQUEST` (`../../sid/dr2-neighbourhood-source.ts`), half
of the frozen dry-run pair.

## Files

- `gaia-request-pure.ts` — the `PullTable`s: `ASTROMETRY_COLUMNS`, the one
  astrometry schema both scopes write, each scope's spot rows, GSPC's and
  the DR2 neighbourhood's tables, batch sizes and reach floors.
- `binaries-astrometry-request-source.ts`, `catalog-astrometry-request-source.ts`
  — one request declaration each, so an entry reaches only the request it
  reads ([Reached means read](../../util/sources/README.md#reached-means-read)).
- `gaia-request-outputs.ts` — the four `declareOutputs`.
- `refresh-gaia-{astrometry,astrometry-catalog,gspc,dr2-neighbourhood}.ts` —
  one entry per step, each building its `Pull` over its request.
- `gaia-request.test.ts` — replies recorded from ESA on 2026-11-08 for each
  table's spot rows, and ARI's for the DR2 boolean: each formats to lines of
  the committed table, byte for byte, and passes its spot rows. It also
  holds each committed table in its sort key's order. Replies are inline,
  not files, for the reason [gaia-whole-table/](../gaia-whole-table/README.md)
  gives.

## Formats, order and gates

Measured on ESA and ARI, which answer the same CSV text but for a BOOLEAN:

- **Astrometry.** `ra`/`dec` are DOUBLE, `{fixed: 9}`; `parallax`, `pmra`,
  `pmdec` DOUBLE, `{fixed: 4}`; every `*_error`, `ruwe` and `radial_velocity`
  (+ error) REAL, `{fixed: 4, float32: true}`; the three `phot_*_mean_mag`
  REAL, `{fixed: 6, float32: true}`. `ref_epoch` (`2016.0`) and
  `ipd_frac_multi_peak` pass through. Every spot row pins `ref_epoch` as the
  text `2016.0`: a DR4 swap-in moves it to 2017.5, which epoch propagation
  downstream does not assume.
- **GSPC.** Magnitudes `{fixed: 6, float32: true}`; fluxes `{exp: 6,
  float32: true}` — they span ~1e-19 W nm⁻¹ m⁻², and six digits after the
  point is float32's own width; the two validated-range flags `{flag: true}`,
  which refuses any value besides 0/1
  ([The GSPC validated-range flag](/data/gaia/README.md#the-gspc-validated-range-flag--1-means-in-range)).
  The spot rows pin the flag's polarity in both directions and a row with B
  absent and V present.
- **DR2 neighbourhood.** `angular_distance` (mas, unlike the best-neighbour
  tables' arcsec) and `magnitude_difference` are REAL, `{fixed: 3, float32:
  true}`; `proper_motion_propagation` is a BOOLEAN, `{flag: true}`. Spot rows
  key on `dr3_source_id` with `dr2_source_id` pinned: a same-id carry-forward
  and both DR3 halves of a DR2 source the release split.

Both request files are ascending source_id, so the astrometry and GSPC
tables sort by `source_id` as an integer; the DR2 neighbourhood by
(`dr3_source_id` integer, `angular_distance` decimal).

| Table | Batch | Rows per id | Band | Coverage floor |
|---|---|---|---|---|
| astrometry, both scopes | 5,000 | 1 | [⌈0.95 n⌉, n] for a request of n | none: the band carries it |
| GSPC | 5,000 | 1 | 320,000 – 370,000 | none |
| DR2 neighbourhood | 2,500 | 4 | 5,700 – 6,100 | 0.97 of distinct DR3 ids |

GSPC exists only for sources with published BP/RP spectra and drops this
catalogue's hot-blue and very-red bright ends, so it reaches about 87.6% of
the request; its band is the gate, and coverage reports the share with B and
V both present and both in validated range, never floored — the
validated-range share is a property of how bright the catalogue is, not of
the pull's health. `DR2_ROWS_PER_ID` is the most rows one DR3 id answers in
the committed table, which the test holds; at 2,500 × 4 × 2 + 1 a batch fits
ESA's 50,000.
