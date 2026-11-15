# Companion promotion

Promotion of `data/binaries/multiples.tsv` secondaries into first-class
`catalog.bin` records, plus the renderable-companion wings bit that rides
it. This is the seam where bugs in the binary-system pipeline
(`scripts/binaries/README.md`) become user-visible.

**Promotion names nothing.** A minted record ships no `proper`: what it
displays is composed post-sort from its structured designation set and its
WDS component letter, by the one ladder the runtime renders with
(`../naming/README.md`). So "Sirius B" is not a string this folder writes —
it is the anchor's approved name plus the letter, re-derived on both
sides.

The science of *why* each decomposition rule is what it is lives in
`docs/science-multiple-star-pipeline.md`; this file is the engineering
side — the per-row gate cascade, the field-inheritance contract, and the
counted metrics.

## Files in this area

```
scripts/catalog/companions/
  companion-promotion.ts          promoteCompanions: builds the SystemIndex
    (+ test)                      (identity/), runs the cursor walk — each
                                  row's identity, placement and mint or
                                  adoption — then the post-passes/ in
                                  order, turning their outcomes into
                                  lineage rewrites and PromotionStats.
                                  Runs before the absmag
                                  sort so promoted records take the same
                                  final indexing as everything else.
                                  readMultiplesTsv reads through the
                                  `MULTIPLES_TSV` codec (readArtifact,
                                  so a missing file fails the build)
                                  (../../binaries/multiples-tsv.ts) and
                                  hands promotion each row with its anchor
                                  offset already parsed, never the raw
                                  anchor cells.
  identity/                       Which record a pair row names: the
                                  system index and the per-row identity
                                  gates (identity/README.md).
  placement/                      Where a component sits: own fit, else a
                                  WDS projection off its anchor
                                  (placement/README.md).
  post-passes/                    Inner-pair re-home, systemic velocity,
                                  blend split, anchor flux conservation
                                  (post-passes/README.md).
  promotion-lineage-pure.ts       Promotion as a lineage stage: its reason
    (+ test)                      codes and count block, the serialiser over
                                  RowOutcome, rewriteRows (each sized
                                  record's size row and a held record's
                                  brightness rows), promotionSummary, and
                                  the identity rows of the records it mints
                                  and the rows it removes or merges
                                  (#promotion-lineage).
  companion-dust-pure.ts (+ test) Which of a companion's absmag and B−V are
                                  observed, so carry the A_V that
                                  de-extinction subtracts: read by the mint
                                  and by promotion's dust row.
  overlap-gate-pure.ts (+ test)   physicalOverlaps: record pairs closer than
                                  the sum of their radii, less those an orbit
                                  chain separates. See Overlap gate below.
  multiples-fixture.ts            Default-valued MultiplesTsvRow factory.
                                  A module, NOT an export from
                                  companion-promotion.test.ts: importing one
                                  test file from another re-executes every
                                  describe in it, so this suite silently ran
                                  a second time inside the multiplicity and
                                  record-index suites.
  /tests/integration/multi-star-regression.test.ts   Frozen corpus pinning promoted-companion
  multi-star-regression.tsv       records against the built catalog and the
                                  real binaries.bin — catches drift on
                                  either side of the wings correspondence.
  record-index/                   Post-sort record addressing: the row-index
                                  sidecar, the wings bit, component
                                  designations. Downstream of promotion,
                                  never read by it.
```

## Companion promotion from `data/binaries/multiples.tsv`

