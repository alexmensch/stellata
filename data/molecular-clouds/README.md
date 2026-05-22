# Molecular cloud reference data

Zucker 2020 + Zucker 2021 cloud distance / geometry tables, consumed
at build time by `scripts/clouds/build-clouds.py` →
`public/clouds.json` (renderer currently shelved).

```
zucker2020-tablea1.tsv   Zucker 2020 cloud distances (~88 KB,
                         sightline-aggregated by name).
zucker2021-table1.dat    Zucker 2021 3D bounding boxes (~1 KB).
zucker2021-table2.dat    Zucker 2021 radial profile fits (kept for
                         future).
zucker2021-table3.dat    Zucker 2021 cloud masses (kept for future).
```

All files ride regular git (small).

## References

- Zucker C. et al. 2020, *ApJ* 900, 196.
  DOI: 10.3847/1538-4357/abb247.
- Zucker C. et al. 2021, *ApJ* 919, 35.
  DOI: 10.3847/1538-4357/ac1f96.
