# Multiplicity and double-star cross-matching

Which catalog records are flagged as multiple, how geometric pairs are
inferred, the CCDM double-star cross-match and its optical-double
suppression cascade, and the system distance-coherence pass.

Promotion of companion records into the catalog is a sibling concern —
see `../companions/README.md`.

## Files in this area

```
scripts/catalog/multiplicity/
  visual-doubles.ts (+ test)      inferBinaries (geometric pair cells) +
                                  the CCDM cross-match and the tiered
                                  optical-double suppression cascade.
  system-coherence.ts (+ test)    Post-pass forcing one distance per
                                  physical system, so a pair never
                                  straddles two distance layers.
```

## Multiplicity status

Each record's `multiplicity_status` byte (offset 96) classifies its
known multiplicity so the hover/info surface can say "this is a
binary" even when no companion renders:

- **`MULTIPLICITY_RESOLVED` (1)** — a resolved multiples.tsv member
  row backs the record. The set comes from the same
  `resolvePairComponents` walk the wings pass runs
  (`wingRenderablePrimaries` returns it), so it tracks the records the
  binaries pipeline actually addresses — primaries AND promoted
  companions alike (~20.9k records).
- **`MULTIPLICITY_UNRESOLVED` (2)** — SIMBAD flags the star as a
  multiple (`otype = '**'` in `data/simbad/simbad_sptype.tsv`, keyed by
  Gaia source_id) but nothing resolves: the spectroscopic-binary
  population invisible to WDS/CCDM/NSS. 64 Vir (HIP 65241, classical
  Am star — the class is ~75% short-period SBs) is the canonical pin
  (~4.4k records).
- **`MULTIPLICITY_SINGLE` (0)** — neither signal; the default.

Counted `multiplicityResolved` / `multiplicityUnresolved` in
build-counts; pinned per-star in `known-stars.test.ts`. The runtime
loader exposes `Catalog.multiplicityStatus` (Uint8Array); the hover
surface consuming it is tracked separately (stellata-lo5.10).

## Geometric binary inference

`inferBinaries` in `build-catalog.ts` runs after the absmag sort so record
indices are final. Spatial grid keyed at `BINARY_MAX_SEP_PC = 0.005 pc`
(≈1030 AU) using a three-axis hash; for each star, check own cell + 26
neighbours and record the nearest neighbour within the threshold.

Why this threshold: at the current `minDistance = 0.005 pc` orbit,
anything farther than that subtends >45° from the camera — it wouldn't
fit the viewport as a visual "system", which is what the render layer
wants. Wider bound pairs exist in the catalog but won't render usefully.

What you'll see from the classic_ids subset: ~14 pairs. Feels low but is
accurate. The subset selects stars with classical designations, and most
"wide binary" companions in physically-bound pairs don't have their own
classical ID — the brighter primary does. The pairs we do find are
almost all famous named visual binaries (α Cen A/B, Alula Australis,
Struve 2398, etc.). Reaching thousands of pairs would require the fuller
`reduced_m10` subset, which has a different selection profile.

Each star records its **directed** nearest in `companionIdx`: A's
nearest may be B while B's nearest is some third star C. The
relation is one-way. The renderer reads this as "the partner to keep
in frame" (zoom-fit, disc-mask), which is well-defined even when
asymmetric.

Flag bit 4 (`0x10`) is stricter: set only on the **brighter member of
a mutual pair** — A↔B where each is the other's directed nearest.
Mutual-only avoids over-flagging in dense clusters where a star's
directed nearest happens to be a third star already paired with
someone else, and ensures the chart-mode wings glyph appears once
per system on the canonical anchor.

## CCDM double-star cross-match

Visual binaries get the same `flags` bit 4 the geometric pass uses, so
chart mode renders wings on either source with no renderer-side
changes. The geometric pass alone yields ~14 pairs (the only AT-HYG
rows where both components survive the classic-IDs cut); the CCDM
pass pulls in everything else where the primary has a HIP — Sirius,
Mizar, Castor, α Cen, Polaris, Albireo, γ And, ε Lyr, etc.

`parseHipCcdm` in `build-catalog.ts` reads `data/hipparcos/hip_ccdm.tsv`, a
three-column slice of the **Hipparcos main catalogue** (VizieR
`I/239/hip_main`). The `CCDM` column on each Hipparcos row carries
the cross-reference into the Catalog of the Components of Double
and Multiple stars (Dommanget & Nys 1994), the curated pre-WDS
register of visual doubles. CCDM alone is too permissive — it
lumps physical pairs together with wide line-of-sight optical
pairs that happen to land near each other on the sky, so flagging
on `CCDM != ""` alone tags Vega, Pollux, and ~19k other stars
including a substantial optical-pair tail.

To gate optical pairs out, we additionally filter on Hipparcos's
own `MultFlag` (H59) column:

