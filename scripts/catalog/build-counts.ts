// Pure helpers for the build-catalog count assertion — diff a
// BuildCounts record against the committed snapshot. See
// scripts/catalog/README.md § Validation harness.

export interface BuildCounts {
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
  /** AT-HYG rows whose (ra, dec) falls inside the LMC sky cone — the
   *  population the LMC kinematic PM gate is evaluated against. */
  lmcCandidates: number;
  /** Rows that ALSO pass the LMC bulk-PM gate; their dist/x/y/z/absmag
   *  were snapped to Pietrzyński 2019's eclipsing-binary distance. */
  lmcOverridden: number;
  /** Stars with a proper name written into the name table. */
  nameTableEntries: number;
  /** Stars with both nonzero amplitude and period after quantisation —
   *  drives the shader's "is variable" sentinel. */
  variableCount: number;
  /** Entries in search-index.json (stars with at least one searchable
   *  identifier). */
  searchEntries: number;
  /** Record index of Sol after sort. -1 if Sol is not found in source. */
  solIndex: number;
  /** Total stick-figure polylines across all constellations. */
  figureCount: number;
  /** Constellations that carry at least one stick-figure polyline. */
  figureConstellations: number;
  /** Records emitted with a non-zero Gaia DR3 source_id at
   *  RECORD_LAYOUT.gaiaSourceId. AT-HYG carries `gaia` for ~98% of
   *  rows; a sharp drop here means the AT-HYG column changed or the
   *  builder lost the plumbing. */
  gaiaSourceIdResolved: number;
  /** AT-HYG rows whose `gaia` cell was blank but whose `hip` resolved
   *  through `gaia_dr3_hip_xmatch.tsv` — surfaced as `gaia_source_id`
   *  in the binary via the HIP→Gaia cross-walk fallback. Counted as
   *  part of `gaiaSourceIdResolved`. Gaia-saturated bright binaries
   *  (Sirius, Vega, …) are excluded from both AT-HYG.gaia and the
   *  cross-walk, so they remain unresolved and are not counted here. */
  gaiaSourceIdBackfilled: number;
  /** AT-HYG rows whose native `gaia` cell or HIP cross-walk hit was
   *  scrubbed by the G−V magnitude gate
   *  (GAIA_BINDING_G_MINUS_V_REJECT_MAG) — saturated bright stars
   *  best-matched to a resolvable companion or background source
   *  (Toliman, Castor). Mirrors the binaries pipeline's gate in
   *  scripts/binaries/indices.py. */
  gaiaBindingMagRejected: number;
  /** AT-HYG rows whose binding was scrubbed by the sibling-letter
   *  attribution gate (isSiblingLetterAttribution) — SIMBAD's WDS
   *  cross-IDs give a sibling component sole ownership of the bound
   *  source (μ Dra A carrying B's source). The catalog-boundary mirror
   *  of the binaries pipeline's identity refutation. */
  gaiaBindingSiblingRejected: number;
  /** Sources indexed from the SIMBAD WDS cross-IDs TSV (bySource size). */
  simbadWdsXidsEntries: number;
  /** Total entries in the Gaia DR3 Apsis TSV (parsed map size). */
  apsisEntries: number;
  /** Catalog records whose `gaia_source_id` resolves to an ApsisRow —
   *  upper bound on per-record Apsis coverage. */
  apsisMatched: number;
  /** Records with a non-null Teff in either gspphot OR gspspec — the
   *  population the downstream Tier 2 colour-LUT re-routing can use as
   *  Apsis-direct Teff. Pinned against the 84.8% probe figure. */
  apsisTeffEither: number;
  /** Total entries in the SIMBAD sp_type TSV (parsed map size). */
  simbadSptypeEntries: number;
  /** Records classified via the curated HIP→sp_type override tier
   *  (CURATED_SPTYPE_BY_HIP) — saturated stars whose SIMBAD entry
   *  carries neither hip nor source_id (Castor). */
  spectralByCurated: number;
  /** Records whose spectral classification (classIdx + subclass + lumClass)
   *  came from SIMBAD's `sp_type` — the canonical Morgan-Keenan tier. */
  spectralBySimbad: number;
  /** Records that fell through to Gaia DR3 GSP-Spec's
   *  `spectraltype_esphs` enum — second-tier letter-only classification. */
  spectralByGspspec: number;
  /** Records with neither SIMBAD sp_type nor GSP-Spec coverage — packed
   *  as classIdx=8 (unknown) / lumClass=255 (no luminosity-class ramp). */
  spectralFallback: number;
  /** No-Apsis-Teff ∩ no-observed-B−V records whose `ci` is baked from the
   *  parsed spectral class (tier 4/5) instead of the solar fallback — the
   *  population that would otherwise render solar-yellow. */
  ciSpectralDerived: number;
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
  /** Dim candidates skipped by the M_member > M_blend + 0.05 guard. */
  companionBlendDimSkipped: number;
  /** Existing AT-HYG blend-coordinate double entries repositioned in
   *  place by companion promotion (ξ UMa B class). */
  companionRepositionedCollocatedDouble: number;
  /** Promoted companions that inherited a classified constellation index
   *  from their anchor (all but the rows whose anchor is absent or itself
   *  unclassified). */
  companionConstellationInherited: number;
  /** First-class AT-HYG records given a composed component name by the
   *  stamp-component-letters pass — pairs AT-HYG left anonymous so both
   *  halves printed the same Bayer/Flamsteed label (61 Cyg A/B class). */
  componentLettersStamped: number;
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
  /** Distinct Gaia DR3 source_ids carrying an NSS two-body orbit —
   *  input to the gaia_nss_systemic routing tag. */
  nssSourceIdEntries: number;
  /** dist_src=HIP rows whose distance was re-derived as 1000/plx from
   *  the committed HIP2 file (same value AT-HYG catalogued, freed of
   *  its 4-dp print truncation). */
  hipDistFullPrecision: number;
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
  /** Direction cascade: residual rows placed at AT-HYG's printed
   *  ra/dec as-is (no Gaia astrometry row, no HIP2 row; ξ UMa
   *  canonical, plus Sol). */
  directionAthygPrinted: number;
  /** Space-motion velocity: rows whose tangential velocity came from
   *  Gaia DR3 5p PM (the dominant set; tracks directionGaia5p +
   *  directionGaiaNssSystemic minus PM-less 2p rows). */
  velocityGaiaPm: number;
  /** Space-motion velocity: rows whose PM came from HIP2 (the
   *  hip2_saturated + hip2_pm_discrepant tiers with a usable HIP2 PM). */
  velocityHip2Pm: number;
  /** Space-motion velocity: athyg_printed-tier rows whose PM came from
   *  AT-HYG's own pm_ra/pm_dec cells. */
  velocityAthygPm: number;
  /** Space-motion velocity: rows with no usable PM from any source —
   *  zero tangential velocity (2p Gaia rows, PM-less athyg_printed rows,
   *  Sol, and the artifact rows the sanity ceiling zeroed). */
  velocityZero: number;
  /** Rows whose computed space velocity exceeded VELOCITY_SANITY_CEILING
   *  (PM×distance artifact) and was zeroed — a subset of velocityZero. */
  velocityClamped: number;
  /** Kept rows above the Galactic escape velocity (~550 km/s). Unbound
   *  stars are genuinely exceptional, so this band is almost all PM×distance
   *  / bad-RV artifacts — tracked as a ratchet (not clamped) so a proven
   *  hypervelocity star survives and the artifact tail stays visible for
   *  finer filtering. */
  velocityAboveEscape: number;
  /** Rows whose velocity carries a non-zero AT-HYG radial velocity
   *  (rv cell present and non-zero; rv_src is Gaia RVS on the bulk). */
  velocityRvApplied: number;
}

