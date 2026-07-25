# Companion promotion

Promotion of `data/binaries/multiples.tsv` secondaries into first-class
`catalog.bin` records, and the two passes that ride it — the
renderable-companion wings bit and component-letter stamping. This is
the seam where bugs in the binary-system pipeline
(`scripts/binaries/README.md`) become user-visible.

The science of *why* each decomposition rule is what it is lives in
`docs/science-multiple-star-pipeline.md`; this file is the engineering
side — the per-row gate cascade, the field-inheritance contract, and the
counted metrics.

## Files in this area

```
scripts/catalog/companions/
  companion-promotion.ts          promoteCompanions +
    (+ test)                      backfillPrimaryIdentifiers +
                                  stampComponentLetters +
                                  wingRenderablePrimaries. Runs before the
                                  absmag sort so promoted records take the
                                  same final indexing as everything else.
  multi-star-regression.test.ts   Frozen corpus pinning promoted-companion
  multi-star-regression.tsv       records against the built catalog and the
                                  real binaries.bin — catches drift on
                                  either side of the wings correspondence.
```

## Companion promotion from `data/binaries/multiples.tsv`

Before promotion runs, `backfillPrimaryIdentifiers` (same module)
sweeps the pair-primary rows and backfills HIP + Gaia source_id onto
identifier-less catalog records, joined by the TSV's `hd` column —
never by position: the nearest-position record to ξ UMa A is ξ UMa
B's, so a position join would stamp A's identifiers onto B. This is
what makes HD-only AT-HYG systems addressable by `lookupByHip` /
URL refs. Guards: unique HD in the catalog, target record carries no
id of its own, no id duplicated from another record. Counted
`multiplesIdentifierBackfill`.

`companion-promotion.ts` runs BEFORE the absmag sort. It reads the
binaries pipeline output and adds first-class catalog records for
the secondary of every physical pair whose identifier isn't already
in AT-HYG. ~14.2k companions promoted into the current build
(Sirius B, Achird B, Porrima B, Fomalhaut C, Algol Ab, …) — about
a third via real Gaia/HIP keys, two-thirds via synthetic identifiers
(see the identifier gate below).

Per-row gates and resolution:

- **WDS unresolved-compound guard.** Secondary rows whose `comp` letter
  is an unresolved compound aggregate ("BC" / "AB" / "ABC") — every
  character appears as a single-letter comp on a sibling cursor in the
  same WDS root — drop early without promotion. 40 Eri's `A,BC` row
  carries `comp="BC"`, and the WDS root also has resolved `BC` /
  `AC` cursors with single-letter primaries B and C; the relational
  test confirms "BC" is shorthand for the unresolved B+C aggregate and
  not a single star. Promoting it would add a "Keid BC" record at
  ~416 AU from Keid alongside the resolved Keid B and Keid C, double-
  counting the BC pair's light + position.
- **Identifier.** Real-ID resolution (gaia first, then hip)
  attempts to match the row against an existing catalog star;
  skip when it hits a row that ISN'T the system primary
  (alreadyInCatalog). When the row carries no own gaia AND no
  own hip, mint `synth-<wds_id>-<comp>` and proceed —
  `FLAG_BINARY_COMPANION_SYNTHETIC` flags the result. Same path
  fires when the inherited-HIP or inherited-Gaia escapes strip
  the row's ids to null, since the final record has nothing else
  addressable. Algol Aa,Ab + Aa1,2 are the canonical surfacing
  cases. The Gaia escape mirrors the HIP one: Gaia fits one
  source to a blended sub-arcsec pair, so both component rows
  carry the primary's source_id (2090 pairs) — the companion
  strips it rather than colliding with the primary in every
  gaia-keyed lookup, and build-runtime-binaries retries the
  synth key when its id-first resolve degenerates.
- **Cursor-primary anchor.** findExistingPrimary walks gaia →
  hip → proper name (position-guarded, for GJ-only AT-HYG rows
  carrying neither id — ξ UMa A). An unresolvable primary would
  otherwise run its whole cursor anchor-less.
- **Collocated AT-HYG double merge.** When the composed companion
  name matches an existing record sitting bit-identical on the
  anchor (AT-HYG carries both members of a resolved pair at the
  same printed blend coordinates — ξ UMa's "Alula Australis" +
  "Alula Australis B" is the only case in the catalog), that
  record IS the companion: it is repositioned in place (gaia
  backfilled from the row) instead of minting a duplicate.