| `MultFlag` | Meaning                                | Action |
|------------|----------------------------------------|--------|
| `C`        | Component star in a Hipparcos system   | keep   |
| `G`        | Double resolved within Hipparcos field | keep   |
| `O`        | Orbit known (spectroscopic / astrom.)  | keep   |
| blank      | CCDM listed but Hipparcos didn't model | drop   |
| `V`        | Variability-induced double             | drop   |
| `X`        | Stochastic, low confidence             | drop   |

This drops the bulk of optical pairs while preserving every
binary Hipparcos itself confirmed.

A handful of canonical visual doubles fall through the gate
because Hipparcos modelled them as single stars (`Ncomp=1`,
blank `MultFlag`) — typically wide pairs where the secondary is
faint or angularly outside what Hipparcos resolved.
**`KNOWN_VISUAL_DOUBLES`** in `build-catalog.ts` recovers them
unconditionally. The structure is a list of `{components, reason}`
systems — each entry is one physical system whose `components`
array is the HIPs known to belong to it (one or more) plus a
human-readable justification. The same primary-only flagging that
applies to real CCDM groups applies here, so 61 Cyg A and B share
one entry rather than two and only the brighter (A) gets the
wings glyph. Current list: Polaris (sep 18″ Polaris B), ε¹ Lyr
(inner pair 2.4″), 61 Cyg A+B (the famous nearby K-dwarf pair).
Visual review of new chart-mode renders may surface more — extend
conservatively.

Why this and not TDSC or WDS directly:

- **TDSC** (Fabricius et al. 2002) is built from Tycho-2, which
  saturates on the brightest stars (V ≲ 3) — Sirius, Mizar, Castor,
  α Cen, Polaris are all *missing* from TDSC. CCDM has no such gap.
- **WDS** itself doesn't carry HIP. Doing positional matching
  ourselves would invite false positives in dense fields. CCDM
  side-steps that by giving us the HIP↔system mapping pre-built.

The file is a VizieR TSV fetched once from
`vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/239/hip_main&-out=HIP,CCDM,MultFlag&-out.max=unlimited`
and committed via Git LFS. The parser tolerates VizieR's preamble
(`#` comment lines, header row, dash-separator row). Required
columns are the literal labels `HIP`, `CCDM`, and `MultFlag`; if a
future fetch renames them the build fails with a clear message
naming the actual header that was read.

No separation gate at the per-row level (CCDM and Hipparcos's
`rho` column are both inconsistently populated). The chart-mode
wings glyph is iconic rather than a depiction of resolved pair
geometry, so even Sirius B at ΔV ≈ 10 earns wings on Sirius A.

### Optical-double suppression

CCDM+MultFlag=C/G/O still keeps a tail of wide line-of-sight
optical pairs Gaia can now split in 3D — HIP pairs sharing one
CCDM identifier that sit hundreds of pc apart along the sightline.
Flagging their brightest member paints wings on a star with no
bound companion. `isOpticalDoublePrimary` (`catalog-pure.ts`)
vetoes that flag, but only on **positive** evidence the asserted
pair is optical, never on mere absence of physical evidence — so a
noisy parallax can never strip real wings:

- **Physical-evidence keep.** The picked primary keeps its wings
  when it is a component of a kept physical pair in
  `data/binaries/multiples.tsv` (the binaries pipeline's Stage-5
  optical filter already vetted it as bound — the `physicalHips` /
  `physicalGaia` sets), when it is eclipsing (extrinsic wings
  earned), or when the geometric mutual-pair pass already winged it
  (honoured upstream by `markPrimaryIfUnflagged`'s already-flagged
  short-circuit). The curated `KNOWN_VISUAL_DOUBLES` HIPs are folded
  into `physicalHips` so they are never suppressed. This is the gate
  that keeps η Cas (Achird A, its real A/B pair) and β¹ Cyg
  (Albireo, its resolved Aa/Ac inner pair) winged even though each
  CCDM group also holds a wide optical sibling.
