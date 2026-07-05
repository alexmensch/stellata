import { beforeEach, describe, expect, it } from 'vitest';
import { setUnit } from '../../ui/distance-util';
import { J2000_JD } from '../../util/astronomy-constants';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  NO_PARENT,
  type BinariesData,
  type BinaryRelation,
} from '../../binaries/binaries-loader';
import { formatStarHover, type StarHoverFormatContext } from './star-hover-format';

// Tiny fixture builder. Three stars by default — idx 0 is the named
// non-variable, idx 1 is the variable, idx 2 is the unnamed-but-HIP
// fallback. Tests pick the slot they want.
function buildCtx(overrides: Partial<StarHoverFormatContext> = {}): StarHoverFormatContext {
  const positions = new Float32Array([
    // idx 0 — Vega-like distance (~7.7 pc)
    5, 4, 3,
    // idx 1 — Mira-like distance (~92 pc)
    60, 50, 40,
    // idx 2 — far unnamed (~150 pc)
    100, 80, 60,
  ]);
  const constellation = new Float32Array([0, 1, 255]);
  const constellations = [{ name: 'Lyra' }, { name: 'Cetus' }];
  const periodDays = new Float32Array([0, 332, 0]);
  const amplitudeMag = new Float32Array([0, 7.6, 0]);
  const starLabels = new Map<number, string>([
    [0, 'Vega'],
    [1, 'Mira'],
    [2, 'HIP 99999'],
  ]);
  const spectralMap = new Map<number, string>([
    [0, 'A0V'],
    [1, 'M5-9e'],
    // idx 2: no spectral entry — exercise the no-spectral path
  ]);
  return {
    starLabels,
    spectralMap,
    positions,
    constellation,
    constellations,
    periodDays,
    amplitudeMag,
    binaries: null,
    nowJd: J2000_JD,
    ...overrides,
  };
}

// Binary-relation fixture builders. Defaults are NaN for every orbital
// element so a test opts into exactly the fields its tier needs.
function makeRelation(o: Partial<BinaryRelation>): BinaryRelation {
  return {
    primaryIdx: 0,
    secondaryIdx: 1,
    flags: 0,
    parentRelation: NO_PARENT,
    pDays: NaN,
    tJd: NaN,
    e: NaN,
    aAU: NaN,
    iRad: NaN,
    omegaRad: NaN,
    OmegaRad: NaN,
    q: NaN,
    sepArcsec: NaN,
    paDeg: NaN,
    sepPaEpochJd: J2000_JD,
    ...o,
  };
}

function makeBinaries(relations: BinaryRelation[]): BinariesData {
  const primaryIdxToRelations = new Map<number, number[]>();
  const secondaryIdxToRelation = new Map<number, number>();
  relations.forEach((r, i) => {
    const arr = primaryIdxToRelations.get(r.primaryIdx);
    if (arr) arr.push(i);
    else primaryIdxToRelations.set(r.primaryIdx, [i]);
    if (!secondaryIdxToRelation.has(r.secondaryIdx)) {
      secondaryIdxToRelation.set(r.secondaryIdx, i);
    }
  });
  return { version: 1, relations, primaryIdxToRelations, secondaryIdxToRelation };
}

// idx 0 = primary "Sirius A", idx 1 = secondary "Sirius B". Reuses
// buildCtx's 3-slot position/constellation arrays.
function binaryCtx(
  relations: BinaryRelation[],
  overrides: Partial<StarHoverFormatContext> = {},
): StarHoverFormatContext {
  return buildCtx({
    starLabels: new Map<number, string>([
      [0, 'Sirius A'],
      [1, 'Sirius B'],
    ]),
    binaries: makeBinaries(relations),
    ...overrides,
  });
}

describe('formatStarHover', () => {
  beforeEach(() => {
    // fmtDist reads module-level state. Pin to 'pc' so the golden
    // distance strings below stay stable regardless of test order.
    setUnit('pc');
  });

  it('formats a named non-variable star (Vega-like)', () => {
    const out = formatStarHover(0, buildCtx());
    expect(out.name).toBe('Vega');
    // Distance = sqrt(5² + 4² + 3²) = sqrt(50) ≈ 7.07 pc → '7.1 pc'
    // via fmtDist's <100 pc tier (one decimal).
    expect(out.lines).toEqual([
      'Lyra · 7.1 pc',
      'A0V',
    ]);
  });

  it('formats a variable star with period + Δmag (Mira-like)', () => {
    const out = formatStarHover(1, buildCtx());
    expect(out.name).toBe('Mira');
    // Distance = sqrt(60² + 50² + 40²) = sqrt(7700) ≈ 87.75 pc → '87.7 pc'
    // (fmtDist <100 pc tier uses toFixed(1) which truncates the 5).
    expect(out.lines).toEqual([
      'Cetus · 87.7 pc',
      'M5-9e',
      'Variable · Period 332d · Δmag 7.6',
    ]);
  });

  it('formats an unnamed catalog star with the HIP fallback in the name line', () => {
    // idx 2 has constellation = 255 (no constellation) and no spectral
    // entry — distance is the only sub-line.
    const out = formatStarHover(2, buildCtx());
    expect(out.name).toBe('HIP 99999');
    // sqrt(100² + 80² + 60²) = sqrt(20000) ≈ 141.42 pc → '141 pc'
    // (fmtDist 100–10k tier uses Math.round).
    expect(out.lines).toEqual([
      '141 pc',
    ]);
  });

  it('uses the short-period format (toFixed(2)) below 10 days', () => {
    // RR Lyrae-style short-period variable: period 0.567 days.
    const ctx = buildCtx({
      periodDays: new Float32Array([0.567, 0, 0]),
      amplitudeMag: new Float32Array([1.0, 0, 0]),
    });
    const out = formatStarHover(0, ctx);
    expect(out.lines).toContain('Variable · Period 0.57d · Δmag 1.0');
  });

  it('falls back to "Unnamed #idx" when starLabels has no entry', () => {
    const ctx = buildCtx({ starLabels: new Map() });
    expect(formatStarHover(0, ctx).name).toBe('Unnamed #0');
  });
});

