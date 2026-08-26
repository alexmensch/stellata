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
                                  resolveComponentNameCollisions. Runs
                                  before the absmag sort so promoted records
                                  take the same final indexing as
                                  everything else.
  multiples-fixture.ts            Default-valued MultiplesTsvRow factory.
                                  A module, NOT an export from
                                  companion-promotion.test.ts: importing one
                                  test file from another re-executes every
                                  describe in it, so this suite silently ran
                                  a second time inside the multiplicity and
                                  record-index suites.
  multi-star-regression.test.ts   Frozen corpus pinning promoted-companion
  multi-star-regression.tsv       records against the built catalog and the
                                  real binaries.bin — catches drift on
                                  either side of the wings correspondence.
  record-index/                   Post-sort record addressing: the row-index
                                  sidecar, the wings bit, component
                                  designations. Downstream of promotion,
                                  never read by it.
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
in AT-HYG. ~16.4k companions promoted into the current build
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
  embedded in an `athyg_own` anchor's record magnitude double-counts the flux
  if minted without dimming the anchor. **Which members CAN be in there is set
  by the catalogue the anchor's V came from, not by identifiers.** A printed
  tier publishes one magnitude per catalogue entry, so every member sharing the
  entry is inside it; a `gaia_riello` V resolves per source, so a member Gaia
  handed its OWN source_id is separated by measurement and cannot be in the
  anchor's G (`blendDimGaiaResolved` — HD 153557's B at 5″, σ Ori's E at 42″,
  both of which the fit alone would have dimmed). `vTierIsSystemBlend` owns
  that split (`../photometry/README.md` § Which tiers give a system blend).
  Every remaining own-brightness member (`dmag_imputed` / `own` / `wds_mag`) is
  decided per anchor by a **joint subset solve** — derivation, margin rationale
  and worked examples in `docs/science-multiple-star-pipeline.md` § Blend light
  conservation. The engineering invariants it rests on, each easy to get wrong:

  - **Observed magnitude** comes from the anchor's own `absmag` at its own
    `|xyz|`, never a multiples.tsv `dist_pc` — that can predate a distance
    override the record took (HD 64315: 12.7 kpc vs 6.2) or a coherence
    reposition (σ Ori 328.9 → 399.8 pc), both safe here because coherence moves
    records at fixed apparent brightness.
  - **"Anchor alone"** is the `mag_pri` of the anchor's DEEPEST row, and is also
    the Δ reference for every `dmag_imputed` member. `componentDepth` ranks the
    letter, NOT its length: a compound is an unresolved aggregate and scores 0,
    BELOW a single letter, because η CrB's `AB,E` row prints the A+B aggregate
    and reading it as deeper than `A` makes the blend the anchor's own light.
    The test is two designators at ONE level (`AB`, `Aab`, `Aa12`), never "two
    capitals". Ties break brightest.
  - **Registration** reads the ANCHOR RECORD's `vVia`, never a multiples.tsv
    `photometry_via` cell: those freeze at the build that wrote the TSV and went
    stale under the driver swap (ξ UMa's AB row says `none` while the record
    carries a printed `I/239` blend — the exact population needing the dim).
  - **Members already in the catalog are candidates too**, not only minted ones,
    or an anchor on a printed blend tier keeps the pair's combined light. They
    enter as `own` — flux subtraction against the record's own measurement,
    never the Δmag re-split, which would overwrite a first-class record's
    brightness — deduped per `(anchor, member)`, since every cursor pairing the
    two arrives at the same registration.
  - **Conservation is observed-frame.** A member's flux leaves at the apparent
    magnitude the observer sees and the residual converts back at the anchor's
    own distance. Identical arithmetic for a minted member (tangent projection
    puts it at the anchor's distance), not for an already-in-catalog one.
  - **The fit and the subtraction share ONE member magnitude** (`obsMag`). An
    independent-brightness member ships its own record, so the hypothesis is
    built from the light that record contributes, not the pair's WDS `mag_sec` —
    HD 75632 B's Gaia photometry is 0.47 mag off `mag_sec` 9.10, so judging
    `{B}` on one and subtracting the other put the emitted absmag outside the
    residual gate that had just certified it. Only `dmag_imputed` members use
    the WDS frame, having no independent measurement to use instead.
  - **Closest is not close.** The decisive margin ranks hypotheses against each
    other and says nothing about whether any is right, so
    `ANCHOR_DIM_MAX_FIT_RESIDUAL_MAG` = 0.2 refuses a fit whose WINNER still
    misses the anchor's observed magnitude by more than the input's own error
    scale (`blendDimMembersMisfit`). Scoped to the fit's verdict, so members
    that never entered the fit — a printed tier's structural ones — still apply.
  - **The separation gate.** Identity evidence answers "is this member inside
    the entry" only where the catalogue published an identifier for it; past
    that, photometry alone cannot tell a sub-arcsec photocentre from a companion
    525″ off. `PRINTED_BLEND_MAX_SEP_ARCSEC` = 10″ and
    `GAIA_BLEND_MAX_SEP_ARCSEC` = 1″, both calibrated. A pair WDS published no
    separation for is EXCLUDED — no measurement is no evidence of blending
    (AU Mic AB). Structural members skip the bound in BOTH tiers — ids inherited
    from the anchor are evidence about THIS pair and outrank a population
    threshold — which is not the same as bypassing the fit, and 350 Gaia-tier
    candidates turn on the difference.

  Apply, once per anchor with exact conservation: `own` / `wds_mag` members
  subtract their actual flux, guarded against a member as bright as the blend
  itself (`blendDimSkipped`); `dmag_imputed` members re-split the residual by
  Δmag. Counted `blendDimmedAnchors` per anchor; members the fit leaves outside
  are `blendDimMembersOutside`, with no usable WDS magnitudes
  `blendDimMembersUnfit`, past the tier's blending scale
  `blendDimMembersBeyondSeparation`, resolved out by their own Gaia source
  `blendDimGaiaResolved`. The equal-split `gaia_photometry` blend pass above
  stays for the N-way no-WDS-mag case. Standing caveat: WDS pair magnitudes are
  taken at face value, and speckle-band (non-V) pairs overstate a member's V
  share (Achernar's Δm 1.4 is H-band) — a data-curation tail, visible in the
  known-stars notes.
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
  `companionSpectMsFromOwnAbsmag` (~14.5k of 16.4k promoted). Rows
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
  when a blended component inherited a SIBLING's composed name
  — Acrab's WDS E shares β² Sco's (WDS C) Gaia source, so E's row name is
  "Acrab B"; the canonical comp encodes the full path from the root, so
  "Acrab B" + "E" strips to "Acrab E", not "Acrab B E". Sub-letters need
  the sibling guard as well as the parent-token one: Eb's parent token is
  "E", so nothing matched the inherited " B" and the name composed as
  "Acrab B Eb".

Promoted records carry `FLAG_BINARY_COMPANION_ONLY = 0x08`, and
additionally `FLAG_BINARY_COMPANION_SYNTHETIC = 0x20` when the
record lacks own gaia/hip and is addressed exclusively through a
`synth-<wds_id>-<comp>` key. They're pushed onto `stars` before
the absmag sort so they receive the same final record indexing as
everything else. Addressing those records afterwards — the
`byGaia` / `byHip` / `bySynth` sidecar, the chart-mode wings bit, and the
component-letter search designations — is `record-index/README.md`;
nothing in this file reads back from it.

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
| `conIndex` | per-component | the IAU boundary region the minted position falls in (`../parse/README.md` § Positional constellation membership) — so a pair wide enough to straddle a boundary lands its members on the correct sides, and an anchor-less row still resolves. Counted `companionConstellationSplitFromAnchor` where it differs from the anchor's. |
| `desigConIndex` | inherited | anchor's designation index — a composed name ("Xi Boo B") is named for whatever the primary's designation is. Sourced from IV/27A keyed on the anchor's HD/HIP, so a boundary-straddling companion composes against the primary's designation (Fomalhaut C is "α PsA C" though it sits in Aquarius) rather than its own positional index (`../classic-ids/README.md` § The designation constellation). |
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
| `hd`, `hr`, `flam`, `bayer`, `gl`, `tyc` | unset | not carried on multiples.tsv rows. |

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

### Display-name uniqueness

`resolveComponentNameCollisions` is the last naming pass. Two schemes
meet in a WDS system: ours composes `<system base> <WDS comp>`, while
AT-HYG's `proper` column carries its own component labels for 9 of its
495 names (`Acrab B`, `Albireo B`, `Alula Australis B`, `Cor Caroli B`,
`Revati B`, `Alkalurops B`, `Marsic B`, `Dziban B`, `Alya B`). Where the
two letter one system differently they collide: β² Sco is AT-HYG's
"Acrab B" but WDS component **C**, so it landed on the same name as the
WDS-B companion promotion mints and a focus card listed "Acrab B" twice.

Precedence: the claimant whose `proper` already equals its own letter
composition keeps the name; every other claimant is recomposed from its
own comp ("Acrab B" on the C component → "Acrab C"). Deterministic — no
per-system curation — and a synth slot is consulted before the id
indexes when attributing a record to a letter, since a row whose ids were
inherited then stripped would otherwise resolve onto the anchor's own
record. Counted `componentNameCollisionsResolved`;
`componentNameCollisionsUnresolved` ratchets down (nonzero means both
claimants own their letter, so one letter is wrong upstream).

Two collision shapes this pass deliberately cannot reach, both pinned by
`KNOWN_DUPLICATE_DISPLAY_NAMES` in `multi-star-regression.test.ts`:
**cross-root within one physical system** (WDS splits the Trapezium
across `05353-0523` / `05353-0524` / `05354-0525`, so two distinct stars
are each their own root's "Cb" and compose the identical name), and
**AT-HYG naming two records alike** (`p Eridani` on both components).
Both need a naming-authority ladder rather than a letter swap — the same
work that owns the 536 display names composed off AT-HYG's ASCII-only
`bayer` column (`The-1 Ori C` where an astronomer reads θ¹ Ori C).
