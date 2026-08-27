// Pure helpers for the build-catalog count assertion — diff a
// BuildCounts record against the committed snapshot. See
// scripts/catalog/README.md § Validation harness.
import { DIST_SRC_BUCKETS, type DistSrcPartition } from './catalog-pure';
import type { RvErrorBandPartition } from './distance/radial-velocity/radial-velocity';
import type { LabelMergeCounts } from './classic-ids/label-merge-pure';

/** Repo-relative path of the snapshot `BuildCounts` is pinned against, so the
 *  build and every consumer that reads the shipped figures back resolve one
 *  path. The generic comparator below is reused with other snapshots. */
export const BUILD_COUNTS_EXPECTED_FILE = 'scripts/catalog/build-catalog-expected.json';

/** Extends the label merge's own partitions rather than restating them: the
 *  merge module owns what those counts mean, and `build:classic-ids` pins the
 *  same set from the spine side — the two snapshots agreeing is what proves the
 *  committed review queue describes the shipped labels. */
export interface BuildCounts extends LabelMergeCounts {
  /** Records written to catalog.bin after filtering and sort. */
  recordCount: number;
  /** `inferBinaries` companion assignments. */
  binaryPairs: number;
  /** Pairs where both stars chose each other (sets FLAG_BINARY_PRIMARY). */
  binaryMutualPairs: number;
  /** Entries in the GCVS main table at source. */
  gcvsEntries: number;
  /** GCVS cross-reference Hipparcos lookups. */
  gcvsHipXrefs: number;
  /** GCVS cross-reference Henry Draper lookups. */
  gcvsHdXrefs: number;
  /** GCVS xrefs bridged from byHip via gaia_dr3_hip_xmatch.tsv onto
   *  gaia_source_id as primary key. */
  gcvsGaiaXrefs: number;
  /** Variables matched into the catalog after cross-reference resolution. */
  gcvsMatched: number;
  /** gcvsMatched component resolved via xref.byGaia (gaia_source_id). */
  gcvsMatchedByGaia: number;
  /** gcvsMatched component resolved via xref.byHip (HIP fallback). */
  gcvsMatchedByHip: number;
  /** gcvsMatched component resolved via xref.byHd (HD fallback). */
  gcvsMatchedByHd: number;
  /** Stars given a searchable GCVS designation (`gcvsName`) — superset of
   *  gcvsMatched: aperiodic variables (flare/RCB/irregular/nova) are named
   *  for search but carry no renderable period. */
  gcvsNamed: number;
  /** Total CCDM systems in the source TSV. */
  ccdmGroups: number;
  /** CCDM systems resolved against catalog records. */
  ccdmResolved: number;
  /** New FLAG_BINARY_PRIMARY bits set by the CCDM pass (excludes ones
   *  already set by `inferBinaries`). */
  ccdmFlagged: number;
  /** CCDM primaries the optical-double gate vetoed: nearest same-group
   *  sibling >1 pc away in 3D at Gaia-quality distances, with no physical
   *  pair / eclipsing / geometric evidence. See isOpticalDoublePrimary. */
  ccdmSuppressedOptical: number;
  /** FLAG_BINARY_PRIMARY bits newly set by the eclipsing-binary pass:
   *  varType == ECLIPSING records not already flagged by the geometric
   *  or CCDM passes. */
  eclipsingWinged: number;
  /** FLAG_BINARY_PRIMARY bits newly set by the renderable-companion pass:
   *  physical systems whose primary/secondary resolve to distinct catalog
   *  records (a promoted companion or a binaries.bin orbit) but which the
   *  geometric, CCDM, and eclipsing passes all left unflagged. One per WDS
   *  system anchor; excludes systems already flagged. Canopus, 16 Cyg A. */
  renderableCompanionWinged: number;
  /** Records backed by a resolved multiples.tsv member row —
   *  multiplicityStatus = MULTIPLICITY_RESOLVED. */
  multiplicityResolved: number;
  /** Records SIMBAD flags as multiple (otype '**') with no resolved
   *  multiples.tsv member row — multiplicityStatus =
   *  MULTIPLICITY_UNRESOLVED (spectroscopic binaries, 64 Vir class). */
  multiplicityUnresolved: number;
  /** Spine rows `readStars` dropped, per gate. **All five must stay 0.** Each
   *  row cleared every one of them in the build the spine snapshots, so a
   *  non-zero entry is the spine disagreeing with a reference table that has
   *  moved under it — a refreshed Bailer-Jones or LMC input pushing a row past
   *  MAX_DIST_PC, or an astrometry table that stopped resolving a direction.
   *  Pinning them here is what turns that into a build failure instead of a
   *  record silently leaving the catalogue (docs/catalog-driver.md § 6.1). */
  spineDroppedNoRaDec: number;
  spineDroppedNoDist: number;
  spineDroppedNoDirection: number;
  spineDroppedTooFar: number;
  spineDroppedNoVMagnitude: number;
  /** Total entries in the Bailer-Jones DR3 distance TSV (parsed map size). */
  bjEntries: number;
  /** AT-HYG rows the Bailer-Jones override is allowed to fire on:
   *  Gaia DR3 source_id present AND dist_src ∈ {G_R3, G_R2} (the Gaia
   *  inverse-parallax population the posterior is the principled
   *  replacement for). HIP / GJ / N / OTHER rows are excluded — their
   *  underlying distance isn't a Gaia inverse and B-J would silently
   *  move them to the prior's distant tail at low parallax S/N. */
  bjEligible: number;
  /** bjEligible rows whose source_id was also in the B-J catalogue —
   *  the count actually overridden. Coverage = bjOverridden / bjEligible. */
  bjOverridden: number;
  /** bjOverridden split by the row's AT-HYG dist_src. HIP / GJ / N /
   *  OTHER must stay 0: a non-zero entry means the eligibility gate
   *  stopped holding and non-Gaia distances are being regressed onto
   *  B-J's Galactic-density prior. UNRECOGNISED must stay 0 too — a
   *  dist_src value no override layer has reasoned about. */
  bjOverriddenByDistSrc: DistSrcPartition;
  /** AT-HYG rows whose (ra, dec) falls inside the LMC sky cone — the
   *  population the LMC kinematic PM gate is evaluated against. */
  lmcCandidates: number;
  /** Rows that ALSO pass the LMC bulk-PM gate; their dist/x/y/z/absmag
   *  were snapped to Pietrzyński 2019's eclipsing-binary distance. */
  lmcOverridden: number;
  /** lmcOverridden split by the row's AT-HYG dist_src. Unlike B-J this
   *  layer gates on sky cone + PM, not on dist_src, so every bucket is
   *  legitimately reachable — the split states which catalogued-distance
   *  populations the snap actually displaces. */
  lmcOverriddenByDistSrc: DistSrcPartition;
  /** Stars with a proper name written into the name table. */
  nameTableEntries: number;
  /** Stars with both nonzero amplitude and period after quantisation —
   *  drives the shader's "is variable" sentinel. */
  variableCount: number;
  /** Entries in search-index.json (stars with at least one searchable
   *  identifier). */
  searchEntries: number;
  /** Boundary arcs in public/constellation-boundaries.json — one per IAU
   *  edge record, so a drift means the edge set changed. */
  boundarySegments: number;
  /** Precessed ICRS sample directions across all boundary arcs. Set by the
   *  subdivision step, and the artifact's whole wire cost. */
  boundaryDirections: number;
  /** RA runs the resolved cell grid collapses to, band-major. The wire cost
   *  of the runtime membership lookup, and the one dimension of that grid no
   *  other pin covers — the 89 regions and their areas are pinned in
   *  src/client/constellation-boundaries/. */
  boundaryRegionRuns: number;
  /** public/constellation-boundaries.json size, rounded to KiB. Pinned
   *  because the direction quantisation is a wire-size choice with no other
   *  visible signal — dropping `DIRECTION_DECIMALS` by one moves ~30k values
   *  a character each, ~30 KiB. Rounded rather than exact: the file is 30k
   *  decimal-formatted floats, so a last-bit difference in one trig call
   *  (V8 differs across Node versions and architectures — CI is Node 24
   *  x64) changes its byte length while changing nothing that matters. */
  boundaryArtifactKb: number;
  /** Search entries carrying `dc` — a designation constellation that
   *  differs from the record's positional one, so its Bayer / Flamsteed /
   *  GCVS aliases are built against the designation's constellation instead
   *  (ρ Aql / 67 Aql). */
  designationConMismatch: number;
  /** Stars whose designation constellation came from their own GCVS
   *  designation — the only nomenclature source the build has left, since the
   *  spine carries no editorial `con` cell. See `parse/README.md`
   *  § Positional constellation membership. */
  gcvsDesignationCon: number;
  /** Record index of Sol after sort. -1 if Sol is not found in source. */
  solIndex: number;
  /** Total stick-figure polylines across all constellations. */
  figureCount: number;
  /** Constellations that carry at least one stick-figure polyline. */
  figureConstellations: number;
  /** Records emitted with a non-zero Gaia DR3 source_id at
   *  RECORD_LAYOUT.gaiaSourceId. The spine carries one on all but its
   *  no-Gaia residual; a sharp drop here means the builder lost the
   *  plumbing, since nothing re-derives the binding. */
  gaiaSourceIdResolved: number;
  /** Total entries in the Gaia DR3 Apsis TSV (parsed map size). */
  apsisEntries: number;
  /** Total entries in the Gaia DR3 synthetic-photometry TSV carrying both
   *  bands (parsed map size) — the ci cascade's synthetic-tier reach. */
  gspcEntries: number;
  /** Catalog records whose `gaia_source_id` resolves to an ApsisRow —
   *  upper bound on per-record Apsis coverage. */
  apsisMatched: number;
  /** Records with a non-null Teff in either gspphot OR gspspec — the
   *  population the downstream Tier 2 colour-LUT re-routing can use as
   *  Apsis-direct Teff. Pinned against the 84.8% probe figure. */
  apsisTeffEither: number;
  /** Total entries in the SIMBAD sp_type TSV (parsed map size). */
  simbadSptypeEntries: number;
  /** Rows in `data/simbad/simbad_values.tsv` — the § 5 value cohort. */
  simbadValuesEntries: number;
  /** Records classified via the curated HIP→sp_type override tier
   *  (CURATED_SPTYPE_BY_HIP) — saturated stars whose SIMBAD entry
   *  carries neither hip nor source_id (Castor). */
  spectralByCurated: number;
  /** Records whose spectral classification (classIdx + subclass + lumClass)
   *  came from SIMBAD's `sp_type` — the canonical Morgan-Keenan tier. */
  spectralBySimbad: number;
  /** The four SIMBAD tiers split by the namespace that found the row, summing
   *  to `spectralBySimbad` — enforced by `spectralSimbadPartitionError`, not
   *  merely asserted here. The split is over which namespace WON, so the
   *  ladder's order decides it: GJ is walked before TYC, and a record both
   *  reach credits GJ. `spectralSimbadByTyc` is the only one reaching an
   *  object SIMBAD holds no Gaia id and no HIP for. */
  spectralSimbadBySourceId: number;
  spectralSimbadByHip: number;
  spectralSimbadByTyc: number;
  spectralSimbadByGj: number;
  /** Records that fell through to Gaia DR3 GSP-Spec's
   *  `spectraltype_esphs` enum — second-tier letter-only classification. */
  spectralByGspspec: number;
  /** Records with neither SIMBAD sp_type nor GSP-Spec coverage — packed
   *  as classIdx=8 (unknown) / lumClass=255 (no luminosity-class ramp). */
  spectralFallback: number;
  /** Records whose `ci` came from the Gaia BP−RP relation. */
  ciGaiaRelation: number;
  /** Records taking Gaia's synthetic B−V — past the relation's colour bound,
   *  inside the measured one, and with no printed colour above it. */
  ciGspc: number;
  /** The `ciGspc` subset the archive's own flag calls inside the JKC
   *  standardisation's validated range — **zero**, and pinned there as a
   *  tripwire rather than as a coverage figure. The flag's region and this
   *  tier's window do not intersect on any row of this catalogue (measured,
   *  `../../data/gaia/README.md` § The GSPC validated-range flag), so a
   *  nonzero value means the flag moved upstream, not that coverage
   *  improved. */
  ciGspcValidatedRange: number;
  /** Records falling through to printed `I/239` B−V keyed on their own HIP. */
  ciPrintedHipBv: number;
  /** No-Apsis-Teff records whose `ci` is baked from the parsed spectral class
   *  instead of the solar fallback — the population that would otherwise
   *  render solar-yellow. */
  ciSpectralDerived: number;
  /** Records no tier covers, taking `SOLAR_BV_FALLBACK`. */
  ciSolarFallback: number;
  /** Identifier-less catalog primaries that gained HIP / Gaia source_id
   *  from a multiples.tsv pair-primary row, joined by HD
   *  (backfillPrimaryIdentifiers — the ξ UMa HD-only shape). */
  multiplesIdentifierBackfill: number;
  /** WDS systems with ≥2 distinct own-record members walked by the
   *  intra-system radial-coherence pass (system-coherence.ts). */
  systemCoherenceSystems: number;
  /** Own-record members moved to their system's anchor distance along
   *  their own direction (radial gap not a ≥3σ measurement). */
  systemCoherenceRepositioned: number;
  /** Systems whose distance anchor was a non-primary member (a clean
   *  unsaturated Gaia 5p member outranking a saturated primary). */
  systemCoherenceMemberAnchorWins: number;
  /** Members whose radial gap IS a ≥3σ measurement — genuinely measured
   *  depth kept (α Cen–Proxima, 61 Cyg A/B). */
  systemCoherenceSignificantDepthKept: number;
  /** Systems skipped because the anchor's rendered catalog distance
   *  contradicts its own parallax evidence (μ¹ Sco's B-J placement of
   *  a RUWE-corrupted source at 1.7 kpc) — members keep their own. */
  systemCoherenceAnchorInconsistent: number;
  /** Pair rows in multiples.tsv scanned by the companion-promotion pass
   *  (excludes standalone rows). */
  companionRowsScanned: number;
  /** Newly minted catalog records — companions whose identifier wasn't
   *  already in AT-HYG and that survived the position + absmag gates. */
  companionPromoted: number;
  /** Subset of `companionPromoted` addressable only via a synthetic
   *  identifier (`synth-<wds_id>-<comp>`) because the row carried no
   *  own Gaia source_id and no non-inherited HIP. Algol Aa,Ab + Aa1,2's
   *  Ab / Aa2 sit here. */
  companionPromotedSynthetic: number;
  /** Pair rows whose identifier already resolved to an existing
   *  catalog row (most pair rows fall here — the brighter component is
   *  almost always AT-HYG'd). */
  companionAlreadyInCatalog: number;
  /** Pair rows dropped because both gaia_source_id AND hip were blank
   *  on the secondary — no way for runtime code to address them. */
  companionDroppedNoIdentifier: number;
  /** Pair rows dropped because neither the secondary's own astrometry
   *  nor sep+PA tangent projection from the primary yielded a 3D
   *  position. */
  companionDroppedNoPosition: number;
  /** Pair rows dropped because the tangent projection ρ·d exceeds the
   *  bound-pair tidal limit — a fabricated companion that far can't be
   *  gravitationally bound (a line-of-sight optical double with no
   *  parallax for Stage 5 to catch). */
  companionDroppedBeyondTidalLimit: number;
  /** Pair rows dropped because the secondary's absmag couldn't be
   *  imputed — no own absmag AND no primary+Δmag combo. */
  companionDroppedNoAbsmag: number;
  /** Pair rows dropped because the secondary's comp letter is a WDS
   *  unresolved compound (e.g. "BC" / "AB" / "ABC") whose constituent
   *  single-letter components are already resolved as sibling cursors
   *  in the same WDS root. The aggregate isn't a single star and would
   *  double-count its components if promoted. */
  companionDroppedCompoundComp: number;
  /** Pair-row primaries dropped because no position was derivable —
   *  neither own per-component astrometry nor a compound-sibling sep+PA
   *  proxy — so collocating on the anchor would render a false
   *  coincident star (Alsephina C). */
  companionDroppedCollocatedPrimary: number;
  /** Promoted secondaries whose absmag came from the class→M_V
   *  spectral calibration (inherited/missing photometry, no WDS Δmag,
   *  per-component spect_via=curated/simbad). */
  companionAbsmagSpectralDerived: number;
  /** Promoted records whose spectral info was re-derived as a
   *  main-sequence estimate from the component's own de-extincted
   *  absmag (spect_via inherited/blank + an own-brightness absmag
   *  source) — the hot-but-tiny inherited-type population (Algol Ab,
   *  Acrab B, Acrux B). */
  companionSpectMsFromOwnAbsmag: number;
  /** Promoted records whose absmag came from the row's own WDS
   *  apparent magnitude at the system distance (both Δmag paths
   *  unavailable, or an escape row whose "own" photometry is the
   *  anchor's blend — Acrux B). */
  companionAbsmagWdsMagDerived: number;
  /** Promoted pair-row-primary escapes whose absmag fell back to the
   *  anchor's collocated brightness (imputeCompanionAbsmag). Ratchet DOWN
   *  by curating white-dwarf absmags. */
  companionAbsmagAnchorCollocated: number;
  /** Promoted secondaries still carrying the inherited primary absmag
   *  (full-luminosity twin) — kept only because the pair has a
   *  renderable orbit binaries.bin must keep addressing. Ratchet DOWN
   *  by curating per-component types; an increase is a regression. */
  companionAbsmagInheritedTwinOrbital: number;
  /** Promoted gaia_photometry records whose absmag was reduced by the
   *  blend-split post-pass — N≥2 collocated records sharing one Gaia
   *  source (an unresolved sub-arcsec pair) each fainter than the derived
   *  combined magnitude by 2.5·log10(N). YY Gem Ca/Cb is the showcase. */
  companionBlendSplit: number;
  /** Anchor records dimmed by the flux-conservation post-pass: a synth
   *  member with anchor-inherited-then-stripped ids took a wds_mag/dmag
   *  absmag, so its flux is subtracted from the anchor's athyg_own blend
   *  magnitude and total system light is conserved. */
  companionBlendDimmedAnchors: number;
  /** Non-structural dim candidates the subset solve could not fit (no
   *  observed WDS mags / distance) — left un-dimmed. */
  companionBlendDimUnfit: number;
  /** Non-structural dim candidates the winning subset left out, or whose
   *  fit was indecisive within the decisive margin — their light is not in
   *  the anchor's blend. */
  companionBlendDimOutside: number;
  /** Dim candidates Gaia had already resolved out of the anchor's magnitude:
   *  the member carries its own DR3 source_id and the anchor's V came from
   *  Gaia's, so its light was never in there. Rises with Gaia coverage. */
  companionBlendDimGaiaResolved: number;
  /** Dim candidates wider than the anchor tier's blending scale, or carrying no
   *  published separation at all — no entry of that catalogue sums both. */
  companionBlendDimBeyondSeparation: number;
  /** Dim candidates whose winning hypothesis still missed the anchor's observed
   *  magnitude by more than the input's error scale — matched nothing. */
  companionBlendDimMisfit: number;
  /** Dim candidates skipped by the M_member > M_blend + 0.05 guard. */
  companionBlendDimSkipped: number;
  /** Existing AT-HYG blend-coordinate double entries repositioned in
   *  place by companion promotion (ξ UMa B class). */
  companionRepositionedCollocatedDouble: number;
  /** Promoted companions whose own IAU-positional constellation differs from
   *  their anchor's — a pair wide enough to straddle a boundary, which
   *  inheriting the anchor's index used to hide. */
  companionConstellationSplitFromAnchor: number;
  /** First-class AT-HYG records given a composed component name by the
   *  stamp-component-letters pass — pairs AT-HYG left anonymous so both
   *  halves printed the same Bayer/Flamsteed label (61 Cyg A/B class). */
  componentLettersStamped: number;
  /** Same-WDS-root display-name collisions settled by re-lettering the
   *  claimant whose name wasn't its own letter composition (β² Sco's
   *  AT-HYG "Acrab B" → "Acrab C"). */
  componentNameCollisionsResolved: number;
  /** Same-root collisions left in place because the re-lettered name was
   *  itself already claimed. Ratchet DOWN — a nonzero value means a system
   *  needs a designation policy, not a letter swap. */
  componentNameCollisionsUnresolved: number;
  /** Catalog records carrying a multiples.tsv component designation
   *  (`cl`/`cp` on their SearchEntry) — the base for "<system> <letter>"
   *  search aliases (Alpha Centauri A/B/C). */
  componentDesignations: number;
  /** Total entries in the full-catalog Gaia DR3 5p astrometry TSV
   *  (parsed map size) — direction-cascade tier 1 coverage. */
  gaiaAstrometryEntries: number;
  /** Total entries in the HIP2 van Leeuwen TSV (parsed map size) —
   *  direction-cascade tier 2 coverage + dist_src=HIP full-precision
   *  distances. */
  hip2Entries: number;
  /** Total entries in the printed-V slice of I/239/hip_main (parsed map
   *  size) — the V cascade's bright-tier coverage. */
  hipVMagEntries: number;
  /** Total printed B−V entries in the same slice — the ci cascade's
   *  printed-tier coverage. Lower than `hipVMagEntries`: 1,281 Hipparcos rows
   *  carry a V with no colour. */
  hipBvEntries: number;
  /** Distinct Gaia DR3 source_ids carrying an NSS two-body orbit —
   *  input to the gaia_nss_systemic routing tag. */
  nssSourceIdEntries: number;
  /** Distinct TYCs across the two committed Tycho-2 tables (main wins on
   *  the identifiers both carry) — the direction / PM / V tier's reach. */
  tycho2Entries: number;
  /** CNS5 rows carrying a position AND the epoch to state it at, keyed on
   *  their own GJ — the direction cascade's CNS5 tier reach. */
  cns5AstrometryEntries: number;
  /** Rows in the committed Gliese V/70A slice — the V cascade's bottom
   *  tier's reach. */
  glieseEntries: number;
  /** Distance cascade: the parallax tier each record's distance inverts,
   *  before the two override layers. `distNone` is the § 6 ledger drop —
   *  records no owned parallax reaches, which do not ship. */
  distBailerJones: number;
  distLmcKinematic: number;
  distGaiaDr3Inversion: number;
  distHip2Parallax: number;
  distCns5Plx: number;
  distGliesePlx: number;
  distSimbadPlx: number;
  distCurated: number;
  distNone: number;
  /** Rows whose SHIPPED distance inverts a parallax with worse than 20%
   *  fractional error, so the result is biased. Bailer-Jones rows are excluded:
   *  there the posterior, not the inversion, handles the low-S/N case.
   *
   *  These rows have no second source, so refusing one would cost it its record
   *  rather than its precision — this count is how the population stays visible
   *  for a Gaia DR4 revisit instead of dissolving into the catalogue. Recompute
   *  the set at any time as `plx / e_plx < PARALLAX_LOW_PRECISION_SN` over the
   *  non-Bailer-Jones tiers. */
  distLowPrecisionParallax: number;
  /** Of `distNone`, the rows a skip rule refused a value for — as against rows
   *  nothing measured at all. § 5's residual policy counts the two apart. */
  distRefusedNoOwnedParallax: number;
  /** Direction cascade: rows whose sky direction came from a clean
   *  Gaia DR3 5p solution (includes the handful of 2p position-only
   *  fall-through rows with no HIP2 cover). */
  directionGaia5p: number;
  /** Direction cascade: Gaia rows with an NSS orbit AND an unreliable
   *  5p fit — same Gaia values, tagged for provenance parity with
   *  scripts/binaries/stage3_astrometry.py. */
  directionGaiaNssSystemic: number;
  /** Direction cascade: rows with no usable Gaia parallax (saturated
   *  bright set / 2p solutions) whose direction came from HIP2. */
  directionHip2Saturated: number;
  /** Direction cascade: rows whose Gaia-vs-HIP2 PM disagreement
   *  (> 50 mas/yr on either axis) routed the direction to HIP2. */
  directionHip2PmDiscrepant: number;
  /** Direction cascade: rows Gaia and HIP2 both miss, placed at Tycho-2's
   *  own mean position propagated to the scene epoch from its per-star,
   *  per-coordinate mean epochs. */
  directionTycho2: number;
  /** The `directionTycho2` subset with no mean solution at all, placed at the
   *  row's J2000 `ra_icrs` cell instead. Those rows carry no Tycho-2 PM
   *  either, so the position is unpropagated unless another tier rescues a
   *  PM for it — the residual § 5 requires enumerated rather than implied. */
  directionTycho2FromIcrs: number;
  /** The `directionTycho2` subset whose mean solution is an unresolved
   *  double's photocentre (`pflag='P'`) rather than one star's place, so the
   *  position is the pair's light-centre. Counted, not gated: no tier sits
   *  below this one for a TYC-keyed row, so gating would cost each its record.
   *  The V side of the same row is marked a system blend for this reason. */
  directionTycho2Photocentre: number;
  /** Direction cascade: TYC-less Gliese rows placed at CNS5's own
   *  coordinates, propagated from the row's own `pos_epoch`. */
  directionCns5: number;
  /** Direction cascade: the bottom tier — rows no first-order catalogue
   *  reaches, placed at SIMBAD's bibcoded J2000 coordinates propagated to
   *  the scene epoch. Sol is NOT here: it has no direction at all. */
  directionSimbad: number;
  /** Direction cascade: Sol, whose curated tier exists because it carries no
   *  identifier any tier above can key on. Pinned at 1. */
  directionCurated: number;
  /** V cascade: rows whose Johnson V came from the Riello+ 2021 G,BP−RP
   *  transform — unsaturated Gaia photometry inside the relation's
   *  validity range. See scripts/catalog/photometry/README.md. */
  vGaiaRiello: number;
  /** V cascade: the bright rescue tier. Rows whose Gaia photometry is
   *  saturated (G < 4), incomplete, or outside the transform's colour
   *  range, resolved against printed I/239 Vmag instead. */
  vPrintedHip: number;
  /** V cascade: rows with no Gaia photometry and no printed HIP V, taking
   *  Tycho-2's `VT` reduced to Johnson V by the SP-1200 relation. */
  vTycho2: number;
  /** The `vTycho2` subset whose `BT−VT` sits outside the range SP-1200
   *  publishes that relation over. Counted, not gated: none of these rows
   *  carries a `gl`, so gating would cost each its only V and hence its
   *  record — ../photometry/v-magnitude-pure.ts `tycho2VMagnitude`. */
  vTycho2OutsideBtVtRange: number;
  /** V cascade: the GJ-only cohort, taking Gliese V/70A's printed `Vmag`.
   *  The tier below Tycho-2 and the last one: SIMBAD publishes no V flux at
   *  all for the rows that reach here. */
  vGliese: number;
  /** V cascade: Sol, curated for the same reason its direction is. Pinned
   *  at 1. */
  vCurated: number;
  /** V cascade: rows no tier supplied a V for, and so no absmag either —
   *  readStars drops them. Pinned at 0, which is the assertion that the
   *  absmag-cell membership gate still implies a usable magnitude. */
  vNone: number;
  /** Space-motion velocity: rows whose tangential velocity came from
   *  Gaia DR3 5p PM (the dominant set; tracks directionGaia5p +
   *  directionGaiaNssSystemic minus PM-less 2p rows). */
  velocityGaiaPm: number;
  /** Space-motion velocity: rows whose PM came from HIP2 (the
   *  hip2_saturated + hip2_pm_discrepant tiers with a usable HIP2 PM). */
  velocityHip2Pm: number;
  /** Space-motion velocity: rows whose PM came from Tycho-2 — its own
   *  direction tier plus the rescue cascade's `pmRescueTycho2`. */
  velocityTycho2Pm: number;
  /** Space-motion velocity: rows whose PM came from CNS5, both routes. */
  velocityCns5Pm: number;
  /** Space-motion velocity: rows whose PM came from a bibcoded SIMBAD
   *  `pmra`/`pmdec`, both routes. */
  velocitySimbadPm: number;
  /** Space-motion velocity: rows with no usable PM from any source —
   *  zero tangential velocity (Sol, the rows the rescue cascade leaves at
   *  `pmRescueGaiaBibcodeSkipped` / `pmRescueNone`, and the artifact rows the
   *  sanity ceiling zeroed). */
  velocityZero: number;
  /** PM rescue: rows the direction tier left without a proper motion whose
   *  own TYC reaches a Tycho-2 mean solution. The cascade's top tier and its
   *  only one needing no bibcode check — Tycho-2 predates Gaia
   *  (`distance/README.md` § The proper-motion rescue cascade). */
  pmRescueTycho2: number;
  /** PM rescue: rows reached by CNS5 on their own GJ, whose PM cites the
   *  literature rather than a Gaia release. */
  pmRescueCns5: number;
  /** PM rescue: rows reached by a bibcoded SIMBAD PM citing the literature —
   *  the second-order bottom tier. */
  pmRescueSimbad: number;
  /** PM rescue: 2p rows whose only owned PM cites a Gaia release, refused so
   *  the pull cannot return the motion DR3 declined to fit. They take a zero
   *  tangential term; the cost is enumerated in the README. */
  pmRescueGaiaBibcodeSkipped: number;
  /** PM rescue: rows no owned PM source reaches at all. Distinct from the
   *  skipped bucket — nothing was refused, there is nothing there. */
  pmRescueNone: number;
  /** Rows whose computed space velocity exceeded VELOCITY_SANITY_CEILING
   *  (PM×distance artifact) and was zeroed — a subset of velocityZero. */
  velocityClamped: number;
  /** Kept rows above the Galactic escape velocity (~550 km/s). Unbound
   *  stars are genuinely exceptional, so this band is almost all PM×distance
   *  / bad-RV artifacts — tracked as a ratchet (not clamped) so a proven
   *  hypervelocity star survives and the artifact tail stays visible for
   *  finer filtering. */
  velocityAboveEscape: number;
  /** Rows whose velocity carries a non-zero radial velocity from either
   *  rv tier below. */
  velocityRvApplied: number;
  /** Rows taking the radial term from Gaia DR3 `radial_velocity`. */
  rvGaiaDr3: number;
  /** Rows RVS did not reach, taking a bibcoded SIMBAD `rvz_radvel`. */
  rvSimbad: number;
  /** `rvSimbad` rows whose bibcode is a Gaia catalogue release rather than
   *  the literature — legitimate here (Gaia published no rv of its own for
   *  them), and the split the skip rule's own cohort is measured against. */
  rvSimbadGaiaBibcode: number;
  /** Rows whose own 5p gate withheld a Gaia rv AND whose SIMBAD candidate
   *  cited a Gaia release — the skip rule's catch, falling to zero rather
   *  than laundering the withheld value back in. */
  rvGaiaBibcodeSkipped: number;
  /** Rows no tier covers — the radial term is zero. */
  rvNone: number;
  /** Rows whose resolved radial term alone exceeded
   *  `VELOCITY_SANITY_CEILING_KM_S` and was dropped, leaving the measured
   *  proper motion in place rather than losing it to the whole-vector clamp
   *  (`distance/radial-velocity/README.md` § The sanity thresholds). Counted
   *  under the tier that supplied the value — the cascade routed correctly
   *  and the threshold, not the cascade, rejected it. */
  rvRadialRejected: number;
  /** `rvGaiaDr3` rows split by the stated `radial_velocity_error`, a tracked
   *  ratchet rather than a gate — DR3 is taken as published
   *  (`distance/radial-velocity/README.md`). `none` is pinned at 0: the
   *  published catalogue always pairs an rv with an error. */
  rvGaiaErrorBands: RvErrorBandPartition;
  /** Largest stated `radial_velocity_error` (km/s) any `rvGaiaDr3` row
   *  carries. Below DR3's own publication ceiling of 40 by construction; a
   *  refresh that moves it forces this snapshot to be reviewed. */
  rvGaiaErrorMaxKmS: number;
  /** Records whose designation constellation came from IV/27A keyed on their
   *  own HD / HIP — the nomenclature source that replaced AT-HYG's editorial
   *  `con` cell. The GCVS pass overwrites it where a variable designation
   *  carries its own (`gcvsDesignationCon`). */
  desigConFromCrossIndex: number;
  /** IV/27A rows whose `cst` names no IAU-88 constellation. **Pinned at 0** —
   *  the table's abbreviations ARE the IAU set, so a non-zero value is an
   *  upstream convention change, not a tolerable miss. */
  crossIndexUnknownCst: number;
}