**A record's identifiers are the manifest's, and this folder adds none.**
Promotion mints records; it does not amend one. The manifest states each
record's HIP and Gaia source_id, its `binding` cell says on what basis, and a
cell it leaves empty is the [§ 4](/docs/catalog-driver.md#4-how-hd-reaches-gaia) gate's decision rather than an omission
([The identifier columns are read, never re-derived](../membership/README.md#the-identifier-columns-are-read-never-re-derived)).
So a pair-primary row's own ids stay on the promoted companion
and never reach the anchor's record.

`companion-promotion.ts` runs BEFORE the record sort. It reads the
binaries pipeline output and adds first-class catalog records for
the secondary of every physical pair whose identifier isn't already
a record the membership manifest admitted: ~<!-- count:build-catalog/promotion.minted.keyed k2 -->3.5k<!-- /count --> companions
via real Gaia/HIP keys and ~<!-- count:build-catalog/promotion.minted.synthetic k3 -->11.2k<!-- /count --> via synthetic identifiers
in the current build (Sirius B, Achird B, Porrima B, Fomalhaut C, Algol Ab, …;
see [Promotion identity](identity/README.md)).

Each pair row's decision is a `RowOutcome`: dropped with its reason, adopted
onto a record already held (its own id or HIP, a same-as bridge, or an
earlier mint this build), or minted;
a pair's primary is `pair-anchor` when it anchors its pair and
`primary-unresolved` when it resolves to no record, and a row in no pair is
`unpaired`. The last two park
([Promotion lineage](#promotion-lineage)).
Each outcome is a lineage row, and each flag it carries a facet row of its
own (the list is [Promotion lineage](#promotion-lineage)'s), so every per-row
count is a fold of its lineage codes. The [post-passes](post-passes/README.md) act on records,
not rows; each writes rows keyed on the records it changes
([Promotion lineage](#promotion-lineage)), and `PromotionStats`, promotion's
derived count block with `physicalOverlaps`, counts what no row records.

Per-row gates and resolution:

- **Identity** ([Promotion identity](identity/README.md)). A compound comp
  ("BC") drops; the inheritance gates strip ids shared with the anchor; a
  held record named by the row's own id, an earlier mint, or a same-as
  bridge is adopted; a row re-serving a refused parallax, or one whose two
  ends are one record, drops; anything else mints, on its surviving ids or
  `synth-<wds_id>-<comp>`. Every held answer goes through
  `adoptExistingMember`: the anchor's designation constellation, the
  re-curation below, and anchor-dim registration.
- <a id="re-curation-of-an-already-in-catalog-member"></a>**Re-curation of an already-in-catalog member.** An existing member's
  position, brightness and velocity all descend from its own 5p solution.
  Where **Gaia rejects that solution** — `isCoherenceAnchorGrade`
  (`../multiplicity/anchor-grade-pure.ts`) — AND the record's `distVia` says
  that solution is what placed it (`bailer_jones` / `gaia_dr3_inversion`;
  every other tier is an independent measurement, including a clean sibling's
  parallax lent through `pair_member_parallax`) — the curated treatment a minted
  member gets is the better source, so it is applied in place — but only
  where a minted member would have taken the WDS projection, since a row
  Stage 3 gave its own per-component fit has no curated geometry to apply
  and its placement is the cascade's answer, not the rejected solution's.
  What it takes: the WDS (ρ, θ) tangent projection off the anchor, the
  anchor's `distVia` (as a minted member does — it now sits at the anchor's
  distance, not its own fit's), the anchor's systemic velocity,
  and a **curated** brightness with its
  [Ballesteros 2012](/data/papers/index.md#ballesteros2012) colour — A+Δmag,
  the row's WDS magnitude referenced to the distance the member now sits at,
  or class→M_V. Photometry travels with the astrometry here because ONE cause
  rejects both — the brighter star's light inside the detection window — and
  BP/RP see more of it than G does. With no curated source the member keeps
  its own apparent brightness across the move (absmag shifts by the distance
  modulus and the A_V difference, colour untouched), never a row's `own` or
  inherited-twin magnitude: those were derived at the rejected fit's distance
  or are the anchor's light. The spectral type is measured elsewhere and
  stays the record's own; the physical radius re-derives against it. The record keeps its identifiers and its first-class membership, so
  this adds no star and retires none. Sirius B is the case: 11.1″ from a
  star 9.91 mag brighter, RUWE 2.42 and a blended image on 18% of transits,
  and a V ≤ 11 floor admits it in its own right — its own fit put the pair
  at 19.1 AU against the measured 29.27, took M_V 11.467 against A+Δmag's
  11.360 and B−V −0.224 against the DA1.9
  [Ballesteros 2012](/data/papers/index.md#ballesteros2012) −0.443, and fed the
  systemic blend below a proper motion that dragged **Sirius A** from
  1339.4 mas/yr to 1282.7. Counted `promotion.existing.recurated.<source>`
  (`held` for the fallback), one row per member however many cursors reach
  it ([Promotion lineage](#promotion-lineage)).
- <a id="collocated-double-refusal"></a>**Collocated-double refusal.** A
  record named `<its name for the anchor> <letter>` sitting bit-identical on
  the anchor (AT-HYG's convention for both members of a resolved pair at one
  printed blend coordinate) is this component, reached by name because the
  row's identifiers missed it — so minting would draw the pair twice. That is
  a membership defect, fixed by giving the record the component's identifier:
  the build throws, naming the row and the record. ξ UMa B carries its own
  Gaia source and is adopted by id before this probe runs. The probe reads
  AT-HYG's own convention and nothing else — the index it hits holds the
  manifest's `proper` cells alone, so a base composed off a Bayer or catalogue
  designation could never match one and none is tried.
- **Position** ([Promotion placement](placement/README.md)). The row's own
  per-component fit, else the WDS (ρ, θ) projection off its anchor record;
  a projection past the 1 pc tidal limit, or a sub-resolution pair with no
  renderable orbit, drops.
- **Inner-pair re-homing (post-pass).** An inner pair's secondary baked on a
  sibling through its cursor primary's blended identifier is re-placed off its
  true parent component ([Inner-pair re-home](post-passes/README.md#inner-pair-re-home)).
- **Pair-row primaries.** A cursor primary no record holds (40 Eri B) is
  promoted as a companion of the WDS-root anchor, placed by its own fit or
  its re-based Stage 6 offset, and dropped with neither
  ([Position for pair-row primaries](placement/README.md#position-for-pair-row-primaries)).
- <a id="blended-identifier-escape"></a>**Blended-identifier escape.** The pair-row-primary escape fires not
  only when the cursor primary resolves to nothing, but also when it
  resolves to the WDS-ROOT ANCHOR's record while its comp is a DISJOINT
  top-level letter — Acrux B carries A's shared HIP, omicron And B
  carries A's shared Gaia source, and a disjoint letter cannot BE the
  anchor. The letter's true slot is its own synth record (a sibling
  cursor's mint is reused); with no honest placement the cursor falls
  back to the blended anchor hit, exactly the pre-escape behaviour.
  Sub-letter primaries (Castor Ca) are excluded — the inner-pair
  post-pass and the writer's parent override own that re-homing. The
  Gaia inheritance gate mirrors the HIP gate's anchor-STAR check for
  the same shape: propagation can bind the shared source to a row
  whose anchor-row cell is empty.
- **Absmag.** Preference order: `primary_absmag + WDS Δmag` when the
  row inherited its parent's AT-HYG photometry (Sirius B's row
  carried Sirius A's 1.45 absmag, not the WD's 11.36); the row's own
  (non-inherited) absmag — including the Stage-6 Gaia-photometry value
  (`photometry_via = gaia_photometry`) derived from an own-DR3
  companion's G/BP/RP + parallax when no AT-HYG row backs it
  ([Multiple-star pipeline](/docs/science-multiple-star-pipeline.md#multiple-star-pipeline));
  primary + Δmag fallback; the row's own WDS
  apparent magnitude at the system distance (`wds_mag`, M = m −
  5·log₁₀(d/10) — fires when both Δmag paths are unavailable and
  rescues rows that previously dropped for want of a brightness);
  class→M_V from a per-component spectral type (`absmagFromSpectral`,
  spect_via curated/simbad — Algol Aa2's curated K0IV lands at 3.30 vs
  the primary's −0.11). A row with none of those has NO honest
  brightness source: returning the inherited value minted
  full-luminosity twins (Betelgeuse Ab). Those rows drop — unless the
  pair carries a renderable orbit binaries.bin must keep addressing,
  where the twin is kept and counted
  (`promotion.brightness.inherited-twin`, a ratchet-down
  metric: curate types to shrink it). For a **pair-row-primary
  escape** the row's Δmag describes the sub-pair it heads, not the
  anchor→row separation (40 Eri B's Δmag is the B→C delta), so both
  `primary + Δmag` paths are suppressed; and when the escape row carries
  an id inherited from the anchor its "own" AT-HYG photometry is the
  anchor's BLEND magnitude, so the own path is skipped too (Acrux B takes
  its WDS V=1.55, not the −4.2 blend). **An id of the row's own does not
  buy the cell back.** AT-HYG keys photometry on the record it merged, so a
  row sharing the anchor's HD/HIP reads the system's magnitude however Gaia
  resolved the component afterwards — VV Crv B kept its own DR3 source and
  claimed HIP 61910's blended V 5.17, which its A branch was claiming too. Absent any
  honest brightness the record inherits the anchor's collocated
  brightness (`promotion.brightness.anchor-collocated`) rather than a
  corrupted A+Δmag.
- **Anchor flux conservation and blend split (post-passes).** A member whose
  light is inside its anchor's catalogued magnitude dims the anchor, decided
  per anchor by a joint subset solve; records sharing one unresolved Gaia
  source divide its light equally. The walk registers the candidates of both
  ([Anchor flux conservation](post-passes/README.md#anchor-flux-conservation),
  [Blend split](post-passes/README.md#blend-split)).
- **B-V (ci).** When Stage 6 tags the row's photometry as inherited
  (`photometry_via = athyg_system_inherited`), recompute from the
  spectral info via `tempKelvin → ballesterosBvFromTeff`. Sirius B's
  DA1.9 stores ci = -0.443 (deep blue at the LUT) rather than the
  inherited 0.009 white.
- **Spectral / lum class.** From `classifyFromSimbad(row.spect)` when
  the row's `spect_via` is per-component (curated / simbad — DA1.9 for
  Sirius B, K7Ve for Achird B). When the string is the system
  primary's inherited AT-HYG type (`spect_via=athyg`) or blank AND the
  member's absmag came from an own-brightness source (dmag-imputed /
  own / wds_mag), the type is instead a main-sequence estimate from
  the member's own de-extincted M_V (`spectralFromAbsmag`, the inverse
  of the class→M_V calibration; lumClass V). Wearing the primary's
  type made a fainter companion hot-but-tiny — Stefan-Boltzmann turns
  a hot inherited Teff on a faint absmag into a spuriously small
  radius AND a blue colour (Algol Ab rendered as a tiny B8V; Acrab B
  inherited B0.5V at 7.98 mag fainter). The MS estimate is wrong for
  evolved companions but strictly less wrong than the primary's type;
  curated overrides / SIMBAD per-component types take precedence, and
  no `spectDisplay` is claimed for the estimate. Counted
  `promotion.spectral.ms-from-own-absmag` (~<!-- count:build-catalog/promotion.spectral.ms-from-own-absmag k3 -->13.4k<!-- /count --> minted records). Rows
  with neither fall back to `SPECTRAL_UNKNOWN`.
Promoted records carry `FLAG_BINARY_COMPANION_ONLY = 0x08`, and
additionally `FLAG_BINARY_COMPANION_SYNTHETIC = 0x20` when the
record lacks own gaia/hip and is addressed exclusively through a
`synth-<wds_id>-<comp>` key. They're pushed onto `stars` before
the record sort so they receive the same final record indexing as
everything else. Addressing those records afterwards — the
`byGaia` / `byHip` / `bySynth` sidecar, the chart-mode wings bit, and the
component-letter search designations — is `record-index/README.md`;
nothing in this file reads back from it.

The Tier A regression corpus in `known-stars.tsv` pins Sirius B's
record specifically (addressed by gaia_source_id, no HIP) as a
stand-in for the broader category.

#### Overlap gate

After the record sort, build-catalog counts every pair of records whose
centres sit closer than the sum of their physical radii — a star drawn inside
another, whatever placement rule put it there — at the 32-bit positions
`catalog.bin` ships, where two records the build keeps 1 AU apart at 1 kpc
collapse onto one point. The check is catalogue-wide, not companion-only.

A pair is exempt only when a chain of renderable orbits fixes their relative
position — one record an ancestor of the other along (primary, secondary)
relations — since the runtime then draws them apart from the elements, and a
bit-identical bake there is the deliberate sub-resolution placement above. Two
siblings of one primary are not exempt: each moves on its own orbit, and
nothing keeps them apart. The relations come from the runtime's own pairing —
`renderableOrbitRelations` in `record-index/`, the `rendered` ends of
`resolvePairs` (the resolution the writer takes) filtered to renderable
orbits — never from promotion's cursor walk, which records a pair
before its parent is minted.

Counted `physicalOverlaps` (<!-- count:build-catalog/physicalOverlaps -->55<!-- /count -->), a ratchet-down metric; the
build log names each pair.

#### Promoted-companion field inheritance

Every field of a minted companion record is one of: **inherited**
from the anchor primary (system-level property), **system-derived**
(computed from the anchor plus the WDS geometry), **per-component**
(the measurement that justified promoting the row), or **post-pass /
unset** (filled later or never). The derivation prose above is
per-field detail; this is the whole-record contract.

"Anchor" here means the local anchor primary, or the WDS-root system
primary when the local anchor never made it into the catalog (δ Vel CD
class). Both inherited fields below resolve that same anchor, so a
companion never gets one without the other.

Which cursor primary is the ROOT's is `isMoreCanonicalAnchor`: top-level
letter first, then token length, then alphabetical order — so a root whose only
A-branch cursor is Aa,Ab still takes its position and velocity from the A
branch. [Component-letter search designations](record-index/README.md#component-letter-search-designations)
carries the worked case and imports the same predicate for naming.

Every read of a Stage 6 offset is re-based onto that anchor
([Re-basing a Stage 6 offset](placement/README.md#re-basing-a-stage-6-offset)).

| Field(s) | Origin | Source |
| --- | --- | --- |
| `conIndex` | per-component | the IAU boundary region the minted position falls in ([Positional constellation membership](../parse/constellations/README.md#positional-constellation-membership)) — so a pair wide enough to straddle a boundary lands its members on the correct sides, and an anchor-less row still resolves. Counted `promotion.constellation.split-from-anchor` where it differs from the anchor's. |
| `proper` | post-pass | null at mint; the display-name pass writes the NAME tiers alone ([Two callers, one composer](/src/catalog-format/naming/README.md#two-callers-one-composer)). |
| `desigCon` | inherited | anchor's designation constellation, sourced `anchor` — a composed name ("Xi Boo B") is named for whatever the primary's designation is. Sourced from IV/27A keyed on the anchor's HD/HIP, so a boundary-straddling companion composes against the primary's designation (Fomalhaut C is "α PsA C" though it sits in Aquarius) rather than its own positional index ([The designation constellation](../classic-ids/README.md#the-designation-constellation)). |
| `vx/vy/vz` | inherited | anchor's systemic velocity — a static companion shears off the primary under the epoch-advance otherwise ([Space-motion velocity](../distance/README.md#space-motion-velocity), Pair coherence). Truly anchor-less escapes fall back to zero. |
| `x/y/z` | system-derived | anchor ICRS position + WDS (ρ, θ) tangent projection at the anchor's distance. |
| `hip`, `gaiaSourceId` | per-component | the row's own id — stripped to `null` (→ `synth-<wds_id>-<comp>`) when it equals the anchor's shared id, per the [inheritance gates](identity/README.md#gaia-and-hip-inheritance-gates). |
| `absmag` | per-component | Stage-5 decomposition / dmag / blend split. |
| `ci` | per-component | own observed B–V, else [Ballesteros 2012](/data/papers/index.md#ballesteros2012) from the resolved spectral type. |
| `spectral`, `spectDisplay` | per-component | SIMBAD/curated type, else a main-sequence estimate from the own M_V. |
| `physicalRadius` | per-component | Stefan-Boltzmann from the per-component absmag + Teff. |
| `flags` | per-component | `FLAG_BINARY_COMPANION_ONLY` (+ `_SYNTHETIC`). |
| `syntheticId` | per-component | `synth-<wds_id>-<comp>` when no own id survives the gates. |
| `originKey` | per-component | the row's own `multiples.tsv` key, `multiples:<system_id>/<comp>` ([Identity](../lineage/identity/README.md)). Build-time only. |
| `companionIdx` | post-pass | set by geometric binary inference ([Geometric binary inference](../multiplicity/README.md#geometric-binary-inference)). |
| `period`, `amplitude`, `varType`, `gcvsName` | unset | companion variability isn't tracked at promotion. |
| `hd`, `hr`, `flam`, `bayer`, `gl`, `tyc` | unset | not carried on multiples.tsv rows. `hdAlt`/`hrAlt` are empty for a different reason — deliberately not inherited: an anchor's alternative HD is often the pair's OTHER component number, which makes handing it to this record tempting and wrong. The overlay asserts both numbers against one Gaia source and names no component, so attributing one here would invent evidence (`../classic-ids/label-merge/README.md`). |

### Where the display name comes from

The `<system> <letter>` label a promoted record shows is composed
post-sort from the WDS root anchor's designation plus the record's own
canonical component letter, and the same pure function composes it again
at runtime off `search-index.json` (`../naming/README.md`). Three defects
that used to need guarding here dissolve in that ladder: the base is
always the ROOT anchor's designation rather than an intermediate lettered
record, so nothing doubles the letter it is about to append, nothing
inherits a sibling's composed name, and one root cannot letter one star
twice.

The letter and the anchor a record composes against are
[Component-letter search designations](record-index/README.md#component-letter-search-designations); the
duplicate labels that survive the ladder are data findings, enumerated in
`../naming/naming-duplicates.tsv` and ratcheted by
`/tests/integration/multi-star-regression.test.ts`.

## Promotion lineage

`build:catalog`'s companion promotion is the lineage stage after coherence
(`promotion-lineage-pure.ts`). `promoteCompanions` returns one
`PromotedRow` per `multiples.tsv` row, keyed on that row
(`multiples:<system_id>/<comp>`), and `promotionDecision` serialises its
`RowOutcome` ([above](#companion-promotion-from-databinariesmultiplestsv)) through an exhaustive `switch`: the
outcome row (a mint is `promotion.minted.keyed` or `.synthetic`, a refused
parked record `.gaia-5p` or `.other-route` by route), then a facet row, effect
`none` and no evidence, per flag the outcome carries
(`promotion.brightness.*`, `spectral.*`, `colour.*`, `dust.*`,
`constellation.*`, `desig-con.*`, `fit.owned`), so every per-row count is a
code's line count.

A mint's facets are its brightness lineage, since the record walk's
[brightness-colour stage](../photometry/README.md#brightness-colour-lineage)
never sees it: the absmag source (`brightness.*`), a row for the post-pass,
if any, that changed that absmag after the mint — at most one, since blend
split takes only own-photometry mints and the re-split only Δmag ones
(`brightness.blend-split`, `params.n` the records sharing the source;
`brightness.anchor-re-split`, `params.record` the dimmed anchor — a record
already in the catalogue those passes change writes the rows below instead), the B−V's (`colour.own`,
the row's observed colour; `.spectral-derived`; `.none`, the solar fallback —
`companionCi`), and one dust row naming which of the two the A_V at the
minted position corrected (`dust.edenhofer2024.absmag-and-ci`,
`.absmag-only`, `.ci-only`, `.not-applied`: a class→M_V absmag and a derived
B−V are intrinsic), its `params.av` in brightness-colour's format
(`dustParams`). Their evidence is the outcome
row's: the photometry is the row's own, and the anchor a Δmag reads is cited
there.

Every record promotion sizes or re-sizes also gets rows keyed on its own
origin key — a mint's is its row, a re-curated or dimmed record's its
manifest key — from the `RecordRewrite` `promoteCompanions` returns per
record (`rewriteRows`), uncited. One `promotion.size.*` row names the LAST
pass that set its radius (`mint`, `recurated`, `blend-split`,
`anchor-dimmed`, `anchor-re-split`), its params the radius's route and inputs
in the size stage's form (`radiusRouteParams`,
[Size lineage](../spectral/README.md#size-lineage)), so its `absmag` is the
one the record ships. A key's rows are a set, so the size row is what says
which pass came last. A record the catalogue already held also gets one row
per change to its brightness: `existing.recurated.<source>` (the
re-curation's absmag, `av` and `ci_via`; `.held` carries `from_pc`, `to_pc`,
`av_from`, `av_to` instead), `existing.anchor-dimmed` (citing by origin key the
members whose light it lost, so trace reaches it from each) and `existing.anchor-re-split` (`params.record`,
the dimmed anchor). A key's rows are a set, ordered as every stage file is
([SourceRowRef](../lineage/README.md#sourcerowref)). A
pair's primary that anchors its pair is `promotion.not-applicable.pair-anchor`.
A row in no pair is `promotion.parked.unpaired`, and a primary that resolves
to no record, leaving its pair anchor-less, `promotion.parked.primary-unresolved`:
both park, since promotion ships no record for the star the row names, so a
SID keyed on its identifiers stays in the ledger with that cause. Each row cites as evidence the record its pair
resolved to and its WDS root's anchor; every merge-effect row names the
record it merges into in `params.record`. Both are origin keys: every record
carries its own from the manifest's `origin_key` column
(`../membership/README.md#columns`), so these are joins on the origin key.

A minted companion is founded on its row, so promotion writes its identity
row (`promotion.identity.tsv.gz`, named by `StageLineageSpec.identity`). So
does every row whose code retires, parks or merges, keyed on the `hip` and
`gaia_source_id` cells it arrived with and the synthetic key a mint from it
would carry (`PromotedRow.synthKey`), less any designation a membership
manifest record or one of promotion's own mints already carries, so an
orphaned SID keyed on one of them joins to that row's cause and never to a
row that merely cites another stage's star. A cloud's or Local Group
object's is its sibling allocation stage's; every other record's is
membership's.

Measured 2026-11-15: 125,290 rows — one outcome row per `multiples.tsv` row,
59,713 facet rows (two of them, colour and dust, per minted record), 16,611
size rows (one per record promotion sized, by its last pass:
<!-- count:build-catalog/promotion.size.mint -->12,660<!-- /count --> mint,
<!-- count:build-catalog/promotion.size.anchor-re-split -->1,955<!-- /count --> anchor re-split,
<!-- count:build-catalog/promotion.size.anchor-dimmed -->1,883<!-- /count --> anchor-dimmed,
<!-- count:build-catalog/promotion.size.blend-split -->62<!-- /count --> blend-split,
<!-- count:build-catalog/promotion.size.recurated -->51<!-- /count --> recurated) and 1,945 held-record brightness rows — and 31,908
identity rows (the minted companions and the 17,232 rows promotion retires,
parks or merges), 1.57 MB gzipped in 0.43 s (header, diff, write and
invariants; 67 ms of it the baseline); `PROMOTION_LINEAGE_BUDGET` pins
1.67 MB and 10 s. A CI run with a diff took
6.9 s (2026-11-07), almost all of it the baseline phase.
