# Membership manifest — the primaries-derived record set

Pipeline-derived, like `../binaries/multiples.tsv`: written by
`pnpm run build:membership` (`scripts/catalog/membership/`), regenerated and
diffed in CI, never hand-edited. Contract: `docs/catalog-driver.md` § 3.1.

```
membership-manifest.tsv  ~30 MB, LFS. One row per admitted record: final
                         labels (hd/hd_alt/hr/hr_alt/hip/gl/flam, the spine's
                         bayer/proper), gaia_source_id with its binding class,
                         and the primary attesting each cell. 376,929 rows.
additions-ledger.tsv     ~3.6 MB, LFS. The § 6.1 ledger for everything the
                         primaries admit that the spine lacked: one row per
                         group, keyed on the same five identifier cells as
                         parked-ledger.tsv, under the
                         closed reason enum (admitted:hd_link_gap ·
                         admitted:hd_omitted · admitted:hip_omitted ·
                         admitted:cns5_census · component:<anchor>).
parked-ledger.tsv        ~441 KB, regular git. The § 6.1 ledger for manifest
                         rows that build no record: no owned parallax, no V, or
                         no position. Same five identifier cells as
                         additions-ledger.tsv, under the closed reason enum
                         (refused_no_defensible_parallax · no_parallax_published
                         · no_v_magnitude · no_position). Written by build:catalog, not
                         build:membership — which rows park is an output of the
                         record walk. The parity gate subtracts exactly these
                         rows and no more, so a park that is not on this list
                         fails the build rather than vanishing.
binding-review.tsv       ~3 KB, regular git. The 34 spine bindings only AT-HYG
                         asserts and SIMBAD does not corroborate, with the
                         SIMBAD witness columns. Pipeline-derived.
binding-review-dispositions.tsv
                         ~8 KB, regular git. Hand-curated: one row per
                         binding-review.tsv row — keep | drop, a basis from
                         the closed enum (tycho2_position · v70a_astrometry
                         · simbad_dr2_object), the measured evidence. 34
                         rows, all keep; a kept binding rides the manifest
                         as binding=reviewed.
label-drops.tsv          ~7 KB, regular git. The § 6.2 label ledger: every
                         spine Flamsteed / HD cell no primary attests, keyed
                         on the manifest row it left, under
                         flamsteed_unattested (119) · hd_unattested (1).
```

`data/membership/*.tsv` is a blanket LFS rule, so the three small files carry
their own `!filter` lines in `.gitattributes` — a review queue on LFS shows a
reviewer an oid instead of the rows. Any further small file here needs one too.

## Inputs

The frozen inherited spine (`../athyg/inherited-spine.tsv`, as the record of
AT-HYG's merge decisions and bindings), the primaries the audit reads
(`../classic-ids/`, `../gliese/`, `../hipparcos/` with I/239's `hd` column,
`../tycho2/`, `../iau-wgsn/`, the two `../gaia/` cross-walks,
`../simbad/simbad_sptype.tsv`), the `gl:` bridges of
`../sid/sameas-overrides.tsv`, the post-gate overlay
`../classic-ids/classic_id_overlay.tsv`, `../classic-ids/classic_id_overrides.tsv`,
`../binaries/multiples.tsv`, and this folder's own
`binding-review-dispositions.tsv`. Licence follows the inputs: CC-BY-SA-4.0
through the spine.

## Consumed by

`membership-manifest.tsv` → **`scripts/catalog/build-catalog.ts`** (`readStars`
in `scripts/catalog/parse/stars-parse.ts`), as the membership term: every row
is a record unless it parks, and no other source adds one. It is also the
request set every catalog-scoped refresh pull is derived from
(`scripts/refresh/README.md` § Request sets are membership-derived).

`scripts/catalog/membership/membership-manifest-gate.test.ts` reads all of
these — the parity gate over them against the spine, the SID bridges and the
built catalogue, including the two row-for-row joins (queue ↔ dispositions,
label drops ↔ manifest).
