import { describe, it, expect } from 'vitest';
import { emptyTallyPartition } from '../util/tally';
import {
  compareBuildCounts,
  formatCountDiff,
  formatPartition,
  spectralSimbadPartitionError,
  type BuildCounts,
} from './build-counts';
import { DIST_VIA_VALUES } from './distance/parallax/parallax-cascade';

function baseCounts(): BuildCounts {
  return {
    recordCount: 313242,
    systemCoherenceSystems: 0,
    systemCoherenceRepositioned: 0,
    systemCoherenceMemberAnchorWins: 0,
    systemCoherenceSignificantDepthKept: 0,
    systemCoherenceAnchorInconsistent: 0,
    binaryPairs: 100,
    binaryMutualPairs: 50,
    gcvsEntries: 60000,
    gcvsHipXrefs: 11316,
    gcvsHdXrefs: 13926,
    gcvsGaiaXrefs: 11000,
    gcvsMatched: 3677,
    gcvsMatchedByGaia: 3500,
    gcvsMatchedByHip: 100,
    gcvsMatchedByHd: 77,
    gcvsNamed: 12000,
    ccdmGroups: 4000,
    ccdmResolved: 3500,
    ccdmFlagged: 200,
    ccdmSuppressedOptical: 50,
    eclipsingWinged: 300,
    renderableCompanionWinged: 400,
    multiplicityResolved: 20000,
    multiplicityUnresolved: 5000,
    componentDesignations: 16000,
    desigConFromCrossIndex: 3180,
    crossIndexUnknownCst: 0,
    droppedTooFar: 0,
    bjEntries: 310000,
    bjEligible: 305000,
    bjOverridden: 304000,
    lmcCandidates: 1200,
    lmcOverridden: 60,
    lmcOverriddenByDistVia: {
      ...emptyTallyPartition(DIST_VIA_VALUES), bailer_jones: 58, gaia_dr3_inversion: 2,
    },
    nameTableEntries: 350,
    variableCount: 3677,
    searchEntries: 290000,
    solIndex: 100000,
    figureCount: 500,
    figureConstellations: 88,
    gaiaSourceIdResolved: 307000,
    apsisEntries: 270000,
    gspcEntries: 281000,
    apsisMatched: 260000,
    apsisTeffEither: 255000,
    simbadSptypeEntries: 320000,
    simbadValuesEntries: 11037,
    spectralByCurated: 1,
    spectralBySimbad: 280000,
    spectralSimbadBySourceId: 279000,
    spectralSimbadByHip: 700,
    spectralSimbadByTyc: 286,
    spectralSimbadByGj: 14,
    spectralByGspspec: 25000,
    spectralFallback: 8000,
    ciGaiaRelation: 280000,
    ciPrintedHipBv: 3400,
    ciGspc: 16000,
    ciGspcValidatedRange: 0,
    ciSpectralDerived: 1200,
    ciSolarFallback: 3000,
    multiplesIdentifierBackfill: 30,
    companionRowsScanned: 13000,
    companionPromoted: 4500,
    companionPromotedSynthetic: 12,
    companionAlreadyInCatalog: 7000,
    companionDroppedNoIdentifier: 100,
    companionDroppedNoPosition: 500,
    companionDroppedBeyondTidalLimit: 0,
    companionDroppedNoAbsmag: 900,
    companionDroppedCompoundComp: 40,
    companionDroppedCollocatedPrimary: 6,
    companionDroppedParkedRecord: 0,
    companionAbsmagSpectralDerived: 30,
    companionSpectMsFromOwnAbsmag: 3000,
    companionAbsmagWdsMagDerived: 0,
    companionAbsmagAnchorCollocated: 1,
    companionAbsmagInheritedTwinOrbital: 25,
    companionBlendSplit: 0,
    companionBlendDimmedAnchors: 0,
    companionBlendDimSkipped: 0,
    companionBlendDimUnfit: 0,
    companionBlendDimOutside: 0,
    companionBlendDimGaiaResolved: 0,
    companionBlendDimBeyondSeparation: 0,
    companionBlendDimMisfit: 0,
    companionRepositionedCollocatedDouble: 1,
    companionConstellationSplitFromAnchor: 0,
    companionExistingDesigConFromAnchor: 0,
    designationConMismatch: 1,
    gcvsDesignationCon: 4,
    boundarySegments: 781,
    boundaryDirections: 12000,
    boundaryRegionRuns: 2961,
    boundaryArtifactKb: 391,
    namingIauNamed: 444,
    namingIauNamedByProper: 3,
    namingIauUnreached: 55,
    namingEponym: 27,
    namingBayer: 2000,
    namingBayerAdded: 490,
    namingBayerComponent: 260,
    namingBayerDropped: 2,
    namingGould: 937,
    namingAliases: 21,
    namingAliasRecords: 21,
    namingDesigConFromWgsn: 2900,
    namingDesigConWgsnConflict: 0,
    namingTierOverride: 0,
    namingTierIau: 444,
    namingTierEponym: 27,
    namingTierBayer: 1669,
    namingTierFlamsteed: 1568,
    namingTierGould: 935,
    namingTierGcvs: 12438,
    namingTierCatalogue: 295909,
    namingBorrowed: 10087,
    namingLettered: 300,
    namingNameTable: 1500,
    namingOverrides: 0,
    namingUnlabelled: 6000,
    namingDuplicateLabels: 30,
    namingDuplicateRecords: 60,
    gaiaAstrometryEntries: 315000,
    hip2Entries: 117000,
    hipVMagEntries: 118000,
    hipBvEntries: 116000,
    nssSourceIdEntries: 356000,
    tycho2Entries: 372599,
    cns5AstrometryEntries: 5900,
    glieseEntries: 3803,
    pairMemberParallaxEntries: 0,
    distBailerJones: 0,
    distLmcKinematic: 0,
    distGaiaDr3Inversion: 0,
    distHip2Parallax: 0,
    distCns5Plx: 0,
    distGliesePlx: 0,
    distGliesePhotometricPlx: 0,
    distSimbadPlx: 0,
    distPairMemberParallax: 0,
    distCurated: 0,
    distNone: 0,
    distLowPrecisionParallax: 840,
    distRefusedNoOwnedParallax: 0,
    directionGaia5p: 300000,
    directionGaiaNssSystemic: 10000,
    directionHip2Saturated: 2500,
    directionHip2PmDiscrepant: 146,
    directionTycho2: 43,
    directionTycho2FromIcrs: 3,
    directionTycho2Photocentre: 2,
    directionCns5: 4,
    directionSimbad: 13,
    directionCurated: 1,
    vGaiaRiello: 300000,
    vPrintedHip: 12000,
    vTycho2: 123,
    vTycho2OutsideBtVtRange: 5,
    vGliese: 16,
    vCurated: 1,
    vNone: 0,
    velocityGaiaPm: 308000,
    velocityHip2Pm: 2600,
    velocityTycho2Pm: 40,
    velocityCns5Pm: 4,
    velocitySimbadPm: 13,
    velocityZero: 2617,
    pmRescueTycho2: 242,
    pmRescueCns5: 2,
    pmRescueSimbad: 17,
    pmRescueGaiaBibcodeSkipped: 13,
    pmRescueNone: 2,
    velocityClamped: 40,
    velocityAboveEscape: 50,
    velocityRvApplied: 267000,
    rvGaiaDr3: 250000,
    rvSimbad: 7000,
    rvSimbadGaiaBibcode: 240,
    rvGaiaBibcodeSkipped: 205,
    rvNone: 46000,
    rvRadialRejected: 1,
    rvGaiaErrorBands: {
      none: 0, le1: 200000, le5: 40000, le10: 6000, le20: 3000, gt20: 1000,
    },
    rvGaiaErrorMaxKmS: 39.9433,
  };
}

