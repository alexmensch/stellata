# Binary-system pipeline output + curated inputs

Pipeline-derived output plus two hand-curated inputs. Lives alongside
its source folders under `data/` so the binary-system pipeline's data
stays in one place.

```
multiples.tsv                   build-binaries.py output. Two rows per
                                kept physical WDS pair (incl. sub-pairs
                                synthesized from ORB6 / Gaia NSS — see
                                scripts/binaries/README.md § Sub-pair
                                synthesis), plus standalone rows for
                                SIMBAD-known components the pair walk
                                didn't reach. ~7 MB, LFS.
component_sptype_overrides.tsv  Hand-curated per-component MK types for
                                components no machine source carries
                                (Algol Aa2 K0IV, δ Vel Ab, σ Ori Ab,
                                Castor Ab/Bb/Ca/Cb). Top tier of Stage
                                6's spectral cascade (spect_via=curated).
                                Component keys use the raw multiples
                                comp form (Algol's Aa1,2 secondary is
                                "2"); every entry cites its literature
                                source. Regular git.
orb6_component_overrides.tsv    Hand-curated WDS component letters for
                                ORB6 rows whose components field is
                                blank — the catalog names the pair only
                                by its variable-star designation
                                (YY Gem = Castor Ca,Cb). Keyed on
                                (wds_id, discoverer); applied before
                                orphan sub-pair synthesis; every entry
                                cites its literature source. Regular
                                git.
```

## Schema

Canonical column order is `MULTIPLES_TSV_COLUMNS` in
[`scripts/binaries/stage6_multiples.py`](../../scripts/binaries/README.md):

```
system_id, comp, hip, gaia_source_id,
x_pc, y_pc, z_pc, absmag, ci, spect, name,
source, regime,
resolve_via, astrometry_via, orbit_via, spect_via,
photometry_via, a_via,
orbit_role,
P_days, T_jd, e, a_AU, i_rad, omega_rad, Omega_rad, q, dist_pc,
sep_arcsec, pa_deg, sep_pa_epoch_jd, dmag
```

Per-component provenance columns (`resolve_via`, `astrometry_via`,
`orbit_via`, `spect_via`, `photometry_via`, `a_via`) name which
strategy / catalogue tier supplied each piece of data. Canonical
values live in
[`scripts/binaries/`](../../scripts/binaries/README.md).

## Produced by

`scripts/binaries/build-binaries.py` (Stage 6 emits;
`npm run build:binaries`). See
[`scripts/binaries/README.md`](../../scripts/binaries/README.md) for
the seven-stage pipeline + per-stage modules.

## Consumed by

- `scripts/catalog/companion-promotion.ts` (build-time — surfaces pair
  secondaries as catalog.bin records).
- `scripts/binaries/build-runtime-binaries.py` (emits
  `public/binaries.bin` for the per-frame
  [`src/client/binaries/`](../../src/client/binaries/README.md) layer).
- `scripts/catalog/known-stars.test.ts` +
  `multi-star-regression.test.ts` (Tier A validation harnesses).
- Ad-hoc debugging of cross-match decisions.
