# Promotion post-passes

The four passes companion promotion runs over records after its cursor walk
(`../README.md#companion-promotion-from-databinariesmultiplestsv`), in this
order: inner-pair re-home, systemic velocity, blend split, anchor flux
conservation. Each acts on records, not rows: it reads what the walk
gathered, changes records in place, and returns what it changed.
`promoteCompanions` (`../companion-promotion.ts`) is the wiring — it turns
each pass's outcomes into lineage rewrites and folds `PromotionStats`, the
derived count block, from them. All four run before the record sort.

Nothing here imports `companion-promotion.ts` for a value; the walk hands
each pass its inputs.

## Files in this area

```
scripts/catalog/companions/post-passes/
  inner-rehome.ts (+ test)      ComponentSlots, the (WDS root, component) →
                                record map the walk fills, and
                                reHomeInnerPairs (#inner-pair-re-home).
  systemic-velocity.ts (+ test) SystemicGroups: renderable-orbit pairs per
                                root, reconciled to one velocity
                                (#systemic-velocity).
  blend-split.ts (+ test)       splitBlends (#blend-split).
  anchor-dim.ts (+ test)        dimAnchors, the joint subset solve and the
                                dim it decides, with its calibrated
                                constants and componentDepth
                                (#anchor-flux-conservation). Every candidate
                                gets one AnchorDimVerdict, and the
                                companionBlendDim* counts fold from them.
  held-record.ts                starDistPc and recordSpectralInfo: what a
                                pass reads back off a record already built
                                (#reading-a-records-class-back).
```

## Inner-pair re-home

