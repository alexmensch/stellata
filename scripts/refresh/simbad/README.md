# SIMBAD pull plumbing

Reusable building blocks for SIMBAD TAP pulls. Modelled on
[`scripts/binaries/`](../../binaries/README.md) (one module per
phase, shared dataclasses) so every SIMBAD-anchored refresh reuses
the entire stack.

```
specs.py     Declarative dataclasses — ColumnSpec for basic-table
             columns (sp_type / otype / the § 5 value columns and
             their bibcodes), IdentLookup for an identifier namespace
             (HIP, Gaia DR3/DR2/DR1, TYC, GJ), FluxBand for one band of
             the long-format flux table, BibcodedGroup for the columns
             that ship only alongside their bibcode. Canonical catalogue
             of instances, plus WIDENING_LADDER and GAIA_RELEASES.
inputs.py    Spine-driven feeders — spine_request_keys partitions rows
             into per-namespace lookup keys AND collects each
             source_id-keyed row's other designations in the same pass,
             is_simbad_value_cohort is the § 5 value-tier predicate,
             gl_suffix normalises the GJ/Gl spellings. Plus the
             WDS-component oid iterator.
request.py   Phase A — resolve a SpineRequestKeys partition to the
             deduplicated oid set, with the widening ladder, its
             corroboration rule, and the per-namespace coverage report.
query.py     ADQL builders + batched TAP executor. Wraps each
             ColumnSpec's adql fragment with `AS <alias>` so ORDER BY
             can reference the alias (SIMBAD rejects qualified names
             in ORDER BY). fetch_ident_lookups and fetch_ident_sets
             share one query and differ only by an insert strategy —
             rows must fold straight into their final shape, because at
             spine scope this accumulator is ~100 MB and an
             intermediate copy doubles it.
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

## The widening falls through on resolution, not on cell presence

A row's primary key is the first namespace it carries, so a populated
`gaia_source_id` cell keeps it out of every other namespace's request —
**even when SIMBAD's `ident` table has no such id**. `resolve_spine_keys`
therefore runs a second ladder over the source_ids the Gaia namespace did
not reach, retrying each on the record's own HIP, then TYC, then GJ. Each
rung asks only for what the rungs above left unbound, and the order is the
one `docs/catalog-driver.md` § 5 gives the no-Gaia tier — the same order
`walkSimbadNamespaces` reads back in, so a widened row is looked up under
the namespace that bound it.

**HIP before TYC is load-bearing, not alphabetical.** A TYC names the
Tycho entry, which for a close pair is the system; SIMBAD frequently
splits that into a component-lettered object carrying a coarse PM and no
parallax at all, beside the star's own entry carrying everything. Asking
under HIP first lands on the latter. Measured over the values cohort when
the ladder landed: 67 rows moved off a `HD nnnnnA`-style component entry
onto the star's entry, gaining a parallax on every one, and no row lost
the row it had.

## The widening carries its own corroboration rule

A widened binding is made on a designation alone, so it needs evidence
before it may attach rv / parallax / PM / coordinates. `_corroborate`
reads **every Gaia release SIMBAD keys a cross-ID under**, not DR3 alone,
and returns one of three verdicts per binding:

- **Corroborated** — SIMBAD holds the asking id itself, under any release.
  This is what reaches a spine cell carrying a **DR2 id in the DR3
  column**: the Gaia namespace misses, SIMBAD's DR3 id for the object
  differs, and reading that difference as "these are different stars"
  would be wrong — it is a disagreement about the release
  (`data/athyg/stale_gaia_source_ids.tsv` enumerates the six).
- **Vetoed** — SIMBAD holds a DR3 id and it is not the asking one. Only
  DR3 can contradict: each release numbers the same star differently, so a
  differing DR2 id is no evidence either way.
- **Uncorroborated** — no Gaia id for the object at all, so the binding
  stands unverified. Kept and reported per pull, never silent.

A designation two source_ids both claim binds neither and is dropped
before the request.

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
