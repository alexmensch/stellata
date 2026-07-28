# IAU constellation boundaries

The Delporte (1930) boundary arcs: the B1875 edge set, its decomposition
into named sky regions, and the positional lookup that answers "which
constellation is this position in" for **any** position — catalogued
star, anonymous Gaia row, galaxy, cloud, or planet.

Assignment is purely positional and epoch-independent: precess the
position to B1875.0, test it against arcs that are constant-RA /
constant-Dec lines in that equinox. Nothing about a catalogue entry
enters into it.

## Files in this area

```
src/client/constellation-boundaries/
  iau-boundaries-pure.ts          Edge parsing, the cell decomposition,
    (+ test)                      point lookup, nearest-edge distance. Pure.
  iau-athyg-agreement.test.ts     Catalogue-wide cross-check against AT-HYG's
                                  editorial con column (§ Agreement).
```

The edge records are read from the committed Stellarium file by
`readIauEdgeRecords` (`scripts/catalog/parse/constellations.ts`); B1875
precession is `../util/precession.ts`.

## The edge set

`data/stellarium/stellarium-modern-skyculture.json` carries an `edges`
array of **781** records — 389 meridians (constant RA) and 392
parallels (constant Dec) — at equinox **B1875**, sourced from
pbarbier's `edges_18.txt`. Each names the two constellations it
separates:

```
097:096 M+ 20:08:30 +08:30:00 20:08:30 +15:45:00 DEL AQL
```

**The CON1/CON2 order carries no side convention.** Do not read it as
"A lies west of B" — the labelling below never depends on it.

A parallel arc always runs **eastward** from its first RA to its
second, so a second RA at or below the first wraps through RA 0. Taking
`min`/`max` instead keeps the complementary arc and quietly walls off
most of the sky (11 of the 392 wrap). Both endpoints are stored exactly
as parsed, never as `start + span`: the cell grid keys on exact
equality against them and a reconstructed end differs in the last float
digit, which splinters 236 RA bounds into 259.

## B1875

`B1875_JD` (`../util/precession.ts`) is 2405889.2586 — **1874 Dec
31.76**, by the Besselian epoch formula, not a Julian-year offset from
J2000. The rotation is the IAU 1976 (Lieske) composition
Rz(−z)·Ry(−θ)·Rz(−ζ).

Two ways to get this wrong, both of which still produce a
plausible-looking sky:

- **θ negated.** Every position lands 2θ ≈ 1.4° off in declination.
  Agreement with AT-HYG collapses to 92.8%.
- **The epoch off by months.** Six months late (1875 Jun 2 instead of
  1874 Dec 31) shifts RA by ~17″ and triples the disagreement count
  from 61 to 149 while every named-star spot check still passes.

The epoch is therefore pinned by the disagreement count, not by spot
checks. See § Agreement and § ρ Aquilae.

## Cell decomposition — the self-validating invariant

`buildConstellationRegions` turns the edge set into named regions:

1. The distinct RA and Dec values across all edges induce a
   **236 × 200** cell grid (236 cyclic RA columns, 199 Dec bounds → 200
   bands closed by ±90).
2. Union adjacent cells no edge separates. A meridian at the shared RA
   walls two columns apart only where it spans the whole Dec band; a
   parallel at the shared Dec walls two bands apart only where it spans
   the whole RA column.
3. Name each region by **intersecting the {CON1, CON2} pairs of every
   edge bounding it**. A set intersection, so it is convention-free.

RA adjacency is cyclic, and that is also what closes the polar caps: no
meridian reaches past ±85°, so every cell in the outermost band
connects around to its neighbours (Octans south, Ursa Minor north). No
special case needed.

The walk yields **exactly 89 regions, each with a distinct name** —
`IAU_REGION_COUNT`. Nothing in the pipeline supplies that number: the
edge pairs alone determine it, and 89 is 88 constellations plus
Serpens' two disjoint parts. So the count matching is a genuine
self-check, and `buildConstellationRegions` **throws** rather than ship
a half-resolved sky. A drift means the source data changed or the cell
walk broke — no lookup table (Roman 1987 / VI/42) is needed or
consulted.

## Serpens

The edge set names `SER1` (Caput) and `SER2` (Cauda) because they are
genuinely disconnected regions. `constellationEdgeCodeAt` returns
whichever one the position is in; `constellationKey` collapses both to
`ser`, the lowercase key `CON_INDEX`
(`scripts/catalog/parse/constellations.ts`) indexes the IAU-88 table
by. Keep the split when the two halves must be placed separately — a
flux-weighted centroid over the union lands in the gap between them.

## ρ Aquilae

ρ Aql / 67 Aql (HIP 99742) is the one designated star whose positional
constellation is **not** its nomenclature constellation: IAU naming
keeps it in Aquila, its position is in **Delphinus**. It crossed the
20h08m30s wall by proper motion — published as 1992.

The margin is 0.381″ past the wall at the catalogue's J2000 position.
That is thin by design and it is a *feature* of the pin: walking the
margin back through the star's own proper motion (55.4 mas/yr in
α·cos δ) dates the crossing to 1993.4, which is independent external
corroboration that the B1875 epoch and the rotation are both right. A
wrong epoch moves the implied date by centuries.

This is why positional membership and the designation's constellation
have to be carried as separate fields — making the catalogue's
constellation positional would otherwise rewrite this star's search
aliases from "Rho Aql" to "Rho Del".

## Agreement with AT-HYG

`iau-athyg-agreement.test.ts` walks all **317,174** AT-HYG rows that
carry a `con` cell (Sol is the one row that does not) and compares the
computed assignment against that editorial column:

| | |
| --- | --- |
| Agreement | 99.98% |
| Disagreements | **61**, pinned exactly |
| Of those, carrying a designation | 1 — ρ Aql |

The other 60 are anonymous rows sitting within an arcsecond or so of a
wall, where an editorial cell has no nomenclature to answer to. The
count is pinned as an exact number rather than a rate because it is the
sharpest signal available on the precession epoch (§ B1875).

AT-HYG shares no input with the edge set, so this is external
validation of both the epoch and the decomposition. It is also why the
positional assignment can replace the editorial column outright:
AT-HYG's `con` covers only its own rows, while this covers every
position, including the uncatalogued fill tier.

## Nearest-edge distance

`angularDistanceToNearestEdgeDeg` gives the angular distance from a
B1875 position to the closest boundary arc, measured across the sphere:

- **Meridian** — a constant-RA great circle, so the perpendicular foot
  keeps the point's own declination. In-span, the distance is the
  point's angle out of that circle's plane (a 1° RA offset at dec 80 is
  0.17° of sky); out of span, the nearer endpoint wins.
- **Parallel** — a constant-Dec small circle, so the shortest path runs
  along the point's own meridian and an in-span point is |Δdec| away;
  out of span, the nearer endpoint again.

This feeds the fade window for drawing the boundaries. A boundary is a
Sol-frame projection, so the offset at which a star reads as being in
the *wrong* cell is `(distance to its wall + tolerance) × its distance
from Sol` — sub-parsec for the naked-eye population, which is what
makes the drawn boundaries a Sol-neighbourhood affordance that
self-hides before the first star.