- **Position.** Prefer the row's own xyz when its astrometry is a
  real per-component fit AND its xyz differs from the primary row's
  xyz. Else apply a sky-tangent projection from the EXISTING catalog
  primary's xyz at the published WDS sep+PA — anchoring on the
  catalog primary (not the multiples.tsv primary row) avoids a
  pipeline-precision gap between AT-HYG's 3-4 sig figs and the
  binaries pipeline's 6 sig figs (Sirius A and B were ~100 AU apart
  for that reason before the fix). Sub-resolution / unmeasured
  pairs (WDS ρ 0.000, or a null sep/pa where WDS reported no
  measurement) have no static placement
  to bake: with a renderable orbit the secondary collocates
  BIT-IDENTICALLY on the anchor — a placement choice for the LOD
  fallback, not a runtime signal. The runtime renders the relative
  offset as R(t) from the orbital elements alone regardless of the
  baked placement (`src/client/binaries/orbit-relation-cache.ts`
  `baseDiffPc`) — and without a placement the row drops
  (droppedNoPosition): nothing would ever separate the records and
  the collocated star double-counts the blend photometry.
- **Projected-separation tidal gate.** A tangent-projected secondary
  sits at the primary's distance, so its projected physical separation
  `ρ·d` is a lower bound on the pair's true 3D separation. When that
  exceeds `OPTICAL_DOUBLE_MIN_SEP_PC = 1.0` pc (the Galactic
  tidal-disruption limit, the same constant the CCDM optical-double
  suppression and the binaries pipeline's Stage-5 `SEPARATION_LIMIT_PC`
  use) no pair can be bound, so the projection is refused
  (droppedBeyondTidalLimit) rather than fabricating a companion at a
  bogus placement. This catches wide line-of-sight optical doubles whose
  secondary has no parallax for Stage 5 to reject — e.g. SHY 476 BC
  (05359+3530), a foreground star 999.5″ from a ~1470 pc primary. Only
  the projection branch consults it; a secondary with its own resolved
  astrometry is vetted upstream by Stage 5.