export type CountDiff =
  | { key: string; status: 'match'; value: number }
  | {
      key: string;
      status: 'mismatch';
      expected: number;
      actual: number;
    };

/** Compare actual counts against an expected manifest and emit a per-key
 *  diff. Partition-valued entries (a `DistSrcPartition`) expand to one
 *  `parent.bucket` row each, so a single drifting bucket names itself.
 *  Pure — no I/O. The caller decides whether mismatches are fatal.
 *
 *  Generic over the count record so any build script's snapshot can use it
 *  (`BuildCounts` here, `ClassicIdOverlayCounts` in `classic-ids/`); the
 *  walk only needs each value to be a number or a flat number partition. */
export function compareBuildCounts<T extends object>(
  expected: T,
  actual: T,
): CountDiff[] {
  const diff: CountDiff[] = [];
  const expectedByKey = expected as Record<string, unknown>;
  for (const [key, a] of Object.entries(actual as Record<string, unknown>)) {
    const e = expectedByKey[key];
    if (typeof a === 'number') {
      diff.push(compareOne(key, typeof e === 'number' ? e : NaN, a));
      continue;
    }
    const ea = (e ?? {}) as Partial<Record<string, number>>;
    for (const [bucket, value] of Object.entries(a as Record<string, number>)) {
      diff.push(compareOne(`${key}.${bucket}`, ea[bucket] ?? NaN, value));
    }
  }
  return diff;
}

