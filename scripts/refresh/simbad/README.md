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
             Cost: the designation map is a dict per source_id-keyed row —
             ~98 MB over the whole spine against ~46 MB for three flat
             per-namespace dicts. Bought deliberately: it is what lets the
             request side look a namespace up by IdentLookup.tsv_name and
             stay generic over WIDENING_LADDER. Refresh-time only, never
             build:catalog and never the browser.
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
union.py     Phase B2 — the value-keyed union (§ The union asks every
             namespace a record reaches). Reads Phase A's per-namespace
             bindings and Phase B's rows, asks what no bound object
             answered, and returns the objects that do.
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
one `docs/catalog-driver.md` § 5 gives the no-Gaia tier — both read it off
`WIDENING_LADDER`, and `spine_request_keys` partitions the no-Gaia rows by
iterating that same tuple, so the tier and the widening cannot drift apart.

**Read-back does not depend on that order.** A widened row is joinable
because its emitted row carries the asking designation in the namespace
that bound it, so `walkSimbadNamespaces` reaches it whichever rung matches
first — which is what lets the read side order its own walk independently.
The one binding that cannot recover is an object SIMBAD holds two ids for
in the binding namespace: the shipped column is single-valued and
`fetch_ident_lookups` keeps the last in table order, so the winner need not
be the id that asked. Pinned rather than assumed away in `simbad.test.py`.

**HIP before TYC is load-bearing, not alphabetical.** A TYC names the
Tycho entry, which for a close pair is the system; SIMBAD frequently
splits that into a component-lettered object carrying a coarse PM and no
parallax at all, beside the star's own entry carrying everything. Asking
under HIP first lands on the latter. Measured over the values cohort when
the ladder landed: 67 rows moved off a `HD nnnnnA`-style component entry
onto the star's entry, gaining a parallax on every one, and no row lost
the row it had.

## The union asks every namespace a record reaches

The widening above falls through on RESOLUTION, so it never fires for a row
whose Gaia lookup resolved — onto an object carrying no value. SIMBAD holds
two objects for those stars: a Gaia-keyed one with no `sp_type`, and an
HD/HIP-keyed one that has it (`HD 224738A` beside `HD 224738`, and ~4.7k
more). A ladder that stops at the first BINDING cannot reach them; only a
union over the namespaces the record itself carries can.

`union.py` runs after the basic-table pull, because the question it asks is
about the VALUE and nothing before Phase B knows it:

1. Walk the spine. For each row, collect every namespace it can be asked
   under and look each up in Phase A's bindings.
2. A row one bound object answers is done — **`answered` is the common
   case and it costs no request at all**, which is what keeps the pass
   cheap over the whole spine: 280,676 of 313,257 rows ask nothing.
3. Otherwise ask the namespaces Phase A never bound. A namespace it DID
   bind is not re-asked: it has answered, with the absence of a value.
4. Keep an object only where its value cell is filled. One that answers
   with nothing would add a row saying nothing and — keyed under the same
   identifiers — would collide with one that does.

**The pull unions; the record build orders.** Every namespace that answers
ships its row, and `SIMBAD_NAMESPACE_VALUES` decides which one a record
takes, so nothing in the request may pick a winner between two objects.
That is `stellata-3bsf.31`'s settled rule applied rather than re-decided:
identifiers rank by WHAT THEY NAME, so a GJ (which carries its component
letter) outranks a TYC (which on a close pair names the system), and a
system-blend value can never displace a component one. The union's own
namespace order is therefore not load-bearing — it only decides which rung
spends the request.

**The read side has to merge too.** Two objects reaching one record means
two rows sharing one key, which `indexSimbadRow` used to treat as a fault.
It now hands both to the consumer: the sp_type index keeps whichever row
states a type, and throws only where BOTH do — an ambiguity the union
cannot produce and curation has to settle.

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
- **Uncorroborated** — **no DR3 id to contradict it**, so the binding stands
  unverified. Kept and reported per pull, never silent. Because only DR3
  contradicts, this bucket admits an object holding a *differing* DR2 or DR1
  id as well as one holding no Gaia id at all — the two are the same amount
  of evidence, which is the whole point of the rule above, so the count does
  not separate them.

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
