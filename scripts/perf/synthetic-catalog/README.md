# Synthetic catalog — scale measurement without the Gaia pull

Rewrites a catalog artifact set with a synthetic faint population appended, so
the wire-size and GPU-memory axes of `stellata-cns.1` can be measured at
V ≤ 11 / 12 / 13 today. Those two axes are functions of record count and bytes
per record alone; only build-pipeline cost and the visual-gap check need real
rows, and those stay on `stellata-cns.3`.

```
scripts/perf/synthetic-catalog/
  synthetic-catalog-pure.ts   The sampling maths: census targets, the
    (+ test)                  intrinsic-property pool, the per-sightline
                              march and its magnitude-limited weights, the
                              equal-area sky grid, the CDF draws. Pure.
  build-synthetic-catalog.ts  The runner: reads a source artifact set, appends
                              the synthetic population, rewrites chunks and
                              manifest.
```

## THIS ARTIFACT IS NOT A BUILD OUTPUT

It **violates the brightest-first record sort** that
`scripts/catalog/record/README.md` states as the on-disk contract: synthetic
records append after the real ones rather than merging into the absmag order.
That is deliberate. Record indices are addressed from outside the binary —
`companionIdx`, `binaries.bin` relation indices, and
`catalog-row-index-map.json` — so a merge would have to remap all three, and
the sort itself is load-bearing only for search, which synthetic render-only
stars never enter.

Never serve this from the main checkout's `public/`, never commit it, and
never compare a run over it against a pin taken on the real catalogue as
though the two measured the same scene.

## Invocation

```
tsx scripts/perf/synthetic-catalog/build-synthetic-catalog.ts \
  --source <dir with catalog.bin.* + catalog-manifest.json> \
  --out <dir> [--limit-mag 11|12|13|14|15] [--seed 1] [--max-records N]
```

`--source` and `--out` may be the same directory; the runner clears stale
`catalog.bin.<i>` first so a shrunk chunk count cannot strand files.
`--max-records` caps the synthetic count for a quick shape check.

Sets live under `.synthetic/<depth>/` (gitignored — hundreds of MB), one
directory per depth, and a dev server is pointed at one by copying it over
`public/`.

Copy the artifacts into the worktree, never symlink them — a build in a
worktree writes through a symlink into the main checkout ([Building in a worktree](/scripts/README.md#building-in-a-worktree)).

## What the distribution is drawn from

The missing population is **not local**. Measured on the shipped catalogue:
375 records within 10 pc, 312k of 388k between 100 pc and 1 kpc, and the
apparent-magnitude histogram turning over at V 9–10 where a complete census
would still be climbing. The ~890k stars missing at V ≤ 11 sit at roughly
250 pc – 2.5 kpc, concentrated toward the galactic plane. An isotropic
sprinkle would therefore under-count survivors in the one view that decides
the answer — a wide field toward the galactic centre, which is what the canon
`mw120` and `mw50` vantages already look at.

So positions are drawn against the band's **own** density profile, imported
from `src/client/milkyway/milkyway-column-pure.ts` rather than restated:
`discDensity + bulgeDensity`, each clamped to its proxy ellipsoid because the
profiles do not stop there on their own — at render time the shader's
ray-sphere intersection is what bounds them.

Stellar number density is taken as proportional to that luminance density.
One population, so the shapes agree up to a scale, and the census target fixes
the scale.

Intrinsic properties are not invented. Each synthetic star **reuses a real
record's** `(absmag, ci, physRadius, spectClass, lumClass)` tuple, drawn from
records within 100 pc. That guarantees physically consistent tuples with no
colour/radius/class relation of our own, and the pool *is* the empirical
luminosity function. Its own incompleteness — missing M dwarfs beyond a few
tens of parsecs — falls exactly where it does not matter: an M dwarf at 1 kpc
sits near V = 20 and is nowhere near any floor measured here.

Selection is magnitude-limited **after extinction**, using the same analytic
dust column the band marches (`dustTauVPerPc`). Ignoring it would place stars
whose rendered magnitude lands past the limit once the raymarch re-adds A_V,
which culls them and flatters the result. Sampling is by precomputed CDF —
8192 equal-area sky cells × 192 radial steps — so each star costs two table
lookups rather than a rejection loop that would run at ~1e-4 acceptance.

## Two approximations in how many stars get made

Both sit in the count, not the distribution, and they pull opposite ways. The
ladder is a scale measurement, so neither is worth the cost of removing — but a
figure read off it is good to a few percent, not to the record.

**The target is a G-band census; the cut is a V-band one.** `GAIA_CENSUS_BY_G`
holds counts of stars brighter than a limit in Gaia's own broad `G` band,
while selection here cuts on `V` — what the catalogue's `absmag` is measured
in. `G` runs slightly brighter than `V` for most stars, so the census sweeps in
some stars a true `V` cut would leave out, and the target is a little generous.

**Real records are counted against the limit without extinction.** The
synthetic draw is magnitude-limited *after* the dust column, but the tally of
real records already at the limit is not — so that tally is too high, and the
shortfall it is subtracted from comes out too low. This under-makes stars,
against the previous paragraph's over-count.

## The band double-counts, and it moves the number

The band's density solve is anchored to the
[Leinert 1998](/data/papers/index.md#leinert1998) **total**, which
covers resolved and unresolved stars alike, so the resolved catalogue is
already double-counted: `src/client/milkyway/calibration/README.md` records the
cost as diffuse + catalogue reading 23.00 mag/arcsec² at the pole against
[Leinert 1998](/data/papers/index.md#leinert1998)'s 23.83. Deepening the
catalogue widens that gap, and the resolved-catalogue subtraction constants are
read by tests alone — nothing rendered self-corrects.

This reaches the measurement, not just the look. A brighter sky pulls exposure
adaptation down, the derived `uCullMag` follows, and fewer stars survive the
vertex cull. **State in any recorded run whether the band was corrected**, and
treat corrected/uncorrected runs as different scenes. `stellata-cns.9` owns
the recalibration.

## Reading a result

The scale axes are offline: record count, raw bytes, gzipped bytes, chunk
count, and per-instance VRAM from the 14 instanced attributes. Frame cost is
the armed runner at `mw120` / `mw50` per the `stellata-perf` skill — and a run
over this artifact is never comparable to `pins/`, which was taken on the real
catalogue.
