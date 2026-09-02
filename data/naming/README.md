# Naming — the curated override table

The naming ladder's escape hatch (`docs/star-naming.md` § 7), and the only
hand-written input to it. Every other tier is compiled from a published
source: the authority itself is `../iau-wgsn/`, and the build side is
`scripts/catalog/naming/`.

```
name_overrides.tsv  Hand-curated, header-only today. Columns: sid,
                    display_name, reason, source. Keyed on the frozen
                    Stellata ID (docs/sid.md § 7) — a record's identity
                    survives re-indexing, and a no-Gaia record has no
                    source_id to key on. Applied as ladder tier 1, above
                    the IAU name, so a row wins outright.
```

## What does NOT belong in it

**A growing override file is a signal the ingest is wrong**, so its row
count is pinned in build-counts (`namingOverrides`) and review sees any
growth. Three shapes have their own home instead:

- a folk name the ladder displaced → an **alias**, routed by class in
  `../iau-wgsn/athyg_proper_dispositions.tsv`. It keeps resolving a search
  and never displays.
- a designation the authority spells differently → a **data refresh** of
  `../iau-wgsn/`. A name that moves tier by code edit stops tracking the
  authority.
- two records claiming one designation → a **data finding**. The composer
  is injective given (naming anchor, component letter), so a surviving
  duplicate is two catalogue entries claiming one designation and the fix
  is upstream, not a qualifier bolted onto the label.

A row here is for the fourth case only: a review finding the authority
cannot express.
