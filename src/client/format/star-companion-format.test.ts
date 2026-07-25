import { describe, expect, it } from 'vitest';
import { J2000_JD } from '../util/astronomy-constants';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  type BinaryRelation,
} from '../binaries/binaries-loader';
import { makeBinaries, makeRelation } from '../binaries/binary-relation-fixture';
import {
  collapsedClusterIndices,
  companionLines,
  companionNames,
  companionOfLines,
  resolveStarName,
  systemMemberIndices,
  type CompanionFormatContext,
} from './star-companion-format';

const LABELS = new Map<number, string>([
  [0, 'Sirius A'],
  [1, 'Sirius B'],
  [2, 'Sirius C'],
]);

function ctxOf(
  rels: BinaryRelation[],
  over: Partial<CompanionFormatContext> = {},
): CompanionFormatContext {
  return {
    starLabels: LABELS,
    gaiaSourceId: new BigUint64Array(4),
    sid: new Uint32Array([101, 102, 103, 104]),
    binaries: makeBinaries(rels),
    nowJd: J2000_JD,
    ...over,
  };
}

// Periastron at the card's own epoch → E = 0 → ρ = a(1 − e) = 4.8 AU.
const KEPLER_ELEMENTS = {
  pDays: 79.91 * 365.25,
  tJd: J2000_JD,
  e: 0.52,
  aAU: 10,
  omegaRad: 0,
  q: 0.3,
};

describe('companionOfLines — tier 1', () => {
  it('quotes the live separation, period and eccentricity', () => {
    const rel = makeRelation({
      ...KEPLER_ELEMENTS,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      iRad: 0.9,
      OmegaRad: 2.1,
    });
    expect(companionOfLines(1, ctxOf([rel]))).toEqual([
      'Orbits Sirius A · ρ = 4.8 AU',
      'P = 79.91 yr · e = 0.52',
    ]);
  });

  it('tracks ρ as sim time advances — apoapsis half a period on', () => {
    const rel = makeRelation({
      ...KEPLER_ELEMENTS,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      iRad: 0.9,
    });
    const halfway = J2000_JD + KEPLER_ELEMENTS.pDays / 2;
    expect(companionOfLines(1, ctxOf([rel], { nowJd: halfway }))).toContain(
      'Orbits Sirius A · ρ = 15.2 AU',
    );
  });
});

describe('companionOfLines — tier 2', () => {
  it('flags the fallback plane and keeps every measured element', () => {
    const rel = makeRelation({ ...KEPLER_ELEMENTS, flags: FLAG_HAS_ORBIT });
    expect(companionOfLines(1, ctxOf([rel]))).toEqual([
      'Orbits Sirius A · ρ = 4.8 AU',
      'P = 79.91 yr · e = 0.52 (unknown orbital plane)',
    ]);
  });

  it('quotes the same ρ a measured plane would — only the orientation falls back', () => {
    const tier2 = makeRelation({ ...KEPLER_ELEMENTS, flags: FLAG_HAS_ORBIT });
    const tier1 = makeRelation({
      ...KEPLER_ELEMENTS,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      iRad: 1.31,
      OmegaRad: 0.44,
    });
    const rho = (rel: BinaryRelation) => companionOfLines(1, ctxOf([rel]))[0];
    expect(rho(tier2)).toBe(rho(tier1));
  });

  it('renders a sub-year period in days', () => {
    const rel = makeRelation({
      ...KEPLER_ELEMENTS,
      flags: FLAG_HAS_ORBIT,
      pDays: 9.21,
      e: 0,
      aAU: 0.1,
    });
    expect(companionOfLines(1, ctxOf([rel]))).toEqual([
      'Orbits Sirius A · ρ = 0.1 AU',
      'P = 9.21 d · e = 0.00 (unknown orbital plane)',
    ]);
  });
});

