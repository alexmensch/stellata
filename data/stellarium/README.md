# Stellarium modern sky culture

Two datasets in one file: HIP-indexed polylines for the 88 IAU
constellation stick figures, and the 781 IAU (Delporte 1930)
constellation **boundary** segments at equinox B1875.

The file also carries a `common_names` block — 659 HIP-keyed folk names
with per-name literature references. **Nothing reads it**, and it is
rejected as a naming authority (`docs/star-naming.md` § 2); it carries
**no Bayer designations and no Greek glyphs**, so it is not a glyph
source either. It stays an optional alias candidate only.

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

The file is Stellarium's native `index.json` format.

**Stick figures.** Per constellation, the `lines` array is a list of
polylines, each a sequence of HIP integer IDs to be connected in order.

**Boundaries.** The top-level `edges` array holds 781 whitespace-delimited
records, `<id>:<id> <M|P>+ ra1 dec1 ra2 dec2 CON1 CON2` — M for a
meridian (constant RA), P for a parallel (constant Dec), coordinates
sexagesimal. `edges_epoch` is `B1875` and `edges_source` credits
pbarbier's `edges_18.txt`; both are asserted at read time, since the
assignment precesses positions to that equinox before testing them.

## Consumed by

Both by `scripts/catalog/parse/constellations.ts`, which owns the path:

- `buildFigureLines(hipToIndex)` → `public/constellations.json` (absent
  for constellations with no asterism lines), from
  `scripts/catalog/build-catalog.ts`. See
  [`scripts/catalog/parse/README.md`](../../scripts/catalog/parse/README.md)
  § Stick figures from Stellarium.
- `readIauEdgeRecords()` → the boundary segments, parsed and decomposed
  into named sky regions by
  [`src/client/constellation-boundaries/`](../../src/client/constellation-boundaries/README.md).

## Reliability rules

Any unresolved stick-figure HIP is a hard build error, unless it's in
`KNOWN_MISSING_HIPS` (currently `5165` α Phe, `89341` μ Sgr) with
a human-readable justification. Don't relax to a soft warning —
deterministic HIP indexing is the whole reason Stellarium was
preferred over RA/Dec positional matching.

The boundary side has the equivalent guard built into its own
decomposition: the edge set must resolve to exactly 89 uniquely named
regions or the walk throws. See that folder's README § Cell
decomposition.
