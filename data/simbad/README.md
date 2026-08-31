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
simbad_sptype.tsv          ~24 MB, LFS. 330,141 rows. Per-source sp_type /
                           sp_qual / sp_bibcode / otype + HIP / Gaia DR3 /
                           TYC / GJ cross-IDs; the resolver keys all four.
simbad_values.tsv          ~2.8 MB, LFS. 11,044 rows. Bibcoded rv,
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

**And the file holds no unbibcoded value at all** — the writer drops the
whole quantity (value, error, quality flag) wherever its bibcode is
empty, so every field's value count equals its bibcode count by
construction rather than by observation (`BibcodedGroup`,
`scripts/refresh/simbad/specs.py`). A consumer therefore cannot reach a
cell it may not use, and admitting one would be a **re-pull, not a filter
change** — the same terms the cohort itself is widened on. What that
costs is visible in the pull's own report, which prints values reached
before it prints values shipped.

**The request set is an enumerated cohort, not the catalogue.** It is the
spine rows some field's printed cell marks non-first-order (`HYG`,
`OTHER`, `G_R2`, `GJ`) plus the whole no-Gaia tier — 11,050 rows, keyed
`gaia_source_id` → HIP → TYC → GJ. Rows a first-order catalogue already
covers are absent by construction, so a consumer cannot quietly reach for
SIMBAD outside the cohort. **Widening the cohort is a re-pull**, not a
filter change: the predicate is `is_simbad_value_cohort` in
`scripts/refresh/simbad/inputs.py`.

Coverage over the cohort, measured at the 2026-08-26 pull. Every count
below is what **ships**, i.e. post-policy — the file holds no unbibcoded
value, so each field's value count equals its bibcode count: coordinates
11,044 · PM 10,992 · parallax 10,896 · rv 9,557 · flux B 8,187 ·
flux V 8,186.

| Spine cohort | Field | Reaches a shipped value |
|---|---|---|
| `rv_src=HYG` 7,965 | rv | 7,710 (96.8%) |
| `rv_src=OTHER` 871 | rv | 559 (64.2%) |
| `rv_src=G_R2` 295 | rv | 241 (81.7%) |
| `dist_src=G_R2` 898 | parallax | 887 (98.8%) |
| `dist_src=GJ` 38 | parallax | 30 (78.9%) |
| `pos_src=GJ` 981 | coordinates | 979 (99.8%) |
| `pm_src=HYG` 2,472 | PM | 2,424 (98.1%) |
| `mag_src=GJ` 981 | V flux | 361 (36.8%) |

**V flux is the one field the bibcode policy actually bites.** Pull-wide
SIMBAD has a B flux for 10,232 oids and a V for 9,680, but publishes a
bibcode for only 8,187 and 8,186 — so 2,045 B and 1,494 V are dropped as
unattributable, which is why `mag_src=GJ` ships 361 of 981 rather than the
larger share SIMBAD's own V coverage implies. How many that cohort reached
*before* the policy is not recoverable from the committed file — it holds no
unbibcoded value by construction — so the pull's own report is the only place
that number is ever read. Nothing else in the cohort loses a row. The single
`*_src=OTHER` row in the position / magnitude / PM columns is Sol, which
is curated rather than sourced.

**rv Gaia-bibcode skip rule** (§ 5): of the 9,557 rv values in the pull,
**1,421 carry a Gaia catalogue bibcode** — 1,219 `2018yCat.1345....0G`
(DR2) and 202 `2022yCat.1355....0G` (DR3). Those are the values the rv
cascade must skip on rows whose own 5p gate withheld Gaia rv, so the pull
cannot launder a withheld value back in. The rest are literature, led by
`2006AstL...32..759G` (2,827) and `2007AN....328..889K` (950).

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
  ([`classifyFromSimbad`](../../scripts/catalog/spectral/spectral-classify.ts))
  is
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
the CSV walk over-pulled and gained 193 (measured 2026-08-15). Realised on
the 2026-08-25 re-pull: the committed file's `source_id`-keyed rows fell
325,479 → 323,228, and `simbadSptypeEntries` in build-counts with them.

The no-Gaia tier (1,371 rows) falls through **HIP → TYC → GJ**: 1,317
carry a HIP, 41 are keyed on a TYC, 12 on a GJ, and Sol carries none.
The fall-through is strict, so those 41 are keyed on TYC whether or not
they also carry a GJ — **5 of them do**, and their GJ is never requested
(`scripts/catalog/spectral/README.md` § The ladder is ordered by what an
identifier names).
Resolution against SIMBAD's `ident` table is 100% for HIP and TYC and
10/12 for GJ — `Gl 165A` and `GJ 3406A` are component designations SIMBAD
does not index, and stripping the letter would key the system rather than
the component, so they stay unresolved rather than mis-bound.

**The widening ladder, and its corroboration rule.** A source_id SIMBAD's
`ident` table does not carry leaves its row unreachable under the Gaia
namespace — so each pull retries those rows on the record's own **HIP,
then TYC, then GJ**, the order the no-Gaia tier itself falls through, each
rung asking only for what the rungs above left unbound. Read-back does not
depend on that order — see `scripts/refresh/simbad/README.md` § The widening
falls through on resolution, not on cell presence.
These are the only bindings here made on a designation alone, so each is
adjudicated against SIMBAD's own Gaia cross-IDs **across releases**: kept
where SIMBAD holds the asking id under any release, dropped where it
holds a *DR3* id that is not the asking one, kept-and-counted where it
holds no DR3 id to contradict it. Over the value cohort, **8 vetoed** and
142 kept (62 corroborated, 80 with no DR3 id against them) out of 150
candidate bindings — bindings, not rows: a row vetoed on one rung is
offered again to the next, so the 150 exceeds the distinct rows widened by
at most the 8 vetoed. Mechanism and why only DR3 can contradict:
`scripts/refresh/simbad/README.md` § The widening carries its own
corroboration rule.

