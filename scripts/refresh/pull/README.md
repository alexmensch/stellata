# Pull — the TypeScript refresh runtime

What a TypeScript pull does when it runs: one TAP backend for Gaia, VizieR and
SIMBAD. A pull is a `pull` step on the step table
([Step kinds](../../pipeline/README.md#step-kinds)); the runner never runs it,
`record.ts` does, and its committed record is `data/stamps/<step>.json`.

## Files

- `tap-pure.ts` (+ test) — the backend: the three archives, the sync query,
  the reply's classification, `tapClient`, `SIMBAD_BATCH_SIZE`, the ids
  one SIMBAD `IN (…)` batch may carry, and `GAIA_SLICE_ROWS`, the rows one
  sliced Gaia query holds.
- `unverified-mirrors.test.ts` — no committed `data/stamps/` record answered by
  a mirror whose `verified` flag is false.
- `columns-pure.ts` (+ test) — a table's `Column` list and everything derived
  from it: the projection, the reply's schema check, the TSV.
- `gates-pure.ts` (+ test) — the row band, spot rows and coverage, each an
  `emitArtifacts` check.
- `slices-pure.ts` (+ test) — the sliced scope's key ranges: their ADQL
  conditions, per-slice counts, and cutting edges from a table.
- `checkpoint.ts` — the resume cache.
- `recorded-reply.ts` — for a pull's own tests: a reply recorded from the
  archive replayed into a committed table's lines, the committed table's rows,
  and its slices measured against `sliceRows`.
- `pull.ts` (+ test, the faked-transport acceptance cases) — the `Pull` and
  `PhasedPull` types, `describePull` / `describePhasedPull`, `runPull` /
  `runPhasedPull`, and `LIVE`, the network transport.

## A pull

```ts
export const pull: Pull<'xmatch'> = { archive: GAIA, outputs: XMATCH_OUTPUTS, release: GAIA_DR3_RELEASE, tables: { xmatch: {…} } };
export const describe = () => describePull(pull);
export const main = () => runPull(pull);
```

A `Pull` is an archive, the step's `declareOutputs` constant, and one
`PullTable` per declared output: `from`, optional `where` and `orderBy`, its
columns, its sort key, a scope, and its gates. **A table without a row band,
at least one spot row, or a sort key does not compile.**

**The sort key is the written order.** An archive's row order is not stable
across runs and a server `ORDER BY` cannot order across batches, so
`runPull` sorts every row of a table, all batches together, by `sortBy`
before writing: each key a column compared as `integer` (exactly, through
`BigInt`, so a source_id past 2^53 orders right), `decimal` or `text` (code
unit), an empty cell first (`sortRows`). A re-pull of unchanged data writes
the same bytes. `orderBy` is only for a query that needs a server order, such
as one under `TOP`. Scopes:

- `whole-table` — one query, limit `band.max × LIMIT_HEADROOM`, within
  [How big a table may be](#how-big-a-table-may-be).
- `request` — the ids (ADQL literals, answering in `idColumn`) ANDed onto `where` as
  `<key> IN (…)`, `batchSize` per query, limit
  `batchSize × rowsPerId × LIMIT_HEADROOM`; optional coverage over the ids.
- `sliced` — a whole table too big for one mirror's reply, one query per
  key range ([Sliced scope](#sliced-scope)), limit `sliceRows × LIMIT_HEADROOM`,
  within the same bound.

`LIMIT_HEADROOM` (2) leaves room for a moved table to reach the band gate,
which reports its count, rather than the overflow, which cannot.

`describePull` states, per table, everything besides the data that decides
its bytes — its query with the request ids left as `{request}`, its
column formats and its sort key — plus the mirror list and release: what the record's query
hash covers ([Freshness](../../pipeline/README.md#freshness--one-mechanism)),
so a changed column, `WHERE`, rounding, order or mirror stales the pull and a
changed id list does not, except through the pull's inputs.

`runPull` queries every table, gates every one, then makes one
`emitArtifacts` emission of all its outputs: a failed gate, query or schema
check anywhere leaves every prior output byte-identical.

### A phased pull

A `PhasedPull` is for a pull whose later queries take their ids from earlier
answers, as every manifest-keyed SIMBAD pull does (identifier → oid, then
oid → columns). It declares its `phases` (a `Phase` is a table's query without
its ids: whole-table with the most rows it may return, sliced as a static
table is plus that same `maxRows`, or request-scoped by key, batch size and rows per id), its written `tables` (columns, sort key,
band, spot rows), optionally the `request` it derives and the files it comes
off and the `parameters` that decide its bytes besides its queries (a seed,
a draw's targets), and a `run(ask)` that composes the rows. `ask(phase, ids)` is the same
batched, checkpointed, header-checked query a static table gets, and it
**refuses a phase the pull does not declare**, so `describePhasedPull`, which
states every phase's template, each table's formats and order, the
parameters and the request, covers every query the run can send. `runPhasedPull` gates and emits
as `runPull` does, plus whatever checks `run` returns; `runPull` is a phased
pull of one phase per table.

### How big a table may be

`runPull` holds every row of a table at once — its parsed cells, their sorted
copy and the TSV written from them — and for a whole-table table the reply
text too. A whole-table or sliced phase states `maxRows`, the most rows it may
hold over all its queries (a static table's is its band's `max`), and `ask`
refuses it, naming the count, once its rows pass that. So it holds at most
`min(query count × limit, maxRows + limit)` rows, and `runPull` refuses,
before any query, one whose held rows × column count could exceed
`MAX_TABLE_CELLS` (30,000,000). A request-scoped table is not bounded this
way.
Measured 2026-11-05 under Node 26, the committed `gaia_dr3_tyc_xmatch.tsv` (5
columns) replayed through `runPull` and a fake transport, peak live heap by
`watchHeap` ([CI heap budget](../../util/heap-budget/README.md)):

| Rows | Cells | Reply | Peak live heap | Wall |
|---|---|---|---|---|
| 2,518,330 | 12.6 M | 106 MiB | 1,855 MiB | 5.7 s |
| 5,036,660 | 25.2 M | 212 MiB | 2,681 MiB | 11.6 s |

That is about 69 bytes per cell over about 1,029 MiB fixed (the harness's own
copies of the reply among it). The magnitude table (19 numeric columns),
replayed the same way on 2026-11-09 from its 52 slices: 1,247,240 rows, 23.7 M
cells, peak live heap **2,949 MiB**, 17.3 s — about 85 bytes per cell over the
same fixed cost, though that harness also held the committed text and a CSV
copy of every slice. At 85 bytes per cell the 3,482 MiB budget holds about
30.3 M cells, so the cap is **30 M**, the widest measured table's figure.
Bounds today: magnitude 25.1 M ((1,273,000 + 48,000) × 19), tyc-xmatch
12.9 M ((2,530,000 + 48,000) × 5). A table with wider text cells costs more
per cell, so a pull near the cap is re-measured, not assumed.

### Sliced scope

A table no list of ids scopes, cut into half-open ranges of a `key` between
committed `edges`, open at both ends (`key < e0`, `e0 ≤ key < e1`, …, `key ≥
eN`), so every non-null key falls in exactly one slice and no row is asked for
twice. The edges are part of the description: a re-cut stales the pull, and
its next run asks the new ranges.

An integer key's edges are `bigint`s, so a `source_id` past 2^53 is written
exactly; a decimal key's (`phot_g_mean_mag`) are `number`s, written as their
shortest text. The archive compares a decimal edge against the column's own
value, a float32 for a REAL, so a row whose committed six-decimal text equals
an edge may fall on either side of it. That moves a slice's count by the rows
sitting on the edge, never the partition: adjacent conditions share one
literal.

`sliceRows` is the most rows any slice holds, and the edges are
`cutEdges(<the table's keys, ascending>, sliceRows)`, which never splits equal
keys across an edge. A pull's own test counts its committed table into its
slices (`sliceCounts`) and fails, printing the re-cut edges, when one outgrows
`sliceRows`. Whether a mirror can serve a slice is the TAP backend's
per-mirror check below: `sliceRows × LIMIT_HEADROOM + 1` must fit its hard
limit, so a pull sized for ESA's 50,000 keeps `sliceRows` at most 24,999.

## The checkpoint

Each answered query's CSV reply is cached once it passes the column check, under
`<first output>.ckpt/`, named by the hash of the query's text, beside the
mirror that answered it; a re-run replays a cached reply (re-checked against
the limit and the columns) and asks only what is missing. **A replay reports
its cached mirror**, so the record's `answeredBy` names who answered whichever
run fetched the rows, and a reply first answered by an unverified mirror stays
caught after a gate-fix re-run. A reply seeded from committed rows records no
mirror; one with no record of its mirror is refused. Keying on the text is what makes **a changed
query never replay an old answer**: a new column, `WHERE`, batch or id hashes
to a new file. The folder is removed only after the outputs commit, so **a
failed gate keeps it**, and the fix re-run costs no network. It is
gitignored (`data/**/*.tsv.ckpt*/`) and deleting it is always safe.

## The TAP backend

**One request shape for every service; only the URL differs.** `POST
<mirror>/sync` with `REQUEST=doQuery`, `LANG=ADQL`, `FORMAT=csv`, and
`MAXREC = limit + 1`. An archive (`GAIA`, `VIZIER`, `SIMBAD`) is its mirrors
in fallback order, its retry delays and how it quotes an identifier (VizieR
double-quotes every one: table ids carry `/`, columns carry case and
parentheses).

**Overflow is refused by row count, never by a status flag.** A CSV reply
carries no `QUERY_STATUS`: truncated at MAXREC it is HTTP 200 with exactly
MAXREC rows and nothing else (measured 2026-11-05 on ESA, ARI and
SIMBAD-Harvard). So a query of limit `n` asks for `n + 1` rows, and a reply
holding more than `n` raises `TapOverflow` (`readCsv`). It is permanent: every
mirror truncates the same query the same way, so it neither retries nor falls
back.

That is exact only where the mirror can return `n + 1` rows at all: a mirror
truncates at its own hard output limit whatever MAXREC asks. The client reads
each mirror's hard limit from its `/capabilities` once per run
(`hardRowLimit`; none declared means none) and sends a query only to mirrors
that can hold `n + 1`. When none can, the query is refused as one to batch.
A `/capabilities` reply other than 200 is about the mirror, never the query,
so it is transient on any status and the next mirror is tried.
Measured 2026-11-05: ESA 50,000, ARI 10,000,000, SIMBAD-Harvard 2,000,000.

**The archive's own error message is what classifies a failure.** A failed
query's reply is a VOTable whatever FORMAT asked for, its `QUERY_STATUS` INFO
naming the clause it rejected (`queryStatus`). A message naming a query fault
(unknown column, parse error, …) is `TapRefused` on any status, since a 5xx
can carry one; otherwise a 5xx, a network failure or a non-CSV 2xx is
transient (retried through the archive's delays, then the next mirror), and
any other 4xx is refused. Only the parsed message is matched: a proxy's HTML
page saying "not found" is about the service and must still fall back. An
HTML page is reported by its text.

**The answering mirror moves to the front**, so a mirror that is down costs
its retries once per run, and each answer is reported through
`../../util/answered-by.ts`, which `record.ts` copies into the record's
`answeredBy`. `services`, the declared mirror list, is what a pull's
describe states.

**The `CDS` and `SIMBAD-CDS` mirrors are unverified, and the first PR a mirror
answers verifies that mirror before it lands.** CDS Strasbourg was unreachable
from 2026-11-05, and Harvard mirrors SIMBAD's TAP but not VizieR's, so their CSV dialect (quoting,
a BOM, the empty cell), `/capabilities` limit and error body are unmeasured.
Each mirror's `verified` flag is the gate: `unverified-mirrors.test.ts` fails
on any committed `data/stamps/` record whose `answeredBy` names an unverified
mirror, a Python pull's included, so the PR that first reaches one cannot
land until it runs that mirror's group of live checks in
stellata-hhaw.45.29.9, records its limit here, fixes whatever the checks find
and sets the flag. The two are separate hosts and may return apart, so each
mirror passes on its own; the bead closes once both have.

## Columns

A table's `Column` list is the one statement of its schema. Each column's
`name` is the header the archive answers with and the TSV writes; `select`
is its projection when that is not the quoted name (a qualified `t.source_id`,
which still answers as `source_id`, or an aliased expression); `format`
is the one place a pull rounds, and it is data: `{fixed: n}`, Python's
`f"{x:.nf}"` text (`formatFixed`, `../../util/round-pure.ts`), `{exp: n}`,
Python's `f"{x:.ne}"` (`formatExponent`), or `{repr: true}`, Python's
`repr(x)` (`formatRepr`). `{flag: true}` is a two-valued
column written `0`/`1`: ESA prints a BOOLEAN as `true`/`false` and ARI as
`1`/`0`, and ARI rejects a `CAST`, so the mapping cannot be server-side. It
maps when the reply is checked (`checkedRows`), so gates, sort and TSV all see
`0`/`1` whichever mirror answered, and any third value refuses the reply. A column the
archive stores as a REAL adds `float32: true`: its value is the float32
nearest the reply's text, and Python formatted that value, so `{fixed: 6}` on
the text alone disagrees with it on about 1 cell in 230 (measured on a
24,000-row slice of `tycho2tdsc_merge_best_neighbour`), and a float32 `repr`
is numpy's (shortest float32 digits, positional only from 1e-4 up to 1e6). An unformatted cell
is written as the archive's text, which for a float is Java's (`9.045827E-5`
where Python wrote `9.045827e-05`). Being data, it is part of what
`describePull` states, so a changed rounding stales the pull. So the projection, the schema check and the header order cannot
disagree: a reply whose header is not exactly the declared names, in order,
is refused (`checkedRows`).

**An empty CSV cell is the masked value**, read as `null` and written as an
empty TSV cell; a CSV reply cannot tell an empty string from a null, and
neither can the TSV. `formatTsv` writes LF line endings and a final newline,
and refuses a cell holding a tab or line break: the codec's own layout (`tsvLine`, `tsvText`, `../../util/tsv/`).

## Gates

Every gate is an `emitArtifacts` check, so one that fails refuses the whole
emission before a byte is written, every output of the pull included.

- **Row band** (`bandCheck`), required: inclusive both ends. Outside it, the
  upstream table, the request or the query moved.
- **Spot rows** (`spotRowCheck`), required, at least one: a row keyed by one
  column's text, each pinned cell exact text, `{near, within}` for a number,
  or `null` for empty. A missing row and every drifted cell are reported
  together.
- **Coverage** (`coverageCheck`), request-scoped tables only: the share of
  the request each group and their union reach, counted in distinct values of
  the scope's `idColumn` (an id may answer several rows, as DR2 neighbours
  do), always reported, failing under `floor` when one is set.
