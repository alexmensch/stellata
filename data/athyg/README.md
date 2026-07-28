# AT-HYG v3.3 — stellar catalogue (classic-IDs subset)

The base stellar catalogue Stellata renders, plus the frozen spine derived
from it. Every row in the subset carries at least one classical designation
(proper name, Bayer, Flamsteed, HIP, HD, HR, or Gliese).

```
athyg_33_classic_ids.csv   ~64 MB, LFS. Upstream. ~317k rows.
inherited-spine.tsv        ~40 MB, LFS. Generated provenance data —
                           see § The inherited spine. 313,257 rows.
```

The two are different kinds of file: the CSV is frozen **external** data
under the policy in [`../README.md`](../README.md) § Frozen external data;
the spine is a frozen **Stellata build artifact** that happens to live
beside it.

## Provenance

- **Maintainer**: David Nash, [Codeberg/astronexus/athyg](https://codeberg.org/astronexus/athyg).
- **Licence**: CC-BY-SA-4.0. The generated `public/catalog.bin` and
  `public/search-index.json` are derivatives and carry the same licence.
- **Composition**: heterogeneous merge over Tycho-2 (bulk positions
  + V_T photometry), Hipparcos (bright end), Gaia DR3 (most
  distances, some positions), Gliese (nearby stars). The classic-IDs
  subset is whichever merge rows carry one of the classical IDs above.
- **Per-row provenance**: `pos_src` / `dist_src` / `mag_src` / `pm_src`
  columns name which upstream catalogue supplied each piece of data.
  ~99.4 % Tycho-2 positions, ~97.9 % Gaia DR3 distances, mixed
  Tycho-2 / Hipparcos magnitudes. See `docs/science-catalog-ingestion.md`
  § Stellar catalog ingestion for the magnitude distribution and how it interacts with
  the `naked-eye` / `binoculars` / `all` presets.

## The inherited spine

`inherited-spine.tsv` is **generated provenance data**, not an upstream
table: one row per AT-HYG-derived record of the AT-HYG-driven build of
**2026-07-28** (`athyg_33_classic_ids.csv` v3.3 + that day's reference
tables), written once by `pnpm run build:spine` and then frozen. It carries
each record's resolved designation set (`hip` `hd` `hr` `gl` `flam` `bayer`
`proper` `gaia_source_id`) plus AT-HYG's printed cells verbatim (`tyc` `ra`
`dec` `dist` `mag` `ci` `spect` `rv` `pm_ra` `pm_dec` and the six `*_src`
provenance columns). `gaia_source_id` is empty on 1,371 rows — the no-Gaia
residual; there is no separate keep-list file.

It exists so catalogue membership and labels survive AT-HYG's retirement as
the build driver: after the swap, membership is the spine and AT-HYG the
catalogue is not consulted. Contract:
[`docs/catalog-driver.md`](../../docs/catalog-driver.md) § 3. Generator,
column origins, and why nothing regenerates it in CI:
[`scripts/catalog/spine/README.md`](../../scripts/catalog/spine/README.md).
Licence follows the CSV it derives from (CC-BY-SA-4.0).

## Consumed by

`athyg_33_classic_ids.csv` → `scripts/catalog/build-catalog.ts` (`readStars`
in `scripts/catalog/parse/stars-parse.ts`) and
`scripts/catalog/spine/build-inherited-spine.ts`. The build does NOT consult
the network — refresh of the CSV is a manual swap, see
[`scripts/refresh/`](../../scripts/refresh/README.md) when a new
AT-HYG release lands. Reference epoch J2000.0; proper-motion columns
are ingested but not applied (no T-axis animation today).

`inherited-spine.tsv` has no build consumer yet — wiring it in as the
membership term is `stellata-3bsf.4`. Two test files in
`scripts/catalog/spine/` read it: the guard pins its bytes and committed
counts, the parity gate holds it to the build it snapshots.
