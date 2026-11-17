# SIMBAD's HD per Tycho-2 entry

`refresh:simbad-tyc-hd` — SIMBAD's own HD identification for every Tycho
entry the manifest or IV/25 mentions or a Tycho-2 pair holds, written to
`data/simbad/simbad_tyc_hd.tsv` (`tyc`, `simbad_oid`, `simbad_main_id`,
`hd`): the witness independent of IV/25 a close pair's crossed HD cells need
([The TYC → HD pull](/data/simbad/README.md#the-tyc--hd-pull)). A phased pull
on the [pull runtime](../pull/README.md#a-phased-pull) over the
[SIMBAD core](../simbad/README.md#the-typescript-core).

## Files

- `refresh-simbad-tyc-hd.ts` (+ test, the committed table replayed through
  the pull) — the entry: `describe` and `main` over `readTycRequest`.
- `simbad-tyc-hd-pure.ts` (+ test) — the phases, the table and its gates,
  `hdOrder`, `tycHdRows` and `tycHdPull`.
- `simbad-tyc-hd-replay-pure.ts` — `tycHdFake`, a fake SIMBAD holding a
  committed table's objects.
- `simbad-tyc-hd-outputs.ts` — the step's output declaration.

## The request

The TYC part of `refresh:tycho2`'s
([The request set](../tycho2/README.md#the-request-set)) — the manifest's TYCs
and IV/25's, one `1-381-1` key each, without the manifest HIPs only the
Tycho-2 pull keeps rows by — plus every entry of a Tycho-2 pair: each entry
whose HIP Tycho-2 gives to another entry too (`pairEntries`, read off the
committed Tycho-2 tables). Those are the entries the pair rule can move a HIP
onto, and the build's SIMBAD check reads only them and IV/25's
([Applying the pair rule](/scripts/catalog/membership/merge-derivation/README.md#applying-the-pair-rule)),
so whichever entry a move lands on was asked. `readTycRequest` builds it; its
describe states every key, off the manifest, IV/25 and Tycho-2, so any of the
three moving stales the record.

## The run

1. **Resolve.** Each TYC against SIMBAD's `ident` table as `TYC <tyc>`,
   `SIMBAD_BATCH_SIZE` per query. SIMBAD answers in its stored spelling, the
   first field right-aligned (`TYC   40-1338-1`); `parseIdent` strips it, so
   the reply joins its request
   ([Two invariants](../simbad/README.md#two-invariants-the-adql-depends-on)).
   A TYC answering under two objects fails the pull; none did on
   SIMBAD-Harvard on 2026-11-16 (`SELECT id, COUNT(*) FROM ident WHERE id
   LIKE 'TYC %' GROUP BY id HAVING COUNT(*) > 1`: no rows).
2. **HD idents.** Every `HD ` id each resolved object holds, read under
   `HD_LETTERED`, so the component letter stays in the suffix (`24071B`).
3. **main_id** from `basic`, written as SIMBAD spells it (`HD    254`).

## The table

One row per TYC that resolved to an object holding an HD. A TYC SIMBAD does
not hold, or whose object holds no HD, ships nothing: absence from the file
is the answer "SIMBAD attributes no HD here". Two TYCs SIMBAD folds onto one
object each ship their own row.

`hd` is every HD the object holds, `|`-separated, never one picked: an
unresolved pair's entry carries both components' numbers, and that is the
ambiguity a consumer asks about. Ordered by number, then by the whole
suffix (`hdOrder`), so a bare number precedes its lettered forms and two
numbers of different widths read low to high.

Rows are written in `tyc` text order.

## Gates

- **Band** 300,000–380,000 rows: the requested TYCs SIMBAD resolves and
  holds an HD for, so it tracks that intersection rather than either input.
  336,351 at the committed pull.
- **Spot rows**: eight close pairs whose two Tycho entries carry adjacent HD
  numbers (f Eri A/B, τ Oph A/B, α Psc A, ε Boo B, κ¹/κ² CrA) — the shape the
  table exists to adjudicate.
- **Parse ledger**: a TYC or HD id with nothing after its prefix fails the
  pull.

## The committed table

The replay test answers each committed row's TYC under its object, padded as
SIMBAD stores it, and each object's `main_id` and HD ids (`tycHdFake`), runs
the pull over the committed manifest and IV/25, and holds the output to the
committed bytes. The record was written from that replay, its replies
seeded into the checkpoint, so its `answeredBy` is empty. Its first live run
is a re-pull like any other.
