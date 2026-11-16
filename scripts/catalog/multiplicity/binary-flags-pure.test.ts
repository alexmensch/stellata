import { describe, it, expect } from 'vitest';
import {
  VAR_TYPE_UNKNOWN,
  VAR_TYPE_ECLIPSING,
} from '../../../src/catalog-format/record/catalog-pure';
import {
  binaryPrimaries,
  eclipsingClaims,
  groupPrimaryClaims,
  inferBinaries,
  mutualPairs,
  pickBrightest,
  resolveGroups,
  hasGaiaQualityDistance,
  isOpticalDoubleMember,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  type OpticalDoubleStar,
  type OpticalDoubleContext,
  buildHipToIndex,
  BINARY_MAX_SEP_PC,
  type BinaryStar,
} from './binary-flags-pure';
import { enterPhase } from '../record/record-phase';

describe('binary-flags-pure / inferBinaries', () => {
  function makeStar(opts: BinaryStar): BinaryStar {
    return opts;
  }
  const geometricClaims = (stars: BinaryStar[]) =>
    groupPrimaryClaims(stars, inferBinaries(enterPhase('sorted', stars)).mutual, new Set()).claims;

  it('flags a single close pair as a binary', () => {
    // Two stars at 0.001 pc apart — well under BINARY_MAX_SEP_PC (0.005 pc).
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 6 }),
    ];
    const { counts: stats, nearest } = inferBinaries(enterPhase('sorted', stars));
    expect(stats.binaryPairs).toBe(2); // both record the other as companion
    expect(stats.binaryMutualPairs).toBe(1);
    expect(nearest[0]).toBe(1);
    expect(nearest[1]).toBe(0);
  });

  it('claims the brighter (lower absmag) star as the primary', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 6 }),       // dimmer
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 4 }),   // brighter
    ];
    expect(geometricClaims(stars)).toEqual([1]);
  });

  it('does not pair stars that are further apart than BINARY_MAX_SEP_PC', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC * 2, y: 0, z: 0, absmag: 6 }),
    ];
    const { counts: stats, nearest } = inferBinaries(enterPhase('sorted', stars));
    expect(stats.binaryPairs).toBe(0);
    expect(nearest[0]).toBe(-1);
    expect(nearest[1]).toBe(-1);
  });

  it('ignores stars exactly at the cutoff (strict less-than)', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC, y: 0, z: 0, absmag: 6 }),
    ];
    const { nearest } = inferBinaries(enterPhase('sorted', stars));
    expect(nearest[0]).toBe(-1);
  });

  it('picks the nearest neighbour when several are within range', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.0008, y: 0, z: 0, absmag: 6 }),
      makeStar({ x: 0.003,  y: 0, z: 0, absmag: 5 }),
    ];
    const { nearest } = inferBinaries(enterPhase('sorted', stars));
    expect(nearest[0]).toBe(1); // nearest, not brightest
  });

  it('does not pair a star with itself', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
    ];
    const { counts: stats, nearest } = inferBinaries(enterPhase('sorted', stars));
    expect(stats.binaryPairs).toBe(0);
    expect(nearest[0]).toBe(-1);
  });

  it('handles a triple system by pairing each member with its nearest', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),    // A — brightest
      makeStar({ x: 0.001,  y: 0, z: 0, absmag: 5 }),    // B
      makeStar({ x: 0.0009, y: 0, z: 0, absmag: 6 }),    // C
    ];
    const { counts, mutual, nearest } = inferBinaries(enterPhase('sorted', stars));
    // Distances: A-B=0.001, A-C=0.0009, B-C=0.0001.
    //   A's nearest is C (0.0009). C's nearest is B (0.0001). B's nearest is C.
    // Only B↔C is mutual; A→C is one-way (C points back to B).
    expect(nearest[0]).toBe(2);
    expect(nearest[1]).toBe(2);
    expect(nearest[2]).toBe(1);
    expect(counts.binaryMutualPairs).toBe(1);
    // Primary = brighter of mutual pair B↔C → B (absmag=5 < C's 6). A is in no
    // mutual pair, so it is NOT claimed even though it is the brightest.
    expect(groupPrimaryClaims(stars, mutual, new Set()).claims).toEqual([1]);
  });

  it('does not claim stars in non-mutual chains', () => {
    // 1D chain A-B-C-D where the inner B-C gap is the tightest, so
    // A→B and D→C (the outer stars point inward) but neither A nor D
    // is the nearest of anyone — they're chain ends. Only B↔C is
    // mutual.
    //   A=0, B=0.0030, C=0.0040, D=0.0070
    //   distances: A-B=0.0030, B-C=0.0010, C-D=0.0030,
    //              A-C=0.0040, A-D=0.0070 (above cutoff), B-D=0.0040.
    //   A→B (closer than C), B→C (0.0010 beats A's 0.0030),
    //   C→B (0.0010 beats D's 0.0030), D→C (closer than B).
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 3 }),
      makeStar({ x: 0.0030, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.0040, y: 0, z: 0, absmag: 5 }),
      makeStar({ x: 0.0070, y: 0, z: 0, absmag: 6 }),
    ];
    const { counts, mutual, nearest } = inferBinaries(enterPhase('sorted', stars));
    expect(nearest[0]).toBe(1);
    expect(nearest[1]).toBe(2);
    expect(nearest[2]).toBe(1);
    expect(nearest[3]).toBe(2);
    expect(counts.binaryMutualPairs).toBe(1);
    expect(groupPrimaryClaims(stars, mutual, new Set()).claims).toEqual([1]);
  });

  it('claims one primary per mutual pair when there are several', () => {
    // Two well-separated mutual pairs.
    const stars: BinaryStar[] = [
      makeStar({ x: 0,         y: 0, z: 0, absmag: 4 }),  // pair 1
      makeStar({ x: 0.001,     y: 0, z: 0, absmag: 5 }),
      makeStar({ x: 100,       y: 0, z: 0, absmag: 3 }),  // pair 2 (brightest in catalog)
      makeStar({ x: 100.001,   y: 0, z: 0, absmag: 6 }),
    ];
    expect(geometricClaims(stars)).toEqual([0, 2]);
  });

  it('returns zero counts for an empty input', () => {
    expect(inferBinaries(enterPhase('sorted', [])).counts).toEqual({ binaryPairs: 0, binaryMutualPairs: 0 });
  });

  it('uses 3D distance, not 2D', () => {
    // Two stars separated only along z; would be 0 in xy projection.
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0,     absmag: 4 }),
      makeStar({ x: 0, y: 0, z: 0.001, absmag: 6 }),
    ];
    const { nearest } = inferBinaries(enterPhase('sorted', stars));
    expect(nearest[0]).toBe(1);
  });
});

