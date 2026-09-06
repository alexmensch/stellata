# AT-HYG v3.3 — stellar catalogue (classic-IDs subset)

The catalogue Stellata's membership descends from, plus the frozen spine
that now carries it. Every row in the subset carries at least one classical
designation (proper name, Bayer, Flamsteed, HIP, HD, HR, or Gliese).

```
athyg_33_classic_ids.csv   ~64 MB, LFS. Upstream. ~317k rows. NOT a build
                           input — see § Consumed by.
inherited-spine.tsv        ~40 MB, LFS. Generated provenance data, and the
                           record build's membership term — see § The
                           inherited spine. 313,257 rows.
stale_gaia_source_ids.tsv  ~1 KB, regular git. Review queue: the 6 spine
                           rows whose gaia_source_id Gaia DR3 publishes no
                           row for — see § Six DR2 ids in the DR3 column.
parked_no_owned_parallax.tsv
                           ~21 KB, regular git. The § 6.1 dropped list: the
                           spine rows no owned parallax reaches, which build
                           no record. The parity gate subtracts exactly this
                           many rows and no more, so a park that is not on
                           this list fails the build rather than vanishing.
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
the build driver, which has happened: membership is the spine, and AT-HYG
the catalogue is not consulted. Contract:
[`docs/catalog-driver.md`](../../docs/catalog-driver.md) § 3. Generator,
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
`stellata-3bsf.8` re-sources the spine from the primaries and is where the
ids themselves would change, if they change at all.

## Consumed by

`inherited-spine.tsv` → `scripts/catalog/build-catalog.ts` (`readStars` in
`scripts/catalog/parse/stars-parse.ts`), as the membership term: every row
is a record, and no other source adds one. Two test files in
`scripts/catalog/spine/` also read it — the guard pins its bytes,
committed counts and the queue above, the parity gate holds it to the
build it snapshots.
`pnpm run build:classic-ids` reads it as well, as the label merge's spine
side: its review queue has to describe the same records the record build
labels (`scripts/catalog/classic-ids/README.md` § The label merge).
`pnpm run build:membership` reads it as the frozen record of AT-HYG's merge
decisions and bindings — which designations name one star, and which Gaia
source it bound — that the primaries-derived manifest re-keys
(`scripts/catalog/membership/README.md` § The spine side).
Reference epoch J2000.0.

`athyg_33_classic_ids.csv` is **no longer an input to the record build, and no
refresh script reads it.** It stays committed as the spine's provenance and for
two consumers that walk the upstream cells directly:
`src/client/constellation-boundaries/iau-geometry/iau-athyg-agreement.test.ts`
(the boundary-epoch cross-check against the editorial `con` column — the only
TypeScript reader left, and it spells the path itself) and
`scripts/binaries/build-binaries.py` (Stage 1's AT-HYG parse, on the
`build:binaries` path, not `build:catalog`).

Every request set moved onto the spine's own columns. The Gaia pull list went
first with `export-astrometry-request.ts`; the Bailer-Jones, Apsis and SIMBAD
pulls followed. Request and record build now name the same source_ids by
construction rather than by agreeing, and each rebase drops what the CSV walk
over-pulled — for the SIMBAD sp_type set, 3,172 source_ids the walk requested
that never became records, against 193 the spine's resolved column gains
(measured 2026-08-15). A new AT-HYG release therefore no longer moves the
catalogue — replacing the spine is `stellata-3bsf.8`.
