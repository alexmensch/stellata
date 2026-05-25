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
  /** Total CCDM systems in the source TSV. */
  ccdmGroups: number;
  /** CCDM systems resolved against catalog records. */
  ccdmResolved: number;
  /** New FLAG_BINARY_PRIMARY bits set by the CCDM pass (excludes ones
   *  already set by `inferBinaries`). */
  ccdmFlagged: number;
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
  /** Records whose spectral classification (classIdx + subclass + lumClass)
   *  came from SIMBAD's `sp_type` — the canonical Morgan-Keenan tier. */
  spectralBySimbad: number;
  /** Records that fell through to Gaia DR3 GSP-Spec's
   *  `spectraltype_esphs` enum — second-tier letter-only classification. */
  spectralByGspspec: number;
  /** Records with neither SIMBAD sp_type nor GSP-Spec coverage — packed
   *  as classIdx=8 (unknown) / lumClass=255 (no luminosity-class ramp). */
  spectralFallback: number;
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
  /** Pair rows dropped because the secondary's absmag couldn't be
   *  imputed — no own absmag AND no primary+Δmag combo. */
  companionDroppedNoAbsmag: number;
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
