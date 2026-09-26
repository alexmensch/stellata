# Molecular cloud reference data

[Zucker 2020](/data/papers/index.md#zucker2020) + [Zucker 2021](/data/papers/index.md#zucker2021) cloud distance / geometry
tables, consumed at build time by `scripts/clouds/build-clouds.py` →
`public/clouds.json`, rendered by `src/client/molecular-clouds/`
(see that folder's README).

```
zucker2020-tablea1.tsv   Zucker 2020 cloud distances (~88 KB,
                         sightline-aggregated by name).
zucker2021-table1.dat    Zucker 2021 3D bounding boxes (~1 KB).
zucker2021-table2.dat    Zucker 2021 radial profile fits (the
                         density model's shape, scripts/clouds/
                         cloud_model.py).
zucker2021-table3.dat    Zucker 2021 cloud masses and peak A_K (the
                         display mass, and the density model's
                         calibration target).
```

All files ride regular git (small).

## References

- [Zucker 2020](/data/papers/index.md#zucker2020).
- [Zucker 2021](/data/papers/index.md#zucker2021).