// Scalar keys contribute one diff row; a partition key contributes one per
// bucket.
function expectedDiffRows(counts: BuildCounts): number {
  return Object.values(counts).reduce<number>(
    (n, v) => n + (typeof v === 'number' ? 1 : Object.keys(v).length),
    0,
  );
}

describe('compareBuildCounts', () => {
  it('reports every key as match when expected === actual', () => {
    const counts = baseCounts();
    const diff = compareBuildCounts(counts, counts);
    expect(diff).toHaveLength(expectedDiffRows(counts));
    expect(diff.every((d) => d.status === 'match')).toBe(true);
  });

  it('flags only the keys that differ', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.recordCount = 313243;
    actual.gcvsMatched = 3678;
    const diff = compareBuildCounts(expected, actual);
    const mismatches = diff.filter((d) => d.status === 'mismatch');
    expect(mismatches).toEqual([
      { key: 'recordCount', status: 'mismatch', expected: 313242, actual: 313243 },
      { key: 'gcvsMatched', status: 'mismatch', expected: 3677, actual: 3678 },
    ]);
  });

  it('names the drifting bucket of a partition, not the whole partition', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.lmcOverriddenByDistVia.hip2_parallax = 11;
    const mismatches = compareBuildCounts(expected, actual)
      .filter((d) => d.status === 'mismatch');
    expect(mismatches).toEqual([{
      key: 'lmcOverriddenByDistVia.hip2_parallax',
      status: 'mismatch',
      expected: 0,
      actual: 11,
    }]);
  });

  it('flags a partition bucket the snapshot has no entry for', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (expected.lmcOverriddenByDistVia as Partial<Record<string, number>>).gaia_dr3_inversion;
    const mismatches = compareBuildCounts(expected, actual)
      .filter((d) => d.status === 'mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].key).toBe('lmcOverriddenByDistVia.gaia_dr3_inversion');
    expect(mismatches[0].status === 'mismatch'
      && Number.isNaN(mismatches[0].expected)).toBe(true);
  });

  it('preserves the key order of the actual object, partitions expanded', () => {
    const actual = baseCounts();
    const diff = compareBuildCounts(baseCounts(), actual);
    const flatKeys = Object.entries(actual).flatMap(([k, v]) => (
      typeof v === 'number' ? [k] : Object.keys(v).map((b) => `${k}.${b}`)
    ));
    expect(diff.map((d) => d.key)).toEqual(flatKeys);
  });
});

