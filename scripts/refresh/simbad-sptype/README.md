# SIMBAD sp_type — the manifest-keyed spectral types

`refresh:simbad-sptype` — SIMBAD's `sp_type`, `sp_qual`, `sp_bibcode` and
`otype` for every membership-manifest row, with each object's HIP, Gaia DR3,
TYC and GJ ids, written to `data/simbad/simbad_sptype.tsv`. The catalogue's
top spectral tier and a binding source of the membership build
([Consumed by](/data/simbad/README.md#consumed-by)). A phased pull on the
[pull runtime](../pull/README.md#a-phased-pull) over the
[SIMBAD core](../simbad/README.md#the-typescript-core).

## Files

- `refresh-simbad-sptype.ts` — the entry: reads the manifest, `describe` and
  `main`.
- `simbad-sptype-pure.ts` (+ test) — the columns, phases, gates and
  `sptypePull`.
- `simbad-sptype-outputs.ts` — the step's output declaration.

## The request and the gates

Every manifest row's keys (`membershipKeys`, no cohort), resolved by Phase A
with the widening ladder; then the basic table per oid; then the value-keyed
union, which asks the namespaces of each row no bound object types
([The union asks every namespace a record reaches](../simbad/README.md#the-union-asks-every-namespace-a-record-reaches));
then cross-IDs for every object either pass found. The run log prints the
union's counts and a sample of `RECOVERED_SAMPLE` recovered rows.

- **Band**: 90% to 110% of the manifest's keyed rows: a key binds at most one
  object, and the union adds objects beyond them.
- **Floors**: `sp_type` filled per membership term (`SP_TYPE_FLOORS`), over
  the objects that term's rows' Gaia ids bound: 80% for the primaries and 15%
  for the magnitude term, whose fainter stars SIMBAD seldom types (measured
  2026-11-08: 90.7% and 21.4%), so the magnitude term cannot mask a primaries
  regression.
- **Spot rows**: Arcturus (oid 2252964) and alf Cen A (oid 3396054), main_id,
  `sp_type` and HIP exact, alf Cen A's GJ too.
- **Parse ledger**: an id shape the namespace rules do not know fails the pull.

Re-pulling it re-opens the binding review by construction
([`simbad_sptype.tsv` is a cycle](../README.md#the-staleness-gate--pin-the-shortfall-never-the-numerator)):
expect `binding-review-dispositions.tsv` rows to need re-review in the same
change.