describe('binary-flags-pure / binaryPrimaries', () => {
  it('hands each claimant every earlier claim, and returns their union and each one\'s counts in order', () => {
    const seen: number[][] = [];
    const { primaries, counts } = binaryPrimaries(
      (claimed) => { seen.push([...claimed]); return { claims: [3], counts: 'first' }; },
      (claimed) => { seen.push([...claimed]); return { claims: [1, 4], counts: 2 }; },
      (claimed) => { seen.push([...claimed]); return { claims: [], counts: { last: true } }; },
    );
    expect(seen).toEqual([[], [3], [3, 1, 4]]);
    expect([...primaries].sort()).toEqual([1, 3, 4]);
    expect(counts).toEqual(['first', 2, { last: true }]);
  });

  it('orders the precedence by argument order alone: swapping two claimants swaps who wins a contested group', () => {
    const stars = [{ absmag: 2 }, { absmag: 5 }];
    const groupClaim = (claimed: ReadonlySet<number>) => groupPrimaryClaims(stars, [[0, 1]], claimed);
    const dimmerFirst = () => ({ claims: [1], counts: null });
    expect([...binaryPrimaries(dimmerFirst, groupClaim).primaries]).toEqual([1]);
    expect([...binaryPrimaries(groupClaim, dimmerFirst).primaries].sort()).toEqual([0, 1]);
  });
});

describe('binary-flags-pure / buildHipToIndex', () => {
  it('maps positive HIPs to their record index and skips null / non-positive', () => {
    const m = buildHipToIndex(enterPhase('sorted', [
      { hip: 100 },
      { hip: null },
      { hip: 0 },
      { hip: 200 },
    ]));
    expect(m.size).toBe(2);
    expect(m.get(100)).toBe(0);
    expect(m.get(200)).toBe(3);
  });

  it('keeps the FIRST occurrence on duplicate HIPs (brightest under absmag-sorted input)', () => {
    const m = buildHipToIndex(enterPhase('sorted', [
      { hip: 100 },
      { hip: 100 },
      { hip: 100 },
    ]));
    expect(m.get(100)).toBe(0);
  });
});

