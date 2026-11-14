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
                               stage2Counts.
  components-pure.ts           ResolvedComponent, DecomposedPair, Bound
                               (an identifier and its origin), decompose
                               (the split), working (a pass's copy),
                               findOwningPair, RESOLVE_VIA_PRIORITY.
  cascade-pure.ts              The tiers: resolveComponent (ORB6 HIP,
                               AT-HYG-native), resolveViaSimbad,
                               resolveViaCcdm, resolveViaPosition; the
                               sibling-identity rejections they record.
  athyg-match-pure.ts          The AT-HYG position match Stage 3 reuses:
                               the 1° grid, the nearest-row search,
                               pairAthygMatches.
  sibling-identity-pure.ts     HipClaims and the disjoint-letter test the
                               CCDM and position tiers both apply.
  propagate-pure.ts            propagateWithinSystem,
                               propagateBlendIdentity,
                               seedSynthesizedComponentBindings,
                               inheritDownwardParentBindings.
  binding-audit-pure.ts        auditBindingIntegrity (the verdicts) and
                               enforceBindingVerdicts (applying them),
                               bindingIntegrityCounts, addNewestEdge (the
                               pair-geometry graph Stage 6's anchor offsets
                               build too).
  binding-verdicts-tsv.ts      BINDING_VERDICTS_TSV, the codec for
                               build/binding-integrity-verdicts.tsv, and
                               bindingVerdictRow.
  stage2-report-pure.ts        The build-log lines, read off the result.
  spot-check-pure.ts (+ test)  The spot-check's ground-truth rows and its
                               check (#the-spot-check).
  spot-check-source.ts         SPOT_CHECK_GROUND_TRUTH
                               (data/binaries/spot_check_ground_truth.tsv).
  resolve-fixture.ts           Test-only builders: components, indices,
                               the audit's one-system fixtures.
```

Each `*-pure.ts` but `sibling-identity-pure.ts` and `stage2-report-pure.ts`,
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

A pass reaches a component through its pair. One that works per component
iterates `working(pairs).components`, a view of the same drafts in pair
order, primary then secondary, so pairing never rests on position.

## Identifier origins

Each of a component's Gaia source, HIP and AT-HYG row is a `Bound`: the value
and its `IdOrigin` (`../multiples-tsv.ts`), `own` or inherited from a named
token of the same system. Every tier binds `own`; a rebind by the audit is
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

## Choices the outputs rest on

`multiples.tsv` is pinned byte for byte, and these choices hold it where a
cleaner one would move a row; changing one is a correctness item of its own:

- **`findOwningPair` reads the first matching row**, not the row that produced
  the component: a discoverer's `AB` and `AC` rows both answer for primary
  `A`. The CCDM, position and seeding passes look pairs up this way.
- **Gaia source_ids sort numerically** (`compareSourceIds`): the audit's
  source order, a contested label, the request file.
- **A rebind keeps the instance's tier.** An instance an earlier verdict
  unbound, which a later verdict rebinds, ends bound with `resolve_via`
  `unresolved` — one component today (05371+2655 A), `stellata-hhaw.45.17.9`.
- **The audit's verdicts are all computed before any is applied.** Every
  verdict reads the per-system context built before enforcement, never a
  component, so the order verdicts apply in never changes one; the
  winner's HIPs are read as enforcement has left them.

## Counts

`stage2Counts` returns the count-snapshot keys this stage's code alone
produces — `ccdm_sibling_owned_rejected` and the seven binding-integrity keys
— folded from the sibling rejections and the verdicts. The snapshot's other
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

## The AT-HYG position match

`matchAthygEitherEpoch` tries each candidate PM-propagated from AT-HYG's
J1991.25 to the WDS coordinate epoch first, then as stored: AT-HYG's HIP rows
sit at J1991.25, its GJ rows at J2000 (ξ UMa drifts ~5″ under propagation).
With propagation the grid search widens a cell each way so a high-PM star
stored in a neighbouring cell is still a candidate. A secondary whose own
match misses rides its primary's row, inherited from it (`blend` at ρ = 0,
else `partner`); Stage 2 binds only `own` matches, Stage 3 takes both.

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
canonical tag set is `RESOLVE_VIA`:

| Tag | When it fires |
| --- | --- |
| `orb6_hip` | The pair has an ORB6 entry with a published HIP for the primary, and Gaia DR3's `hipparcos2_best_neighbour` cross-walk covers that HIP. Strongest tier — ORB6's HIP attribution is human-curated — but gated on a WDS-coordinate sanity check (`orb6HipMatchesPairCoord`): ORB6 occasionally carries a typo'd HIP that points at an unrelated star tens of degrees away (ε Equ STF2737 lists HIP 103579 for the true HIP 103569), so a HIP whose known position sits >5′ from the pair's WDS precise coord is dropped entirely and the component falls through to the coordinate-validated tiers below. |
| `athyg_gaia_native` | HIP-mediated: ORB6's HIP, an AT-HYG row's HIP, or a CCDM sibling's HIP routes through AT-HYG's own `gaia` column when Gaia's published HIP→DR3 cross-walk misses (AT-HYG's source_id coverage is broader). Also reused for the position-match pass below, which lands on the same AT-HYG-native field by a different path. |
| `simbad_xid` | The component is in `data/simbad/simbad_wds_xids.tsv` — SIMBAD's curated `(WDS-J id, component letter) → (Gaia DR3 source_id, HIP)` map. Reaches sub-arcsec components that ORB6 doesn't enumerate (η Cas A/B/C, ξ UMa A/B, ζ Cnc A/B/C, α Cen A/B/Proxima). |
| `ccdm_hip` | The pair's WDS id matches a Hipparcos CCDM identifier; one of the CCDM-sibling HIPs sits within 10″ of the WDS precise coord (PM-propagated from J1991.25). Routes that HIP through Gaia's HIP cross-walk and AT-HYG-native fall-through. A candidate another hierarchy-disjoint, non-partner letter of the system owns is skipped — decisively by geometry (the letter-position map from pair rows, 2× decisiveness) or by an existing binding (the system HIP-claims map). The pair partner is exempt (the WDS blend convention: σ Ori B legitimately carries A's HIP at 0.26″); a non-partner letter's HIP is another star's identity (Rigel's BC row sits 9.4″ from HIP 24436 = Rigel A, inside tolerance — binding it dressed B in A's photometry). Counted `ccdm_sibling_owned_rejected`. |
| `position_pm` / `position_nopm` | Reserved placeholders in `RESOLVE_VIA` for a future PM-propagated match against `data/gaia/gaia_dr3_astrometry_catalog.tsv`. Not yet wired. |
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

The position-match pass deserves its own note. AT-HYG's stored
ra/dec is documented as J2000 but HIP-sourced rows are empirically at
J1991.25 (the HIP1 native epoch), while GJ / Tycho-sourced rows are
closer to J2000. Stage 2 and Stage 3 share `pairAthygMatches`
to walk the pair-iteration cascade (primary match against the WDS
precise_coord, then predicted-secondary match with primary-row
exclusion, with the wide-pair short-circuit at the WDS overflow
sentinel `999.9″` — `parseWdsSumm` collapses that ρ to None, and
the predicted-secondary match skips a None ρ). The default matcher,
`matchAthygEitherEpoch`, tries the row PM-propagated
J1991.25→J2000 first, then the unpropagated stored coord — propagated
wins on tie, the unpropagated retry covers high-PM GJ-anchored rows
(ξ UMa at -425/-581 mas/yr drifts ~5″ off under propagation, beyond
the 2″ tolerance).

The position-match cascade carries the same sibling-identity guard:
a matched AT-HYG row whose HIP is already bound to a hierarchy-disjoint,
non-partner letter of the same system is dropped (WDS stamps some pair
rows with the SYSTEM coordinate — Rigel's BC row carries A's coord, so
B's primary match landed on A's row at ~0″ and wore A's photometry).
The gate lives in `pairAthygMatches`, so Stage 2's identifier
binding and Stage 3's astrometry fallback both honour it; the
inherited branch (a secondary riding its pair primary's row) is
exempt by construction. Counted `athyg_match_sibling_claimed_rejected`
(both stages summed).

The two stages compose:

- **Stage 2** binds identifiers — sets `athyg` always on match,
  and surfaces `gaia` / `hip` from the row when the row carries them
  (tagging `resolve_via=athyg_gaia_native` when a Gaia source binds).
  Binds only `own` matches: an inherited match would carry the primary's
  AT-HYG row, and with it the primary's Gaia source, onto the secondary.
- **Stage 3** synthesizes astrometry — `routePairs`
  routes any remaining `unresolved` component through the same
  cascade, taking inherited matches too, so Hipparcos-unresolved
  pairs (A, B sharing one AT-HYG row at sub-AU separation) both
  emit `astrometry_via=athyg_position`.

After the cascade, `propagateWithinSystem` (same file) smears each
letter binding across every WDS pair row in the same system that
references the same letter — η Cas A is the same physical star whether
it appears in the AB, AC, AD, …, AH rows. The bare letter `A` also
inherits from a resolved sub-letter `Aa` because Gaia rarely separates
the spectroscopic sub-components; the brighter `Aa` carries the system
flux and is the single Gaia source the renderer ever sees.

ρ = 0 sub-resolution pairs get two special rules. Every positional
match (CCDM sibling pick, predicted-secondary AT-HYG match) is
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
- **Proxima** → `athyg_gaia_native` via the AT-HYG row's `gaia` cell
  (HIP-mediated lookup through HIP 70890).
- **Castor STF1110 A** → inherits from CIA 29 Aa via the sub-letter
  hierarchy pass; tagged with Aa's `resolve_via` value.
- **40 Eri B/C** (a tight inner binary inside the BC pair) → both
  components resolve to Gaia source_ids but their per-component 5p
  astrometry is blended; Stage 6's system-anchor inheritance
  backstops them (see below).