describe('formatCountDiff', () => {
  it('produces a single match line when nothing differs', () => {
    const counts = baseCounts();
    const out = formatCountDiff(compareBuildCounts(counts, counts));
    expect(out).toMatch(/all \d+ counts match/);
    expect(out.split('\n')).toHaveLength(1);
  });

  it('lists each mismatch with signed delta', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.recordCount = 313_240; // -2
    actual.gcvsMatched = 3_680;   // +3
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(/2 of \d+ counts differ/);
    expect(out).toMatch(/recordCount\s+expected 313242, got 313240 \(-2\)/);
    expect(out).toMatch(/gcvsMatched\s+expected 3677, got 3680 \(\+3\)/);
  });

  it('header reports the mismatched count, not the matched count', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.solIndex = 99999;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(/1 of \d+ counts differ/);
  });

  it('labels a partition mismatch with its dotted bucket key', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    actual.lmcOverriddenByDistVia.cns5_plx = 3;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(
      /lmcOverriddenByDistVia\.cns5_plx\s+expected 0, got 3 \(\+3\)/,
    );
  });

  it('says "absent from snapshot" rather than printing a NaN delta', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (expected.lmcOverriddenByDistVia as Partial<Record<string, number>>).bailer_jones;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(
      /lmcOverriddenByDistVia\.bailer_jones\s+absent from snapshot, got 58/,
    );
    expect(out).not.toMatch(/NaN/);
  });
});

describe('formatPartition', () => {
  it('lists every bucket in declaration order, zeros included', () => {
    expect(formatPartition({ bailer_jones: 58, gaia_dr3_inversion: 2, curated: 0 })).toBe(
      'bailer_jones=58, gaia_dr3_inversion=2, curated=0',
    );
  });
});

describe('spectralSimbadPartitionError', () => {
  it('accepts a partition that exhausts the SIMBAD tier', () => {
    const counts = baseCounts();
    expect(
      counts.spectralSimbadBySourceId + counts.spectralSimbadByHip
        + counts.spectralSimbadByTyc + counts.spectralSimbadByGj,
    ).toBe(counts.spectralBySimbad);
    expect(spectralSimbadPartitionError(counts)).toBeNull();
  });

  it('names both sides when a namespace tally goes missing', () => {
    const counts = { ...baseCounts(), spectralSimbadByTyc: 0 };
    const err = spectralSimbadPartitionError(counts);
    expect(err).toMatch(/tyc 0/);
    expect(err).toMatch(/= 279714, but spectralBySimbad is 280000/);
  });

  it('catches a record counted under two namespaces at once', () => {
    const counts = baseCounts();
    expect(spectralSimbadPartitionError({
      ...counts, spectralSimbadByGj: counts.spectralSimbadByGj + 1,
    })).toMatch(/= 280001, but spectralBySimbad is 280000/);
  });
});