describe('binary-flags-pure / groupPrimaryClaims', () => {
  type Slim = { absmag: number; hip: number | null };
  const s = (absmag: number, hip: number | null): Slim => ({ absmag, hip });
  const none = new Set<number>();
  const groups = (stars: Slim[], hips: number[][]) => resolveGroups(hips, buildHipToIndex(enterPhase('sorted', stars)));

  it('claims the brightest in-catalog member of each group', () => {
    const stars = [s(4, 100), s(2, 200), s(6, 300)];
    const r = groupPrimaryClaims(stars, groups(stars, [[100, 200, 300]]), none);
    expect(r.claims).toEqual([1]);
    expect(r.counts).toEqual({ systems: 1, flagged: 1, suppressed: 0 });
  });

  it('silently drops groups whose HIPs are all missing from the catalog', () => {
    const stars = [s(4, 100), s(5, 200)];
    const r = groupPrimaryClaims(stars, groups(stars, [[999, 1000]]), none);
    expect(r.claims).toEqual([]);
    expect(r.counts).toEqual({ systems: 0, flagged: 0, suppressed: 0 });
  });

  it('counts a system but claims nothing when an earlier claimant took a member', () => {
    const stars = [s(2, 100), s(5, 200)];
    const r = groupPrimaryClaims(stars, groups(stars, [[100, 200]]), new Set([1]));
    expect(r.claims).toEqual([]);
    expect(r.counts).toEqual({ systems: 1, flagged: 0, suppressed: 0 });
  });

  it('defers to its own earlier group, as to an earlier claimant', () => {
    const stars = [s(2, 100), s(5, 200), s(1, 300)];
    const r = groupPrimaryClaims(stars, groups(stars, [[100, 200], [100, 300]]), none);
    expect(r.claims).toEqual([0]);
  });

  it('claims one primary per group across multiple groups', () => {
    const stars = [
      s(2, 100), s(3, 101), // group A — 100 brightest
      s(5, 200), s(4, 201), // group B — 201 brightest
    ];
    const r = groupPrimaryClaims(stars, groups(stars, [[100, 101], [200, 201]]), none);
    expect(r.claims).toEqual([0, 3]);
    expect(r.counts.flagged).toBe(2);
  });

  it('skips HIP=0 / null records when building the lookup', () => {
    const stars = [s(2, null), s(4, 0), s(3, 100)];
    expect(groupPrimaryClaims(stars, groups(stars, [[100]]), none).claims).toEqual([2]);
  });

  it('breaks ties on the first-encountered index', () => {
    const stars = [s(4, 100), s(4, 200)];
    expect(groupPrimaryClaims(stars, groups(stars, [[100, 200]]), none).claims).toEqual([0]);
  });

  it('vetoes the pick when the suppress predicate fires, and counts it', () => {
    const stars = [s(2, 100), s(5, 200)];
    const r = groupPrimaryClaims(stars, groups(stars, [[100, 200]]), none, (primaryIdx) => primaryIdx === 0);
    expect(r.claims).toEqual([]);
    expect(r.counts).toEqual({ systems: 1, flagged: 0, suppressed: 1 });
  });

  it('never runs the suppress predicate on a group with a claimed member', () => {
    const stars = [s(2, 100), s(5, 200)];
    let called = false;
    const r = groupPrimaryClaims(stars, groups(stars, [[100, 200]]), new Set([1]), () => {
      called = true;
      return true;
    });
    expect(called).toBe(false);
    expect(r.counts).toEqual({ systems: 1, flagged: 0, suppressed: 0 });
  });
});

describe('binary-flags-pure / pickBrightest', () => {
  const s = (absmag: number) => ({ absmag });
  it('returns the lowest-absmag index', () => {
    expect(pickBrightest([s(4), s(2), s(6)], [0, 1, 2])).toBe(1);
  });
  it('returns -1 for an empty index list', () => {
    expect(pickBrightest([s(4)], [])).toBe(-1);
  });
});

