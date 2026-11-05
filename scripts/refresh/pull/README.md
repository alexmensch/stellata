# Pull — the TypeScript refresh runtime

What a TypeScript pull does when it runs: one TAP backend for Gaia, VizieR and
SIMBAD. A pull is a `pull` step on the step table
([Step kinds](../../pipeline/README.md#step-kinds)); the runner never runs it,
`record.ts` does, and its committed record is `data/stamps/<step>.json`.

## Files

- `tap-pure.ts` (+ test) — the backend: the three archives, the sync query,
  the reply's classification, and `tapClient`.

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

The VizieR CSV dialect is unmeasured: CDS Strasbourg was unreachable on
2026-11-05, and Harvard mirrors SIMBAD's TAP but not VizieR's.