Reading a differing DR3 id as a different star is what used to lose the
six rows of `data/athyg/stale_gaia_source_ids.tsv`, whose spine cell is a
**Gaia DR2 id sitting in the DR3 column** — a release disagreement, not a
star disagreement. All six now reach the pull. The ladder also moved 67
rows off `HD nnnnnA`-style WDS-component entries onto the star's own
entry, every one gaining a parallax, and cost no row the row it had.

**The sp_type pull has taken the widening** (re-pulled 2026-08-25;
`simbad_sptype.tsv` is 330,141 rows against the previous 329,268, gains
`tyc` / `gj` cross-ID columns, and reads 86.1% `sp_type`-filled). It had
34,849 no-`sp_type` rows carrying a TYC; what the widening reaches and what
reaches a RECORD are different numbers, and only the second one matters:

| build-count | before → after |
|---|---|
| `spectralBySimbad` | 278,326 → **280,495** |
| … by `source_id` | 277,014 → 277,048 |
| … by HIP | 1,312 → 1,494 |
| … by **TYC** | 0 → **1,940** |
| … by **GJ** | 0 → **13** |
| `spectralByGspspec` | 33,535 → 31,714 |
| `spectralFallback` | 1,394 → **1,046** |

The +2,169 into SIMBAD is exactly the 1,821 leaving GSP-Spec plus the 348
leaving unknown, so no record changed tier for any other reason. 348 fewer
stars display as unknown. The TYC and GJ rows only reach records because
the resolver gained matching tiers in the same change — the pull's cross-ID
columns are inert without them (`scripts/catalog/spectral/README.md`
§ The resolver and the radius chain).

**34 records lost a spectral type**, every one of them via a vanished HIP
key, and the pattern is uniform: the object that owned that HIP in the old
pull carried **no `source_id`** (`HD 1209`, `[R78b] 16`, `HD 6194`, …).
The AT-HYG-derived request set pulled those objects; the spine-derived one
asks under the record's own resolved `source_id` and gets SIMBAD's
Gaia-keyed object for the same star, which carries no `sp_type`. SIMBAD
holds both, and the HIP index of the day silently kept whichever row it met
first, so which one supplied the type was never a decision the pipeline made.
Reaching both would mean the request unioning namespaces instead of picking
one. **The ladder above is not that union** and does not fix these 34: it
falls through only where the Gaia namespace fails to *resolve*, and here it
resolved — onto an oid carrying no `sp_type`. The union stays open work.
The index no longer resolves such a clash quietly: `parseSimbadSptypeTsv`
throws on a repeated key in any namespace, which the committed file has
none of.

`simbad_sptype.tsv` was not re-pulled when the ladder landed: a rebased
request set does not rewrite its output (`scripts/refresh/README.md`
§ Request sets are spine-derived), so it takes the ladder at its next
refresh and the numbers above are the 2026-08-25 TYC-only pull's.

**7 spectral strings changed** on records that kept a type, all through
`source_id`, all upstream re-typings rather than re-bindings: `G0V:`→`G1V`,
`B5`→`B2V`, `G5V`→`G5`, `G0/2`→`F9`, `G0IV-V`→`G0V`, `K7`→`M0`,
`M7`→`M7/10`. The fifth is 26 Draconis, whose `known-stars.tsv` row pinned
the old string and is re-pinned in the same change with the reason recorded
— SIMBAD is a living database with no citable release, so a re-typing is
the expected cost of the tier, not a regression.

**A re-pull is not done when the file lands.** `simbad_sptype.tsv` feeds two
pipelines — § Consumed by names both — and they pin separate count snapshots.
Refreshing the file means running `pnpm run build:binaries` (which moves
`data/binaries/multiples.tsv` and its per-component `spect` provenance),
`pnpm run build:binaries-runtime`, and `pnpm run build:catalog`, in that order:
the catalogue reads the regenerated `multiples.tsv`, so its own counts move
after the binaries ones do.

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
- `simbad_values.tsv` → `scripts/catalog/simbad-values-parse.ts`, indexed by
  every namespace the pull keyed on and joined per record source_id → HIP →
  **GJ → TYC** — the join deliberately no longer mirrors the request order,
  because a GJ names the component where a TYC names the system
  (`scripts/catalog/spectral/README.md` § The ladder is ordered by what an
  identifier names). The **rv** cascade consumes it today
  (`scripts/catalog/distance/radial-velocity/README.md`); the direction/PM,
  V and distance cascades follow at `stellata-3bsf.26` / `.28`. The file
  shipped ahead of all of them so each is a build change against a reviewed
  pull rather than a pull and a build change at once. Only the `rv*` columns
  are read so far — the parser adds a field per bead.

## Refresh

- `pnpm run refresh:simbad` →
  [`scripts/refresh/refresh-simbad-sample.py`](../../scripts/refresh/README.md).
- `pnpm run refresh:simbad-values` →
  [`scripts/refresh/refresh-simbad-values.py`](../../scripts/refresh/README.md).
- `refresh-simbad-sptype.py` and `refresh-simbad-wds-xids.py` have
  no pnpm targets; invoke directly. All share the
  `scripts/refresh/simbad/` plumbing.