describe('formatStarHover — binary companions', () => {
  beforeEach(() => setUnit('pc'));

  it('Tier 1: secondary card names the orbit, period, eccentricity, and live separation', () => {
    // e=0.52, i=0, ω=Ω=0, T=nowJd=J2000 → M=0, E=0, X=0.48, Y=0 →
    // (north, east, radial) = (a·0.48, 0, 0) = (4.8, 0, 0) AU → sep 4.8.
    const ctx = binaryCtx([
      makeRelation({
        flags: FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION,
        pDays: 79.91 * 365.25,
        tJd: J2000_JD,
        e: 0.52,
        aAU: 10,
        iRad: 0,
        omegaRad: 0,
        OmegaRad: 0,
        q: 0.3,
      }),
    ]);
    const out = formatStarHover(1, ctx);
    expect(out.name).toBe('Sirius B');
    expect(out.lines).toContain('Orbits Sirius A · ρ = 4.8 AU');
    expect(out.lines).toContain('P = 79.91 yr · e = 0.52');
  });

  it('Tier 2: secondary card flags the unknown orbit', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: FLAG_HAS_ORBIT, pDays: 9.21 * 365.25 }),
    ]);
    const out = formatStarHover(1, ctx);
    expect(out.name).toBe('Sirius B');
    expect(out.lines).toContain('Orbits Sirius A');
    expect(out.lines).toContain('P = 9.21 yr (unknown orbit)');
  });

  it('Tier 3: secondary card quotes the static sep + PA at its epoch', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: 0, sepArcsec: 5.3, paDeg: 132, sepPaEpochJd: J2000_JD }),
    ]);
    const out = formatStarHover(1, ctx);
    expect(out.lines).toContain('Visual companion of Sirius A');
    expect(out.lines).toContain('ρ = 5.3″ · PA 132° at J2000.0');
  });

  it('renders a sub-year period in days (spectroscopic pair)', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: FLAG_HAS_ORBIT, pDays: 9.21 }),
    ]);
    expect(formatStarHover(1, ctx).lines).toContain('P = 9.21 d (unknown orbit)');
  });

  it('primary card names the sole companion', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: FLAG_HAS_ORBIT, pDays: 9.21 * 365.25 }),
    ]);
    const out = formatStarHover(0, ctx);
    expect(out.name).toBe('Sirius A');
    expect(out.lines).toContain('1 known companion: Sirius B');
  });

  it('primary card lists every companion on its own line under a count heading', () => {
    const ctx = binaryCtx(
      [
        makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: FLAG_HAS_ORBIT, pDays: 100 }),
        makeRelation({ primaryIdx: 0, secondaryIdx: 2, flags: FLAG_HAS_ORBIT, pDays: 200 }),
      ],
      {
        starLabels: new Map<number, string>([
          [0, 'Sirius A'],
          [1, 'Sirius B'],
          [2, 'Sirius C'],
        ]),
      },
    );
    const out = formatStarHover(0, ctx);
    expect(out.lines).toContain('2 known companions:');
    expect(out.lines).toContain('Sirius B');
    expect(out.lines).toContain('Sirius C');
  });

  it('adds no companion line for a star in no relation', () => {
    const ctx = binaryCtx([
      makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: FLAG_HAS_ORBIT, pDays: 100 }),
    ]);
    // idx 2 is neither a primary nor a secondary here.
    const out = formatStarHover(2, ctx);
    expect(out.lines.some((l) => /orbits|companion/i.test(l))).toBe(false);
  });

  it('drops companion lines entirely when binaries.bin is absent', () => {
    const out = formatStarHover(1, binaryCtx([], { binaries: null }));
    expect(out.lines.some((l) => /orbits|companion/i.test(l))).toBe(false);
  });
});
