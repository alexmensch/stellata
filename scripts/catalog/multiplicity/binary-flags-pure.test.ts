import { describe, it, expect } from 'vitest';
import {
  VAR_TYPE_UNKNOWN,
  VAR_TYPE_ECLIPSING,
  FLAG_BINARY_PRIMARY,
} from '../../../src/catalog-format/record/catalog-pure';
import {
  inferBinaries,
  pickBrightest,
  markPrimary,
  markPrimaryIfUnflagged,
  flagGroupPrimaries,
  hasGaiaQualityDistance,
  isOpticalDoublePrimary,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  type OpticalDoubleStar,
  type OpticalDoubleContext,
  buildHipToIndex,
  BINARY_MAX_SEP_PC,
  type BinaryStar,
  type DoublesStar,
  wingEclipsingBinaries,
} from './binary-flags-pure';

describe('binary-flags-pure / inferBinaries', () => {
  function makeStar(opts: Partial<BinaryStar> & { x: number; y: number; z: number; absmag: number }): BinaryStar {
    return { flags: 0, companionIdx: -1, ...opts };
  }

  it('flags a single close pair as a binary', () => {
    // Two stars at 0.001 pc apart — well under BINARY_MAX_SEP_PC (0.005 pc).
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.binaryPairs).toBe(2); // both record the other as companion
    expect(stats.binaryMutualPairs).toBe(1);
    expect(stars[0].companionIdx).toBe(1);
    expect(stars[1].companionIdx).toBe(0);
  });

  it('flags the brighter (lower absmag) star as the primary', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 6 }),       // dimmer
      makeStar({ x: 0.001, y: 0, z: 0, absmag: 4 }),   // brighter
    ];
    inferBinaries(stars);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('does not pair stars that are further apart than BINARY_MAX_SEP_PC', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC * 2, y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.binaryPairs).toBe(0);
    expect(stars[0].companionIdx).toBe(-1);
    expect(stars[1].companionIdx).toBe(-1);
  });

  it('ignores stars exactly at the cutoff (strict less-than)', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
      makeStar({ x: BINARY_MAX_SEP_PC, y: 0, z: 0, absmag: 6 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(-1);
  });

  it('picks the nearest neighbour when several are within range', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),
      makeStar({ x: 0.0008, y: 0, z: 0, absmag: 6 }),
      makeStar({ x: 0.003,  y: 0, z: 0, absmag: 5 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1); // nearest, not brightest
  });

  it('does not pair a star with itself', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0, absmag: 4 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.binaryPairs).toBe(0);
    expect(stars[0].companionIdx).toBe(-1);
  });

  it('handles a triple system by pairing each member with its nearest', () => {
    const stars: BinaryStar[] = [
      makeStar({ x: 0,      y: 0, z: 0, absmag: 4 }),    // A — brightest
      makeStar({ x: 0.001,  y: 0, z: 0, absmag: 5 }),    // B
      makeStar({ x: 0.0009, y: 0, z: 0, absmag: 6 }),    // C
    ];
    const stats = inferBinaries(stars);
    // Distances: A-B=0.001, A-C=0.0009, B-C=0.0001.
    //   A's nearest is C (0.0009). C's nearest is B (0.0001). B's nearest is C.
    // Only B↔C is mutual; A→C is one-way (C points back to B).
    expect(stars[0].companionIdx).toBe(2);
    expect(stars[1].companionIdx).toBe(2);
    expect(stars[2].companionIdx).toBe(1);
    expect(stats.binaryMutualPairs).toBe(1);
    // Primary = brighter of mutual pair B↔C → B (absmag=5 < C's 6).
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    // A is not part of any mutual pair, so it is NOT flagged primary
    // even though it is the brightest of the three.
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('does not flag stars in non-mutual chains as primary', () => {
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
    const stats = inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1);
    expect(stars[1].companionIdx).toBe(2);
    expect(stars[2].companionIdx).toBe(1);
    expect(stars[3].companionIdx).toBe(2);
    expect(stats.binaryMutualPairs).toBe(1);
    // Primary = brighter of B↔C → B (absmag=4).
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[3].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('flags one primary per mutual pair when there are several', () => {
    // Two well-separated mutual pairs.
    const stars: BinaryStar[] = [
      makeStar({ x: 0,         y: 0, z: 0, absmag: 4 }),  // pair 1
      makeStar({ x: 0.001,     y: 0, z: 0, absmag: 5 }),
      makeStar({ x: 100,       y: 0, z: 0, absmag: 3 }),  // pair 2 (brightest in catalog)
      makeStar({ x: 100.001,   y: 0, z: 0, absmag: 6 }),
    ];
    const stats = inferBinaries(stars);
    expect(stats.binaryMutualPairs).toBe(2);
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeTruthy(); // pair 1 brighter
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeTruthy(); // pair 2 brighter
    expect(stars[3].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it('returns zero counts for an empty input', () => {
    expect(inferBinaries([])).toEqual({ binaryPairs: 0, binaryMutualPairs: 0 });
  });

  it('uses 3D distance, not 2D', () => {
    // Two stars separated only along z; would be 0 in xy projection.
    const stars: BinaryStar[] = [
      makeStar({ x: 0, y: 0, z: 0,     absmag: 4 }),
      makeStar({ x: 0, y: 0, z: 0.001, absmag: 6 }),
    ];
    inferBinaries(stars);
    expect(stars[0].companionIdx).toBe(1);
  });
});

describe("binary-flags-pure / markPrimary", () => {
  type Slim = { absmag: number; flags: number };
  const star = (absmag: number, flags = 0): Slim => ({ absmag, flags });

  it("flags the brightest (lowest absmag) of a group", () => {
    const stars: Slim[] = [star(6), star(4), star(5)];
    expect(markPrimary(stars, [0, 1, 2])).toBe(1);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
  });

  it("returns -1 for an empty group", () => {
    const stars: Slim[] = [star(4)];
    expect(markPrimary(stars, [])).toBe(-1);
    expect(stars[0].flags).toBe(0);
  });

  it("preserves pre-existing flag bits via OR", () => {
    const stars: Slim[] = [star(4, 0x01)];
    markPrimary(stars, [0]);
    expect(stars[0].flags & 0x01).toBeTruthy();
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("is idempotent under re-application to the same group", () => {
    const stars: Slim[] = [star(4), star(6)];
    markPrimary(stars, [0, 1]);
    const before = stars.map(s => s.flags);
    markPrimary(stars, [0, 1]);
    expect(stars.map(s => s.flags)).toEqual(before);
  });

  it("breaks ties on the first-encountered index", () => {
    // Both equally bright — the helper picks whichever it sees first
    // (matching the prior `i <= j ? i : j` behaviour for mutual pairs).
    const stars: Slim[] = [star(4), star(4)];
    expect(markPrimary(stars, [0, 1])).toBe(0);
  });
});

describe("binary-flags-pure / markPrimaryIfUnflagged", () => {
  type Slim = { absmag: number; flags: number };
  const star = (absmag: number, flags = 0): Slim => ({ absmag, flags });

  it("delegates to markPrimary when no member is pre-flagged", () => {
    const stars: Slim[] = [star(6), star(4), star(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1, 2])).toBe(1);
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("returns -2 (skip sentinel) when any member is already flagged", () => {
    // Geometric pass already picked stars[2] (e.g. mutual pair primary).
    // CCDM pass should not re-flag stars[0] even though it is brighter.
    const stars: Slim[] = [star(4), star(6), star(5, FLAG_BINARY_PRIMARY)];
    expect(markPrimaryIfUnflagged(stars, [0, 1, 2])).toBe(-2);
    expect(stars[0].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[1].flags & FLAG_BINARY_PRIMARY).toBeFalsy();
    expect(stars[2].flags & FLAG_BINARY_PRIMARY).toBeTruthy();
  });

  it("returns -1 for an empty group", () => {
    const stars: Slim[] = [star(4)];
    expect(markPrimaryIfUnflagged(stars, [])).toBe(-1);
  });

  it("is idempotent: a group whose primary it just flagged returns -2 next time", () => {
    const stars: Slim[] = [star(4), star(6)];
    expect(markPrimaryIfUnflagged(stars, [0, 1])).toBe(0);
    expect(markPrimaryIfUnflagged(stars, [0, 1])).toBe(-2);
  });

  it("does not flag any star when bailing on the pre-flagged check", () => {
    const stars: Slim[] = [star(4), star(6, FLAG_BINARY_PRIMARY)];
    markPrimaryIfUnflagged(stars, [0, 1]);
    // stars[0] was brighter but must remain unflagged because stars[1]
    // already carried the bit.
    expect(stars[0].flags).toBe(0);
  });
});

describe('binary-flags-pure / buildHipToIndex', () => {
  it('maps positive HIPs to their record index and skips null / non-positive', () => {
    const m = buildHipToIndex([
      { hip: 100 },
      { hip: null },
      { hip: 0 },
      { hip: 200 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get(100)).toBe(0);
    expect(m.get(200)).toBe(3);
  });

  it('keeps the FIRST occurrence on duplicate HIPs (brightest under absmag-sorted input)', () => {
    const m = buildHipToIndex([
      { hip: 100 },
      { hip: 100 },
      { hip: 100 },
    ]);
    expect(m.get(100)).toBe(0);
  });
});

describe('binary-flags-pure / flagGroupPrimaries', () => {
  // Mini Star fixture with just the fields flagGroupPrimaries reads/writes.
  function s(absmag: number, hip: number | null, flags = 0): DoublesStar {
    return { absmag, hip, flags };
  }

  it('flags the brightest in-catalog member of each group', () => {
    // Three stars; the group covers them all. Lowest absmag (=brightest)
    // should get FLAG_BINARY_PRIMARY; the others stay clean.
    const stars: DoublesStar[] = [s(4, 100), s(2, 200), s(6, 300)];
    const r = flagGroupPrimaries(stars, [[100, 200, 300]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(1);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
    expect(stars[0].flags).toBe(0);
    expect(stars[2].flags).toBe(0);
  });

  it('silently drops groups whose HIPs are all missing from the catalog', () => {
    const stars: DoublesStar[] = [s(4, 100), s(5, 200)];
    const r = flagGroupPrimaries(stars, [[999, 1000]], buildHipToIndex(stars));
    expect(r.systems).toBe(0);
    expect(r.flagged).toBe(0);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('counts a system but does not re-flag when a member already has the bit', () => {
    // Geometric pass already flagged the dimmer star; CCDM pass would
    // pick the brighter one but must defer per markPrimaryIfUnflagged's
    // contract.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200, FLAG_BINARY_PRIMARY)];
    const r = flagGroupPrimaries(stars, [[100, 200]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(0);
    expect(stars[0].flags).toBe(0);                    // not re-flagged
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);  // pre-existing bit preserved
  });

  it('flags one primary per group across multiple groups', () => {
    const stars: DoublesStar[] = [
      s(2, 100), s(3, 101), // group A — 100 brightest
      s(5, 200), s(4, 201), // group B — 201 brightest
    ];
    const r = flagGroupPrimaries(stars, [[100, 101], [200, 201]], buildHipToIndex(stars));
    expect(r.systems).toBe(2);
    expect(r.flagged).toBe(2);
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY); // 100 won group A
    expect(stars[3].flags).toBe(FLAG_BINARY_PRIMARY); // 201 won group B
    expect(stars[1].flags).toBe(0);
    expect(stars[2].flags).toBe(0);
  });

  it('handles override-style groups (curated visual doubles) the same as CCDM groups', () => {
    // The build-catalog wrapper unions CCDM-from-file groups and the
    // KNOWN_VISUAL_DOUBLES list before calling this; here we verify both
    // sources behave identically once unioned.
    const stars: DoublesStar[] = [s(3, 100), s(2, 101)];
    // Pretend the CCDM pass produced one group, the override another.
    const r = flagGroupPrimaries(stars, [[100], [101]], buildHipToIndex(stars));
    expect(r.systems).toBe(2);
    expect(r.flagged).toBe(2);
    // Each single-member group flags its own brightest (and only)
    // component.
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
  });

  it('skips HIP=0 / null records when building the lookup', () => {
    const stars: DoublesStar[] = [s(2, null), s(4, 0), s(3, 100)];
    const r = flagGroupPrimaries(stars, [[100]], buildHipToIndex(stars));
    expect(r.systems).toBe(1);
    expect(stars[2].flags).toBe(FLAG_BINARY_PRIMARY);
    // The 0/null-HIP rows must never be hit by HIP→index lookup.
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('is idempotent under re-application', () => {
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const idx = buildHipToIndex(stars);
    flagGroupPrimaries(stars, [[100, 200]], idx);
    const flagsBefore = stars.map((x) => x.flags);
    flagGroupPrimaries(stars, [[100, 200]], idx);
    // Second pass sees the existing primary bit and bails — no
    // additional bits set.
    expect(stars.map((x) => x.flags)).toEqual(flagsBefore);
  });

  it('reports suppressed=0 when no suppress predicate is supplied', () => {
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const r = flagGroupPrimaries(stars, [[100, 200]], buildHipToIndex(stars));
    expect(r.suppressed).toBe(0);
  });

  it('vetoes the fresh flag when the suppress predicate fires', () => {
    // Group {100, 200}; 100 is brightest. A predicate that suppresses the
    // picked primary leaves both stars unflagged and counts one suppression.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200)];
    const r = flagGroupPrimaries(
      stars,
      [[100, 200]],
      buildHipToIndex(stars),
      (primaryIdx) => primaryIdx === 0,
    );
    expect(r.systems).toBe(1);
    expect(r.flagged).toBe(0);
    expect(r.suppressed).toBe(1);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });

  it('never runs the suppress predicate on an already-flagged group', () => {
    // 200 already winged by a prior pass; the group short-circuits to a
    // no-op before the predicate would see the picked primary.
    const stars: DoublesStar[] = [s(2, 100), s(5, 200, FLAG_BINARY_PRIMARY)];
    let called = false;
    const r = flagGroupPrimaries(stars, [[100, 200]], buildHipToIndex(stars), () => {
      called = true;
      return true;
    });
    expect(called).toBe(false);
    expect(r.flagged).toBe(0);
    expect(r.suppressed).toBe(0);
    expect(stars[1].flags).toBe(FLAG_BINARY_PRIMARY);
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
  it('does not mutate — markPrimary is the flag-setting wrapper', () => {
    const stars = [{ absmag: 2, flags: 0 }];
    pickBrightest(stars, [0]);
    expect(stars[0].flags).toBe(0);
  });
});

describe('binary-flags-pure / markPrimaryIfUnflagged suppress hook', () => {
  const s = (absmag: number, flags = 0) => ({ absmag, flags });
  it('returns -3 and sets no bit when suppress vetoes the pick', () => {
    const stars = [s(2), s(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1], (i) => i === 0)).toBe(-3);
    expect(stars[0].flags).toBe(0);
    expect(stars[1].flags).toBe(0);
  });
  it('flags normally when suppress returns false', () => {
    const stars = [s(2), s(5)];
    expect(markPrimaryIfUnflagged(stars, [0, 1], () => false)).toBe(0);
    expect(stars[0].flags).toBe(FLAG_BINARY_PRIMARY);
  });
  it('short-circuits (-2) before consulting suppress on an already-flagged member', () => {
    const stars = [s(2), s(5, FLAG_BINARY_PRIMARY)];
    let called = false;
    expect(markPrimaryIfUnflagged(stars, [0, 1], () => { called = true; return true; })).toBe(-2);
    expect(called).toBe(false);
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

describe('binary-flags-pure / isOpticalDoublePrimary', () => {
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
    expect(isOpticalDoublePrimary(0, [0, 1], make(), ctx())).toBe(true);
  });
  it('keeps when the nearest sibling is within the limit', () => {
    const stars = make([{}, { x: 0.5 }]); // 0.5 pc apart
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary is a component of a physical pair (by HIP)', () => {
    expect(isOpticalDoublePrimary(0, [0, 1], make(), ctx({ physicalHips: new Set([100]) }))).toBe(false);
  });
  it('keeps when the primary is a physical-pair member by Gaia source_id', () => {
    const stars = make([{ gaiaSourceId: 'g1' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx({ physicalGaia: new Set(['g1']) }))).toBe(false);
  });
  it('keeps eclipsing primaries (extrinsic wings earned)', () => {
    const stars = make([{ varType: VAR_TYPE_ECLIPSING }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when the primary lacks a Gaia-quality distance', () => {
    const stars = make([{ distVia: 'hip2_parallax' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('keeps when no sibling has a Gaia-quality distance to measure against', () => {
    const stars = make([{}, { x: 3, distVia: 'hip2_parallax' }]);
    expect(isOpticalDoublePrimary(0, [0, 1], stars, ctx())).toBe(false);
  });
  it('measures the NEAREST sibling — a near Gaia-quality partner keeps the wings even beside a far one', () => {
    const stars: OpticalDoubleStar[] = [
      { absmag: 0, x: 0, y: 0, z: 0, hip: 100, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 },
      { absmag: 1, x: 0.3, y: 0, z: 0, hip: 200, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 }, // bound
      { absmag: 2, x: 900, y: 0, z: 0, hip: 300, gaiaSourceId: null, distVia: 'bailer_jones', varType: 0 }, // background
    ];
    expect(isOpticalDoublePrimary(0, [0, 1, 2], stars, ctx())).toBe(false);
  });
});

describe('binary-flags-pure / wingEclipsingBinaries', () => {
  it('wings each unflagged eclipsing record and counts only those', () => {
    const stars = [
      { flags: 0, varType: VAR_TYPE_ECLIPSING },
      { flags: FLAG_BINARY_PRIMARY, varType: VAR_TYPE_ECLIPSING },
      { flags: 0, varType: 0 },
    ];
    expect(wingEclipsingBinaries(stars)).toEqual({ eclipsingWinged: 1 });
    expect(stars.map((s) => s.flags)).toEqual([FLAG_BINARY_PRIMARY, FLAG_BINARY_PRIMARY, 0]);
  });
});
