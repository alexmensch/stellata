# Trace — every stage's rows for one record

The query side of [record lineage](../README.md): from a name, designation,
SID or Gaia id to the origin keys it names, then every stage's rows for them.

```
scripts/catalog/lineage/trace/
  trace-pure.ts     The query parse, the name match and the record search.
  trace.ts          `pnpm run trace`.
  trace.test.ts     Both, the command over a committed fixture.
```

## The command

`pnpm run trace <name | designation | sid | gaia id> [--dir <dir>]`
(`trace.ts`, over `trace-pure.ts`; `--dir` reads another lineage directory,
`build/lineage/` by default). `parseTraceQuery` tells the four apart: ten or
more bare digits, or `gaia_dr3:<id>`, is a Gaia id (a SID never runs that
long); fewer, or `sid:<n>`, a SID; `ns:key` a designation; anything else a
name.

1. A name resolves over the name table `lookupByName` reads (`nameTable`,
   `../../catalog-lookup.ts`: names plus composed designation labels) to its
   record's full designation set (`catalogRecordDesignations`, `../../../sid/`),
   so it needs a built catalogue. `matchName` tries the name exactly, then
   case- and accent-folded (`foldNameKey`, `../../naming/`), so `algol` finds
   Algol and `Yunu` finds Yunü. A name reaching two records, exactly or
   folded, refuses, listing both: one composed label can sit on two records
   (`54 Leo`, a HIP primary and a Gaia-only companion), and the designation
   half has case-only twins that are different stars (`a Car`, `A Car`).
   `lookupByName` itself stays exact, for the frozen corpora. Designations
   follow `../../../sid/sid-pure.ts`'s grammar; a SID resolves to its
   canonical key through the ledger.
2. Find the origin keys whose identity rows carry that designation. Parked
   and dropped records have lineage rows too, so they are found. Also find
   every row that names it in `params` or `evidence` — a source a gate
   weighed and refused, or only cited, sits on no identity row — and every
   row that cites one of those identity-row records by origin key, as a
   companion's promotion row cites its anchor. `classic-ids` rows are keyed
   on the catalogue row stating a designation, not on a record, so they are
   found this way: by the designation in their params (`hd:128621`) or by a
   Gaia id they reached or refused. Identity rows come from every
   stage that writes them (`StageLineageSpec.identity`,
   [Identity](../README.md#identity--the-origin-source-row)). No index is
   kept: trace streams the stage files twice, once to find the keys and once
   to collect their rows, and never holds a stage's rows whole — every
   stage's rows decoded at once overrun the 4 GB heap.
3. Widen through allocation's rows: a SID query also finds the origin keys
   allocation filed it under — the record it resolved to, or the decision
   that retired, parked or merged it — and a merged SID's successor.
4. Print every stage's rows for those keys in stage order
   (`LINEAGE_STAGES`, `../lineage-stages.ts`).

`trace.test.ts` runs the command over a small committed fixture: it finds a
designation's classic-id rows with the binding the gate refused (α Cen B's
HD 128621 and HR 5460 on the background source beside it), a
record the catalogue parks, prints a record's placement,
brightness-colour and size rows with their refused tiers, finds the record that
refused a source no identity row carries, every component row of a promoted system from its anchor's
designation, a minted companion's V, colour and A_V rows, and a cloud from its `cloud:` slug.
