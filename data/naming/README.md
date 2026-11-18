# Naming — the curated tables the naming ladder reads beside the authority

The names the IAU WGSN tables (`../iau-wgsn/`) do not supply: cited string
designations, dropped names kept searchable, and the escape hatch
([§ 7](/docs/star-naming.md#7-curation-seam)). The build side, and the rules each
table's rows obey, is `scripts/catalog/naming/`
([String designations](/scripts/catalog/naming/README.md#string-designations)).

```
eponyms.tsv         Hand-curated, cited. Columns: name, class, key,
                    source, citation, ident. The discovery, catalogue
                    and Gould designations the ladder displays as
                    strings, each keyed on one record identifier
                    (hd:/hip:/gaia:) and citing a SIMBAD object (oid,
                    and the ident in ../simbad/simbad_idents.tsv that
                    spells the name) or the authority's Gould row.
name_drops.tsv      Hand-curated, frozen. Columns: name, class, key,
                    evidence. Names no source attests: shipped as
                    search-only aliases, never displayed.
simbad_short_forms.tsv  Hand-curated. Columns: simbad_prefix,
                    long_prefix, reason. How a SIMBAD ident is spelt out
                    to compare with a name (`LAL` → `Lalande`); a test
                    fails on a row no eponym cites.
name_overrides.tsv  Hand-curated, three rows. Columns: sid,
                    display_name, reason, source. Keyed on the frozen
                    Stellata ID (/docs/sid.md#7-storage--sid-in-every-artifact) — a record's identity
                    survives re-indexing, and a no-Gaia record has no
                    source_id to key on. Applied as ladder tier 1, above
                    the IAU name, so a row wins outright. A SID no record
                    carries FAILS the build: this is the one tier no
                    published source can be re-read to check, so a
                    retired or mistyped SID must not pass review as an
                    applied row that displays nothing.
bayer_drops.tsv     Hand-curated, frozen. Columns: hd, bayer, reason,
                    evidence. The Bayer cells AT-HYG printed on a record
                    the naming authority's tables (WGSN, then the IV/27A
                    and V/50 tail) leave bare. Reason sibling_holds: the
                    authority keys the designation on another
                    component's record. Read by no build;
                    ../../scripts/catalog/membership/membership-manifest-gate.test.ts
                    holds that each row keys one manifest record the
                    build's Bayer join leaves bare and that exactly one
                    other record holds the designation, so a refresh
                    that moves either fails until the row changes.
```

## What does NOT belong in it

**A growing override file is a signal the ingest is wrong**, so its row
count is pinned in build-counts (`namingOverrides`) and review sees any
growth. Three shapes have their own home instead:

- a name no source attests → an **alias** on `name_drops.tsv`. It keeps
  resolving a search and never displays.
- a designation the authority spells differently → a **data refresh** of
  `../iau-wgsn/`. A name that moves tier by code edit stops tracking the
  authority.
- two records claiming one designation → a **data finding**. The composer
  is injective given (naming anchor, component letter), so a surviving
  duplicate is two catalogue entries claiming one designation and the fix
  is upstream, not a qualifier bolted onto the label.

A row here is for the fourth case only: a review finding the authority
cannot express. The three today are approved names whose authority rows
key no identifier the record holds — Albireo B (HD 183913 against the
record's 183914), and the faints hosts Kaewkosin and Maru.
