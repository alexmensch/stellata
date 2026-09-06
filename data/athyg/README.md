# AT-HYG v3.3 — stellar catalogue (classic-IDs subset)

The catalogue Stellata's membership descends from, plus the frozen spine that
records its merge decisions. Neither is a `build:catalog` input — the record
build walks `../membership/membership-manifest.tsv`. Every row in the subset
carries at least one classical designation (proper name, Bayer, Flamsteed,
HIP, HD, HR, or Gliese).

```
athyg_33_classic_ids.csv   ~64 MB, LFS. Upstream. ~317k rows. NOT a build
                           input — see § Consumed by.
inherited-spine.tsv        ~40 MB, LFS. Generated provenance data: AT-HYG's
                           merge decisions, frozen — see § The inherited
                           spine. 313,257 rows.
stale_gaia_source_ids.tsv  ~1 KB, regular git. Review queue: the 6 spine
                           rows whose gaia_source_id Gaia DR3 publishes no
                           row for — see § Six DR2 ids in the DR3 column.
simbad_sourced_distances.tsv
                           ~2 KB, regular git. The records whose distance
                           came from the cascade's SIMBAD tier, excluded from
                           SIMBAD-based validation of the same field.
```

Three kinds of file: the CSV is frozen **external** data under the policy in
[`../README.md`](../README.md) § Frozen external data; the spine is a frozen
**Stellata build artifact** that happens to live beside it; the last three are
**emitted by every build** and committed so a reviewer and a test can read what
the build decided. Regenerate them with `pnpm run build:catalog` — never by
hand. `scripts/catalog/distance/parallax/README.md` owns what the two newest
mean.

**The small ones are exempted from LFS in `.gitattributes`, and must stay
exempt.** `data/athyg/*.tsv` is a blanket LFS rule written for the 40 MB spine,
so a new file here is LFS by default — which for a review queue defeats the
point twice over: `git diff` shows an oid instead of the rows a reviewer is
meant to check, and a checkout without LFS hands the parity gate a pointer
where it expects a header. Any further small file added here needs its own
`!filter` line.

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
tables), written once by a generator that has since retired, and frozen. It carries
each record's resolved designation set (`hip` `hd` `hr` `gl` `flam` `bayer`
`proper` `gaia_source_id`) plus AT-HYG's printed cells verbatim (`tyc` `ra`
`dec` `dist` `mag` `ci` `spect` `rv` `pm_ra` `pm_dec` and the six `*_src`
provenance columns). `gaia_source_id` is empty on 1,371 rows — the no-Gaia
residual; there is no separate keep-list file.

It exists so catalogue membership and labels survive AT-HYG's retirement as
the build driver, which has happened. It has since handed the membership term
to the primaries-derived manifest, and what it still uniquely supplies is the
merge decisions behind it. Contract:
[`docs/catalog-driver.md`](../../docs/catalog-driver.md) § 3 and § 3.1.
Generator,
column origins, and why nothing regenerates it in CI:
[`scripts/catalog/spine/README.md`](../../scripts/catalog/spine/README.md).
Licence follows the CSV it derives from (CC-BY-SA-4.0).

## Six DR2 ids in the DR3 column

AT-HYG wrote a **Gaia DR2** source_id into the cell the pipeline reads as
DR3 on six rows, and the spine carried them forward. Gaia DR3 publishes no
row for any of the six, so they reach no Gaia astrometry, photometry or
parallax; SIMBAD holds each of them as `Gaia DR2 <the spine's id>`, and for
four of the six also holds a different, genuine DR3 id — the renumbering
AT-HYG did not follow. `stale_gaia_source_ids.tsv` enumerates all six with
that status, and `scripts/catalog/spine/inherited-spine-guard.test.ts`
holds the enumeration to what the committed spine and 5p pull actually say.

**The cells are not repaired, and that is a decision rather than an
omission.** § 3 makes the spine frozen and states that ids are DR3-namespace
designations that never get rewritten; substituting the successor id would
change four records' designation sets, which is a `docs/sid.md` § 6
DR-reconciliation event and not a data fix. A DR2 id is a real Gaia
designation, so the records stay addressable either way. What the rows
needed was to stop being *unreachable*: the SIMBAD widening ladder now
falls through to their own TYC / GJ and corroborates the binding across
releases, so all six carry bibcoded coordinates, PM and parallax
(`../simbad/README.md` § The widening ladder, and its corroboration rule).
The membership manifest carries all six unchanged, each on a review
disposition whose basis is that SIMBAD corroboration
(`../membership/binding-review-dispositions.tsv`, `simbad_dr2_object`); a
DR-reconciliation run is where the ids themselves would change, if they
change at all.

## Consumed by

`inherited-spine.tsv` → **`pnpm run build:membership`**, which reads it as the
frozen record of AT-HYG's merge decisions and bindings — which designations
name one star, and which Gaia source it bound — that the primaries-derived
manifest re-keys (`scripts/catalog/membership/README.md` § The spine side).
`pnpm run build:classic-ids` reads it as the label merge's spine side, and the
manifest's parity gate reads it as the baseline every manifest row must
account for. `scripts/catalog/spine/inherited-spine-guard.test.ts` pins its
bytes, committed counts and the queue above.

**`build:catalog` does not read it.** `readStars` walks
`../membership/membership-manifest.tsv`; membership is that file less the
§ 6.1 parks. Reference epoch J2000.0.

`athyg_33_classic_ids.csv` is **no longer an input to the record build, and no
refresh script reads it.** It stays committed as the spine's provenance and for
two consumers that walk the upstream cells directly:
`src/client/constellation-boundaries/iau-geometry/iau-athyg-agreement.test.ts`
(the boundary-epoch cross-check against the editorial `con` column — the only
TypeScript reader left, and it spells the path itself) and
`scripts/binaries/build-binaries.py` (Stage 1's AT-HYG parse, on the
`build:binaries` path, not `build:catalog`).

Every request set is derived from the membership term — the spine's own
columns first, and the manifest's since the record build swapped onto it
(`scripts/refresh/README.md` § Request sets are membership-derived). Request
and record build name the same source_ids by construction rather than by
agreeing. A new AT-HYG release therefore no longer moves the catalogue.
