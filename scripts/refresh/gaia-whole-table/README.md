# Whole-table Gaia DR3 pulls

The two pulls that take a whole `gaiadr3.*` table rather than a request
set, on the TypeScript runtime ([pull/README.md](../pull/README.md)):

| Step | Table | Output |
|---|---|---|
| `refresh:gaia-hip` | `hipparcos2_best_neighbour` | `data/gaia/gaia_dr3_hip_xmatch.tsv` |
| `refresh:gaia-tyc` | `tycho2tdsc_merge_best_neighbour` | `data/gaia/gaia_dr3_tyc_xmatch.tsv` |

Output paths are `DATA_FILES`' (`/src/catalog-format/pipeline-outputs/`),
the same names the catalogue's sources read.

## Files

- `gaia-whole-table-pure.ts` — the two `PullTable`s: columns, formats,
  sort keys, bands and spot rows.
- `slice-edges.ts` — each table's slice edges on `source_id`.
- `gaia-whole-table.ts` — the two `Pull`s; `gaia-whole-table-outputs.ts`,
  their `declareOutputs`.
- `refresh-gaia-{hip-xmatch,tyc-xmatch}.ts` — one entry per step.
- `gaia-whole-table.test.ts` — replies recorded from ESA on 2026-11-06 for
  the spot rows and the hard cases (float32 near-ties at six decimals,
  scientific notation): each formats to
  lines of the committed table, byte for byte. The replies are inline, not
  files: a non-code file beside an entry's modules is one of the step's
  inputs ([`step-inputs.ts`](../../util/README.md)), so a fixture there
  would stale the pull when edited.

## Slices

Every table is asked in `sliced` scope on `source_id`
([Sliced scope](../pull/README.md#sliced-scope)) so that ESA, whose hard
output limit is 50,000 rows, can serve it when ARI is down. At
`GAIA_SLICE_ROWS` (24,000, the Gaia archive's in `../pull/tap-pure.ts`,
shared with the magnitude-sliced pulls) each slice asks 48,001 rows: HIP is 5 slices,
TYC 105. One TYC slice took 75 s on ESA (2026-11-06).

The edges are `cutEdges` over each committed table's Gaia `source_id`
column (`gaia_source_id`) — an integer, so a slice is
a plain range whatever the archive's text collation. The test counts each
committed table into its slices and fails, printing the re-cut edges, when
one outgrows `GAIA_SLICE_ROWS`; a re-cut changes the description and stales
the pull.

## Formats and order

`angular_distance` is a REAL, written `{fixed: 6, float32: true}`; the id
columns pass through. HIP is ordered by `hip` as an integer, TYC by `tyc` as
text (character order).
