# SIMBAD — sample, sp_type, values, designation idents, WDS↔Gaia and TYC↔HD cross-IDs

Per-source SIMBAD pulls. Used as: a Tier-C validation corpus, the
top-priority spectral classifier, the bibcoded bottom tier of the
per-field value cascades, and the principled WDS-component
cross-identification path. SIMBAD's strength is curated per-source
identifier and classification metadata across the literature —
exactly the gap AT-HYG (system-level spectra) and Gaia DR3
(saturation-prone bright primaries) leave open.

```
simbad_sample.tsv          ~5.7 MB, LFS. Stratified random 50k stars.
simbad_sptype.tsv          ~66 MB, LFS. 966,842 rows. Per-source sp_type /
                           sp_qual / sp_bibcode / otype + HIP / Gaia DR3 /
                           TYC / GJ cross-IDs; the resolver keys all four.
simbad_values.tsv          ~29 MB, LFS. 115,743 rows. Bibcoded rv,
                           parallax, PM, coordinates and B/V fluxes for
                           the /docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers value cohort — see README.md#the-values-pull.
simbad_wds_xids.tsv        ~1.2 MB, LFS. Per-WDS-component (Gaia DR3,
                           HIP) curated cross-IDs: the 2026-07-11 pull plus
                           the HAT-P-7 A/C rows of the 2026-10-31 run. A
                           full re-pull also moves the ~59 lost / 55 added /
                           73 changed rows stellata-hooj.30 tracks (44 Gaia
                           sources leave multiples.tsv, mu Cas A-E among
                           them); land it only with those resolved.
simbad_wds_sptype.tsv      ~0.25 MB, LFS. 23,604 rows. sp_type per WDS
                           component oid, the rows build:binaries reads —
                           see README.md#the-wds-keyed-sp_type-pull.
simbad_tyc_hd.tsv          ~11 MB, LFS. 336,351 rows. SIMBAD's own HD
                           attribution per Tycho-2 entry, keyed on TYC —
                           see README.md#the-tyc--hd-pull.
simbad_idents.tsv          ~4 MB, LFS. 70,153 rows. Designation idents per
                           object with its catalogue keys — see
                           README.md#the-identifier-pull.
wds_xids_overrides.tsv     ~1.5 KB, regular git. Hand-curated SIMBAD oids
                           for components no WDS-J ident or alias reaches.
sptype_overrides.tsv       <1 KB, regular git. Hand-curated MK types by
                           HIP for stars no SIMBAD key reaches.
```

## The values pull

[§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) puts SIMBAD at the **bottom** of the rv,
distance, direction, PM and V cascades: never an authority, only the
bibcoded courier for cohorts no first-order catalogue reaches. Two
properties follow, and both are structural rather than stylistic.

**Every value travels with its own bibcode** — `rvz_bibcode`,
`plx_bibcode`, `pm_bibcode`, `coo_bibcode`, `flux_<F>_bibcode`. The
bibcode is the source and SIMBAD only the index that found it, so a cell
whose bibcode is empty is **not consumable** under the [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) residual
policy. That is why the fluxes come from SIMBAD's long-format `flux`
table rather than the wider, simpler `allfluxes` view: `allfluxes`
carries no bibcode at all.

**And the file holds no unbibcoded value at all** — the writer drops the
whole quantity (value, error, quality flag) wherever its bibcode is
empty, so every field's value count equals its bibcode count by
construction rather than by observation (`BibcodedGroup`,
`scripts/refresh/simbad/simbad-specs-pure.ts`). A consumer therefore cannot reach a
cell it may not use, and admitting one would be a **re-pull, not a filter
change** — the same terms the cohort itself is widened on. What that
costs is visible in the pull's own report, which prints values reached
before it prints values shipped.