An inner pair's cursor primary (Castor Ba) can carry the system's blended
identifier — a shared Gaia source, or a shared HIP Gaia later split — so it
resolves onto a sibling (Castor A) and the secondary bakes there instead of
on its true parent component (B). The pass re-runs the placement against the
parent's resolved slot — its synth record first, then `ComponentSlots` for a
parent that kept its own Gaia row — covering both the ρ=0 collocation and a
measured sep+PA re-projection, and gives the secondary the parent's velocity.
Position only: naming already resolved, and A_V across the sub-arcsec offset
is below the dust grid's resolution. This makes the baked placement match the
runtime pair anchor
([The parent re-home](../record-index/README.md#the-parent-re-home));
counted by `companionRepositionedInnerToParent`. Rendering is unaffected
either way (elements-alone R(t)), but a consistent bake keeps the
baked-vs-elements ratchet in `/tests/integration/multi-star-regression.test.ts`
honest.

`ComponentSlots` has two writers with different rules: a cursor primary
claims a slot only if it is empty, since a blended primary resolves onto a
sibling, and a promoted secondary always overwrites, since its own record is
authoritative for its token.

## Systemic velocity

A bound pair's members share one systemic velocity, so the runtime
epoch-advance never shears a pair; orbital motion stays the elements'
([Composition with binary orbital motion](/docs/science-catalog-ingestion.md#current-epoch-star-positions--space-motion-propagation-to-t)).
Over the renderable-orbit pairs this build resolves, grouped by WDS root: a
lone pair takes the barycentric blend v_sys = (1−q)·v_p + q·v_s, cancelling
orbital contamination in the per-member PMs to first order, and a root with
≥2 orbit pairs takes the root anchor's velocity for every member. With the
mint's velocity inheritance this is the guarantee that no promoted companion
freezes at v=0 while its primary drifts. Pairs `binaries.bin`'s runtime
pairing re-homes, and its Tier-3 static pairs, are not grouped here; harmless
while Tier-1/2 offsets are elements-owned.

## Blend split

A sub-arcsec pair Gaia fit as a single 5p source with neither component in
AT-HYG (YY Gem = Castor Ca,Cb) surfaces as ≥2 collocated `gaia_photometry`
records — the outer-pair row for the source and the inner pair's components —
each carrying the source's COMBINED `M_V`, so the system renders ~2× too
bright. The walk groups minted records by their backing Gaia source
(`row.gaiaSourceId`, pre-inherited-id-strip, so an inherited-Gaia synth
secondary still groups with its blend partner); a source backing N≥2 gets
each record dimmed by `2.5·log₁₀(N)` (0.753 mag for a pair) and its radius
re-derived. Equal split — a pair Gaia couldn't resolve is near-equal by
construction, exact for the M-dwarf eclipsing pairs that dominate; total
system light is preserved. `ci` stays the shared colour. Each split record
writes `promotion.brightness.blend-split`
([Promotion lineage](../README.md#promotion-lineage)). See
[Multiple-star pipeline](/docs/science-multiple-star-pipeline.md#multiple-star-pipeline)
(Blend split).

## Anchor flux conservation

A member whose light is embedded in an `athyg_own` anchor's record magnitude
double-counts the flux if minted without dimming the anchor. **Which members
CAN be in there is set by the catalogue the anchor's V came from, not by
identifiers.** A printed tier publishes one magnitude per catalogue entry, so
every member sharing the entry is inside it; a `gaia_riello` V resolves per
source, so a member Gaia handed its OWN source_id is separated by measurement
and cannot be in the anchor's G (`companionBlendDimGaiaResolved` — HD 153557's
B at 5″, σ Ori's E at 42″, both of which the fit alone would have dimmed).
`vTierIsSystemBlend` owns that split
([Which tiers give a system blend](../../photometry/README.md#which-tiers-give-a-system-blend--vtierissystemblend)).
Every remaining own-brightness member (`dmag_imputed` / `own` / `wds_mag`) is
decided per anchor by a **joint subset solve** — derivation, margin rationale
and worked examples in
[Blend light conservation](/docs/science-multiple-star-pipeline.md#blend-light-conservation).

The walk registers the candidates; `dimAnchors` solves and applies each
anchor in turn, in place, in first-registered order — a later anchor reads an
earlier one's rewritten absmag, so the order is part of the result. The
engineering invariants it rests on, each easy to get wrong:

#### Observed magnitude

Comes from the anchor's own `absmag` at its own `|xyz|`, never a
multiples.tsv `dist_pc` — that can predate a distance override the record
took (HD 64315: 12.7 kpc vs 6.2) or a coherence reposition (σ Ori 328.9 →
399.8 pc). Coherence moves a record at fixed de-extincted apparent magnitude,
so a snapped anchor's observed magnitude here is off by its A_V difference
between the two positions (`stellata-hooj.47.1`). One A_V serves the whole
group: the dust grid's voxels are far coarser than even the widest member's
offset (σ Ori's E at 42″, AR Cas I at 234″).

#### Anchor alone

The `mag_pri` of the anchor's DEEPEST row, and also the Δ reference for every
`dmag_imputed` member. `componentDepth` ranks the letter, NOT its length: a
compound is an unresolved aggregate and scores 0, BELOW a single letter,
because η CrB's `AB,E` row prints the A+B aggregate (4.98 against the `AB`
row's 5.64 for A alone) and reading it as deeper than `A` makes the blend the
anchor's own light. The test is two designators at ONE level (`AB`, `Aab`,
`Aa12`), never "two capitals". Ties break brightest: two rows at one depth
are two measurements of one subtree, and the fainter would claim a split that
is not there.

#### Registration

Reads the ANCHOR RECORD's `vVia` (`anchorMagIsCatalogued`), never a
multiples.tsv `photometry_via` cell: those freeze at the build that wrote the
TSV and went stale under the driver swap (ξ UMa's AB row says `none` while
the record carries a printed `I/239` blend — the exact population needing the
dim).

**Members already in the catalog are candidates too**, not only minted ones,
or an anchor on a printed blend tier keeps the pair's combined light. They
enter as `own` — flux subtraction against the record's own measurement,
never the Δmag re-split, which would overwrite a first-class record's
brightness — deduped per `(anchor, member)`, since every cursor pairing the
two arrives at the same registration. A **re-curated** member is the
exception: its brightness is the curated one, so it enters under that source
exactly as a minted member would (and a class→M_V one not at all).

#### Conservation is observed-frame

A member's flux leaves at the apparent magnitude the observer sees and the
residual converts back at the anchor's own distance. Identical arithmetic for
a minted member (tangent projection puts it at the anchor's distance), not
for an already-in-catalog one (ξ Sco B sits 3.4 pc past A).

#### One member magnitude

The fit and the subtraction share ONE member magnitude (`obsMag`). An
independent-brightness member ships its own record, so the hypothesis is
built from the light that record contributes, not the pair's WDS `mag_sec` —
HD 75632 B's Gaia photometry is 0.47 mag off `mag_sec` 9.10, so judging `{B}`
on one and subtracting the other put the emitted absmag outside the residual
gate that had just certified it. Only `dmag_imputed` members use the WDS
frame, having no independent measurement to use instead.

#### The decisive margin

The solve dims only when the winning hypothesis beats "anchor alone" by
`ANCHOR_DIM_DECISIVE_MAG`; hypotheses within it of the best are one class,
and the SMALLEST subset in the class wins, so near-degenerate cases (Sirius,
Δmag≈10: hypotheses differ by ~10⁻⁴ mag) never flip on float noise. The
margin is a floor at the
[Riello 2021](/data/papers/index.md#riello2021) G−V scatter, because a
`gaia_riello` anchor's magnitude is only good to that σ. It does not model a
printed-tier anchor's σ (Hipparcos' printed precision), nor the WDS
observed-frame magnitudes the hypotheses are built from, whose ~0.1 mag error
dominates both. Raising it toward that term is a calibration with count
movement, not a constant swap.

#### Closest is not close

The decisive margin ranks hypotheses against each other and says nothing
about whether any is right, so `ANCHOR_DIM_MAX_FIT_RESIDUAL_MAG` = 0.2
refuses a fit whose WINNER still misses the anchor's observed magnitude by
more than the input's own error scale (`companionBlendDimMisfit`). Scoped to
the fit's verdict, so members that never entered the fit — a printed tier's
structural ones — still apply.

#### The separation gate

Identity evidence answers "is this member inside the entry" only where the
catalogue published an identifier for it; past that, photometry alone cannot
tell a sub-arcsec photocentre from a companion 525″ off.
`PRINTED_BLEND_MAX_SEP_ARCSEC` = 10″ and `GAIA_BLEND_MAX_SEP_ARCSEC` = 1″, both
calibrated. A pair WDS published no separation for is EXCLUDED — no
measurement is no evidence of blending (AU Mic AB). Structural members skip
the bound in BOTH tiers — ids inherited from the anchor are evidence about
THIS pair and outrank a population threshold — which is not the same as
bypassing the fit, and a large share of the Gaia-tier candidates turn on the
difference (`companionBlendDimGaiaResolved` and
`companionBlendDimBeyondSeparation` are the pinned counts; no snapshot
isolates the structural share, so don't quote one). **Inherited means
inherited, not inherited-then-stripped**: an id the row kept of its own says
nothing about what the anchor's catalogue entry contained, and reading it as
evidence let a printed-tier member escape the dim while shipping the entry's
whole light. **A member already in the catalog is never structural, and that
asymmetry is load-bearing, not an oversight**: the bypass is for a member
with no other evidence — ids inherited-then-stripped AND a separation WDS
never published (VV Crv B). An existing record has its own measured magnitude
and a published separation, so the fit and the 10″ bound can both judge it
and should. ζ UMa B shares the anchor's HIP and HD but sits at 14.4″ where
the printed cell is A alone (V 2.23): letting the shared id outrank that
measurement subtracts light the entry never held and dims Mizar Aa 0.274 mag
off `../../validate/known-stars.tsv`.

### Apply

Once per anchor with exact conservation: `own` / `wds_mag` members subtract
their actual flux, guarded against a member as bright as the blend itself
(M_member > M_blend + 0.05, which would zero or invert the residual) or with
no observed magnitude at all — only a structural member can be, since the
fit drops its own participants for that (`companionBlendDimSkipped`); `dmag_imputed`
members re-split the residual,
F_A · (1 + Σ 10^(−0.4·Δ_i)) = F_blend − Σ F_own, which reduces to "anchor
barely dims" for a faint companion and to the equal split at Δ = 0, where a
naive subtraction would gut a near-equal anchor. Counted
`promotion.existing.anchor-dimmed`, one row per anchor. Each candidate's
`AnchorDimVerdict`: left outside by the winning subset, or the whole fit
indecisive within the decisive margin, `companionBlendDimOutside` (36 Oph D
against A+B's blend); no comparison possible — no observed WDS magnitude for
member or anchor, no distance, or more than 16 fitted members —
`companionBlendDimUnfit`; past the tier's blending
scale `companionBlendDimBeyondSeparation`; resolved out by its own Gaia
source `companionBlendDimGaiaResolved`; plus `subtracted` and `re-split` for
the applied ones and `unapplied` for a re-split member the apply could not
use (no Δ, or no residual flux), which no count names. The equal-split blend
pass above stays for the N-way no-WDS-mag case. Standing caveat: WDS pair
magnitudes are taken at face value, and speckle-band (non-V) pairs overstate
a member's V share (Achernar's Δm 1.4 is H-band) — a data-curation tail,
visible in the known-stars notes.

## Reading a record's class back

The re-curation, blend-split and anchor-dim passes re-derive a radius from a
record already held, and take its class from `recordSpectralInfo`: the
display string re-parsed, else the class **as the record's two bytes keep
it** — `decodeSpectralBytes(encodeSpectralBytes(star.spectral))`, which drops
the subclass, the WD index and the Wolf-Rayet kind. That is deliberate and
temporary: reading `star.spectral` itself is the right source, and it moves
the radius of every member whose class the bytes coarsen (a main-sequence
estimate's fractional subclass reads back as not stated), so it lands as its
own behaviour change, `stellata-hooj.36`.