- **Inner-pair re-homing (post-pass).** An inner pair's cursor primary
  (Castor Ba) can carry the system's blended identifier — a shared Gaia
  source, or a shared HIP Gaia later split — so it resolves onto a
  sibling (Castor A) and the secondary bakes there instead of on its true
  parent component (B). A post-pass re-runs the placement against the
  parent's resolved slot (synth record first, then a per-system
  component→index map for a parent that kept its own Gaia row), covering
  both the ρ=0 collocation and a measured sep+PA re-projection. This makes
  the baked placement match the runtime pair anchor
  (`build-runtime-binaries.py`'s `override_inner_primary_indices`);
  counted by `repositionedInnerToParent`. Rendering is unaffected either
  way (elements-alone R(t)), but a consistent bake keeps the
  baked-vs-elements ratchet in `multi-star-regression.test.ts` honest.
- **Position for pair-row primaries.** When the cursor primary itself
  needs promotion (40 Eri B — primary in BC/BD/BE, never a secondary
  of A), no identifier is required: an id-less row (Rigel B, Acrux B —
  the Stage-2 sibling-identity claims gate strips stolen HIPs) mints an
  addressable `synth-<wds_id>-<comp>` key exactly like an
  identifier-less secondary. The honesty gates are position and
  brightness, not identity; a reappearing previously-retired component
  is reconciled in the SID ledger via `data/sid/reinstatements.tsv`
  (docs/sid.md § 4.3), never by dropping the star. Position resolves
  in preference order: (1) the row's own
  per-component astrometry when Stage 3 supplied a real independent fit
  (own `gaia_5p` / `hip2_long_baseline` whose id differs from the
  anchor's); (2) project the row's Stage-6 `anchor_sep_arcsec` /
  `anchor_pa_deg` off the WDS-root anchor star — the per-component
  offset BFS-composed over kept, Stage-5-rejected, and
  compound-photocentre pair geometry (40 Eri B lands at the A,BC
  compound proxy; Acrux B at the rejected AB row's 3.5″/114°).
  Neither available → **drop** (`droppedCollocatedPrimary`). Collocating
  on the anchor would bake a false coincident star inside the anchor's
  disc (δ Vel C): the escape only fires for cursor primaries that never
  appear as a secondary of the anchor, so no anchor→self orbital pair
  exists for `BinaryOrbitField` to animate it away from centre at
  runtime.
- **Blended-identifier escape.** The pair-row-primary escape fires not
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
  (`docs/science-multiple-star-pipeline.md` § Multiple-star pipeline);
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
  (`companionAbsmagInheritedTwinOrbital`, a ratchet-down
  metric: curate types to shrink it). For a **pair-row-primary
  escape** the row's Δmag describes the sub-pair it heads, not the
  anchor→row separation (40 Eri B's Δmag is the B→C delta), so both
  `primary + Δmag` paths are suppressed; and when the escape row's
  only ids were inherited from the anchor its "own" AT-HYG photometry
  is the anchor's BLEND magnitude, so the own path is skipped too
  (Acrux B takes its WDS V=1.55, not the −4.2 blend). Absent any
  honest brightness the record inherits the anchor's collocated
  brightness (`companionAbsmagAnchorCollocated`) rather than a
  corrupted A+Δmag.
- **Anchor flux conservation (post-pass).** A member whose light is
  embedded in an `athyg_own` anchor's AT-HYG magnitude double-counts
  the flux if minted without dimming the anchor. Membership is decided
  per anchor by a **joint subset solve** over every own-brightness
  member (`dmag_imputed` / `own` / `wds_mag` — identifier-carrying and
  identifier-less synth alike): the hypothesis
  `m(S) = −2.5·log₁₀(F_anchor + Σ_{i∈S} F_i)` over observed-frame WDS
  magnitudes that lands closest to the anchor's observed apparent
  magnitude wins, decisive only when it beats "anchor alone" by
  ≥0.01 mag (hypotheses within 0.01 mag of the best are an equivalence
  class — the smallest subset in it wins, so a negligible-flux member
  never flips the outcome, and Sirius' Δmag≈10 float-noise shape never
  dims). A synth member whose ids were inherited-then-stripped from
  the anchor is structurally in the blend and skips the fit. The joint
  fit is what a pairwise test couldn't do: 36 Oph D cannot claim
  A+B's blend (any subset containing D fits worse than {A,B}), while
  Polaris Ab (inside the 1.98 blend, Δmag 2.0) dims its anchor
  ~0.16 mag. Apply, once per anchor with exact conservation: members
  with independent brightness (`own` / `wds_mag`) subtract their
  actual flux, guarded against a member as bright as the blend itself
  (`blendDimSkipped`); blend-relative members (`dmag_imputed`)
  re-split the residual by Δmag —
  `F_A · (1 + Σ 10^(−0.4Δᵢ)) = F_blend − Σ F_own`, the N-member
  generalisation of `M_A = M_blend + 2.5·log₁₀(1 + 10^(−0.4Δ))`
  (exact for any Δ; a naive subtraction would gut a near-equal
  anchor, Capella −0.51 → +2.1). Counted `blendDimmedAnchors` (per
  anchor); members the fit leaves outside the blend are
  `blendDimMembersOutside`, members with no usable WDS magnitudes are
  `blendDimMembersUnfit`. Caveat: WDS pair magnitudes are taken at
  face value, and speckle-band (non-V) pairs overstate a member's V
  share (Achernar's Δm 1.4 is H-band) — a data-curation tail, visible
  in the known-stars notes. The equal-split gaia_photometry blend pass
  above stays for the N-way no-WDS-mag case.
- **Blend split (post-pass).** A sub-arcsec pair Gaia fit as a single
  5p source with neither component in AT-HYG (YY Gem = Castor Ca,Cb)
  surfaces as ≥2 collocated `gaia_photometry` records — the outer-pair
  row for the source and the inner pair's components — each carrying the
  source's COMBINED `M_V`, so the system renders ~2× too bright. After
  the cursor walk, records are grouped by their backing Gaia source
  (`row.gaiaSourceId`, pre-inherited-id-strip, so an inherited-Gaia synth
  secondary still groups with its blend partner); a source backing N≥2
  gets each record dimmed by `2.5·log₁₀(N)` (0.753 mag for a pair) and
  its radius re-derived. Equal split — a pair Gaia couldn't resolve is
  near-equal by construction, exact for the M-dwarf eclipsing pairs that
  dominate; total system light is preserved. `ci` stays the shared
  colour. Counted `companionBlendSplit`; runs before the absmag sort.
  See `docs/science-multiple-star-pipeline.md` § Multiple-star pipeline
  (Blend split).
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
  `companionSpectMsFromOwnAbsmag` (~12.6k of 14.2k promoted). Rows
  with neither fall back to `SPECTRAL_UNKNOWN`.
- **HIP inheritance gate.** When the row's HIP equals the primary
  row's HIP, set `hip = null` on the promoted record. Hipparcos
  resolved the system as one star and the HIP belongs to the
  brighter component; inheriting it would collide with the
  primary in every HIP-keyed lookup (url-state's `refFromIndex`
  notably).
- **Proper name.** Compose as `<primary_proper> <comp>` —
  "Sirius B", "Achird B", "Porrima B". The secondary's own `name`
  cell wins when populated (source=athyg); the primary row's name
  is the fallback when the secondary's row is source=wds with no
  AT-HYG entry of its own. Two doubling guards strip an already-present
  component letter so the canonical comp isn't appended twice:
  `stripDoubledParentToken` for a base ending in the comp's parent /
  local-primary letter (Castor "C" + "Cb" → "Castor Cb"; AR Cas
  "HIP 115990 F" + "G" → "HIP 115990 G"), and `stripBlendedSiblingLetter`
  when a blended top-level component inherited a SIBLING's composed name
  — Acrab's WDS E shares β² Sco's (WDS C) Gaia source, so E's row name is
  "Acrab B"; a top-level letter composes flat off the system base, so
  "Acrab B" + "E" strips to "Acrab E", not "Acrab B E".

Promoted records carry `FLAG_BINARY_COMPANION_ONLY = 0x08`, and
additionally `FLAG_BINARY_COMPANION_SYNTHETIC = 0x20` when the
record lacks own gaia/hip and is addressed exclusively through a
`synth-<wds_id>-<comp>` key. They're pushed onto `stars` before
the absmag sort so they receive the same final record indexing as
everything else. The post-sort `buildCatalogRowIndexMap` emits
`public/catalog-row-index-map.json` with three sections —
`byGaia`, `byHip`, `bySynth` — which lets the runtime binaries
layer resolve multiples.tsv rows back to catalog.bin records in
that priority order.

The companion-promotion path is the seam where bugs in the
binaries pipeline become user-visible. The Tier A regression
corpus in `known-stars.tsv` pins Sirius B's record specifically
(addressed by gaia_source_id, no HIP) as a stand-in for the
broader category.

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

| Field(s) | Origin | Source |
| --- | --- | --- |
| `conIndex` | inherited | anchor's index — constellations ship no boundary polygons, so a position can't be classified. Rows whose anchor is absent or itself unclassified keep `NO_CONSTELLATION_INDEX`. Counted `companionConstellationInherited`. |
| `vx/vy/vz` | inherited | anchor's systemic velocity — a static companion shears off the primary under the epoch-advance otherwise (`../parse/README.md` § Space-motion velocity, Pair coherence). Truly anchor-less escapes fall back to zero. |
| `x/y/z` | system-derived | anchor ICRS position + WDS (ρ, θ) tangent projection at the anchor's distance. |
| `proper` | system-derived | `<primary_proper> <comp>` (own `name` cell wins when present). |
| `hip`, `gaiaSourceId` | per-component | the row's own id — stripped to `null` (→ `synth-<wds_id>-<comp>`) when it equals the anchor's shared id, per the inheritance gates above. |
| `absmag` | per-component | Stage-5 decomposition / dmag / blend split. |
| `ci` | per-component | own observed B–V, else Ballesteros from the resolved spectral type. |
| `spectClass`, `lumClass`, `spectDisplay` | per-component | SIMBAD/curated type, else a main-sequence estimate from the own M_V. |
| `physicalRadius` | per-component | Stefan-Boltzmann from the per-component absmag + Teff. |
| `flags` | per-component | `FLAG_BINARY_COMPANION_ONLY` (+ `_SYNTHETIC`). |
| `syntheticId` | per-component | `synth-<wds_id>-<comp>` when no own id survives the gates. |
| `companionIdx` | post-pass | set by geometric binary inference (`../multiplicity/README.md` § Geometric binary inference). |
| `period`, `amplitude`, `varType`, `gcvsName` | unset | companion variability isn't tracked at promotion. |
| `hd`, `hr`, `flam`, `bayer`, `gl` | unset | not carried on multiples.tsv rows. |

Position and constellation both flow from the anchor because a
promoted companion sits sub-arcsec off it — well below the catalog's
positional precision — so the pair shares one sky patch. The
per-component fields are precisely the ones the promotion exists to
surface: the companion is a distinct row because its brightness,
colour, and type differ from the blended primary.

### Renderable-companion wings

The three passes below that set `FLAG_BINARY_PRIMARY` (the chart-mode
wings bit) — geometric `inferBinaries`, the CCDM pass, the eclipsing
sweep — are all keyed on evidence that is unaligned with the
*presence of a rendered companion*. A physical pair wider than the
`0.005 pc` geometric cell, not CCDM `C/G/O`, and not eclipsing
(16 Cyg A, whose promoted placement exceeds the geometric cell) shows a
companion or a live orbit with no wings on the anchor.
`wingRenderablePrimaries` (run after those three passes, over the
post-sort `buildCatalogRowIndexMap`) closes that gap:

- **Renders-a-companion gate.** For each non-standalone
  multiples.tsv pair, primary and secondary resolve to catalog records
  through the same `gaia → hip → synth` priority
  `build-runtime-binaries.py`'s `resolve_idx` uses, plus both of that
  writer's blended-sibling synth retries: each pair end re-homes onto
  its own distinct synth slot whenever promotion minted one (a synth
  slot exists only for rows whose ids were inherited then stripped,
  so it is always the truer target — Castor Ca inside the outer pair,
  04049-3527's pair-mate-inherited C). A pair whose two sides resolve
  to DISTINCT records
  renders a companion, so the winged set tracks `binaries.bin`'s
  primaries. The writer's post-resolution steps
  (`override_inner_primary_indices`, the relation-winner dedup) are not
  replicated: they change *which* index anchors a pair, never the
  distinct-pair boolean this gate keys on, and root-grouping plus the
  brightest-participant pick below absorb the difference. The
  correspondence is pinned against the real `binaries.bin` by
  `multi-star-regression.test.ts` (every rendered system carries the
  wings bit), which catches drift on either side.
- **One glyph per WDS system.** Records participating in a rendered
  pair are grouped by WDS root; the bit lands on the brightest
  participant only (the mutual-primary / CCDM brightest-member
  contract). A hierarchical system (Castor Ca,Cb inside the outer
  pairs) gets one glyph on the system anchor, never one per inner
  pair. A system any earlier pass already flagged is skipped, so it
  keeps its single glyph.
- **Additive only.** The pass never clears wings, so the
  reverse-direction cases stay correct: eclipsing binaries (an
  eclipsed star is a binary by convention even with a
  spectroscopically-unresolved companion) and iconic CCDM / Hipparcos
  doubles whose faint secondary isn't in the classic-IDs catalog
  (ν³ CMa = HDS 915, the Sirius-B pattern) keep their wings whether or
  not a second star renders.

`renderableCompanionWinged` in build-counts pins the count.

### Component-letter stamping

`stampComponentLetters` runs immediately after `promoteCompanions`
(over the same grouped `multiples.tsv` rows `promoteCompanions`
returns), before the absmag sort and the name-table / search-index
write. Promotion only ADDS records; when BOTH halves of a pair
already exist as first-class AT-HYG rows AND neither carries a
`proper` name, they render with identical Bayer/Flamsteed labels and
are individually unsearchable (61 Cyg A and 61 Cyg B both print
"61 Cyg"). For each system where ≥2 **distinct** first-class
(non-promoted) AT-HYG records resolve and none is already named, the
pass writes `<base> <comp>` into each record's `proper` (base via
`resolveCompanionNameBase`) and sets `FLAG_HAS_NAME`. Components are
deduped by record index: a blended single entry whose rows share one
identifier (no own gaia + shared HIP) resolves to one record and is
skipped — it is one star, not two components, and must not be
mislabelled as its faint secondary. It also **skips** any system
where a component already carries a real `proper` (never rename
Sirius A → "Sirius A") or where the primary yields no usable base.
`componentLettersStamped` counts the records renamed.
