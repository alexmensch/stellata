# Promotion placement

Where companion promotion (`../README.md`) puts a component: its own
per-component fit, else a WDS (ρ, θ) projection off its anchor record. The
walk asks; nothing here writes a record.

## Files in this area

```
scripts/catalog/companions/placement/
  placement.ts (+ test)         resolvePosition (a secondary), resolveEscapePosition
                                (a pair-row-primary escape), projectFromSepPa and
                                the tidal gate.
  anchor-offset-pure.ts (+ test) parseStage6Offset (the anchor columns' parse
                                boundary) and rebasedAnchorOffset (#re-basing-a-stage-6-offset).
                                Offsets convert through astro-core's
                                polarToTangent / tangentToPolar, the pair
                                Stage 6 writes them with.
```

## Position

Prefer the row's own xyz when its astrometry is a real per-component fit —
Stage 3's `gaia_5p` with its own Gaia source or `hip2_long_baseline` with its
own HIP, neither shared with the anchor primary (`hasIndependentFitRoute`).
Every other route reproduces the SYSTEM anchor under a different float path,
and float residue ranges from µpc (Algol Aa↔Ab) to tens of AU (Polaris
Aa↔Ab), so the route tag, not xyz equality, is the signal. Else project from
the EXISTING catalog primary's xyz at the published WDS sep+PA — anchoring on
the catalog record, not the multiples.tsv primary row, avoids the precision
gap between AT-HYG's 3–4 significant figures and the binaries pipeline's 6
(Sirius A and B ~100 AU apart). Sub-resolution / unmeasured pairs (WDS ρ
0.000, or a null sep/pa) have no static placement to bake: with a renderable
orbit the secondary collocates BIT-IDENTICALLY on the anchor — a placement
choice for the LOD fallback, not a runtime signal, since the runtime renders
the offset as R(t) from the elements alone
(`src/client/binaries/orbit-relation-cache.ts` `baseDiffPc`) — and without
one the row drops (`promotion.dropped.no-position`): nothing would ever
separate the records and the collocated star double-counts the blend
photometry.

## Projected-separation tidal gate

A tangent-projected secondary sits at the primary's distance, so its
projected physical separation `ρ·d` is a lower bound on the pair's true 3D
separation. When that exceeds `OPTICAL_DOUBLE_MIN_SEP_PC = 1.0` pc (the
Galactic tidal-disruption limit, the same constant the CCDM optical-double
suppression and the binaries pipeline's Stage-5 `SEPARATION_LIMIT_PC` use) no
pair can be bound, so the projection is refused
(`promotion.dropped.beyond-tidal-limit`) rather than fabricating a companion
at a bogus placement. This catches wide line-of-sight optical doubles whose
secondary has no parallax for Stage 5 to reject — e.g. SHY 476 BC
(05359+3530), a foreground star 999.5″ from a ~1470 pc primary. Only the
projection branch consults it; a secondary with its own resolved astrometry
is vetted upstream by Stage 5.

## Position for pair-row primaries

When the cursor primary itself needs promotion (40 Eri B — primary in
BC/BD/BE, never a secondary of A), no identifier is required: an id-less row
(Rigel B, Acrux B — the Stage-2 sibling-identity claims gate strips stolen
HIPs) mints an addressable `synth-<wds_id>-<comp>` key exactly like an
identifier-less secondary. The honesty gates are position and brightness,
not identity; a reappearing previously-retired component is reconciled in
the SID ledger by a `reinstate` event in `data/sid/events.tsv`
([§ 4.3](/docs/sid.md#43-ledger--datasidledgertsv)), never by dropping the
star. `resolveEscapePosition` resolves in preference order: (1) the row's
own per-component astrometry, as above; (2) the row's Stage-6
`anchor_sep_arcsec` / `anchor_pa_deg` projected off the WDS-root anchor
star, re-based onto it (below) — the per-component offset BFS-composed over
kept, Stage-5-rejected, and compound-photocentre pair geometry (40 Eri B
lands at the A,BC compound proxy; Acrux B at the rejected AB row's
3.5″/114°). Neither available → **drop**
(`promotion.dropped.collocated-primary`). Collocating on the anchor would
bake a false coincident star inside the anchor's disc (δ Vel C): the escape
only fires for cursor primaries that never appear as a secondary of the
anchor, so no anchor→self orbital pair exists for `BinaryOrbitField` to
animate it away from centre at runtime.

## Re-basing a Stage 6 offset

Only cursor primaries `findExistingPrimary` resolves compete for the root
anchor ([The system index](../identity/README.md#the-system-index)), while
Stage 6 chains `anchor_sep_arcsec` / `anchor_pa_deg` from the top kept
primary whatever its identifiers, and names that letter in `anchor_comp`. So
every read of a Stage 6 offset goes through `rebasedAnchorOffset`, which
subtracts the promotion anchor's own offset from the row's — or refuses,
leaving the row offset-less, when Stage 6 reached either from no measured
geometry or the two coincide. It also refuses the chaining letter's own row:
that letter outranks every resolvable primary, so it reaches promotion only
with no identifier bound, and the catalogue usually holds its star unlinked —
placing it would mint a twin of that record.
