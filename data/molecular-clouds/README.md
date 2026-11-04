# Molecular cloud reference data

[Zucker 2020](/data/papers/index.md#zucker2020) + [Zucker 2021](/data/papers/index.md#zucker2021) cloud distance / geometry
tables, consumed at build time by `scripts/clouds/build-clouds.ts` →
`public/clouds.json`, rendered by `src/client/molecular-clouds/`
(see that folder's README).

```
zucker2020-tablea1.tsv   Zucker 2020 (/data/papers/index.md#zucker2020)
                         cloud distances (~88 KB,
                         sightline-aggregated by name).
zucker2021-table1.dat    Zucker 2021 (/data/papers/index.md#zucker2021)
                         3D skeleton extents (~1 KB).
zucker2021-table2.dat    Zucker 2021 (/data/papers/index.md#zucker2021)
                         radial profile fits (the
                         density model's shape, scripts/clouds/
                         cloud-model-pure.ts).
zucker2021-table3.dat    Zucker 2021 (/data/papers/index.md#zucker2021)
                         cloud masses and peak A_K (the
                         display mass, and the density model's
                         calibration target).
zucker-profiled.json     Written by build:clouds: the profiled
                         clouds' boxes and target columns the dust
                         bake's Zucker check reads
                         (/scripts/clouds/README.md#outputs).
cloud-surfaces.bin       Written by build:cloud-surfaces
                         (/scripts/cloud-surfaces/README.md).
```

The tables and `zucker-profiled.json` ride regular git (small); `*.bin` is LFS.

## References

- [Zucker 2020](/data/papers/index.md#zucker2020).
- [Zucker 2021](/data/papers/index.md#zucker2021).
