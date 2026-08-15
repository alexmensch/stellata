# SIMBAD — sample, sp_type, values, WDS↔Gaia cross-IDs

Per-source SIMBAD pulls. Used as: a Tier-C validation corpus, the
top-priority spectral classifier, the bibcoded bottom tier of the
per-field value cascades, and the principled WDS-component
cross-identification path. SIMBAD's strength is curated per-source
identifier and classification metadata across the literature —
exactly the gap AT-HYG (system-level spectra) and Gaia DR3
(saturation-prone bright primaries) leave open.

```
simbad_sample.tsv          ~5.7 MB, LFS. Stratified random 10k stars.
simbad_sptype.tsv          ~21 MB, LFS. Per-source sp_type / sp_qual /
                           sp_bibcode / otype + HIP / Gaia DR3 / TYC /
                           GJ IDs.
simbad_values.tsv          ~2.8 MB, LFS. 11,043 rows. Bibcoded rv,
                           parallax, PM, coordinates and B/V fluxes for
                           the § 5 value cohort — see § The values pull.
simbad_wds_xids.tsv        ~1.2 MB, LFS. Per-WDS-component (Gaia DR3,
                           HIP) curated cross-IDs.
wds_xids_overrides.tsv     ~1.5 KB, regular git. Hand-curated WDS-J
                           coalesce overrides for Sirius B-shaped cases.
```

## The values pull

`docs/catalog-driver.md` § 5 puts SIMBAD at the **bottom** of the rv,
distance, direction, PM and V cascades: never an authority, only the
bibcoded courier for cohorts no first-order catalogue reaches. Two
properties follow, and both are structural rather than stylistic.

**Every value travels with its own bibcode** — `rvz_bibcode`,
`plx_bibcode`, `pm_bibcode`, `coo_bibcode`, `flux_<F>_bibcode`. The
bibcode is the source and SIMBAD only the index that found it, so a cell
whose bibcode is empty is **not consumable** under the § 5 residual
policy. That is why the fluxes come from SIMBAD's long-format `flux`
table rather than the wider, simpler `allfluxes` view: `allfluxes`
carries no bibcode at all.

**The request set is an enumerated cohort, not the catalogue.** It is the
spine rows some field's printed cell marks non-first-order (`HYG`,
`OTHER`, `G_R2`, `GJ`) plus the whole no-Gaia tier — 11,050 rows, keyed
`gaia_source_id` → HIP → TYC → GJ. Rows a first-order catalogue already
covers are absent by construction, so a consumer cannot quietly reach for
SIMBAD outside the cohort. **Widening the cohort is a re-pull**, not a
filter change: the predicate is `is_simbad_value_cohort` in
`scripts/refresh/simbad/inputs.py`.

Coverage over the cohort, measured at the 2026-08-15 pull — value counts
and bibcode counts are equal in every field, so nothing shipped is
unattributable:

| Spine cohort | Field | SIMBAD reaches |
|---|---|---|
| `rv_src=HYG` 7,965 | rv | 7,676 (96.4%) |
| `rv_src=OTHER` 871 | rv | 556 (63.8%) |
| `rv_src=G_R2` 295 | rv | 241 (81.7%) |
| `dist_src=G_R2` 898 | parallax | 885 (98.6%) |
| `dist_src=GJ` 38 | parallax | 28 (73.7%) |
| `pos_src=GJ` 981 | coordinates | 975 (99.4%) |
| `pm_src=HYG` 2,472 | PM | 2,424 (98.1%) |
| `mag_src=GJ` 981 | V flux | 471 (48.0%), **359 bibcoded** |

The V flux is the one field where bibcode coverage lags the value
coverage — 112 of the 471 fluxes carry none and so cannot ship. The
single `*_src=OTHER` row in the position / magnitude / PM columns is Sol,
which is curated rather than sourced.

