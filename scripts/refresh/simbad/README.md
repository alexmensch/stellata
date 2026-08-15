# SIMBAD pull plumbing

Reusable building blocks for SIMBAD TAP pulls. Modelled on
[`scripts/binaries/`](../../binaries/README.md) (one module per
phase, shared dataclasses) so every SIMBAD-anchored refresh reuses
the entire stack.

```
specs.py     Declarative dataclasses — ColumnSpec for basic-table
             columns (sp_type / otype / the § 5 value columns and
             their bibcodes), IdentLookup for an identifier namespace
             (HIP, Gaia DR3, TYC, GJ), FluxBand for one band of the
             long-format flux table, BibcodedGroup for the columns that
             ship only alongside their bibcode. Canonical catalogue of
             instances.
inputs.py    Spine-driven feeders — spine_request_keys partitions rows
             into per-namespace lookup keys AND collects the widening
             map in the same pass, is_simbad_value_cohort is the § 5
             value-tier predicate, gl_suffix normalises the GJ/Gl
             spellings. Plus the WDS-component oid iterator.
request.py   Phase A — resolve a SpineRequestKeys partition to the
             deduplicated oid set, with the TYC widening, its veto, and
             the per-namespace coverage report.
query.py     ADQL builders + batched TAP executor. Wraps each
             ColumnSpec's adql fragment with `AS <alias>` so ORDER BY
             can reference the alias (SIMBAD rejects qualified names
             in ORDER BY).
coverage.py  Fill counting and floor gates over a pull's
             {oid: {alias: value}} rows — one definition of "this cell
             is filled" (neither None nor blank) and one gate message,
             shared by every shell's coverage phase.
tsv.py       Spec-driven TSV writer — basic columns, then ordered
             blocks (ident cross-IDs, pivoted flux bands); applies the
             bibcode policy below; atomic rename via the shared
             refresh_lib path.
simbad.test.py   stdlib unittest pins covering spec definitions,
                 spine feeders, request composition, the widening
                 veto, query builders, coverage gates and TSV emit.
__init__.py      Package marker + source_files(), the module list a
                 shell folds into its is_up_to_date sources.
```

## Two invariants the ADQL depends on

**Stored ident ids are space-padded.** SIMBAD right-aligns a TYC's first
field, so `TYC 144-1004-1` is stored as `TYC  144-1004-1` — while matching
the unpadded request that found it. Anything joining a returned id back to
its request must go through `IdentLookup.parse_suffix`, which strips;
keying on the raw returned id silently loses those rows.

**A suffix is interpolated into an ADQL string literal**, so
`resolve_oids_by_prefix` refuses any suffix outside
`[A-Za-z0-9 .+-]` rather than composing a query it cannot quote.

## An unbibcoded value never reaches the file

`docs/catalog-driver.md` § 5 makes the bibcode the source and SIMBAD only
the index that found it, so a value SIMBAD publishes without one is an
orphan: nothing to cite, nothing to re-pull, nothing a cascade may
defend. `write_simbad_tsv` therefore drops the whole quantity — value,
error, quality flag — wherever its `BibcodedGroup`'s bibcode cell is
empty or blank.

Enforced rather than observed: value and bibcode counts happen to be
equal in SIMBAD's basic table today, but SIMBAD is a living database with
no release to pin that to, so `BASIC_BIBCODED_GROUPS` states the pairing
and the writer applies it. The fluxes are where it currently bites — the
`flux` table publishes plenty of bands with no reference at all.

A shell that declares no groups is unaffected, which is why the sp_type
pull is untouched. Admitting an unbibcoded value later is a **re-pull,
not a filter change**, on the same terms as widening the cohort; the
per-run report prints values reached before values shipped so the cost is
never invisible.

## The TYC widening carries its own veto

A source_id SIMBAD's `ident` table does not hold leaves its row
unreachable under the Gaia namespace, so `resolve_spine_keys` retries it
on the record's own TYC. That retry is the one binding in the stack made
on a designation alone — and a TYC names the **Tycho entry**, which for a
close pair is the system, not the component the spine resolved. Left
unchecked it attaches rv / parallax / PM / coordinates from the wrong
star, the same failure the GJ keys avoid by refusing to strip a component
letter.

`_veto_contradicted` closes it with the evidence the pull already has:
where SIMBAD holds a Gaia DR3 cross-ID for the widened oid and it is not
the source_id that asked, the two disagree about which star this is and
the binding is dropped. (It can only ever disagree — had SIMBAD held the
asking source_id, the Gaia pass would have resolved the row and it would
never have been a widening candidate.) A TYC two source_ids both claim
binds neither and is dropped before the request. What survives is the
uncorroborated remainder: SIMBAD holds no Gaia id for the object at all,
so the TYC binding stands unverified — reported per pull, never silent.

## Used by

- [`refresh-simbad-sptype.py`](../README.md) — per-source `sp_type` /
  `sp_qual` / `sp_bibcode` / `otype` + cross-IDs, over the whole spine.
- [`refresh-simbad-values.py`](../README.md) — bibcoded rv / parallax /
  PM / coordinates + B/V fluxes, over the § 5 value cohort.
- [`refresh-simbad-wds-xids.py`](../README.md) — per-WDS-component
  (Gaia DR3, HIP) cross-IDs via a two-phase WDS-id → SIMBAD-oid →
  cross-IDs walk.

`refresh-simbad-sample.py` predates this folder and drives its TAP
queries directly via the shared
[`scripts/refresh/refresh_lib.py`](../README.md). New SIMBAD pulls
should compose the modules here instead of inlining their own ADQL.