- **Optical suppress.** Otherwise the nearest same-group catalog
  sibling with a Gaia-quality distance is measured in 3D; a
  separation beyond `OPTICAL_DOUBLE_MIN_SEP_PC = 1.0` pc (the
  Galactic tidal-disruption limit, mirroring the binaries
  pipeline's Stage-5 `SEPARATION_LIMIT_PC`) marks it optical and
  drops the wings. Both the primary and the sibling must carry a
  Gaia-quality distance (`isGaiaQualityDist` — same dist_src set as
  B-J eligibility, {G_R3, G_R2} → G_R3/BJ final) for the separation
  to be trusted; absent that, the wings stand. Nearest-sibling means
  a physically-close catalog member keeps the wings regardless of a
  wide background star that merely shares the CCDM string — the
  failure mode that made a naive "3D-separation over full CCDM
  membership" test regress η Cas. Counted `ccdmSuppressedOptical`
  (~487 of the ~11k flagged primaries; median suppressed separation
  ~54 pc).

`parseHipCcdm` returns systems grouped by `CCDM_ID` (real CCDM
strings for file-driven entries, synthetic `OVERRIDE-N` keys for
the `KNOWN_VISUAL_DOUBLES` list). `applyDoublesFlag` then walks
each group, picks the **brightest** catalog member (lowest
`absmag`), and — unless the optical-double gate above vetoes it —
ORs `0x10` onto only that one, so each Hipparcos-resolved system
contributes exactly one chart-mode wings glyph, matching the
geometric pass's mutual-primary semantics. Stars that
are CCDM secondaries do not get the bit; they remain in the
catalog with their other flags intact. No `companionIdx` write —
the secondary often isn't in the AT-HYG classic_ids subset, and
the renderer's zoom-fit code at `stellata.ts` already guards on
`companion ≥ 0`, so a flagged-but-unpaired primary is fine.

If the CCDM file is absent the build logs and continues — the
geometric pass still runs and chart mode still works, just with the
~14-pair coverage.

## System distance coherence

`system-coherence.ts` (`applySystemDistanceCoherence`) runs after the
HD identifier backfill and **before companion promotion**, over the
kept-physical pair rows of `multiples.tsv`. Two members of a bound WDS
system carry independently-measured catalog distances whose noise
scatter (a fraction of a parsec at ~50 pc) dwarfs the pair's true
physical size (hundreds of AU), so without this pass the pair renders
visibly split along the sightline from any nearby vantage — the
camera-anywhere failure the single-star distance stack can't see.

Per WDS root with ≥2 resolved own-record members:

- **Anchor pick — purpose-aware, not recency-aware.** Best tier wins:
  clean unsaturated Gaia 5p (`isCoherenceAnchorGrade` — parallax > 0,
  RUWE ≤ 1.4, ipd_frac_multi_peak ≤ 2 **percent**, the column being
  0–100 here unlike direction-cascade's fraction-scale threshold, and
  G ≥ 3.0), then HIP2 coverage, then Bailer-Jones membership, then
  inherited. That predicate is exported: the parallax cascade's
  `pair_member_parallax` tier lends the same grade of fit to a member
  Gaia fitted no parallax for at all, one pass earlier
  (`../distance/parallax/README.md`). Two mechanisms doing their own
  job — the tier decides where a member ships, this pass then snaps it
  onto the anchor RECORD's distance for intra-system consistency. HIP2's long baseline beats Gaia exactly where Gaia is
  saturated or binarity-corrupted (Acrux). A member hosting its own
  sub-pair (Acrux C = Ca,Cb) never takes the clean-Gaia tier —
  photocentre wobble on periods beyond Gaia's baseline corrupts the 5p
  parallax without tripping RUWE. Ties break pair-primary first, then
  the WDS-canonical letter.
- **Anchor placement-consistency gate.** A picked anchor whose rendered
  catalog distance contradicts its own best parallax — by >3σ AND >20%
  of the anchor distance — poisons the whole system, so the system is
  skipped and members keep their own distances. μ¹ Sco is the case: its
  RUWE-corrupted Gaia parallax (1.87 ± 0.74 mas) gets a Bailer-Jones
  placement at 1685.7 pc while HIP2 measures ~154 pc; without this gate
  the corrupted parallax's huge σ made μ² Sco's honest 176.6 pc read as
  a <3σ gap and dragged it out to 1.7 kpc. Counted
  `systemCoherenceAnchorInconsistent`. (The μ¹ Sco record's own B-J
  placement is a separate open defect.)
- **Radial snap with a significance gate.** Every other member moves
  radially to the anchor's distance (direction preserved — it is
  mas-accurate regardless of parallax quality) UNLESS its own parallax
  gap from the anchor is significant at ≥3σ of the combined parallax
  error (`COHERENCE_RADIAL_SIGMA`, mirroring Stage 5's
  `RADIAL_SEPARATION_SIGMA`) — genuinely measured depth
  (α Cen–Proxima, 61 Cyg A/B) survives. Members with no error model
  snap only across gaps within 20% of the anchor distance (1 pc floor
  for nearby systems); a wider gap is a genuine catalog disagreement
  and the member keeps its own distance.
- **Brightness invariance.** A repositioned member's absmag shifts by
  `5·log₁₀(d_old/d_new)` and its Stefan-Boltzmann radius follows
  (R ∝ √L at fixed Teff), so apparent brightness doesn't change.

Running before promotion means minted companions tangent-project off
already-coherent anchors, and the baked pair geometry in catalog.bin
matches what `binaries.bin` renders. Pinned in build-counts as
`systemCoherenceSystems` / `systemCoherenceRepositioned` /
`systemCoherenceMemberAnchorWins` /
`systemCoherenceSignificantDepthKept`.
`docs/science-multiple-star-pipeline.md` § Multiple-star pipeline
carries the science framing.
