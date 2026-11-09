# The magnitude-bounded selection

The pulls whose scope is a **bound on `phot_g_mean_mag`** rather than a list of
ids, on the TypeScript runtime ([pull/README.md](../pull/README.md)): the
magnitude pull itself, and the two tables pulled over the deep population
built on it. The refresh policy and the per-target table are the parent's
(`../README.md`).

| Step | Table | Output |
|---|---|---|
| `refresh:gaia-magnitude` | `gaiadr3.gaia_source` | `data/gaia/gaia_dr3_magnitude_pull.tsv` |
| `refresh:gaia-apsis` | `gaiadr3.astrophysical_parameters` | `data/gaia/gaia_dr3_apsis.tsv` |
| `refresh:bailer-jones` | `external.gaiaedr3_distance` (ESA only) | `data/bailer-jones/bailer-jones-dr3.tsv` |

Output paths are `DATA_FILES`' (`/src/catalog-format/pipeline-outputs/`).

## Files

- `magnitude-pure.ts` — `G_MAG_FLOOR`, `magnitudeBound` (the floor as a
  `WHERE` and its slices on a named G column), and the magnitude pull's
  `PullTable` on `ASTROMETRY_COLUMNS` (`../gaia-request/`).
- `magnitude-edges.ts` — `MAGNITUDE_EDGES`, the slices' edges.
- `deep-population-pure.ts` — `deepPopulationPull`, the two-leg
  `PhasedPull` every deep-population table is.
- `deep-population-tables-pure.ts` — the Apsis and Bailer-Jones tables:
  columns, formats, the magnitude leg's band, spot rows and extra gates.
- `magnitude-outputs.ts` — the three `declareOutputs`.
- `refresh-gaia-{magnitude,apsis}.ts`, `refresh-bailer-jones.ts` — one entry
  per step; the two deep-population entries read the catalogue request through
  `CATALOG_ASTROMETRY_REQUEST` (`../gaia-request/`).
- `magnitude.test.ts`, `deep-population.test.ts` — replies recorded from ESA
  on 2026-11-09 formatting to lines of each committed table byte for byte
  (`../pull/recorded-reply.ts`), each committed table's order, the magnitude
  slices held within `GAIA_SLICE_ROWS`, and the two legs run against a faked
  transport. Replies are inline, for the reason
  [gaia-whole-table/](../gaia-whole-table/README.md) gives.

## Slicing a magnitude-bounded pull

