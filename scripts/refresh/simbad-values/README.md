# SIMBAD values — the bibcoded bottom tier of the value cascades

`refresh:simbad-values` — SIMBAD's bibcoded radial velocity, parallax,
proper motion, coordinates and B/V fluxes for the manifest rows a
[§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) value
tier can reach, written to `data/simbad/simbad_values.tsv`. What the file
holds and who reads it: [The values pull](/data/simbad/README.md#the-values-pull).
A phased pull on the [pull runtime](../pull/README.md#a-phased-pull) over the
[SIMBAD core](../simbad/README.md#the-typescript-core).

## Files

- `refresh-simbad-values.ts` (+ test, the committed table replayed through
  the pull) — the entry: reads the manifest and both Gaia 5p tables (the
  catalogue's and the magnitude pull's), `describe` and `main`.
- `simbad-values-pure.ts` (+ test) — the columns, phases, floors and
  `valuesPull`.
- `simbad-values-replay-pure.ts` — `valuesFake`, a fake SIMBAD holding a
  committed table's objects.
- `simbad-values-outputs.ts` — the step's output declaration.

## The request and the gates

The request is the value cohort's keys (`membershipKeys` under `valueCohort`,
`../simbad/membership-keys-pure.ts`), resolved to oids by Phase A with the
widening ladder (`resolveMembershipKeys`); its describe states every key, off
the manifest and both Gaia 5p tables, so a moved cohort stales the record. The
basic columns, the four namespaces' ids and the B/V fluxes are asked per oid,
and each bibcoded group ships only beside its bibcode
([An unbibcoded value never reaches the file](../simbad/README.md#an-unbibcoded-value-never-reaches-the-file)).

- **Band**: at least `MIN_ROW_REACH` (97%) of the cohort's keyed rows reach an
  object, and never more than the keyed rows, since each key binds at most one.
- **Floors**: Gaia DR3 ident resolution 95% over the cohort's source_ids;
  coordinate fill 99% (every SIMBAD object has coordinates).
- **Spot rows**: tau Cyg (oid 747) and lam And (oid 6222), main_id and HIP
  exact, parallax within 0.5 mas, radial velocity within 1 km/s.
- **Parse ledger**: an id shape the namespace rules do not know fails the pull.

## The committed table

The replay test keys one manifest row on each committed object's own ids and
answers from those objects (`valuesFake`), so it holds the writer to the
committed bytes whatever cohort produced them.
