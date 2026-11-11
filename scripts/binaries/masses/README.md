# Stellar masses from spectral types

A binaries component's mass in solar masses, read off its spectral type, and
each pair's total. Stage 5's escape-velocity gate reads the totals
([What each tier decides](../optical/README.md#what-each-tier-decides)),
computed once by `pairMasses` before the stage runs. Stage 6's mass-ratio and
Kepler semi-major-axis estimates read the same per-component masses
([What each column carries](../multiples/README.md#what-each-column-carries)).
The spectral type comes from `../components/`'s cascade.

## Files in this area

```
scripts/binaries/masses/
  mass-estimate-pure.ts (+ test)   parseSpectralType and
                                   massFromSpectralClass: the main-sequence,
                                   giant and supergiant tables (Cox 2000),
                                   the subgiant weighting, the white-dwarf
                                   and carbon / Wolf-Rayet defaults;
                                   massRatioFromComponents, a pair's q.
  pair-masses.ts                   pairMasses: both sides summed, an
                                   unparseable type at
                                   UNKNOWN_COMPONENT_MASS_MSUN.
  pair-masses.test.ts              The sum.
```

## The main-sequence anchors are an open decision

The main-sequence row disagrees with the dwarf table of
[Mamajek 2022](/data/papers/index.md#mamajek2022): A0V 2.9 against its
2.18 M☉, K5V 0.65 against 0.70. Which source to adopt is open,
`stellata-uadc.69.28`.

## `UNKNOWN_COMPONENT_MASS_MSUN` is high on purpose

A component whose type does not parse counts 3.0 M☉, not a typical star's
~1: an overestimated mass raises the escape velocity, so the gate stays
lenient and never rejects a bound pair for want of a spectral type.

## The parser is not the catalogue's

`parseSpectralType` is its own parser, not
`src/catalog-format/spectral/spectral-classify.ts`. The two disagree on 13 of
the 3,479 spectral strings Stage 5's pairs read, and both misread some of
them: Wolf-Rayet + O/B composites, `giant`, `sd:K…`, k-prefixed Am types.
Moving to `spectral-classify.ts` and fixing those masses is
`stellata-hhaw.45.17.12`; a change here moves `multiples.tsv` rows.
