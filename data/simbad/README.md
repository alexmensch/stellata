# SIMBAD — sample, sp_type, WDS↔Gaia cross-IDs

Per-source SIMBAD pulls. Used as: a Tier-C validation corpus, the
top-priority spectral classifier, and the principled WDS-component
cross-identification path. SIMBAD's strength is curated per-source
identifier and classification metadata across the literature —
exactly the gap AT-HYG (system-level spectra) and Gaia DR3
(saturation-prone bright primaries) leave open.

```
simbad_sample.tsv          ~5.7 MB, LFS. Stratified random 10k stars.
simbad_sptype.tsv          ~21 MB, LFS. Per-source sp_type / sp_qual /
                           sp_bibcode / otype + HIP / Gaia DR3 IDs.
simbad_wds_xids.tsv        ~1.2 MB, LFS. Per-WDS-component (Gaia DR3,
                           HIP) curated cross-IDs.
wds_xids_overrides.tsv     ~1.5 KB, regular git. Hand-curated WDS-J
                           coalesce overrides for Sirius B-shaped cases.
```

## Provenance

- **Citation**: Wenger M. et al. 2000, *A&AS* 143, 9. SIMBAD is
  maintained by CDS Strasbourg.
- **TAP endpoint**:
  https://simbad.cds.unistra.fr/simbad/sim-tap.
- **Licence**: SIMBAD content is publicly accessible per CDS policy
  (academic / non-commercial); cite the Wenger et al. paper.
- **`sp_type`** is SIMBAD's canonicalised Morgan-Keenan string —
  variability annotations live in `otype` and never in `sp_type`, so
  the parser
  ([`classifyFromSimbad`](../../scripts/catalog/catalog-pure.ts)) is
  a strict MK walker.
- **`wds_xids_overrides.tsv`** is the manual escape hatch for the
  Sirius-B-shaped systems where SIMBAD collapses multiple WDS-J
  variants onto one Gaia source; the override coalesce is applied
  inside
  [`scripts/refresh/wds_xids_overrides.py`](../../scripts/refresh/README.md).

## Consumed by

- `simbad_sample.tsv` → `scripts/catalog/distance-regression-check.ts`
  (Tier-C build-time subset) + `scripts/catalog/validate-simbad-sample.ts`
  (Tier-C manual full run, `npm run validate:simbad`).
- `simbad_sptype.tsv` → `scripts/catalog/build-catalog.ts` (Tier-1
  spectral classifier) + `scripts/binaries/build-binaries.py` Stage 6
  (per-component sp_type, beats AT-HYG's system-inherited string).
- `simbad_wds_xids.tsv` → `scripts/binaries/build-binaries.py`
  Stage 2 (`simbad_xid` tier of the WDS-component → Gaia source_id
  cascade).

## Refresh

- `npm run refresh:simbad` →
  [`scripts/refresh/refresh-simbad-sample.py`](../../scripts/refresh/README.md).
- `refresh-simbad-sptype.py` and `refresh-simbad-wds-xids.py` have
  no npm targets; invoke directly. Both share the
  `scripts/refresh/simbad/` plumbing.