The magnitude pull is 1.25 M rows, too many for one sync query, and no id list
scopes it, so it is asked in `sliced` scope on `phot_g_mean_mag`
([Sliced scope](../pull/README.md#sliced-scope)) under `WHERE
phot_g_mean_mag <= 11`. The edges are `cutEdges` over the committed table's
`phot_g_mean_mag` at `GAIA_SLICE_ROWS` (24,000): 51 edges, 52 slices of
23,257 to 24,000 rows, each asking 48,001 rows so ESA, whose hard output limit
is 50,000, can serve every slice as well as ARI. The test counts the committed
table into its slices and fails, printing the re-cut edges, when one outgrows
`GAIA_SLICE_ROWS`; a re-cut changes the description and stales all three pulls.

**One edge list serves all three pulls.** The deep-population tables' magnitude
legs join each slice to `gaiadr3.gaia_source` and select the same sources, so
no slice of theirs holds more rows than the magnitude pull's. A floor that
drifted between them would leave the enrichment tables covering a different set
of records than the magnitude term admits, so `G_MAG_FLOOR` and the edges are
stated once, here ([Why the floor carries no margin](/data/gaia/README.md#why-the-floor-carries-no-margin)).

### Moving the floor

The edges are cut from the committed table, which holds no row past the floor,
so they cannot cover a deeper one: at `G_MAG_FLOOR` 11.5 the last slice would
ask about 360,000 rows against a 48,000 limit and every mirror would refuse it.
`magnitude.test.ts` holds the committed table's faintest G within 0.001 mag of
`G_MAG_FLOOR`, so a moved floor fails there first. To move it, count the new
range on the archive in bins (`SELECT FLOOR(phot_g_mean_mag * 1000) AS bin,
COUNT(*) FROM gaiadr3.gaia_source WHERE phot_g_mean_mag > 11 AND
phot_g_mean_mag <= <floor> GROUP BY bin`), cut edges past the last one so no
slice passes `GAIA_SLICE_ROWS`, re-pull all three tables, then re-cut the whole
list from the new committed table.

The 52 slices at their limits would hold 47.4 M cells over 19 columns; the
pull is bounded instead by its band ceiling plus one slice, 25.1 M
([How big a table may be](../pull/README.md#how-big-a-table-may-be)). The
deep-population magnitude legs are bounded the same way, Apsis at 11.8 M cells
(9 columns) and Bailer-Jones at 10.5 M (8); their runs also hold every row's
cell reader and the magnitude leg's `source_id` set, and that cost is
unmeasured.

## The deep population — a bounded leg plus a request leg

[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) and Apsis are scoped
to every source the catalogue's RECORDS can reach, which takes two legs: that
population has two definitions and neither contains the other.
`deepPopulationPull` is the one statement of the shape; each table supplies its
columns, its magnitude leg's band, its spot rows and any further gates.

- The **magnitude leg** is a selection — every source at the floor or
  brighter, which no request set names because nothing binds most of them yet.
  Neither table carries a magnitude, so the phase is sliced on
  `g.phot_g_mean_mag` over `<table> AS t JOIN gaiadr3.gaia_source AS g ON
  g.source_id = t.source_id`, projecting `t.<column>`; both sides are keyed on
  the indexed `source_id`, so the join costs about what the slice does. Its
  `maxRows` is the leg's band ceiling.
- The **request leg** is `gaia_catalog_source_id_request.tsv`, whose classic
  tiers reach fainter than the floor, restricted to the ids the magnitude leg
  did not return, in `source_id IN` batches of 5,000. That restriction keeps
  each source to one row.

**Both legs need a gate, and they are different gates.** The magnitude leg
answers to its own row band; that says nothing about the request leg, so a
request leg returning nothing would otherwise pass every check and drop exactly
the promoted companions the union exists to reach. The second gate is coverage
of the request by either leg, floored at 0.90 (`MIN_REQUEST_COVERAGE`). The
written table's band runs from the leg's minimum to its maximum plus the
request's size.

| Table | Magnitude-leg band | Extra gates |
|---|---|---|
| Apsis | 1,222,000 – 1,260,000 | Teff and log g from either pipeline ≥ 0.80; `spectraltype_esphs` resolved (not empty, not `unknown`) ≥ 0.90 |
| Bailer-Jones | 1,210,000 – 1,262,000 | photogeo / geo coverage reported, never floored |

Formats: Apsis `teff_*` `{fixed: 1, float32: true}`, `logg_*` / `mh_*` /
`azero_gspphot` `{fixed: 4, float32: true}`, `spectraltype_esphs` passes
through; Bailer-Jones `r_*` `{fixed: 3, float32: true}`, `flag` (a five-digit
decision-tree code) passes through. Every spot row is required: a pinned
`source_id` missing from a static release means the scope moved.

**Bailer-Jones is asked of ESA alone** (`GAIA_ESA`). ARI hosts the same eight
columns as `gaiaedr3_complements.distances`, under a different name from ESA's
`external.gaiaedr3_distance`, so one query cannot serve both mirrors; why the
pull is ESA-side rather than VizieR's:
[Why the pull is ESA-side](/data/bailer-jones/README.md#why-the-pull-is-esa-side).

Reading the exported union rather than the manifest is what closes the
asymmetry [The staleness gate](../README.md#the-staleness-gate--pin-the-shortfall-never-the-numerator) names.