export type CountDiff =
  | { key: keyof BuildCounts; status: 'match'; value: number }
  | {
      key: keyof BuildCounts;
      status: 'mismatch';
      expected: number;
      actual: number;
    };

/** Compare actual counts against an expected manifest and emit a per-key
 *  diff. Pure — no I/O. The caller decides whether mismatches are fatal. */
export function compareBuildCounts(
  expected: BuildCounts,
  actual: BuildCounts,
): CountDiff[] {
  const keys = Object.keys(actual) as (keyof BuildCounts)[];
  return keys.map((key) => {
    const a = actual[key];
    const e = expected[key];
    if (a === e) return { key, status: 'match' as const, value: a };
    return { key, status: 'mismatch' as const, expected: e, actual: a };
  });
}

/** Pretty-printer for the diff. Used by the build script and any future
 *  CLI consumer. Lines are sorted with mismatches first so a fatal exit
 *  doesn't scroll the actionable rows off-screen. */
export function formatCountDiff(diff: CountDiff[]): string {
  const mismatches = diff.filter((d) => d.status === 'mismatch');
  const lines: string[] = [];
  if (mismatches.length === 0) {
    lines.push(`build-counts: all ${diff.length} counts match`);
  } else {
    lines.push(
      `build-counts: ${mismatches.length} of ${diff.length} counts differ`,
    );
    for (const m of mismatches) {
      if (m.status !== 'mismatch') continue;
      const delta = m.actual - m.expected;
      const sign = delta > 0 ? '+' : '';
      lines.push(
        `  ${m.key.padEnd(22)} expected ${m.expected}, got ${m.actual} (${sign}${delta})`,
      );
    }
  }
  return lines.join('\n');
}
