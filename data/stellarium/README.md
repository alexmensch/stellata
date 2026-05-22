# Stellarium modern sky culture

HIP-indexed polylines for the 88 IAU constellation stick figures.

```
stellarium-modern-skyculture.json   ~200 KB, regular git.
```

## Provenance

- **Source**: [Stellarium modern skyculture](https://github.com/Stellarium/stellarium/tree/master/skycultures/modern)
  on GitHub.
- **Licence**: MIT (line data; illustrations are CC-BY-SA-4.0 but
  not used here).
- **Cadence**: essentially never changes — committed as-is rather
  than fetched at build time.

## Schema

The file is Stellarium's native `index.json` format. Per
constellation, the `lines` array is a list of polylines, each a
sequence of HIP integer IDs to be connected in order.

## Consumed by

`scripts/catalog/build-catalog.ts` via
`buildFigureLines(hipToIndex)`. Output: `public/constellations.json`
(absent for constellations with no asterism lines). See
[`scripts/catalog/README.md`](../../scripts/catalog/README.md)
§ Stick figures from Stellarium.

## Reliability rule

Any unresolved HIP is a hard build error, unless it's in
`KNOWN_MISSING_HIPS` (currently `5165` α Phe, `89341` μ Sgr) with
a human-readable justification. Don't relax to a soft warning —
deterministic HIP indexing is the whole reason Stellarium was
preferred over RA/Dec positional matching.
