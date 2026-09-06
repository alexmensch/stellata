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
simbad_sptype.tsv          ~29 MB, LFS. 395,543 rows. Per-source sp_type /
                           sp_qual / sp_bibcode / otype + HIP / Gaia DR3 /
                           TYC / GJ cross-IDs; the resolver keys all four.
simbad_values.tsv          ~2.7 MB, LFS. 11,044 rows. Bibcoded rv,
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
**membership manifest** rows a § 5 value tier can reach — 75,035 of 376,929
(19.9%), keyed `gaia_source_id` → HIP → TYC → GJ. Four rows in five are
absent by construction, so a consumer cannot quietly reach for SIMBAD where a
first-hand catalogue already serves. **Widening the cohort is a re-pull**, not
a filter change: the predicate is `simbad_value_cohort` in
`scripts/refresh/simbad/inputs.py`, and a row is OUT only where Gaia's own 5p
table states every § 5 value for it AND its identity is first-hand too (a
`crosswalk_gated` binding plus a TYC or a HIP). Why it takes both halves —
and what an identity-only predicate loses — is
`scripts/refresh/simbad/README.md` § The cohort is two questions.

Coverage over the cohort, measured at the 2026-09-06 pull (74,442 oids, up
from 11,045 rows on the spine-scoped one it replaced). Every count below is
what **ships**, i.e. post-policy — the file holds no unbibcoded value, so each
field's value count equals its bibcode count.

| Field | Reaches a shipped value |
|---|---|
| coordinates | 74,442 (100.0%) |
| proper motion | 74,263 (99.8%) |
| parallax | 69,907 (93.9%) |
| flux B | 70,853 (95.2%) |
| flux V | 69,774 (93.7%) |
| radial velocity | 34,571 (46.4%) |

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

## Request sets come off the membership term

Every SIMBAD pull keys on the membership
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
Every binding made on a designation alone — these, and the union's below —
is adjudicated against SIMBAD's own Gaia cross-IDs **across releases**: kept
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

**What the widening itself was worth**, measured when it landed
(2026-08-25, the pull that added the `tyc` / `gj` cross-ID columns and took
the file from 329,268 rows to 330,141). It had 34,849 no-`sp_type` rows
carrying a TYC; what the widening reaches and what reaches a RECORD are
different numbers, and only the second one matters:

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

**The union closed the 34 the ladder could not** (re-pulled 2026-09-02).
Those 34 records had lost a spectral type to a vanished HIP key: the object
that owned the HIP in the AT-HYG-derived request carried **no
`source_id`** (`HD 1209`, `[R78b] 16`, `HD 6194`, …), while the
spine-derived request asks under the record's own resolved `source_id` and
gets SIMBAD's Gaia-keyed object for the same star, which carries no
`sp_type`. The widening ladder falls through on *resolution* and here it
resolved, so no rung ever fired.

The pull now asks every namespace a record reaches wherever the object it
bound answers with nothing (`scripts/refresh/simbad/README.md` § The union
asks every namespace a record reaches), and the reach is far wider than
those 34: measured on the spine-scoped pull that introduced it, 280,676 of
313,257 rows were answered by a bound object and asked nothing at all,
32,581 were not, and **3,267 of those were recovered** on 3,188 added
objects. That ratio is what the union is for; the rebase onto the manifest
re-ran it over a larger request without changing the rule, and the pull's
own report is where its figures come from. `simbad_sptype.tsv` is now
**395,543 rows** and reads 87.6% `sp_type`-filled
(`awk -F'\t' 'NR>1{t++; if($3!="") f++} END{print f/t}'`).

Every one of those bindings rests on a designation alone, so every one goes
through the corroboration rule above — the guard the union does NOT get to
skip for being a union, and one shared implementation with the widening
ladder rather than a second one. It **vetoed 111 bindings**
on a contradicting Gaia DR3 id (50 HIP, 57 TYC, 4 GJ); without it 57 records
would have taken a spectral type, and so a rendered radius, from a star
SIMBAD names as a different object.

| build-count | before → after |
|---|---|
| `spectralBySimbad` | 280,236 → **283,606** |
| … by `source_id` | 276,809 → 276,810 |
| … by **HIP** | 1,482 → **4,236** |
| … by TYC | 1,927 → 2,538 |
| … by GJ | 18 → 22 |
| `spectralByGspspec` | 31,696 → **28,787** |
| `spectralFallback` | 1,025 → **564** |

The +3,370 into SIMBAD is exactly the 2,909 leaving GSP-Spec plus the 461
leaving unknown, so no record changed tier for any other reason. **461
fewer stars render with an unknown class**, and 2,909 trade GSP-Spec's
letter-only enum — subclass defaulted to 5, no luminosity class — for a
full Morgan-Keenan type, which moves their rendered radius. `ν Scorpii` is
the shape, and its `known-stars.tsv` row had recorded the defect before the
fix existed: SIMBAD's `* nu. Sco A` carries no type for the record's Gaia
source, so it took GSP-Spec's bare `O`, where `* nu. Sco` under HIP 79374
says `B2V` — and that object carries no Gaia id at all, so nothing
contradicts the binding. 5 records also leave the solar colour fallback for
the intrinsic spectral-class colour their new class supports.

