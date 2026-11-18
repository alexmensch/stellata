# SIMBAD's designation idents

`refresh:simbad-idents` — the SIMBAD identifiers the label cells read, with
the catalogue keys a record joins each object on, written to
`data/simbad/simbad_idents.tsv`
([The identifier pull](/data/simbad/README.md#the-identifier-pull)). A phased
pull on the [pull runtime](../pull/README.md#a-phased-pull) over the
[SIMBAD core](../simbad/README.md#the-typescript-core).

## Files

- `refresh-simbad-idents.ts` (+ test, the committed table replayed through
  the pull) — the entry: `describe`, `main` and `readIdentsRequest`.
- `simbad-idents-pure.ts` (+ test) — the phases, the classes, the table and
  its gates, `identsRows` and `identsPull`.
- `sptype-oids-source.ts` — `SPTYPE_OIDS`, the request's file declared.
- `simbad-idents-replay-pure.ts` — `identsFake`, a fake SIMBAD holding a
  committed table's objects.
- `simbad-idents-outputs.ts` — the step's output declaration.

## The classes

Two scopes, set by what each class costs over the whole of SIMBAD (counted
on SIMBAD-Harvard):

- **Whole-sky**: `* ` (Bayer and Flamsteed, and every other number SIMBAD
  writes in the `NN Con` form, [Which SIMBAD numbers are Flamsteed numbers](../../catalog/simbad/README.md#which-simbad-numbers-are-flamsteed-numbers)),
  `** ` (double-star discoverer codes), `Gmb ` (Groombridge), `NAME `, `LAL `,
  `Ross `, `Wolf ` — 153,260 ids in one query (2026-11-18), 132,504 of them
  `** ` and 41 `Gmb `.
- **Reached**: `V* ` (53,134 whole-sky), `X ` — asked only on the objects
  the request names.

## The request

The distinct `simbad_oid`s of `data/simbad/simbad_sptype.tsv`: the objects
that pull resolved every manifest record to, through its widening ladder and
corroboration rule, so a reached class costs no second resolution of the
manifest. It carries no HD namespace, so an object SIMBAD reaches only by HD
asks nothing here.

A double-star ident hangs on the system object, which is often not the one a
record resolves to: Kruger 60's record resolves to the component object
`HD 239960A`, while `** KR 60AB` sits on the system object `HD 239960`. That
is why `** ` is a whole-sky class: the system object carries the record's
HIP and HD, so the join reaches it by key.

## The run

1. **Whole-sky classes** in one whole-table query.
2. **Reached classes** for every requested oid, `SIMBAD_BATCH_SIZE` per query.
3. **Keys** — every `HIP`, `HD`, `GJ` and `Gaia DR3` id each held object
   carries. A component-lettered HIP or HD (`HD 12345B`) is skipped, as the
   other SIMBAD pulls skip it: the bare number is the record's key.
4. **main_id** from `basic`, written as SIMBAD spells it.

## The table

One row per object holding an id of a pulled class: `simbad_oid`,
`simbad_main_id`, `hip`, `hd`, `gj`, `source_id`, `idents`. Every multi-valued
cell is `|`-separated — keys in numeric order (GJ by code unit), idents by
code unit — and nothing picks one. Idents are written with SIMBAD's space
padding collapsed (`*  39 Psc` → `* 39 Psc`). Rows are in `simbad_oid` order.

## Gates

- **Band** 140,000–170,000 rows. 150,443 at the committed pull (2026-11-18).
- **Spot rows**: 39 Psc, Kapteyn's Star, π² UMi (`18 UMi` too), Kruger 60's
  system object (`** KR 60AB`, keyed HIP 110893 / HD 239960) and β Tau
  (`112 Tau`, `23 Aur`, `γ Aur` and `Elnath` on one object).
- **Parse ledger**: a key id with nothing after its prefix fails the pull.

## The committed table

The replay test answers the whole-sky query with the committed rows' whole-sky
idents and every other query from each object's committed idents, keys and
`main_id` (`identsFake`), runs the pull over the committed
`simbad_sptype.tsv`, and holds the output to the committed bytes.