describe('companionOfLines — tier 3', () => {
  it('quotes the static measurement at its own epoch', () => {
    const rel = makeRelation({
      flags: 0,
      sepArcsec: 5.3,
      paDeg: 132,
      sepPaEpochJd: J2000_JD,
    });
    expect(companionOfLines(1, ctxOf([rel]))).toEqual([
      'Visual companion of Sirius A',
      'ρ = 5.3″ · PA 132° at J2000.0',
    ]);
  });

  it('drops the detail line when the record carries no measurement', () => {
    const rel = makeRelation({ flags: 0, sepArcsec: NaN, paDeg: NaN });
    expect(companionOfLines(1, ctxOf([rel]))).toEqual(['Visual companion of Sirius A']);
  });

  it('merges relations quoting the identical measurement into one heading', () => {
    const measurement = { flags: 0, sepArcsec: 88.4, paDeg: 202, sepPaEpochJd: J2000_JD };
    const rels = [
      makeRelation({ ...measurement, primaryIdx: 0, secondaryIdx: 2 }),
      makeRelation({ ...measurement, primaryIdx: 1, secondaryIdx: 2 }),
    ];
    expect(companionOfLines(2, ctxOf(rels))).toEqual([
      'Visual companion of Sirius A and Sirius B',
      'ρ = 88.4″ · PA 202° at J2000.0',
    ]);
  });

  it('keeps separate blocks when the measurements differ', () => {
    const rels = [
      makeRelation({ primaryIdx: 0, secondaryIdx: 2, flags: 0, sepArcsec: 88.4, paDeg: 202, sepPaEpochJd: J2000_JD }),
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: 0, sepArcsec: 90.1, paDeg: 204, sepPaEpochJd: J2000_JD }),
    ];
    expect(companionOfLines(2, ctxOf(rels)).filter((l) => l.startsWith('Visual'))).toEqual([
      'Visual companion of Sirius A',
      'Visual companion of Sirius B',
    ]);
  });
});

// The runtime gates every Kepler eval on has_orbit AND finite elements
// (keplerRelationParams), so a record failing the finite half animates as a
// static pair. The card has to read it the same way or it would advertise an
// orbit nothing renders.
describe('companionOfLines — malformed has_orbit record', () => {
  it.each([
    ['eccentricity', { e: NaN }],
    ['semi-major axis', { aAU: NaN }],
    ['periastron epoch', { tJd: NaN }],
    ['mass fraction', { q: NaN }],
  ])('reads a non-finite %s as a visual companion, not an orbit', (_field, broken) => {
    const rel = makeRelation({
      ...KEPLER_ELEMENTS,
      ...broken,
      flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
      sepArcsec: 5.3,
      paDeg: 132,
      sepPaEpochJd: J2000_JD,
    });
    expect(companionOfLines(1, ctxOf([rel]))).toEqual([
      'Visual companion of Sirius A',
      'ρ = 5.3″ · PA 132° at J2000.0',
    ]);
  });
});

describe('companionNames / companionLines', () => {
  const rels = [
    makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: 0 }),
    makeRelation({ primaryIdx: 0, secondaryIdx: 2, flags: 0 }),
  ];

  it('names every companion the star is primary of, in relation order', () => {
    expect(companionNames(0, ctxOf(rels))).toEqual(['Sirius B', 'Sirius C']);
  });

  it('returns nothing for a star that is nobody’s primary', () => {
    expect(companionNames(1, ctxOf(rels))).toEqual([]);
  });

  it('puts the roster under its heading, after the companion-of blocks', () => {
    const hierarchy = [
      makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: 0, sepArcsec: 5.3, paDeg: 132, sepPaEpochJd: J2000_JD }),
      makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: 0 }),
    ];
    expect(companionLines(1, ctxOf(hierarchy))).toEqual([
      'Visual companion of Sirius A',
      'ρ = 5.3″ · PA 132° at J2000.0',
      'Known companions:',
      'Sirius C',
    ]);
  });

  it('drops every line when binaries.bin is absent', () => {
    expect(companionLines(1, ctxOf(rels, { binaries: null }))).toEqual([]);
  });
});

describe('resolveStarName', () => {
  it('prefers the search-index label', () => {
    expect(resolveStarName(ctxOf([]), 0)).toBe('Sirius A');
  });

  it('falls back to the Gaia source id, then the SID — never the record index', () => {
    const gaiaSourceId = new BigUint64Array([0n, 0n, 0n, 4295806720n]);
    const ctx = ctxOf([], { starLabels: new Map(), gaiaSourceId });
    expect(resolveStarName(ctx, 3)).toBe('Gaia DR3 4295806720');
    expect(resolveStarName(ctx, 0)).toBe('Unnamed (SID #101)');
  });
});

describe('system membership', () => {
  // 0=A, 1=B (of A), 2=C (of B) — one connected chain.
  const rels = [
    makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: 0 }),
    makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: 0 }),
  ];

  it('walks the whole system from any member, outer primaries first', () => {
    expect(systemMemberIndices(makeBinaries(rels), 2)).toEqual([0, 1, 2]);
  });

  it('returns nothing for a star in no relation', () => {
    expect(systemMemberIndices(makeBinaries(rels), 3)).toEqual([]);
  });

  it('collapses only across edges whose secondary is suppressed right now', () => {
    const binaries = makeBinaries(rels);
    expect(collapsedClusterIndices(binaries, 0, (i) => i === 1)).toEqual([0, 1]);
    expect(collapsedClusterIndices(binaries, 0, () => false)).toEqual([0]);
  });
});
