# SIMBAD sample — the Tier-C validation corpus

`refresh:simbad` — a V-magnitude-stratified 50,000-star draw from SIMBAD,
written to `data/simbad/simbad_sample.tsv`, which the Tier-C validator and
the build's distance-regression check read
([Consumed by](/data/simbad/README.md#consumed-by)). A phased pull on the
[pull runtime](../pull/README.md#a-phased-pull).

## Files

- `refresh-simbad-sample.ts` (+ test, the committed table replayed through
  the pull) — the entry: `describe` and `main`.
- `simbad-sample-pure.ts` (+ test) — the bins, the anchors, the seeded draw,
  the derived distance and absolute magnitude, and `samplePull`.
- `simbad-sample-replay-pure.ts` — `sampleFake`, a fake SIMBAD answering the
  pull with a committed table's own rows.
- `simbad-sample-outputs.ts` — the step's output declaration.

## The draw

Four V bins (`BINS`), each one whole-table query over `basic` joined to
`allfluxes` on the star branch of `otypedef` (a subquery: SIMBAD refuses
`LIKE` on `basic.otype`), thinned server-side by `MOD(oid, modK) = SEED %
modK` so a bin answers about three times its target. The candidates are
sorted by oid and drawn without replacement by `mulberry32(SEED)`
(`../../util/seeded-random-pure.ts`), one generator across the bins in
order, so the same candidates draw the same rows on every machine. A bin
short of its target fails the pull: lower its `modK`.

**The anchors are always drawn.** The V<6 bin draws alf Lac (oid 38673) and
bet Lac (oid 75118) first and the rest of its target from the others; they
are the table's spot rows (main_id exact, V within 0.02, parallax within
0.2 mas), so every redraw still pins two known stars. The seed, the targets
and the anchors are the pull's `parameters`, so changing any of them stales
its record.

**Every live run redraws.** SIMBAD's candidate set drifts between runs, so a
re-pull changes rows even at the same seed; the corpus tracks SIMBAD, not a
frozen draw.

Then HIP and Gaia DR3 ids for the drawn oids (`fetchIdents`, `../simbad/`),
the last of each in table order; Gaia coverage must reach 95% over the whole
sample (the V<6 bin alone runs ~94%: Gaia saturates on the brightest stars).
`distance_pc` is `1000 / plx_value` for a positive parallax and `absmag`
`V − 5 log10(d / 10)`, both derived from the text SIMBAD answers, before the
written rounding (V to 3 decimals, parallax and proper motion to 4,
coordinates to 6).

## The committed table

The committed file is the last Python pull's 50,000 rows replayed through
this pull, each bin answered with exactly its own rows, so the draw takes
every one; its record's `answeredBy` is empty, and the replay test holds the
file to it byte for byte. Nine `absmag` cells moved by 0.001 against the
Python pull (oids 175512, 176682, 1479450, 2318077, 2867110, 2949772,
3195867, 3444459, 16487515): SIMBAD's V carries more decimals than the
file's three (oid 175512: 11.3583 live, 11.358 written), and the replay can
derive only from the written V.
