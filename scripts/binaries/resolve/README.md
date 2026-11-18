# Stage 2 — WDS components resolved to Gaia DR3 and HIP

The TypeScript Stage 2 of the binaries pipeline: every decomposing pair row
of `../load/`'s `ReferenceCatalogs` split into its two components, each bound
to a Gaia DR3 source and / or a HIP by the cascade, the identity propagations
and the binding-integrity audit, returned as frozen `DecomposedPair`s for
Stage 3; `../build-binaries.ts` calls it. What each tier decides, and why:
[What each tier decides](#what-each-tier-decides), with the
[binding-integrity audit](#binding-integrity-audit-enforced).

## Files in this area

```
scripts/binaries/resolve/
  resolve-pairs.ts             resolveStage2 (the passes in order) and
                               resolveCascade (the tiers and propagations
                               alone), Stage2Result, astrometryRequestIds,
                               refusalTally.
  components-pure.ts           ResolvedComponent, DecomposedPair, Bound
                               (an identifier and its origin),
                               GaiaBinding (a Gaia source's Bound plus the
                               tier that found it; resolveViaOf reads
                               `unresolved` off a null one), decompose
                               (the split), working (a pass's copy),
                               componentSides (each component with the
                               row that produced it: the one component
                               order), findOwningPair,
                               RESOLVE_VIA_PRIORITY.
  cascade-pure.ts              The tiers: resolveComponent (ORB6 HIP,
                               manifest HIP), resolveViaSimbad,
                               resolveViaCcdm, resolveViaPosition; the
                               CascadeRefusal each gate records (the ORB6
                               HIP's coordinate check, the three
                               sibling-identity guards).
  position-match-pure.ts       The position match, over any MatchStar
                               list: the 1° grid, the nearest-star search
                               by reading, pairPositionMatches. Stage 2
                               matches manifest stars; Stage 3, AT-HYG.
  sibling-identity-pure.ts     HipClaims and the disjoint-letter test the
    (+ test)                   CCDM and position tiers both apply;
                               simbadSourceLetters and
                               sourceClaimedByDisjointLetter, the manifest
                               HIP route's guard;
                               refuseHipsOfDisjointStars, the post-audit
                               HIP check (#a-hip-follows-its-star).
  propagate-pure.ts            propagateWithinSystem,
                               propagateBlendIdentity,
                               seedSynthesizedComponentBindings,
                               inheritDownwardParentBindings.
  binding-audit-pure.ts        auditBindingIntegrity (the verdicts) and
                               enforceBindingVerdicts (applying them),
                               verdictTouches (each instance holding a
                               binding a verdict weighed, and its part),
                               VERDICT_PARTS (the verdicts each shape
                               reaches and the parts each gives; the
                               BindingVerdict union is typed from it),
                               bindingIntegrityCounts, addNewestEdge (the
                               pair-geometry graph Stage 6's anchor offsets
                               build too).
  binding-verdicts-tsv.ts      BINDING_VERDICTS_TSV, the codec for
                               build/binding-integrity-verdicts.tsv, and
                               bindingVerdictRow.
  stage2-report-pure.ts        The build-log lines, read off the result.
  resolve-lineage-pure.ts      RESOLVE_CODES, resolveLineageLines,
    (+ test)                   resolveCounts and RESOLVE_INVARIANTS: Stage
                               2's decisions as the resolve lineage stage
                               (#resolve-lineage).
  binding-lineage-pure.ts      BINDING_CODES and bindingLineageLines: the
    (+ test)                   origins as the component-binding lineage
                               stage
                               (#binding-lineage).
  spot-check-pure.ts (+ test)  The spot-check's ground-truth rows and its
                               check (#the-spot-check).
  spot-check-source.ts         SPOT_CHECK_GROUND_TRUTH
                               (data/binaries/spot_check_ground_truth.tsv).
  resolve-fixture.ts           Test-only builders: components, indices,
                               the audit's one-system fixtures.
```

Each `*-pure.ts` but `stage2-report-pure.ts`,
and `resolve-pairs.ts` and `binding-verdicts-tsv.ts`, has a co-located
`.test.ts` over fixtures. The real-data cases and the spot-check are the
parent folder's `build-binaries.test.ts`.

## The order of the passes

`resolveStage2` runs them in this order, each reading the one before; every pass takes `DecomposedPair`s and returns new ones:

1. `decompose` splits each pair row and `resolveComponent` binds each side,
   pairs in `ReferenceCatalogs.pairs` order, primary then secondary.
2. `resolveViaSimbad`, `resolveViaCcdm`, `resolveViaPosition`.
3. `propagateWithinSystem`; `propagateBlendIdentity`, and
   `propagateWithinSystem` again only when that seeded anything.
4. `seedSynthesizedComponentBindings` over the ORB6 orphan and MSC inner
   pairs.
5. `auditBindingIntegrity` over the seeded components, then
   `enforceBindingVerdicts`, which re-runs the propagations over the systems
   it touched.
6. `refuseHipsOfDisjointStars` ([A HIP follows its star](#a-hip-follows-its-star)).

A pass reaches a component through its pair. One that works per component
iterates `working(pairs).components`, a view of the same drafts in pair
order, primary then secondary, so pairing never rests on position.

## Identifier origins

Each of a component's Gaia source, HIP and AT-HYG row is a `Bound`: the value
and its `IdOrigin` (`../multiples-record-pure.ts`), `own` or inherited from a named
token of the same system. Stage 2 binds no AT-HYG row; Stage 3's fallback
does. Every tier binds `own`; a rebind by the audit is
`own`. The passes that copy record the kind:

| Kind | Copied by | From |
| --- | --- | --- |
| `blend` | `propagateBlendIdentity`; Stage 3's AT-HYG fallback at ρ = 0 | a ρ = 0 pair's primary |
| `letter` | `propagateWithinSystem` (A ← Aa) | the sub-letter donor |
| `parent` | `seedSynthesizedComponentBindings` (primary), `inheritDownwardParentBindings`, Stage 3's NSS inner pairs | the parent token |
| `partner` | `seedSynthesizedComponentBindings` (secondary); Stage 3's AT-HYG fallback at a measured or unmeasured ρ | the pair's primary |

The same-letter smear across a letter's rows copies the origin unchanged:
one letter is one star, so its binding is its own on every row or inherited
on every row. A copy names its immediate donor, never the donor's donor.

## Binding lineage

`build:binaries` writes the Gaia and HIP origins of every `multiples.tsv`
row as the `component-binding` lineage stage, the first in `LINEAGE_STAGES`
([Record lineage](/scripts/catalog/lineage/README.md#the-component-binding-stage)).
Two rows per component, keyed on its row (`multiples:<system_id>/<comp>`,
the key promotion's rows use): `component-binding.<gaia|hip>.own`,
`.inherited.<kind>` with the donor token in `params.from`, or `.unbound`.
`params` carries the Gaia source bare and the HIP as its `hip:` designation,
the forms trace matches a query on. They are read off the Stage 6 records,
so they and the `gaia_origin` / `hip_origin` columns are one value written
twice. The stage covers Gaia and HIP only, since the binaries pipeline's
AT-HYG binding retires with its AT-HYG read (stellata-hooj.17). The counts
fold into the snapshot's `component-binding` stage ([Composition, not counting](../counts/README.md#composition-not-counting)).

`BINDING_LINEAGE_BUDGET` pins 1.1 MB and 2 s for two rows per component,
over the stage's <!-- count:build-binaries/multiples_rows_emitted -->50,584<!-- /count --> components.
On 2026-11-16, with the manifest's position tier binding more sources, the
stage came to 1,000,943 bytes gzipped in 531–585 ms across two runs, neither
diffing against a baseline. A branch that changes this stage's
inputs re-reads each changed file at the merge-base in one batched git read
to refuse the baseline: 622 ms for the whole window on CI, 269 of it the
baseline (f7a87137, 2026-11-15).

## Resolve lineage

`build:binaries` writes Stage 2's decisions as the `resolve` lineage stage,
after `component-binding` in `LINEAGE_STAGES`
([Record lineage](/scripts/catalog/lineage/README.md#the-resolve-stage)), from
`resolve-lineage-pure.ts` over the `Stage2Result` itself, never re-read off
`multiples.tsv`. Every row is keyed on its component's pair row as
`multiples.tsv` writes it (`multiples:<system_id>/<comp>`, `pairSystemId`), so
a component a later stage drops keeps the key its row would carry, and trace
joins the stage to component-binding and promotion on the key.

| Code | Written for |
| --- | --- |
| `resolve.tier.<tag>` | every component of every decomposing pair row, once: its `resolve_via` ([What each tier decides](#what-each-tier-decides)), underscores as dashes, with its Gaia source and `hip:` in `params`; a rebound component carries its donor's tier |
| `resolve.refused.<gate>` | each candidate HIP a cascade gate refused (`CascadeRefusal`): `orb6-hip-off-coord`, `manifest-hip-sibling-claimed`, `ccdm-sibling-owned`, `position-match-sibling-claimed`, `hip-of-disjoint-star` |
| `resolve.audit.<shape>.<verdict>.<part>` | each component holding a binding an audit verdict weighed (`verdictTouches`), as `won` (it keeps the source), `refused` (it loses it) or `skipped` (unchanged); `params` carry the verdict's `wds`, `contested` label, `reference` letter and `reference_gaia`, `winner`, and the component's own `gaia` |

A `refused` part and every gate code are in the refusal role. The stage
writes no identity rows.

`resolveCounts` folds the snapshot keys this stage's code alone produces from
the stage's lines, inside the timed window (`foldedStageLineage`): a
`ccdm-sibling-owned` refusal per line, each verdict once by its `wds`, shape
and `contested` label however many components it weighed. The keys keep their
names in the snapshot's `resolve` block ([Counts](#counts)).

`RESOLVE_INVARIANTS` allows an `audit.*.unbound-ambiguous.refused` row only
for the 38 rows it names, from 8 conflicts, 20 of them 10444-6000's Aa across
its pair rows ([Invariants](/scripts/catalog/lineage/README.md#invariants)): a
new ambiguous unbinding fails the build by key, and a fix that clears one
fails until it is struck off the list.

`RESOLVE_LINEAGE_BUDGET` pins 1.2 MB and 2 s: 97,386 rows came to 1,032,005
bytes gzipped in 173–196 ms across two runs, neither diffing against a
baseline (2026-11-16). The time budget keeps its siblings' 2 s: write times
swing under machine load (stellata-hhaw.66.1).

## Choices the outputs rest on

`multiples.tsv` is pinned byte for byte, and these choices hold it where a
cleaner one would move a row; changing one is a correctness item of its own:

- **`findOwningPair` reads the first matching row**, not the row that produced
  the component: a discoverer's `AB` and `AC` rows both answer for primary
  `A`. The CCDM, position and seeding passes look pairs up this way.
- **Gaia source_ids sort numerically** (`compareSourceIds`): the audit's
  source order, a contested label, the request file.
- **A rebind takes its donor's tier.** Every instance of the rebound letter
  carries the strongest `resolve_via` among the letter's instances already
  bound to the winning source, read before enforcement, so the tag names the
  tier that found the source it now holds. An identity refutation whose
  SIMBAD source no instance of the letter holds rebinds under `simbad_xid`,
  the tier that supplied it.
- **The audit's verdicts are all computed before any is applied.** Every
  verdict reads the per-system context built before enforcement, never a
  component, so the order verdicts apply in never changes one; the
  winner's HIPs are read as enforcement has left them.

## Counts

`resolveCounts` returns the count-snapshot keys this stage's code alone
produces — `manifest_hip_sibling_claimed_rejected`, `ccdm_sibling_owned_rejected`, `position_match_sibling_claimed_rejected`,
`hip_of_disjoint_star_rejected` and the seven binding-integrity keys
— folded from the resolve stage's lines ([Resolve lineage](#resolve-lineage)).
The snapshot's other
`resolve` keys also count Stage 3's work, so Stage 3's `stage3Counts` returns
them ([Counts](../astrometry/README.md#counts)).

`astrometryRequestIds` is the binaries' share of the one Gaia astrometry
request: `build:astrometry-request` runs Stages 1–2 and unions it in
(`../../catalog/astrometry-request/`), and the real-data case holds every id
of it to the committed request.

## The spot-check

`data/binaries/spot_check_ground_truth.tsv` names, per curated
`(wds_id, component)`, the tier and Gaia source Stage 2 must reach — or
`absent`, no component at all. The real-data case holds the strongest-tier
instance of each key to it and lists every row it misses, tier and source
separately. A row whose note starts `known_bug:` still has to pass: the note
explains the expectation, it does not excuse a miss.

## The position match

`pairPositionMatches` takes any list of `MatchStar`s, each with its
readings: directions tried in order, every star's first reading before any
star's second, nearest within 2″ (`POSITION_MATCH_TOLERANCE_ARCSEC`). Stage
2's stars are the membership manifest's, one reading each at the WDS epoch
([The manifest](../load/README.md#the-manifest)); Stage 3's AT-HYG rows
carry two ([The AT-HYG position fallback](../astrometry/README.md#the-at-hyg-position-fallback)).
The grid search reaches a cell past the query's neighbours each way, so a
high-PM star gridded in a neighbouring cell is still a candidate. A
secondary whose own match misses rides its primary's star, inherited from it
(`blend` at ρ = 0, else `partner`); Stage 2 binds only `own` matches, Stage 3
takes both.

## A HIP follows its star

After enforcement, `refuseHipsOfDisjointStars` takes a HIP off every
component that holds a Gaia source of its own while a hierarchy-disjoint
letter of the system holds the HIP's source (Gaia's HIP cross-walk, else
the manifest's), unless an ORB6 row's primary or SIMBAD's cross-IDs name the
HIP on the component's letter, its parent or a sub-letter. A HIP SIMBAD gives
to two hierarchy-disjoint letters of one system (θ¹ Ori A and B both carry
HIP 26220, usually a pair Hipparcos measured as one star) is no SIMBAD
witness for either. It runs last
because the audit can unbind the source a HIP arrived with after propagation
has already copied the HIP up and down the letter's line: HD 69445
(08159-3056) Bb's position match landed on A's star and took HIP 40476; the
HIP reached B as `letter` before the audit gave A the source back, and Ba
and Bb then inherited it from B. A compound holder (`AB` for `B`) shares the
component's identity and refuses nothing, and a component Gaia does not
separate from the HIP's star (σ Ori B on A's source) keeps it. Each refusal
is a `resolve.refused.hip-of-disjoint-star` row, counted
`hip_of_disjoint_star_rejected`.

## The binding-integrity audit

`auditBindingIntegrity` answers and `enforceBindingVerdicts` acts: the
verdicts are data (counts, the review TSV, the request's audit candidates),
and enforcement is a separate pass over the components. Each verdict carries
one `action`: a `rebind` (a decisive letter→sources verdict, an identity
refutation), an `unbind` of its losing bindings, or none (a skipped
conflict).

## What each tier decides

Every WDS pair row decomposes into a primary and a secondary letter
(`AB` → `A`+`B`, `Aa,Ab` → `Aa`+`Ab`); each letter resolves through a
strict-priority cascade (`cascade-pure.ts`). The
canonical tag set is `RESOLVE_VIA`. A component's tag is its
`GaiaBinding`'s `via`, or `unresolved` with no source bound, so no
component carries a source without a tier, and `gaia_resolve_rate`
([Counts](../astrometry/README.md#counts)) counts every other tier:

| Tag | When it fires |
| --- | --- |
| `orb6_hip` | The pair has an ORB6 entry with a published HIP for the primary, and Gaia DR3's `hipparcos2_best_neighbour` cross-walk covers that HIP. Strongest tier — ORB6's HIP attribution is human-curated — but gated on a WDS-coordinate sanity check (`orb6HipMatchesPairCoord`): ORB6 occasionally carries a typo'd HIP that points at an unrelated star tens of degrees away (ε Equ STF2737 lists HIP 103579 for the true HIP 103569), so a HIP whose known position sits >5′ from the pair's WDS precise coord is dropped entirely and the component falls through to the coordinate-validated tiers below. |
| `manifest_hip` | ORB6's HIP routes through the membership manifest's `gaia_source_id` for that HIP when Gaia's published HIP→DR3 cross-walk misses. The manifest's binding is derived from four committed sources and has passed both binding gates ([The binding derivation](/scripts/catalog/membership/binding/README.md)). Refused when SIMBAD's WDS cross-IDs give that source to a hierarchy-disjoint letter of the system and none of the component's line — no partner exemption, since a source is one star — so the component falls through to the tiers below: 53 Aqr's ORB6 row puts HIP 110778 on A, the manifest binds that HIP to the source SIMBAD names B, and A then takes its own source from `simbad_xid`. Counted `manifest_hip_sibling_claimed_rejected`. A CCDM sibling's HIP that falls through to the manifest tags `ccdm_hip`. |
| `simbad_xid` | The component is in `data/simbad/simbad_wds_xids.tsv` — SIMBAD's curated `(WDS-J id, component letter) → (Gaia DR3 source_id, HIP)` map. Reaches sub-arcsec components that ORB6 doesn't enumerate (η Cas A/B/C, ξ UMa A/B, ζ Cnc A/B/C, α Cen A/B/Proxima). |
| `ccdm_hip` | The pair's WDS id matches a Hipparcos CCDM identifier; one of the CCDM-sibling HIPs sits within 10″ of the WDS precise coord, each HIP placed by its Hipparcos-2 row (PM-propagated from J1991.25), else its cross-walked Gaia source. Routes that HIP through Gaia's HIP cross-walk, then the manifest (`sourceForHip`). A candidate another hierarchy-disjoint, non-partner letter of the system owns is skipped — decisively by geometry (the letter-position map from pair rows, 2× decisiveness) or by an existing binding (the system HIP-claims map). The pair partner is exempt (the WDS blend convention: σ Ori B legitimately carries A's HIP at 0.26″); a non-partner letter's HIP is another star's identity (Rigel's BC row sits 9.4″ from HIP 24436 = Rigel A, inside tolerance — binding it dressed B in A's photometry). Counted `ccdm_sibling_owned_rejected`. |
| `position_pm` / `position_nopm` | The component's WDS position (a primary's precise coord, a secondary's (ρ, θ) prediction) matches a membership manifest star within 2″ ([The position match](#the-position-match)); the star's `gaia_source_id` binds, and its HIP when the component has none. `position_pm` when the source that placed the star states a proper motion, `position_nopm` when it does not. A matched star with no Gaia source binds only its HIP. |
| `unresolved` | All strategies missed. The component still binds a HIP whenever any tier surfaced one — Stage 3's HIP2 long-baseline fallback can attach astrometry to a Gaia-source-less Sirius A or α Cen B from the bare HIP. |

Before any tier runs, Stage 1's `buildIndices` applies a one-sided
**magnitude-consistency gate** to every HIP-anchored Gaia binding —
both Gaia's `hipparcos2_best_neighbour` xwalk rows and AT-HYG's own
`gaia` cells (which ingest the same xwalk). The xwalk has no magnitude
check, so a HIP too saturated for a DR3 source best-matches whatever
source IS nearby: the resolvable companion (Castor A → B's source) or
a faint background star (α Cen B → a G=20.9 source). A bound source
with `G − V > 1.0` (`GAIA_BINDING_G_MINUS_V_REJECT_MAG`) cannot carry
the light the HIP names — the physical ceiling is ~+0.1 for the bluest
stars plus ~+0.75 of equal-blend headroom; red stars run G *brighter*
so the gate never fires on them — and is unbound at the ingest
boundary (AT-HYG cells scrubbed to `None`, xwalk rows dropped from
`hip_to_gaia` / `src_to_hip`). The bare HIP survives for Stage 3's
HIP2 fallback. Unverifiable bindings (no V, source outside the
astrometry pull, no G) are trusted. Counted `xwalk_hip_mag_rejected` /
`athyg_gaia_mag_rejected` in the Stage-7 snapshot.

Stage 2 and Stage 3 share `pairPositionMatches` to walk the
pair-iteration cascade (primary match against the WDS precise_coord, then
predicted-secondary match with the primary's star excluded, with the
wide-pair short-circuit at the WDS overflow sentinel `999.9″` —
`parseWdsSumm` collapses that ρ to None, and the predicted-secondary match
skips a None ρ).

The match carries the same sibling-identity guard: a matched star whose HIP
is already bound to a hierarchy-disjoint, non-partner letter of the same
system is dropped (WDS stamps some pair rows with the SYSTEM coordinate —
Rigel's BC row carries A's coord, so B's primary match landed on A's star
at ~0″ and wore A's photometry). The gate lives in `pairPositionMatches`,
so Stage 2's identifier binding and Stage 3's astrometry fallback both
honour it; the inherited branch (a secondary riding its pair primary's
star) is exempt by construction. Counted per stage:
`position_match_sibling_claimed_rejected` (Stage 2) and
`athyg_match_sibling_claimed_rejected` (Stage 3).

The two stages compose:

- **Stage 2** binds identifiers — the matched manifest star's `gaia` and
  `hip`. Binds only `own` matches: an inherited match would carry the
  primary's Gaia source onto the secondary.
- **Stage 3** synthesizes astrometry — `routePairs`
  routes any remaining `unresolved` component through the same
  match against AT-HYG, taking inherited matches too, so
  Hipparcos-unresolved pairs (A, B sharing one AT-HYG row at sub-AU
  separation) both emit `astrometry_via=athyg_position`.

After the cascade, `propagateWithinSystem` (same file) smears each
letter binding across every WDS pair row in the same system that
references the same letter — η Cas A is the same physical star whether
it appears in the AB, AC, AD, …, AH rows. The bare letter `A` also
inherits from a resolved sub-letter `Aa` because Gaia rarely separates
the spectroscopic sub-components; the brighter `Aa` carries the system
flux and is the single Gaia source the renderer ever sees.

ρ = 0 sub-resolution pairs get two special rules. Every positional
match (CCDM sibling pick, predicted-secondary star match) is
SKIPPED for them — the (ρ, θ) prediction degenerates onto the
primary's own coordinate, so a nearest-neighbour pick can only
coin-flip onto a sibling component's identity (1 Equ Ab once bound
B's HIP 103569 and B's AT-HYG photometry this way). Instead,
`propagateBlendIdentity` gives a secondary that bound nothing of
its own the primary's gaia / hip / AT-HYG row — the WDS blend
convention (Castor CIA 29 lists HIP 36850 on both sides of Aa,Ab) —
and `propagateWithinSystem` re-runs so the blend binding reaches
the letter's other pair rows. Secondaries carrying ANY binding of
their own are left untouched.

### Binding-integrity audit (enforced)

After every binding pass, `auditBindingIntegrity` groups bindings
per WDS system and detects two contradiction shapes the cascade +
propagation can leave behind: (a) one Gaia source bound to disjoint
letters (not ancestor/descendant, not compound-contained, not
sub-resolution blend-mates), and (b) one letter bound to different
sources on different rows. A source cannot be two stars, and two
letters at a measured ρ > 0 cannot be one source — so the blend-mate
exemption applies only to ρ = 0 sub-resolution pairs, not to measured
ones. Each contradiction is arbitrated geometrically: predicted
tangent-plane offsets (E = ρ·sin θ, N = ρ·cos θ) composed over a BFS
chain of pair rows from an uncontested astrometric reference letter,
versus the contested source's actual Gaia offset (min error over
J2016.0 and the PM-propagated WDS edge epoch). The winner is decisive
when its error clears a flat `2″` floor (no separation-scaling — a
wide pair's chain accumulates measurement error, so scaling the
tolerance up with ρ would rubber-stamp a source sitting arcseconds
off the winner) and beats the runner-up by ≥2×, or — for a
disconnected system graph — when geometry refutes every reachable
candidate and leaves exactly one unreachable home.

**Photocentre blends.** A source bound to *both sides of a measured
(ρ > 0) pair* is a genuine Gaia blend — one photocentre for two
components Gaia could not resolve (Castor A/B, saturated at ~5″).
Enforcement unbinds a blend loser only when geometry lands the source
essentially ON one component (winner error within a tight `1″` floor,
i.e. a crosswalk error masquerading as a blend, e.g. σ CrB's C/E
collapse); a larger error means the source is the blend centroid
sitting *between* the components, so the conflict is `skipped` and the
blended-away member is left for the downstream slot-minting machinery
(the Acrux/Castor shape). Before skipping, an **identity refutation**
gets one shot: when SIMBAD's per-component cross-IDs give exactly one
side ownership of the contested source and the other side a different
source of its own (directly, or through its HIP), the "blend" is a
crosswalk mis-match — a component with its own resolved identity is
not inside a photocentre — so the loser rebinds to its own source and
the owner keeps the contested one (`identity_refuted`; 36 Oph, μ Dra,
HD 70492: Gaia's HIP best-neighbour put the primary on the secondary's
source while SIMBAD carries both components distinctly). Chain
geometry through a wide reference is too noisy for the 1″ floor in
exactly these systems, which is why identity gets to overrule it. A
letter_sources conflict on a letter that is itself part of a skipped
blend is skipped for the same reason; one an identity refutation
rebound is fully resolved and emits no second verdict. All other
ambiguous conflicts unbind every contested binding conservatively.

Enforcement (`apply=True`) is live: losers unbind (gaia → None; hip →
None when it cross-walks to the contested source or is a HIP the
winning component also carries — the shared blend-HIP), then the
propagation passes re-run and sub-letters orphaned *within an enforced
system* inherit their bound parent token (20312's Aa/Ab follow A, not
sibling BC). Verdicts are counted (Stage-7 `binding_conflicts_*` /
`arbitrated_geometric` / `arbitrated_unbound_ambiguous` /
`arbitration_skipped_no_reference` / `arbitration_skipped_photocentre_blend`)
and written to `build/binding-integrity-verdicts.tsv` (gitignored
audit surface). Every source the audit weighed stays in the Gaia
astrometry request (`bindingAuditSourceIds`), kept or unbound: the
audit can only unbind a source whose astrometry is in the pull, so
dropping its losers from the request re-binds them on the next refresh.
This is what re-homes the ~7 duplicate-relation
mis-associations the writer previously collapsed; a source cannot be
two stars at measured different separations.

**Worked examples** (per-letter resolve_via):

- **Sirius A** → no Gaia source (saturated), HIP 32349 bound via
  `simbad_xid` / `ccdm_hip`; `resolve_via=unresolved`. Stage 3's HIP2
  long-baseline fallback engages.
- **Sirius B** → `simbad_xid` (the SIMBAD WDS xids side-file). Without
  this tier B would resolve via position-match onto A's source.
- **α Cen A** → no Gaia source; SIMBAD has the HIP, no DR3 source_id;
  `resolve_via=unresolved` + HIP bound. HIP2 long-baseline path.
- **α Cen B** → same shape as α Cen A.
- **Proxima** → `simbad_xid` (the SIMBAD WDS xids side-file).
- **Castor STF1110 A** → inherits from CIA 29 Aa via the sub-letter
  hierarchy pass; tagged with Aa's `resolve_via` value.
- **40 Eri B/C** (a tight inner binary inside the BC pair) → both
  components resolve to Gaia source_ids but their per-component 5p
  astrometry is blended; Stage 6's system-anchor inheritance
  backstops them (see below).
