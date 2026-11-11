# Per-component lookups

What one resolved component reads about itself, shared by every stage that
needs it: its AT-HYG row and its spectral type with that type's provenance.
Stage 5's pair masses read the spectral type (`../masses/`); Stage 6 reads
both for multiples.tsv's `spect` / `spect_via` columns, photometry and names
([Stage 6](../README.md#stage-6--multiplestsv-emit)). `../build-binaries.ts`
calls it; until the switch, `build:binaries` runs `../build-binaries.py` and
only tests call this
([Porting to TypeScript](../README.md#porting-to-typescript--one-stack-one-switch)).

## Files in this area

```
scripts/binaries/components/
  component-spect-pure.ts (+ test)  athygRowFor (the position-matched row,
                                    then the Gaia source's, then the HIP's)
                                    and resolveSpect, the spectral-type
                                    cascade with its spect_via tag.
```

## The spectral-type cascade

`resolveSpect` takes the first non-empty type of: the curated
`component_sptype_overrides.tsv`, SIMBAD's per-component type, the MSC's
pair-side type, the component's AT-HYG row. Each is keyed on the component
token as the pair row writes it, so a truncated secondary (`"2"`) looks up
under `"2"`. What each source covers, and why SIMBAD outranks AT-HYG, is the
parent README's ([Stage 6](../README.md#stage-6--multiplestsv-emit)).
