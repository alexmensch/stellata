# External-catalogue refresh

**Layer 2** of the build/data split — manual, infrequent refresh of
the frozen external catalogues under `data/`. Never wired into
`npm run build`. See `scripts/README.md` § Layer 2 — refresh scripts
for the protocol + cadence (RELEASING.md § Catalogue refresh policy).

## One-time setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/refresh/requirements-refresh.txt
```

Then activate (`source .venv/bin/activate`) before running any
`npm run refresh:*` target.

## Targets

```
npm run refresh:gaia-hip          → data/gaia/gaia_dr3_hip_xmatch.tsv
npm run refresh:gaia-tyc          → data/gaia/gaia_dr3_tyc_xmatch.tsv
npm run refresh:gaia-astrometry   → data/gaia/gaia_dr3_astrometry.tsv
npm run refresh:gaia-nss          → data/gaia/gaia_dr3_nss_two_body.tsv
npm run refresh:gaia-apsis        → data/gaia/gaia_dr3_apsis.tsv
npm run refresh:bailer-jones      → data/bailer-jones/bailer-jones-dr3.tsv
npm run refresh:hip2              → data/hipparcos/hip2_van_leeuwen.tsv
npm run refresh:simbad            → data/simbad/simbad_sample.tsv
```

`refresh-simbad-sptype.py` and `refresh-simbad-wds-xids.py` (no npm
target yet) are invoked directly with `python3 scripts/refresh/refresh-simbad-*.py`.

## Shared plumbing

`refresh_lib.py` — Astroquery / ADQL / atomic-rename plumbing shared
by every `refresh-*.py`. `simbad/` — reusable SIMBAD-pull
infrastructure (`ColumnSpec` / `IdentLookup` specs, per-source-file
id iterators, batched ADQL executors, spec-driven TSV writer). Modelled
on `scripts/binaries/`; future SIMBAD pulls (RV, photometry, …) reuse
every file there.
