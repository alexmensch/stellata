import { describe, it, expect } from 'vitest';
import {
  compareBuildCounts,
  formatCountDiff,
  formatDistSrcPartition,
  type BuildCounts,
} from './build-counts';

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
    bjEntries: 310000,
    bjEligible: 305000,
    bjOverridden: 304000,
    bjOverriddenByDistSrc: {
      G_R3: 303200, G_R2: 800, HIP: 0, GJ: 0, N: 0, OTHER: 0, UNRECOGNISED: 0,
    },
    lmcCandidates: 1200,
    lmcOverridden: 60,
    lmcOverriddenByDistSrc: {
      G_R3: 58, G_R2: 2, HIP: 0, GJ: 0, N: 0, OTHER: 0, UNRECOGNISED: 0,
    },
    nameTableEntries: 350,
    variableCount: 3677,
    searchEntries: 290000,
    solIndex: 100000,
    figureCount: 500,
    figureConstellations: 88,
    gaiaSourceIdResolved: 307000,
    gaiaSourceIdBackfilled: 191,
    gaiaBindingMagRejected: 70,
    gaiaBindingSiblingRejected: 2,
    simbadWdsXidsEntries: 20403,
    apsisEntries: 270000,
    apsisMatched: 260000,
    apsisTeffEither: 255000,
    simbadSptypeEntries: 320000,
    spectralByCurated: 1,
    spectralBySimbad: 280000,
    spectralByGspspec: 25000,
    spectralFallback: 8000,
    ciSpectralDerived: 1200,
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
    companionRepositionedCollocatedDouble: 1,
    companionConstellationInherited: 0,
    componentLettersStamped: 2,
    componentNameCollisionsResolved: 0,
    componentNameCollisionsUnresolved: 0,
    gaiaAstrometryEntries: 315000,
    hip2Entries: 117000,
    nssSourceIdEntries: 356000,
    hipDistFullPrecision: 1900,
    directionGaia5p: 300000,
    directionGaiaNssSystemic: 10000,
    directionHip2Saturated: 2500,
    directionHip2PmDiscrepant: 146,
    directionAthygPrinted: 30,
    velocityGaiaPm: 308000,
    velocityHip2Pm: 2600,
    velocityAthygPm: 25,
    velocityZero: 2617,
    velocityClamped: 40,
    velocityAboveEscape: 50,
    velocityRvApplied: 267000,
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
    actual.bjOverriddenByDistSrc.HIP = 11;
    const mismatches = compareBuildCounts(expected, actual)
      .filter((d) => d.status === 'mismatch');
    expect(mismatches).toEqual([{
      key: 'bjOverriddenByDistSrc.HIP',
      status: 'mismatch',
      expected: 0,
      actual: 11,
    }]);
  });

  it('flags a partition bucket the snapshot has no entry for', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (expected.bjOverriddenByDistSrc as Partial<Record<string, number>>).G_R2;
    const mismatches = compareBuildCounts(expected, actual)
      .filter((d) => d.status === 'mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].key).toBe('bjOverriddenByDistSrc.G_R2');
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
    actual.lmcOverriddenByDistSrc.N = 3;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(
      /lmcOverriddenByDistSrc\.N\s+expected 0, got 3 \(\+3\)/,
    );
  });

  it('says "absent from snapshot" rather than printing a NaN delta', () => {
    const expected = baseCounts();
    const actual = baseCounts();
    delete (expected.lmcOverriddenByDistSrc as Partial<Record<string, number>>).G_R3;
    const out = formatCountDiff(compareBuildCounts(expected, actual));
    expect(out).toMatch(
      /lmcOverriddenByDistSrc\.G_R3\s+absent from snapshot, got 58/,
    );
    expect(out).not.toMatch(/NaN/);
  });
});

describe('formatDistSrcPartition', () => {
  it('lists every bucket including the zeros', () => {
    expect(formatDistSrcPartition(baseCounts().lmcOverriddenByDistSrc)).toBe(
      'G_R3=58, G_R2=2, HIP=0, GJ=0, N=0, OTHER=0, UNRECOGNISED=0',
    );
  });
});
