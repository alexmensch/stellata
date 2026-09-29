# Constellations at build time

The IAU-88 table every constellation index points into, and the two ways the
build fills it in from the committed sources: catalog byte 34's positional
membership, and the Stellarium stick figures in `public/constellations.json`.

## Files in this area

```
scripts/catalog/parse/constellations/
  constellations.ts (+ test)      CONSTELLATIONS / CON_INDEX, the Stellarium
                                  source path and its two readings (stick
                                  figures, readIauEdgeRecords), the chunk-0
                                  figure assert, and
                                  createConstellationAssignment, which binds
                                  the boundary lookup to the table's indices.
```

## Positional constellation membership

Catalog byte 34 is **positional**: `createConstellationAssignment`
(`constellations.ts`) resolves the IAU ([Delporte 1930](/data/papers/index.md#delporte1930)) boundary
region a record's own xyz falls in and maps it onto the `CONSTELLATIONS` index
space. The geometry — the B1875 precession, the edge decomposition, and
its self-validating 89-region invariant — is
`src/client/constellation-boundaries/iau-geometry/README.md`; this module owns only
the index mapping, and throws at construction if a region names a
constellation the IAU-88 table doesn't carry.

Two properties follow from the boundaries partitioning the whole sphere:

- **`NO_CONSTELLATION_INDEX` is unreachable for anything with a
  direction.** Sol sits at the origin and has none, so it is the sole
  holder — asserted at the record write in `../../build-catalog.ts`. Every
  other record, promoted companions included, carries a real
  constellation.
- **A row needs no catalogue entry to be classified.** The uncatalogued
  Gaia fill tier resolves on position like everything else.

**The designation's constellation does not come from this walk.** A
star's *designation* constellation is fixed by nomenclature and diverges from
position once a boundary moves past a named star: ρ Aql / 67 Aql (HIP 99742) has
been positionally in **Delphinus** since 1992 and is ρ **Aquilae** permanently.
The manifest carries no editorial `con` column,
so the walk leaves `desigConIndex` (search-index `dc`) at
`NO_CONSTELLATION_INDEX` and three later passes fill it — the IAU WGSN
designation the naming ladder resolves states its own constellation and wins
([The designation constellation](../../naming/README.md#the-designation-constellation)), else the classic-ID
label pass fills it from IV/27A keyed on the record's own HD/HIP, else a GCVS
designation's trailing abbreviation. Cascade, coverage and the GCVS precedence:
[The designation constellation](../../classic-ids/README.md#the-designation-constellation).
`designationConIndex(dc, c)` in `../../record/catalog-pure.ts` is still the single
statement of which field a Bayer / Flamsteed / GCVS designation reads, and the
positional `conIndex` is still the last fallback (123 faint Flamsteed-only
records IV/27A's TAP subset omits).

The population that fallback would silence is not small: the search entries
carrying a `dc` are dominated by Flamsteed numbers assigned under Ptolemaic
constellations that the [Delporte 1930](/data/papers/index.md#delporte1930) boundaries
reassigned (15 LMi sits in Ursa Major, 41 Lyn — Intercrus — likewise), plus the
boundary-straddling promoted companions whose composed names take the anchor's
designation (Fomalhaut C is α PsA C while sitting in Aquarius).

**A GCVS designation names its own constellation.** "LT Vul" names Vulpecula
whatever any catalogue column says, so `applyVariability` (`../gcvs/gcvs-parse.ts`)
sets `desigConIndex` from the designation's trailing abbreviation wherever
IV/27A left it empty — `gcvsDesignationCon` pins **7,363**. Its authority is
not a fallback position: the cell it used to correct was untrustworthy both
ways —

- **Stale** — LT Vul was filed under Sagitta, but sits in Vulpecula *and*
  is named for it, so designation and boundaries agreed against the cell.
- **Right on position, wrong on the name** — RY Cen (cell and position
  both Lupus, named for Centaurus) and EQ Vul (both Lyra, named for
  Vulpecula) are genuine ρ Aql-shaped movers, and were **invisible** to any
  check reading the designation constellation off the cell.

Those two plus CM Ind (named for Indus, positionally in Pavo) are the GCVS
share of the entries `designationConMismatch` pins; the rest come from IV/27A.
The count lives in [Search index](../../record/README.md#search-index-publicsearch-indexjson); it moves with the
record set.

## Stick figures from Stellarium

Classical asterism lines are sourced from Stellarium's modern sky culture
`index.json` (CC/MIT-compatible, HIP-indexed). The source file is
committed to `data/stellarium/stellarium-modern-skyculture.json` — it essentially
never changes, so fetching it at build time each time would be wasted
work.

Pipeline in `scripts/catalog/build-catalog.ts`:

1. `readStars` reads the manifest's `hip` column into each star record.
2. After the apparent-V sort ([Record order](../../record/README.md#record-order)) fixes the record indices, a
   `hipToIndex: Map<number, number>` is built from the post-sort order.
   Duplicate HIPs (rare — binary companions) keep the brightest entry
   (first-write wins).
3. `buildFigureLines(hipToIndex)` walks each Stellarium constellation's
   `lines` array and resolves every HIP to a record index, producing
   `Map<conIndex, number[][]>`.
4. Resolved `lines` are merged into the emitted `constellations.json`
   alongside `{ code, name }`. A polyline is kept only if ≥2 points
   survive.

**Reliability rule: any unresolved HIP is a hard build error** — unless
it's in `KNOWN_MISSING_HIPS`. That map documents HIPs that Stellarium
references but that build no record, with a human-readable justification
each. Both entries are on the manifest and both **park**: a parallax exists
and a skip rule refuses it, so they hold their SIDs and reinstate when Gaia
DR4 fits the blend (`../../distance/parallax/README.md`).

- `5165` (β Phe, HD 6595 — not α Phe, which is Ankaa at HIP 2081) —
  Phoenix loses most of its figure without this star.
- `89341` (μ Sgr / Polis) — one Sagittarius polyline degrades from 3
  points to 2, shape still recognisable.

If a future Stellarium update introduces new references to missing HIPs,
the build fails until each is explicitly added to
`KNOWN_MISSING_HIPS` with rationale. Don't relax the check to a soft
warning — the whole point of using Stellarium's HIP-indexed data (vs.
fuzzy RA/Dec position matching) is deterministic mapping.

**Every figure vertex must decode with the first transport chunk** — also a
hard build error (`assertFigureVerticesInFirstChunk`, run once the chunk plan
fixes `recordsInFirstChunk`). The runtime draws the figure and aims at its
centroid from first paint, off the records chunk 0 carries
([Late-attached slots](/src/client/README.md#prefix-reads-correct-by-construction)); a vertex in a
later chunk would read an undecoded `(0,0,0)` there. Records are apparent-V
ordered, so this holds while every figure star is naked-eye bright: measured,
708 distinct vertices, highest record index 10,289 against a chunk 0 of
10,412 records.

