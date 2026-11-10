---
name: stellata-adql
description: Writing or debugging an ADQL/TAP query against the Gaia archive (ESA/ARI), CDS VizieR or SIMBAD — the three dialects' verified differences, which service hosts which table, MAXREC and silent truncation, how to batch a selection too large for one sync query, and how to read the archive's real error instead of a bare HTTP status. Use whenever writing or editing a `scripts/refresh/` pull, composing an ad-hoc TAP probe to measure a premise, or diagnosing a 400/500/empty/truncated result from any of the three services. Load it BEFORE writing the query, not after the first rejection.
---

# ADQL against Gaia, VizieR and SIMBAD

Three services, three dialects, one query language they only mostly share. A
rejected query costs a round trip and an opaque error, and the differences
below are not guessable — every one is verified against the live service.

Plumbing reference: [Gaia TAP](/scripts/refresh/README.md#gaia-tap-synchronous-endpoints-only) and the
`refresh_lib` docstrings. This file is the query-language layer above it.

## Reach the services through `refresh_lib`, never a bare POST

`rl.gaia_sync_client(maxrec)` for `gaiadr3.*` (ESA, ARI Heidelberg fallback),
`rl.cds_client()` for VizieR-only tables (CDS alone, no fallback),
`rl.simbad_client()` for SIMBAD (CDS, Harvard CfA fallback). All three retry and
surface the archive's `QUERY_STATUS` message; only the Gaia client also detects
overflow and fails fast on a parse complaint, both below. An ad-hoc probe gets them by adding `scripts/refresh` to `sys.path` and
importing `refresh_lib` — cheaper than re-deriving any of it, and a probe that
works becomes a pull without a rewrite.

**Which service hosts what is a property of the table, not a preference** —
an ESA→CDS fallback on `gaiadr3.*` reports "table not found" and hides the
real fault, which is why `TapClient` takes `backends=` with no default.

It runs the other way too: ESA carries `external.*` copies of catalogues you
may reach for on VizieR, and the copy you pick decides what you can ASK. The
[Bailer-Jones 2021](/data/papers/index.md#bailerjones2021) distances
are `external.gaiaedr3_distance` on ESA, already on the paper's column names,
where VizieR's `I/352/gedr3dis` carries no magnitude — so only the ESA copy
can be bounded by one. Check both services for a table before accepting the
constraints of the first.

## Verified dialect differences

Measured against the live services 2026-09-19. `OK` means the query ran.

| | Gaia (ESA) | SIMBAD | VizieR |
|---|---|---|---|
| `GROUP BY <expression>` | **400** | — | — |
| `GROUP BY <select alias>` | **500**, not 400 (see below) | — | — |
| `GROUP BY <subquery column>` | OK | — | — |
| `ORDER BY <select alias>` | OK | — | — |
| `ORDER BY <qualified column>` | OK | **400** | — |
| `POWER(x, 2)` | OK | — | — |
| `CASE WHEN … THEN … END` | **400** | — | — |
| `TOP n` | OK | OK | OK |
| `LIMIT n` | **400** | — | — |
| unquoted table id with `/` | — | — | **400** |

Where a cell is `—` the combination has not been measured here; measure it
before relying on it, and add the row.

### `GROUP BY` on Gaia takes a column reference and nothing else

ADQL 2.0 permits only column references in `GROUP BY`. An expression is a
parse error at the `GROUP BY` token — note that the same expression in
`SELECT` and `WHERE` parses fine, so the error's column offset is what tells
you which clause it landed in. Nest it:

```sql
SELECT gbin, COUNT(*) AS n
FROM (SELECT FLOOR(phot_g_mean_mag * 4) AS gbin
      FROM gaiadr3.gaia_source WHERE phot_g_mean_mag <= 11.0) AS t
GROUP BY gbin ORDER BY gbin
```

**Grouping by the SELECT alias instead answers 500, not 400** — a parse fault
under a transient-looking status, which only the error body exposes
([Reading the real error](#reading-the-real-error)).

There is no `CASE`, so a conditional aggregate has no one-query form. Count
the subset with a second query carrying the extra predicate rather than
reaching for `SUM(CASE WHEN …)`.

### SIMBAD

`ORDER BY` rejects a qualified column name (`ORDER BY b.oid` fails, `ORDER BY
oid` works) even where the same alias is required elsewhere in the query.
`LIKE` is forbidden on `basic.otype`; `MOD()` exists but the `%` operator does
not. SIMBAD's long-format `flux` table carries bibcodes and `allfluxes` does
not — which is a policy constraint here, not just a schema one
([§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers)).

### VizieR

Double-quote every identifier: table ids contain `/`, and column names are
case-sensitive and may carry parentheses. `SELECT TOP 2 HIP FROM
I/239/hip_main` is a parse error on the slash. Prefer `rl.select_columns()`,
which quotes for you, and `vizier_slice.py` for the whole-table-subset case.

## MAXREC, and the truncation that answers 200

A MAXREC below the result size silently shortens a sync result: HTTP 200, no
error. `FORMAT=votable` flags it only in a trailing `QUERY_STATUS=OVERFLOW`
INFO; **a `FORMAT=csv` reply carries no status at all**, just MAXREC rows
(ESA, ARI, SIMBAD-Harvard, 2026-11-05). Error replies stay VOTable under
`FORMAT=csv`, so the archive's message is still readable.

So every query that cannot read the flag checks its own row count: ask for
`limit + 1` rows and refuse more than `limit`. The TS backend does this on
every query ([The TAP backend](/scripts/refresh/pull/README.md#the-tap-backend)).
In `refresh_lib`, only `gaia_sync_client` reads the flag, raising
`SyncOverflowError`, which is deliberately not transient; `cds_client` and
`simbad_client` run through pyvo, which demotes it to a `DALOverflowWarning`
and returns the truncated table. A raw POST, or pyvo's `search(maxrec=)`, asks
with `MAXREC = limit + 1` — pyvo gives no warning for a result exactly at its
`maxrec`. `cds_client` and `simbad_client` take no MAXREC and run at the server
default, so ask with `TOP limit + 1` in the ADQL.

**A mirror also truncates at its own hard output limit**, whatever MAXREC asks:
read `<outputLimit><hard>` from `<url>/capabilities` before trusting a count.
2026-11-05: ESA 50,000, ARI 10,000,000, SIMBAD-Harvard 2,000,000. A whole
table past a mirror's limit is cut into committed `source_id` ranges
([Sliced scope](/scripts/refresh/pull/README.md#sliced-scope)); ESA answered
a 24,000-row range of `tycho2tdsc_merge_best_neighbour` in 75 s
(2026-11-06). The Python Gaia pulls' MAXREC sizing rules are in
[Gaia TAP](/scripts/refresh/README.md#gaia-tap-synchronous-endpoints-only);
never replace one with a bare literal.

MAXREC is not load-bearing on CDS, whose default is ~1e9; there the row-count
band is what catches an upstream row loss. SIMBAD's is: its default is 50,000
rows, so a `simbad_client` query over 50,000 rows comes back truncated with
only a warning.

## Batching a selection with no request set

A selection defined by a value bound rather than an id list still needs
batching past a few hundred thousand rows: one sync query has no resume point
and a 300 s timeout. Slice on the bound itself, and size the slices by their
**populations** rather than their widths — for a magnitude bound, counts grow
geometrically, so equal magnitude steps give a 27x spread. The runtime's
`sliced` scope does this: edges cut by `cutEdges` from the committed table's
own values, half-open ranges sharing each edge literal, so no row is asked
twice. `refresh:gaia-magnitude` is the worked example;
[Slicing a magnitude-bounded pull](/scripts/refresh/magnitude/README.md#slicing-a-magnitude-bounded-pull) carries it.

`phot_g_mean_mag` is indexed on ESA (a bounded `COUNT(*)` over the
1.8-billion-row table returns in ~2 s), so a slice is no full scan.

**A table with no magnitude of its own is still sliceable: join to
`gaiadr3.gaia_source` for the bound.** Both sides key on the indexed
`source_id`, so the slice costs about what an unjoined one does — ~4 s for
~26 k rows out of `external.gaiaedr3_distance` or
`gaiadr3.astrophysical_parameters`, against ~5.5 h to pull the same scope as
5000-id IN-clauses. Qualify the projection but do NOT rename it
(`SELECT t.source_id, t.teff_gspphot …`): the result carries the bare column
names, so a joined leg and an IN-clause leg feed one collector unchanged.

**Add a predicate to that join and it stops being cheap.** A bare joined
`COUNT(*)` under the bound returns in ~20 s, but the same count with
`AND a.teff_gspphot IS NOT NULL` answers **408 "Job timeout/aborted"**. Sample
the predicate over two or three real slices and extrapolate instead — a
coverage fraction does not need the whole table to be trustworthy.

## Reading the real error

The TS backend, and `refresh_lib` on the Gaia sync path, lift the VOTable
`QUERY_STATUS` message into the raised error for any non-2xx response, so a
pull names the rejected clause — and a complaint naming one fails fast instead
of spending the backoff schedule on every mirror. Only the parsed message is
read that way: a proxy's HTML page saying "not found" must still fail over to
the next mirror. On `refresh_lib`'s CDS and SIMBAD clients, pyvo raises
`DALQueryError` carrying the same message, but `is_transient_http_error`
counts it transient, so it arrives only after every backend's retries are
spent. Code that bypasses all of these POSTs directly and prints `resp.text`:
the status line never names the fault, and `raise_for_status()` discards the
body that does.

Empty result, no error, is the other shape. Check the obvious first: a
magnitude or colour column that is NULL satisfies neither `>` nor `<=`, so a
half-open slice silently excludes every null-valued row — which is usually
right, but only if you decided it.

## Measure the premise before you build on it

[§ 9](/docs/catalog-driver.md#9-testing-a-proposed-identifier-rule-before-building-it) is the authority and applies to every query
written here: a stated rule in this space routinely rests on a claim a second
witness refutes, and a TAP count costs seconds against an implementation plus
a revert. Ask the archive for the count, the max, and the boundary case before
writing the script that assumes them. Record a refutation where the next
session meets it — the bead's close reason and the relevant README — or it
gets re-proposed.

## Keep this skill current — do this without being asked

While writing or debugging a TAP query, if you ever:

- hit a dialect rejection this file does not predict,
- found a row here wrong or contradicted by the live service,
- measured a cell this file leaves as `—`, or
- **had the user correct a query or a pull of yours.**

then **edit this file in that same session.** Do not ask permission and do not
defer it; an unrecorded rejection is a round trip every future session repeats.

The last trigger is the one skipped: treat a correction as a defect in this
file until proven otherwise.

How to edit it well:

- **Verify against the live service before writing.** Run the query. Never
  record remembered syntax, and never record a gotcha you did not hit — a
  plausible-looking row nobody measured is worse than an empty cell, because
  the empty cell says "measure me".
- **Fix the principle, not the incident.** Write the rule that catches the
  class. An incident belongs in the commit message, not here.
- **Every edit includes a concision pass over the WHOLE file.** A skill that
  only grows stops being read, and every future session pays its length. Aim
  net-neutral: a new rule pays for itself out of prose already here. Check it
  with `wc -l` before and after. Cut filler, never facts — queries, status
  codes, measured timings and table rows all stay.
- **Push detail down, keep the trigger here.** Where `scripts/refresh/README.md`
  or a `data/*/README.md` already owns a rule, point at it in one line rather
  than restating it; two copies drift and the copy here is the one that goes
  stale.