describe('binary-flags-pure / hasGaiaQualityDistance', () => {
  it('accepts the two tiers that rest on a Gaia parallax', () => {
    expect(hasGaiaQualityDistance('gaia_dr3_inversion')).toBe(true);
    expect(hasGaiaQualityDistance('bailer_jones')).toBe(true);
  });
  it('rejects every tier resting on someone else\'s measurement', () => {
    for (const via of [
      'hip2_parallax', 'cns5_plx', 'gliese_plx', 'simbad_plx',
      'pair_member_parallax', 'lmc_kinematic', 'curated',
    ] as const) {
      expect(hasGaiaQualityDistance(via), via).toBe(false);
    }
  });
});

describe('binary-flags-pure / isOpticalDoubleMember', () => {
  // Two components 3 pc apart on the x-axis, both Gaia-quality, no physical
  // evidence — the canonical optical double.
  function make(overrides: Partial<OpticalDoubleStar>[] = []): OpticalDoubleStar[] {
    const base: OpticalDoubleStar = {
      absmag: 0, x: 0, y: 0, z: 0, hip: null, gaiaSourceId: null,
      distVia: 'bailer_jones', varType: VAR_TYPE_UNKNOWN,
    };
    const stars: OpticalDoubleStar[] = [
      { ...base, hip: 100 },
      { ...base, hip: 200, x: 3 },
    ];
    overrides.forEach((o, i) => Object.assign(stars[i], o));
    return stars;
  }
  const ctx = (over: Partial<OpticalDoubleContext> = {}): OpticalDoubleContext => ({
    physicalHips: new Set(), physicalGaia: new Set(),
    minSepPc: OPTICAL_DOUBLE_MIN_SEP_PC, ...over,
  });

  it('suppresses when the nearest Gaia-quality sibling is beyond the limit', () => {
    expect(isOpticalDoubleMember(0, [0, 1], make(), ctx())).toBe(true);
  });
  it('keeps when the nearest sibling is within the limit', () => {
    const stars = make([{}, { x: 0.5 }]); // 0.5 pc apart
    expect(isOpticalDoubleMember(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary is a component of a physical pair (by HIP)', () => {
    expect(isOpticalDoubleMember(0, [0, 1], make(), ctx({ physicalHips: new Set([100]) }))).toBe(false);
  });
  it('keeps when the primary is a physical-pair member by Gaia source_id', () => {
    const stars = make([{ gaiaSourceId: 'g1' }]);
    expect(isOpticalDoubleMember(0, [0, 1], stars, ctx({ physicalGaia: new Set(['g1']) }))).toBe(false);
  });
  it('keeps eclipsing primaries (extrinsic wings earned)', () => {
    const stars = make([{ varType: VAR_TYPE_ECLIPSING }]);
    expect(isOpticalDoubleMember(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary lacks a Gaia-quality distance', () => {
    const stars = make([{ distVia: 'hip2_parallax' }]);
    expect(isOpticalDoubleMember(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when no sibling has a Gaia-quality distance to measure against', () => {
    const stars = make([{}, { x: 3, distVia: 'hip2_parallax' }]);
    expect(isOpticalDoubleMember(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('measures the NEAREST sibling — a near Gaia-quality partner keeps the wings even beside a far one', () => {
    const stars: OpticalDoubleStar[] = [
      { absmag: 0, x: 0, y: 0, z: 0, hip: 100, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 },
      { absmag: 1, x: 0.3, y: 0, z: 0, hip: 200, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 }, // bound
      { absmag: 2, x: 900, y: 0, z: 0, hip: 300, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 }, // background
    ];
    expect(isOpticalDoubleMember(0, [0, 1, 2], stars, ctx())).toBe(false);
  });
});

describe('binary-flags-pure / eclipsingClaims', () => {
  it('claims each eclipsing record no earlier claimant took, and counts only those', () => {
    const stars = enterPhase('sorted', [
      { varType: VAR_TYPE_ECLIPSING },
      { varType: VAR_TYPE_ECLIPSING },
      { varType: 0 },
    ]);
    expect(eclipsingClaims(stars, new Set([1]))).toEqual({ claims: [0], counts: { eclipsingWinged: 1 } });
  });
});

describe('binary-flags-pure / mutualPairs', () => {
  it('lists each pair whose members chose each other once, lower index first; one-way choices are not pairs', () => {
    expect(mutualPairs([3, 2, 1, 0, 3, -1])).toEqual([[0, 3], [1, 2]]);
  });
});