`multiplicityUnresolved` moves by **1** on the same pull, which is the one
place the sp_type index is read for something other than a spectral type:
`build-catalog.ts` takes the `otype = '**'` unresolved-multiplicity flag off
`bySourceId`. A vetoed object leaves the file, and its `otype` leaves with
it. Expected rather than incidental — the veto's judgement is about which
star the object IS, so every cell it carries is subject to it.

**One object per key is still the invariant, and the union does not
threaten it.** Two SIMBAD objects for one star both reach the pull, but
under different keys: SIMBAD's `ident` table maps an id to exactly one
object, so a designation the union asks under can only resolve to the
object that holds it, and an object an earlier phase already pulled adds
nothing (`scripts/refresh/simbad/README.md` § The union adds rows, never a
second row under one key — it carries the check to re-run). No key repeats
in any of the four namespaces. What the union did change is that
`parseSimbadSptypeTsv` now MERGES a repeat rather than failing on one,
keeping whichever row states a type; that decides nothing today.
`data/binaries/multiples.tsv` is byte-identical across the re-pull: the
binaries-side join keys on `simbad_oid` through `simbad_wds_xids.tsv`, so
the sp_type namespaces are not on its path at all.

**7 spectral strings changed at the 2026-08-25 pull** on records that kept
a type, all through `source_id`, all upstream re-typings rather than
re-bindings: `G0V:`→`G1V`, `B5`→`B2V`, `G5V`→`G5`, `G0/2`→`F9`,
`G0IV-V`→`G0V`, `K7`→`M0`, `M7`→`M7/10`. The fifth was 26 Draconis, whose
`known-stars.tsv` row pinned the old string and was re-pinned with the
reason recorded. SIMBAD is a living database with no citable release, so a
re-typing is the expected cost of the tier, not a regression — and the
corpus is where each one gets caught, since `known-stars.test.ts` pins
`primary_spect` per row.

**A re-pull is not done when the file lands.** `simbad_sptype.tsv` feeds two
pipelines — § Consumed by names both — and they pin separate count snapshots.
Refreshing the file means three builds, and **`build:binaries-runtime` goes
last, not in the middle**:

```bash
pnpm run build:binaries          # data/binaries/multiples.tsv + spect provenance
pnpm run build:catalog           # reads that multiples.tsv; writes catalog-row-index-map.json
pnpm run build:binaries-runtime  # reads BOTH of the above
```

`build-runtime-binaries.py` resolves every component through
`public/catalog-row-index-map.json`, which `build:catalog` writes, so running
it before the catalogue leaves `public/binaries.bin` older than an input —
which is exactly what `tests/artifact-freshness.test.ts` fails on.

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
  longer reads it**: `readStars` takes each binding off the manifest column,
  already gated, so the gate runs where bindings are still being decided
  (`scripts/catalog/membership/README.md` § The identifier columns are read,
  never re-derived).
- `simbad_values.tsv` → `scripts/catalog/simbad-values-parse.ts`, indexed by
  every namespace the pull keyed on and joined per record source_id → HIP →
  **GJ → TYC** — the join deliberately no longer mirrors the request order,
  because a GJ names the component where a TYC names the system
  (`scripts/catalog/spectral/README.md` § The ladder is ordered by what an
  identifier names). The **rv** cascade
  (`scripts/catalog/distance/radial-velocity/README.md`) and the
  **direction / PM** cascade both consume it; the distance cascade follows.
  The file shipped ahead of all of them so each is a build change against a
  reviewed pull rather than a pull and a build change at once. The `rv*`,
  `ra`/`dec`/`coo_bibcode` and `pm*` columns are read so far — the parser
  adds a field per bead.

  **The `pm_bibcode` is a gate, not a label.** The PM rescue cascade
  (`scripts/catalog/distance/pm-rescue/README.md`) reaches **30** rows the
  direction cascade states no motion for, and refuses the pull's PM on
  **13** more because that bibcode names a Gaia release: on a row whose own
  Gaia solution is 2p, serving Gaia's earlier fit back through this index
  would return the motion DR3 declined to state. Same rule the rv tier
  applies to `rvz_bibcode`, same predicate.

  Direction is the pull's **bottom tier, on 13 rows**, and its coordinates
  are J2000.0 — measured rather than assumed, since the pull carries no
  epoch column: over the 673 catalogue rows holding both a SIMBAD position
  and a Gaia PM above 500 mas/yr, SIMBAD's position matches the Gaia one
  back-propagated to J2000 to a median 0.000″ and not one row is closer to
  J2016. The cascade therefore advances these coordinates 16 yr on the
  row's own bibcoded PM.

  **The V flux reaches no cascade at all.** `docs/catalog-driver.md` § 5's
  projected SIMBAD V tier does not exist: Gliese `V/70A` reaches every row
  Tycho-2 misses, and for the nine that would otherwise have fallen here
  SIMBAD publishes fluxes in `B`, `J`, `H`, `K`, `R`, `g`, `r`, `i` and `G`
  and **no `V`** — so the bibcode policy is not what stops them, and no
  re-pull would change it.

## Refresh

- `pnpm run refresh:simbad` →
  [`scripts/refresh/refresh-simbad-sample.py`](../../scripts/refresh/README.md).
- `pnpm run refresh:simbad-values` →
  [`scripts/refresh/refresh-simbad-values.py`](../../scripts/refresh/README.md).
- `refresh-simbad-sptype.py` and `refresh-simbad-wds-xids.py` have
  no pnpm targets; invoke directly. All share the
  `scripts/refresh/simbad/` plumbing.
