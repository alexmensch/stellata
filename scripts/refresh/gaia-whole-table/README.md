# Whole-table Gaia DR3 pulls

The three pulls that take a whole `gaiadr3.*` table rather than a request
set, on the TypeScript runtime ([pull/README.md](../pull/README.md)):

| Step | Table | Output |
|---|---|---|
| `refresh:gaia-hip` | `hipparcos2_best_neighbour` | `data/gaia/gaia_dr3_hip_xmatch.tsv` |
| `refresh:gaia-tyc` | `tycho2tdsc_merge_best_neighbour` | `data/gaia/gaia_dr3_tyc_xmatch.tsv` |
| `refresh:gaia-nss` | `nss_two_body_orbit` | `data/gaia/gaia_dr3_nss_two_body.tsv` |

Output paths are `DATA_FILES`' (`/src/catalog-format/pipeline-outputs/`),
the same names the catalogue's sources read.

## Files

- `gaia-whole-table-pure.ts` — the three `PullTable`s: columns, formats,
  sort keys, bands, spot rows, and `GAIA_SLICE_ROWS`.
- `slice-edges.ts` — each table's slice edges on `source_id`.
- `gaia-whole-table.ts` — the three `Pull`s; `gaia-whole-table-outputs.ts`,
  their `declareOutputs`.
- `refresh-gaia-{hip-xmatch,tyc-xmatch,nss}.ts` — one entry per step.
- `gaia-whole-table.test.ts` with `{hip-xmatch,tyc-xmatch,nss}.fixture.csv`,
  replies recorded from ESA on 2026-11-06 for the spot rows and the hard
  cases (float32 near-ties at six decimals, scientific notation, an NSS
  source with two solutions): each formats to lines of the committed table,
  byte for byte.

## Slices

Every table is asked in `sliced` scope on `source_id`
([Sliced scope](../pull/README.md#sliced-scope)) so that ESA, whose hard
output limit is 50,000 rows, can serve it when ARI is down. At
`GAIA_SLICE_ROWS` (24,000) each slice asks 48,001 rows: HIP is 5 slices,
TYC 105, NSS 19. One TYC slice took 75 s on ESA (2026-11-06).

The edges are `cutEdges` over each committed table's Gaia `source_id`
column (`gaia_source_id` in the two cross-walks) — an integer, so a slice is
a plain range whatever the archive's text collation. The test counts each
committed table into its slices and fails, printing the re-cut edges, when
one outgrows `GAIA_SLICE_ROWS`; a re-cut changes the description and stales
the pull.

## Formats and order

- **Cross-walks:** `angular_distance` is a REAL, written `{fixed: 6,
  float32: true}`; the id columns pass through.
- **NSS:** each orbital element is a DOUBLE and its `_error` a REAL, as are
  `goodness_of_fit` and `significance`, all written as Python wrote them
  (`{repr: true}`, `float32` on the REALs).
- **Order:** HIP by `hip` as an integer, TYC by `tyc` as text (character
  order), NSS by `source_id` then `nss_solution_type`. 5,926 NSS source_ids
  carry two solutions; `scripts/binaries/` keeps the last row per source_id,
  so the second key decides which orbit it reads.