**The request set is an enumerated cohort, not the catalogue.** It is the
**membership manifest** rows a [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) value tier can reach — 121,109 of the
manifest's rows (12.4%, 2026-11-08), keyed `gaia_source_id` → HIP → TYC → GJ. That first number is the
row count of `membershipKeys(manifest, valueCohort(…))`
over the committed manifest and both Gaia 5p tables, so calling the predicate
directly re-derives it in seconds and costs no network.
`refresh:simbad-values` prints the same figure as its `value cohort:` line,
but only under `--force` and only on its way into the pull — the up-to-date
guard returns before it otherwise. Seven rows in eight are
absent by construction, so a consumer cannot quietly reach for SIMBAD where a
first-hand catalogue already serves. **Widening the cohort is a re-pull**, not
a filter change: the predicate is `valueCohort` in
`scripts/refresh/simbad/membership-keys-pure.ts`, and a row is OUT only where Gaia's own 5p
tables state every [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) value for it AND its identity is first-hand too (a
`gaia_native` binding, or `crosswalk_gated` plus a TYC or a HIP). Why it takes both halves —
and what an identity-only predicate loses — is
[The cohort is two questions](/scripts/refresh/simbad/README.md#the-cohort-is-two-questions-and-the-manifest-answers-one).

Coverage over the cohort, measured at the 2026-11-08 pull (<!-- count:build-catalog/simbadValuesEntries -->115,744<!-- /count --> oids, up
from 74,446 at the 2026-09-08 pull, before the magnitude term). Every count below is
what **ships**, i.e. post-policy — the file holds no unbibcoded value, so each
field's value count equals its bibcode count.

| Field | Reaches a shipped value |
|---|---|
| coordinates | 115,742 (100.0%) |
| proper motion | 115,326 (99.6%) |
| parallax | 108,849 (94.0%) |
| flux V | 100,855 (87.1%) |
| flux B | 100,584 (86.9%) |
| radial velocity | 50,802 (43.9%) |

**The two fluxes are the sparsest fields after rv, and the bibcode policy is
why.** They sit at 87.1% and 86.9% against parallax's 94.0% and PM's 99.6%,
because `allfluxes` — the view whose B/V coverage is wider — carries no bibcode
at all, so the long-format `flux` table is the only consumable source and an
unattributable value is dropped whole: the 2026-11-08 pull's report counts
10,597 B and 9,300 V values reached and dropped. The committed file holds no
unbibcoded value by construction, so the pull's own report is the only place
that number is ever read.

**rv Gaia-bibcode skip rule** ([§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers)): of the 50,802 rv values in the pull,
**25,141 carry a Gaia catalogue bibcode** — 23,633 `2018yCat.1345....0G`
([Gaia Collaboration 2018](/data/papers/index.md#gaiacollab2018cat)) and 1,508 `2022yCat.1355....0G` ([Gaia Collaboration 2022](/data/papers/index.md#gaiacollab2022cat)). Those are the values the rv
cascade must skip on rows whose own 5p gate withheld Gaia rv, so the pull
cannot launder a withheld value back in. The rest are literature, led by
`2020AJ....160..120J` ([Jönsson 2020](/data/papers/index.md#jonsson2020), 5,510),
`2006AstL...32..759G` ([Gontcharov 2006](/data/papers/index.md#gontcharov2006), 3,667) and
`2020AJ....160...83S` ([Steinmetz 2020](/data/papers/index.md#steinmetz2020), 3,236).

## The TYC → HD pull

Which HD number names a given Tycho-2 entry, from SIMBAD rather than from
IV/25. It exists because **one printed cross index is not a witness for an
identifier attribution**, and on a close pair whose two Tycho entries carry
adjacent HD numbers there was previously no second opinion in the tree:
`simbad_sptype.tsv` keys by `source_id`, which on exactly those rows is the
one blended source both components share and so cannot split them.

Columns: `tyc`, `simbad_oid`, `simbad_main_id`, `hd`.

`hd` is `|`-separated and carries SIMBAD's own ident suffix, component letter
included (`24071`, `24071B`). **Nothing picks a winner between two HDs on one
object** — an unresolved pair's entry carries both components' numbers, and
that ambiguity is what a consumer is asking about. 2,896 rows carry more
than one. They are ordered by HD number, then by the suffix itself, so a bare
number precedes its lettered forms and the 28 rows whose two numbers differ in
digit width still read low-to-high; the order ranks nothing.

A Tycho entry SIMBAD holds no HD for is **absent from the file**, so
`has(tyc) === false` reads as "SIMBAD attributes no HD here" and never as "not
asked": the request covers every TYC IV/25 or the manifest mentions, and
every entry of a Tycho-2 pair. The 2026-11-17 pull asked 378,119, resolved
378,106 and wrote 336,351 rows, 2,896 carrying more than one HD.

Measured at the 2026-09-09 pull (8.6 min):

| Stage | Count |
|---|---|
| requested — IV/25's 353,330 ∪ the manifest's 372,147 | 372,618 |
| resolved to a SIMBAD oid | 372,604 (99.996%) |
| …whose object carries an HD ident | 332,318 (89.2%) |
| rows written | 332,320 |

Rows exceed resolved-with-an-HD by 2 because the key is the TYC, not the
object: two Tycho entries SIMBAD folds onto one oid each ship their own row.

### What it adjudicates

The two classes it answers in, the 219 rows no committed table could detect,
the 10 it vindicates against IV/25, and the four-witness split of the 3 it
still contradicts: [What the TYC → HD pull adjudicates](/scripts/catalog/simbad/README.md#what-the-tyc--hd-pull-adjudicates)
and [Which witness decides a close pair's HD](/scripts/catalog/simbad/README.md#which-witness-decides-a-close-pairs-hd). That folder owns
what a consumer may conclude from these tables; this one owns what they are.

## The WDS-keyed sp_type pull

`simbad_wds_sptype.tsv` is SIMBAD's `sp_type` for every object
`simbad_wds_xids.tsv` binds a WDS component to — columns `simbad_oid`,
`sp_type`, one row per oid SIMBAD still holds, an untyped object with an
empty `sp_type`. Its request is `simbad_wds_xids.tsv` alone, so unlike
`simbad_sptype.tsv` nothing in it moves when the membership manifest does,
and `build:binaries` reads it and nothing manifest-keyed. The two pulls
overlap: an oid both requests reach has a row in each file. Pull and gates:
[scripts/refresh/simbad-wds-sptype/](/scripts/refresh/simbad-wds-sptype/README.md).

## The identifier pull

`simbad_idents.tsv` is SIMBAD's designation idents per object — Bayer and
numbered `* NN Con` idents, `NAME`, LAL, Ross and Wolf over all of SIMBAD;
double-star (`**`), variable (`V*`) and `X` idents on the objects
`simbad_sptype.tsv` resolved the manifest to — beside each object's HIP, HD,
GJ and Gaia DR3 keys, so a record joins an object on an identifier it
already owns. 70,157 objects at the 2026-11-16 pull. A `* NN Con` ident is
not always a Flamsteed number; which ones are is
[Which SIMBAD numbers are Flamsteed numbers](/scripts/catalog/simbad/README.md#which-simbad-numbers-are-flamsteed-numbers).
Pull and gates: [scripts/refresh/simbad-idents/](/scripts/refresh/simbad-idents/README.md).

## Provenance

- **Citation**: [Wenger 2000](/data/papers/index.md#wenger2000). SIMBAD is
  maintained by CDS Strasbourg.
- **TAP endpoint**:
  https://simbad.cds.unistra.fr/simbad/sim-tap, with the Harvard CfA
  mirror https://simbad.cfa.harvard.edu/simbad/sim-tap as fallback: the
  pulls' `SIMBAD` archive in `scripts/refresh/pull/tap-pure.ts`
  ([The TAP backend](/scripts/refresh/pull/README.md#the-tap-backend)).
- **Licence**: SIMBAD content is publicly accessible per CDS policy
  (academic / non-commercial); cite the
  [Wenger 2000](/data/papers/index.md#wenger2000) paper.
- **`sp_type`** is SIMBAD's canonicalised Morgan-Keenan string —
  variability annotations live in `otype` and never in `sp_type`, so
  the parser
  ([`classifyFromSimbad`](../../src/catalog-format/spectral/spectral-classify.ts))
  is
  a strict MK walker.
- **`wds_xids_overrides.tsv`** is the manual escape hatch for a component
  whose SIMBAD object carries no `WDS J<id><comp>` ident and no HD / CCDM /
  HIP alias the cascade can reach — HAT-P-7 A and C, whose WDS
  idents SIMBAD dropped and which carry no HD or HIP. Each row pins an oid
  with its reason; the pull applies it
  ([Overrides](../../scripts/refresh/simbad-wds-xids/README.md#overrides)).
  An oid letter need not match the WDS letter: SIMBAD names HAT-P-7 C
  `BD+47 2846B`.
- **`sptype_overrides.tsv`** is the same kind of escape hatch for a spectral
  type: a saturated star whose SIMBAD entry is a component-lettered main_id
  carrying neither `hip` nor `source_id` (Castor A, `* alf Gem A`), so no
  namespace of the resolver reaches it. Each row cites its literature type;
  it is the resolver's curated tier
  ([The resolver](/scripts/catalog/spectral/README.md#the-resolver)).

## The sp_type pull's request

How `simbad_sptype.tsv`'s request comes off the membership term, the
widening ladder with its corroboration rule, and the union:
[The request set](/scripts/refresh/simbad-sptype/README.md#the-request-set).

**A re-pull is not done when the file lands.** The two sp_type files feed
pipelines that pin separate count snapshots — `simbad_wds_sptype.tsv`
`build:binaries`, `simbad_sptype.tsv` membership and the catalogue
([Consumed by](#consumed-by)). Refreshing either means the builds below,
and **`build:binaries-runtime` goes last, not in the middle**:

```bash
pnpm run build:binaries          # data/binaries/multiples.tsv + spect provenance
pnpm run build:catalog           # reads that multiples.tsv; writes catalog-row-index-map.json
pnpm run build:binaries-runtime  # reads BOTH of the above
```

`build:binaries-runtime` resolves every component through
`build/catalog-row-index-map.json`, which `build:catalog` writes, so running
it before the catalogue leaves `public/binaries.bin` older than an input —
which is exactly what `tests/artifact-freshness.test.ts` fails on.

## Consumed by

- `simbad_sample.tsv` → `scripts/catalog/distance/refinement/distance-regression-check.ts`
  (Tier-C build-time subset) + `scripts/catalog/validate/validate-simbad-sample.ts`
  (Tier-C manual full run, `pnpm run validate:simbad`).
- `simbad_sptype.tsv` → `scripts/catalog/build-catalog.ts` (Tier-1
  spectral classifier + the `otype = '**'` unresolved-multiplicity
  flag, [Multiplicity status](/scripts/catalog/multiplicity/README.md#multiplicity-status)) +
  `build:membership` and `build:astrometry-request`, whose binding
  derivation reads its cross-IDs (`scripts/catalog/spine/primaries-tables.ts`).
- `simbad_tyc_hd.tsv` → `build:membership`, the pair rule's check on a move
  onto the other entry of a Tycho-2 pair
  ([Applying the pair rule](/scripts/catalog/membership/merge-derivation/README.md#applying-the-pair-rule)),
  and `scripts/catalog/simbad/simbad-tyc-hd-parse.test.ts`'s adjudication.
- `simbad_wds_sptype.tsv` → `scripts/binaries/build-binaries.ts` Stage 6
  (per-component sp_type, beats AT-HYG's system-inherited string).
- `sptype_overrides.tsv` → `scripts/catalog/spectral/sptype-overrides-source.ts`,
  the spectral resolver's curated tier.
- `simbad_wds_xids.tsv` → `scripts/binaries/build-binaries.ts`
  Stage 2 (`simbad_xid` tier of the WDS-component → Gaia source_id
  cascade) + `scripts/catalog/classic-ids/build-classic-id-overlay.ts`
  (sibling-letter attribution gate on the overlay's bindings — see
  [The binding gate](/data/classic-ids/README.md#the-binding-gate)). **The record build no
  longer reads it**: `readStars` takes each binding off the manifest column,
  already gated, so the gate runs where bindings are still being decided
  ([The identifier columns are read, never re-derived](/scripts/catalog/membership/README.md#the-identifier-columns-are-read-never-re-derived)).
- `simbad_values.tsv` → `scripts/catalog/simbad/simbad-values-parse.ts`, indexed by
  every namespace the pull keyed on and joined per record source_id → HIP →
  **GJ → TYC** — the join deliberately no longer mirrors the request order,
  because a GJ names the component where a TYC names the system
  ([The ladder is ordered by what an identifier names](/scripts/catalog/spectral/README.md#the-ladder-is-ordered-by-what-an-identifier-names)).
  The **rv** cascade
  (`scripts/catalog/distance/radial-velocity/README.md`) and the
  **direction / PM** cascade both consume it; the distance cascade follows.
  The file shipped ahead of all of them so each is a build change against a
  reviewed pull rather than a pull and a build change at once. The `rv*`,
  `ra`/`dec`/`coo_bibcode` and `pm*` columns are read so far — the parser
  adds a field per bead.

  **The `pm_bibcode` is a gate, not a label.** The PM rescue cascade
  (`scripts/catalog/distance/pm-rescue/README.md`) reaches **<!-- count:build-catalog/placement.pm-rescue.simbad -->113<!-- /count -->** rows the
  direction cascade states no motion for, and refuses the pull's PM on
  **<!-- count:build-catalog/placement.pm-rescue.none.gaia-release-refused -->62<!-- /count -->** more because that bibcode names a Gaia release: on a row whose own
  Gaia solution is 2p, serving Gaia's earlier fit back through this index
  would return the motion DR3 declined to state. Same rule the rv tier
  applies to `rvz_bibcode`, same predicate.

  Direction is the pull's **bottom tier, on <!-- count:build-catalog/placement.direction.simbad -->94<!-- /count --> rows**, and its coordinates
  are J2000.0 — measured rather than assumed, since the pull carries no
  epoch column: over the 673 catalogue rows holding both a SIMBAD position
  and a Gaia PM above 500 mas/yr, SIMBAD's position matches the Gaia one
  back-propagated to J2000 to a median 0.000″ and not one row is closer to
  J2016. The cascade therefore advances these coordinates 16 yr on the
  row's own bibcoded PM.

  **The V flux reaches no cascade at all.** [§ 5](/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers)'s
  projected SIMBAD V tier does not exist: [Gliese 1991](/data/papers/index.md#gliese1991) `V/70A` reaches every row
  Tycho-2 misses, and for the nine that would otherwise have fallen here
  SIMBAD publishes fluxes in `B`, `J`, `H`, `K`, `R`, `g`, `r`, `i` and `G`
  and **no `V`** — so the bibcode policy is not what stops them, and no
  re-pull would change it.

## Refresh

- `pnpm run refresh:simbad` →
  [`scripts/refresh/simbad-sample/`](../../scripts/refresh/simbad-sample/README.md).
- `pnpm run refresh:simbad-values` →
  [`scripts/refresh/simbad-values/`](../../scripts/refresh/simbad-values/README.md).
- `pnpm run refresh:simbad-tyc-hd` →
  [`scripts/refresh/simbad-tyc-hd/`](../../scripts/refresh/simbad-tyc-hd/README.md).
- `pnpm run refresh:simbad-idents` →
  [`scripts/refresh/simbad-idents/`](../../scripts/refresh/simbad-idents/README.md).
- `pnpm run refresh:simbad-sptype` →
  [`scripts/refresh/simbad-sptype/`](../../scripts/refresh/simbad-sptype/README.md).
- `pnpm run refresh:simbad-wds-sptype` →
  [`scripts/refresh/simbad-wds-sptype/`](../../scripts/refresh/simbad-wds-sptype/README.md).
- `pnpm run refresh:simbad-wds-xids` →
  [`scripts/refresh/simbad-wds-xids/`](../../scripts/refresh/simbad-wds-xids/README.md).

All share the `scripts/refresh/simbad/` plumbing and run on the TypeScript
pull runtime.