function compareOne(key: string, expected: number, actual: number): CountDiff {
  if (actual === expected) return { key, status: 'match', value: actual };
  return { key, status: 'mismatch', expected, actual };
}

/** One-line `bucket=n` rundown of an override layer's row partition, zeros
 *  included — the per-partition dry-run figure an override PR quotes. */
export function formatDistSrcPartition(partition: DistSrcPartition): string {
  return DIST_SRC_BUCKETS.map((b) => `${b}=${partition[b]}`).join(', ');
}

/** Pretty-printer for the diff. Used by the build script and any future
 *  CLI consumer. Only mismatching rows are listed, so a fatal exit doesn't
 *  scroll the actionable ones off-screen. */
export function formatCountDiff(diff: CountDiff[]): string {
  const mismatches = diff.filter((d) => d.status === 'mismatch');
  const lines: string[] = [];
  if (mismatches.length === 0) {
    lines.push(`build-counts: all ${diff.length} counts match`);
  } else {
    lines.push(
      `build-counts: ${mismatches.length} of ${diff.length} counts differ`,
    );
    const width = Math.max(...mismatches.map((m) => m.key.length));
    for (const m of mismatches) {
      if (m.status !== 'mismatch') continue;
      const label = `  ${m.key.padEnd(width)}`;
      if (Number.isNaN(m.expected)) {
        lines.push(`${label} absent from snapshot, got ${m.actual}`);
        continue;
      }
      const delta = m.actual - m.expected;
      const sign = delta > 0 ? '+' : '';
      lines.push(
        `${label} expected ${m.expected}, got ${m.actual} (${sign}${delta})`,
      );
    }
  }
  return lines.join('\n');
}

/** The SIMBAD namespace tallies must exhaust the SIMBAD tier: every record the
 *  resolver credits to SIMBAD reports exactly one namespace that found it, so a
 *  shortfall means a tier returned a row without naming its key and the
 *  per-namespace figures understate silently. Returns the message to fail the
 *  build with, or null when the partition holds. */
export function spectralSimbadPartitionError(counts: BuildCounts): string | null {
  const sum = counts.spectralSimbadBySourceId + counts.spectralSimbadByHip
    + counts.spectralSimbadByTyc + counts.spectralSimbadByGj;
  if (sum === counts.spectralBySimbad) return null;
  return 'spectralSimbad namespace partition does not exhaust the SIMBAD tier: '
    + `source_id ${counts.spectralSimbadBySourceId} + hip ${counts.spectralSimbadByHip} `
    + `+ tyc ${counts.spectralSimbadByTyc} + gj ${counts.spectralSimbadByGj} `
    + `= ${sum}, but spectralBySimbad is ${counts.spectralBySimbad}`;
}
