# Binary-system pipeline output

Pipeline-derived (not external). Lives alongside its source folders
under `data/` so the source-vs-derived split reads cleanly.

```
multiples.tsv   build-binaries.py output. Two rows per kept physical
                WDS pair, plus standalone rows for SIMBAD-known
                components the pair walk didn't reach. ~5.5 MB, LFS.
```

## Schema

Canonical column order is `MULTIPLES_TSV_COLUMNS` in
[`scripts/binaries/stage6_multiples.py`](../../scripts/binaries/README.md):

```
system_id, comp, hip, gaia_source_id,
x_pc, y_pc, z_pc, absmag, ci, spect, name,
source, regime,
resolve_via, astrometry_via, orbit_via, spect_via,
orbit_role,
P_days, T_jd, e, a_AU, i_rad, omega_rad, Omega_rad, q, dist_pc
```

Per-component provenance columns (`resolve_via`, `astrometry_via`,
`orbit_via`, `spect_via`) name which strategy / catalogue tier
supplied each piece of data. Canonical values live in
[`scripts/binaries/`](../../scripts/binaries/README.md).

## Produced by

`scripts/binaries/build-binaries.py` (Stage 6 emits;
`npm run build:binaries`). See
[`scripts/binaries/README.md`](../../scripts/binaries/README.md) for
the seven-stage pipeline + per-stage modules.

## Consumed by

- `scripts/catalog/known-stars.test.ts` (Tier A validation harness)
  — runtime lookup helper at
  [`scripts/catalog/catalog-lookup.ts`](../../scripts/catalog/README.md).
- Ad-hoc debugging of cross-match decisions.
- *Future*: the per-frame binary-orbit runtime layer, when it lands.
  Not merged into `catalog.bin` — a parallel runtime layer alongside
  per-star, planet-body, Local Group, and the other render layers.