**rv Gaia-bibcode skip rule** (§ 5): of the 9,504 rv values in the pull,
**1,418 carry a Gaia catalogue bibcode** — 1,216 `2018yCat.1345....0G`
(DR2) and 202 `2022yCat.1355....0G` (DR3). Those are the values the rv
cascade must skip on rows whose own 5p gate withheld Gaia rv, so the pull
cannot launder a withheld value back in. The other 207 references are
literature, led by `2006AstL...32..759G` (2,809) and
`2007AN....328..889K` (926).

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

## Request sets come off the spine

Every SIMBAD pull keys on `data/athyg/inherited-spine.tsv`, the membership
term — **no refresh script reads the AT-HYG CSV** (`data/athyg/README.md`
§ Consumed by). The spine's `gaia_source_id` is the resolved, gate-passed
binding rather than a raw cell, so request and record build name the same
sources by construction; rebasing the sp_type set dropped 3,172 source_ids
the CSV walk over-pulled and gained 193 (measured 2026-08-15).

The no-Gaia tier (1,371 rows) falls through **HIP → TYC → GJ**: 1,317
carry a HIP, 41 only a TYC, 12 only a GJ, and Sol carries none.
Resolution against SIMBAD's `ident` table is 100% for HIP and TYC and
10/12 for GJ — `Gl 165A` and `GJ 3406A` are component designations SIMBAD
does not index, and stripping the letter would key the system rather than
the component, so they stay unresolved rather than mis-bound.

**TYC widening.** A source_id SIMBAD's `ident` table does not carry
leaves its row unreachable under the Gaia namespace, so each pull retries
those rows on the record's own TYC. Over the value cohort it recovered
141 oids. Over the rows the committed sp_type pull left with no `sp_type`
at all (34,849 of them carrying a TYC), the widening resolves 34,842 and
**2,882 — 8.3% — come back with a spectral type**; the rest displays as
unknown, which is the § 5 disposition for the spect residual. That gain
lands on the sp_type pull's next run, not in the committed TSV.

## Consumed by

- `simbad_sample.tsv` → `scripts/catalog/distance/distance-regression-check.ts`
  (Tier-C build-time subset) + `scripts/catalog/validate/validate-simbad-sample.ts`
  (Tier-C manual full run, `pnpm run validate:simbad`).
- `simbad_sptype.tsv` → `scripts/catalog/build-catalog.ts` (Tier-1
  spectral classifier + the `otype = '**'` unresolved-multiplicity
  flag, scripts/catalog/multiplicity/README.md § Multiplicity status) +
  `scripts/binaries/build-binaries.py` Stage 6 (per-component sp_type,
  beats AT-HYG's system-inherited string).
- `simbad_wds_xids.tsv` → `scripts/binaries/build-binaries.py`
  Stage 2 (`simbad_xid` tier of the WDS-component → Gaia source_id
  cascade) + `scripts/catalog/classic-ids/build-classic-id-overlay.ts`
  (sibling-letter attribution gate on the overlay's bindings — see
  `data/classic-ids/README.md` § The binding gate). **The record build no
  longer reads it**: `readStars` takes each binding off the spine column,
  already gated, so the gate runs where bindings are still being decided
  (`scripts/catalog/spine/README.md` § The identifier columns are read,
  never re-derived).
- `simbad_values.tsv` → **nothing yet.** It is the frozen input the rv,
  distance, direction/PM and V cascade beads (`stellata-3bsf.26`, `.27`,
  `.28`) consume; the file ships ahead of them so each is a build change
  against a reviewed pull rather than a pull and a build change at once.

## Refresh

- `pnpm run refresh:simbad` →
  [`scripts/refresh/refresh-simbad-sample.py`](../../scripts/refresh/README.md).
- `pnpm run refresh:simbad-values` →
  [`scripts/refresh/refresh-simbad-values.py`](../../scripts/refresh/README.md).
- `refresh-simbad-sptype.py` and `refresh-simbad-wds-xids.py` have
  no pnpm targets; invoke directly. All share the
  `scripts/refresh/simbad/` plumbing.
