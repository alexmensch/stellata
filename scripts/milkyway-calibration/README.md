# Band calibration measurements

What the star catalogue already draws, measured off the built `catalog.bin`
against the Milky Way band model, and written into the band's calibration as
one generated module. The band then marches the model **minus** that light,
so the sky never carries a star twice ([The resolution hole](/src/astro-core/milkyway/calibration/README.md#the-resolution-hole--the-band-marches-the-model-minus-the-drawn-stars)).

```bash
pnpm run measure:band-resolved              # needs a built public/catalog.bin, ~2 s
pnpm run measure:band-resolved -- --manifest path/to/catalog-manifest.json
```

It is a TypeScript manual bake on the step table
([Step kinds](../pipeline/README.md#step-kinds)), so `record.ts` runs it and
writes `data/stamps/measure-band-resolved.json`. Its record holds a hash of
each catalogue column in `STAR_FIELDS`, never the catalogue's bytes
(`describe`, through `catalogColumnsProjection`): a catalogue rebuild that
moves any measured column (any membership change does) stops the build and
names this command, and one that moves only a name or an unread field
leaves it fresh. A `--manifest` run measures another catalogue and writes no
record, so the table reads stale until a plain run.

```
scripts/milkyway-calibration/
  measure-resolved-light.ts   Entry point. Reads the four record columns the
                              measurement needs (xyz, absmag), prints every
                              figure, and writes
                              src/astro-core/milkyway/calibration/resolved-hole-table.ts;
                              its describe is the same columns' projection.
  resolved-hole-table-outputs.ts
                              RESOLVED_HOLE_TABLE_OUTPUTS, the one file the
                              bake writes, as its emitArtifacts declaration.
  measure-inputs.test.ts      The bake's input set: the column reader, and
                              baker-constants.json as its one data file, so
                              no snapshot beside an imported module joins it.
  resolved-light-pure.ts      The cap sums, the (shell × latitude band) cells,
    (+ test)                  the table they become, and the light the table
                              removes. Pure. STAR_FIELDS is the one list of
                              record columns the measurement reads.
```

The quadrature samples stay on the cell that owns them and nothing copies
them: 8,000 directions × 8 sub-steps × 32 shells is 2 M of them, and the
all-sky roll-up (`shellTotals`) needs two scalars per shell, not the
samples. `shellHoleLight` reaches them where they are.

## What it writes

`resolved-hole-table.ts` carries two things, both measured, neither authored:

- **`RESOLVED_CATALOGUE_CAP`** — Σ10^(−0.4·V) over the records inside a 10°
  cap on the ICRS J2000 galactic centre and north pole, per arcsec². `V` is
  `absmag + 5·log10(d/10)`, so the rows are **de-extincted**; only the pole is
  commensurable with an observed sky total (`diffuse-reference.ts`).
- **`RESOLVED_HOLE_VALUES`** — the catalogue's share of the band model's
  light in each of 32 log-distance shells × 8 equal-|sin b| bands around Sol,
  clamped to [0, 1]. Layout constants live in `resolved-fraction-pure.ts`;
  this file is data.

Which catalogue they were measured on is the bake's record, not the table:
CI builds the full catalogue, so a table measured on a shallower local build
reads stale there and fails the build.

## How a cell is measured

Both sides of the ratio are luminosities in the band's own flux unit,
`100·10^(−0.4·M_V)` per star and `ρ₀ × shape` per pc³ for the model:

- **Catalogue** — every record binned by its distance from Sol and its
  |sin b| from Sol, summing `starLuminosity(absmag)`. Intrinsic magnitudes,
  matching the model's intrinsic emissivity; the dust is applied to both
  later, in the march.
- **Model** — `discDensity + bulgeDensity` at 8,000 Fibonacci directions ×
  8 radial sub-steps per shell, each sample carrying its volume element. The
  same samples are what `holeLight` weights by the table, so the reported
  "table removes" column is the shader's own sampling of the shader's own
  table, not a re-derivation.
- **A cell under `MIN_STARS_PER_CELL` (500) stars** takes its shell's
  all-sky share. The ratio is a sum over a heavy-tailed luminosity function
  and a single giant moves a thin cell by a quarter; the innermost and the
  outermost shells are where this bites, and both carry almost no band light.

The shell average is over the whole sky, so the table cannot see structure in
longitude — the Gould Belt, Sco–Cen, the dust toward the centre. It shows as
plane cells reading over 1 within 200 pc (clamped) and as the 0.25 mag by
which the hole column toward the centre exceeds the centre cap.

## What the run says, and what it does not

The run prints the raw shares and the star counts per cell, the all-sky shell
table with the table's own sampled share beside the observed one, the light
budget (the hole removes 1.03× the catalogue's light over the tabulated
volume, 0.35 % of the model's), and the two dust-free columns from Sol with
and without the hole against the catalogue caps. Those figures are the
acceptance for a regeneration: the hole's column at the pole has to land on
the pole cap inside about a tenth of a magnitude, and the whole-model share
has to stay well under a hundredth. The centre's hole column is NOT a
tolerance — dust-free, the GC's total and unresolved columns differ by a
hundredth of a magnitude, so their difference amplifies any error some
fiftyfold ([The resolution hole](/src/astro-core/milkyway/calibration/README.md#the-resolution-hole--the-band-marches-the-model-minus-the-drawn-stars)).

It does **not** re-pin anything. Every consumer test (`/tests/integration/milkyway.test.ts`,
`band-peak-pure.test.ts`, `diffuse-reference.test.ts`,
`scene-adaptation-pure.test.ts`, `march-plan.test.ts`) pins the sightline
table the shipped hole produces, and moves when the table does. Run the
suite after a regeneration and re-pin deliberately.
