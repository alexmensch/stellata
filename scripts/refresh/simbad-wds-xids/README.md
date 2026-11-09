# SIMBAD cross-IDs per WDS component

`refresh:simbad-wds-xids` — the SIMBAD object for each WDS component, with
its `main_id`, Gaia DR3 source_id and HIP, written to
`data/simbad/simbad_wds_xids.tsv` (`wds_id`, `component`, `simbad_oid`,
`simbad_main_id`, `gaia_source_id`, `hip`). Binaries Stage 2's `simbad_xid`
tier reads it, as do the membership binding and `refresh:simbad-wds-sptype`
([Consumed by](/data/simbad/README.md#consumed-by)). A phased pull on the
[pull runtime](../pull/README.md#a-phased-pull) over the
[SIMBAD core](../simbad/README.md#the-typescript-core).

## Files

- `refresh-simbad-wds-xids.ts` (+ test, the committed table replayed through
  the pull) — the entry: reads the WDS summary and the overrides, `describe`
  and `main`.
- `simbad-wds-xids-pure.ts` (+ test) — the phases, the table and its gates,
  and `xidsPull`, whose `run` is the four steps below.
- `wds-components-pure.ts` (+ test) — the request: every component the WDS
  summary decomposes into.
- `wds-xids-cascade-pure.ts` (+ test) — the alias cascade and the HIP an
  object's aliases name.
- `wds-xids-overrides-pure.ts` (+ test), `wds-xids-overrides-source.ts` —
  `data/simbad/wds_xids_overrides.tsv`, read and declared.
- `simbad-wds-xids-replay-pure.ts` — `xidsFake`, a fake SIMBAD holding a
  committed table's objects.
- `simbad-wds-xids-outputs.ts` — the step's output declaration.

## The request

Both sides of every WDS summary row whose `components` field splits
(`splitComponents`, [`../../wds/`](../../wds/README.md#the-components-field)),
each once: the components binaries Stage 2 decomposes, so the file answers
the same set. Each is asked as `WDS J<wds_id><component>`, the one form
SIMBAD stores. Its describe states every ident and every override, off
`data/wds/wds_summ.txt` and the overrides file, so a moved summary or a
changed override stales the record.

## The run

1. **Ident lookup.** Each component's ident against SIMBAD's `ident` table,
   `SIMBAD_BATCH_SIZE` per query. An ident SIMBAD answers under two objects
   fails the pull: an id names one object.
2. **The cascade**, only for a component the lookup missed in a system where
   it found another. The found siblings' HD and HIP numbers (the first of
   each in id order), then the missed component's letter on each, plus its
   CCDM id: `HD 48915B`, `HIP 32349B`, `CCDM J06451-1643B`. SIMBAD answers in
   its stored spelling (`HD  48915B`), so a reply joins back on `identKey`
   ([Two invariants](../simbad/README.md#two-invariants-the-adql-depends-on)).
   An answered WDS ident naming no asked component fails the pull. An alias naming an
   object the lookup already found names that object again and is dropped;
   two aliases naming different objects keep the first in SIMBAD's id
   order, and the run log prints each such conflict.
3. **Overrides** replace whatever the first two found.
4. **Cross-IDs** for every object: `main_id` from `basic`, the HIP and Gaia
   DR3 ids from `ident`. A bare HIP wins; a lettered one (`HIP 55203B`)
   binds only on a letter the object was resolved as, and two different
   lettered HIPs bind neither. An object SIMBAD holds no Gaia DR3 or HIP id
   for is still written, with those cells empty: α Cen A and B.

## The request and the gates

- **Band**: between `MIN_COMPONENT_REACH` (36%) of the components and all of
  them, since each binds at most one object; measured 2026-11-09, 23,669 of
  61,867 (38.3%).
- **Spot rows**: Sirius B (reached only through the cascade), ξ UMa B (a
  lettered HIP) and α Cen A (no Gaia DR3 id).
- **Parse ledger**: an HD, HIP or Gaia DR3 id the namespace rules
  (`parseIdent`) cannot read fails the pull.
- An override naming a component the summary does not decompose into fails
  before any query; one pinning an object SIMBAD's basic table does not hold
  fails the pull.

## Overrides

`data/simbad/wds_xids_overrides.tsv` (`wds_id`, `component`, `simbad_oid`,
`reason`, `#` comments) pins an object for a component neither the lookup
nor the cascade reaches; [Provenance](/data/simbad/README.md#provenance)
names today's rows. Every cell is required and one component takes one row.

## The committed table

The replay test answers each committed row's component under its WDS ident
and each object's `main_id`, bare HIP and Gaia DR3 id (`xidsFake`), runs
the pull over the committed WDS summary and overrides, and holds the output
to the committed bytes. The record was written from that replay, its
replies seeded into the checkpoint, so its `answeredBy` is empty. Its first
live run is a re-pull like any other.
