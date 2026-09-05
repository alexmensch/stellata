# Membership manifest — the primaries-derived record set

Pipeline-derived, like `../binaries/multiples.tsv`: written by
`pnpm run build:membership` (`scripts/catalog/membership/`), regenerated and
diffed in CI, never hand-edited. Contract: `docs/catalog-driver.md` § 3.1.

```
membership-manifest.tsv  ~30 MB, LFS. One row per admitted record: final
                         labels (hd/hd_alt/hr/hr_alt/hip/gl/flam, the spine's
                         bayer/proper), gaia_source_id with its binding class,
                         and the primary attesting each cell. 376,934 rows.
additions-ledger.tsv     ~3.6 MB, LFS. The § 6.1 ledger for everything the
                         primaries admit that the spine lacked: one row per
                         group, keyed on the same five identifier cells as
                         ../athyg/parked_no_owned_parallax.tsv, under the
                         closed reason enum (admitted:hd_link_gap ·
                         admitted:hd_omitted · admitted:hip_omitted ·
                         admitted:cns5_census · component:<anchor>).
binding-review.tsv       ~3 KB, regular git. The 39 spine bindings only AT-HYG
                         asserts and SIMBAD does not corroborate, with the
                         SIMBAD witness columns; their gaia_source_id is empty
                         in the manifest until stellata-3bsf.8.4 disposes them.
```

`data/membership/*.tsv` is a blanket LFS rule, so `binding-review.tsv` carries
its own `!filter` line in `.gitattributes` — a review queue on LFS shows a
reviewer an oid instead of the rows. Any further small file here needs one too.

## Inputs

The frozen inherited spine (`../athyg/inherited-spine.tsv`, as the record of
AT-HYG's merge decisions and bindings), the primaries the audit reads
(`../classic-ids/`, `../gliese/`, `../hipparcos/`, `../tycho2/`,
`../iau-wgsn/`, the two `../gaia/` cross-walks, `../simbad/simbad_sptype.tsv`),
the post-gate overlay `../classic-ids/classic_id_overlay.tsv`,
`../classic-ids/classic_id_overrides.tsv` and `../binaries/multiples.tsv`.
Licence follows the inputs: CC-BY-SA-4.0 through the spine.

## Consumed by

`scripts/catalog/membership/membership-manifest-gate.test.ts` — the parity
gate over these three files against the spine, the SID bridges and the built
catalogue. The record build does not read them yet; `stellata-3bsf.8.3`
switches `readStars` onto the manifest and retires the spine as an input.
