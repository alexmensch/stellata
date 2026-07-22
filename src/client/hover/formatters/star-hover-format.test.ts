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
import { makeBinaries } from '../../binaries/binary-relation-fixture';
import { createBinarySystemMembership } from '../../binaries/binary-system-membership';
import { SystemMembershipRegistry } from '../../system-membership/system-membership';
import { formatStarHover, type StarHoverFormatContext } from './star-hover-format';

// Tiny fixture builder. Three stars by default — idx 0 is the named
// non-variable, idx 1 is the variable, idx 2 is the unnamed-but-HIP
// fallback. Tests pick the slot they want.
function buildCtx(overrides: Partial<StarHoverFormatContext> = {}): StarHoverFormatContext {
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
  // idx 0 A-class dwarf, idx 1 M-class with unknown luminosity, idx 2
  // fully unknown (class 8 / lum 255).
  const spectClass = new Float32Array([2, 6, 8]);
  const luminosityClass = new Uint8Array([2, 255, 255]);
  const flags = new Uint8Array(3);
  const gaiaSourceId = new BigUint64Array(3);
  const sid = new Uint32Array([101, 102, 103]);
  return {
    starLabels,
    gaiaSourceId,
    sid,
    spectralMap,
    spectClass,
    luminosityClass,
    flags,
    constellation,
    constellations,
    periodDays,
    amplitudeMag,
    binaries: null,
    nowJd: J2000_JD,
    ...overrides,
  };
}

// Local relation builder — unlike the shared fixture's sane-finite
// defaults, every orbital element defaults to NaN so a test opts into
// exactly the fields its tier needs (tier-3 lines gate on finiteness).
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

// Registry over the real binary provider — the system-card tests below
// exercise the formatter through the same membership path the shell
// wires (binaries + the live composite-suppress verdict).
function membershipOf(
  binaries: BinariesData,
  isCollapsed: (i: number) => boolean,
): SystemMembershipRegistry {
  const reg = new SystemMembershipRegistry();
  reg.register(createBinarySystemMembership({ getBinaries: () => binaries, isCollapsed }));
  return reg;
}

// idx 0 = primary "Sirius A", idx 1 = secondary "Sirius B". Reuses
// buildCtx's 3-slot fixture arrays.
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

// Camera distance used where a test doesn't care about the value.
const D_CAM = 7.07;

describe('formatStarHover', () => {
  beforeEach(() => {
    // fmtDistAuto reads module-level state. Pin to 'pc' so the golden
    // distance strings below stay stable regardless of test order.
    setUnit('pc');
  });

  it('formats a named non-variable star (Vega-like)', () => {
    const out = formatStarHover(0, 7.07, buildCtx());
    expect(out.name).toBe('Vega');
    // Camera distance 7.07 pc → '7.1 pc' via fmtDist's <100 pc tier
    // (one decimal). Spectral is the cleaned label + descriptor.
    expect(out.lines).toEqual([
      'Lyra · 7.1 pc',
      'A0 V · white main-sequence star',
    ]);
  });

  it('switches the distance to AU when the camera is close', () => {
    // 0.001 pc ≈ 206.3 AU — inside fmtDistAuto's AU regime.
    const out = formatStarHover(0, 0.001, buildCtx());
    expect(out.lines[0]).toBe('Lyra · 206 AU');
  });

  it('formats a variable star with period + Δmag (Mira-like)', () => {
    const out = formatStarHover(1, 87.74, buildCtx());
    expect(out.name).toBe('Mira');
    // Unknown luminosity class → raw-style label only, no descriptor.
    expect(out.lines).toEqual([
      'Cetus · 87.7 pc',
      'M5-9e',
      'Variable · Period 332d · Δmag 7.6',
    ]);
  });

  it('keeps only the primary component of a composite spectral', () => {
    const ctx = buildCtx({
      spectralMap: new Map([[0, 'K0III+K7V']]),
      spectClass: new Float32Array([5, 6, 8]),
      luminosityClass: new Uint8Array([4, 255, 255]),
    });
    const out = formatStarHover(0, D_CAM, ctx);
    expect(out.lines).toContain('K0 III · orange giant');
    expect(out.lines.some((l) => l.includes('K7'))).toBe(false);
  });

  it('formats an unnamed catalog star with the HIP fallback in the name line', () => {
    // idx 2 has constellation = 255 (no constellation) and no spectral
    // entry — distance is the only sub-line.
    const out = formatStarHover(2, 141.42, buildCtx());
    expect(out.name).toBe('HIP 99999');
    // fmtDist 100–10k tier uses Math.round.
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
    const out = formatStarHover(0, D_CAM, ctx);
    expect(out.lines).toContain('Variable · Period 0.57d · Δmag 1.0');
  });

  it('falls back to "Gaia DR3 <id>" when starLabels has no entry but the record carries a source_id', () => {
    const ctx = buildCtx({
      starLabels: new Map(),
      gaiaSourceId: new BigUint64Array([4472832130942575872n, 0n, 0n]),
    });
    expect(formatStarHover(0, D_CAM, ctx).name).toBe('Gaia DR3 4472832130942575872');
  });

  it('falls back to "Unnamed (SID #<n>)" when neither a label nor a Gaia id exists', () => {
    const ctx = buildCtx({ starLabels: new Map() });
    expect(formatStarHover(0, D_CAM, ctx).name).toBe('Unnamed (SID #101)');
  });

  it('marks a synthetic companion\'s brightness-derived class as estimated', () => {
    // Promoted WDS companion: class bytes from spectralFromAbsmag, no
    // raw spectral string, synthetic flag (0x20) set.
    const ctx = buildCtx({
      spectralMap: new Map(),
      flags: new Uint8Array([0x20, 0, 0]),
    });
    const out = formatStarHover(0, D_CAM, ctx);
    expect(out.lines).toContain('white main-sequence star (estimated)');
  });

  it('a real classification is never marked estimated', () => {
    const out = formatStarHover(0, D_CAM, buildCtx());
    expect(out.lines).toContain('A0 V · white main-sequence star');
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
    const out = formatStarHover(1, D_CAM, ctx);
    expect(out.name).toBe('Sirius B');
    expect(out.lines).toContain('Orbits Sirius A · ρ = 4.8 AU');
    expect(out.lines).toContain('P = 79.91 yr · e = 0.52');
  });

  it('Tier 2: secondary card flags the unknown orbit', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: FLAG_HAS_ORBIT, pDays: 9.21 * 365.25 }),
    ]);
    const out = formatStarHover(1, D_CAM, ctx);
    expect(out.name).toBe('Sirius B');
    expect(out.lines).toContain('Orbits Sirius A');
    expect(out.lines).toContain('P = 9.21 yr (unknown orbit)');
  });

  it('Tier 3: secondary card quotes the static sep + PA at its epoch', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: 0, sepArcsec: 5.3, paDeg: 132, sepPaEpochJd: J2000_JD }),
    ]);
    const out = formatStarHover(1, D_CAM, ctx);
    expect(out.lines).toContain('Visual companion of Sirius A');
    expect(out.lines).toContain('ρ = 5.3″ · PA 132° at J2000.0');
  });

  it('renders a sub-year period in days (spectroscopic pair)', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: FLAG_HAS_ORBIT, pDays: 9.21 }),
    ]);
    expect(formatStarHover(1, D_CAM, ctx).lines).toContain('P = 9.21 d (unknown orbit)');
  });

  it('primary card lists the sole companion under the shared heading', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: FLAG_HAS_ORBIT, pDays: 9.21 * 365.25 }),
    ]);
    const out = formatStarHover(0, D_CAM, ctx);
    expect(out.name).toBe('Sirius A');
    expect(out.lines).toContain('Known companions:');
    expect(out.lines).toContain('Sirius B');
  });

  it('primary card lists every companion on its own line under the heading', () => {
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
    const out = formatStarHover(0, D_CAM, ctx);
    expect(out.lines).toContain('Known companions:');
    expect(out.lines).toContain('Sirius B');
    expect(out.lines).toContain('Sirius C');
  });

  it('merges tier-3 relations quoting the identical measurement into one heading', () => {
    // HD-108250 shape: one secondary anchored off two members of the
    // same system, both rows carrying the same wide measurement.
    const ctx = binaryCtx(
      [
        makeRelation({ primaryIdx: 0, secondaryIdx: 2, flags: 0, sepArcsec: 88.4, paDeg: 202, sepPaEpochJd: J2000_JD }),
        makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: 0, sepArcsec: 88.4, paDeg: 202, sepPaEpochJd: J2000_JD }),
      ],
      {
        starLabels: new Map<number, string>([
          [0, 'Acrux'],
          [1, 'Acrux B'],
          [2, 'HD 108250'],
        ]),
      },
    );
    const out = formatStarHover(2, D_CAM, ctx);
    expect(out.lines).toContain('Visual companion of Acrux and Acrux B');
    expect(out.lines).toContain('ρ = 88.4″ · PA 202° at J2000.0');
    // Exactly one heading + one detail line — no per-primary repeat.
    expect(out.lines.filter((l) => l.startsWith('Visual companion'))).toHaveLength(1);
  });

  it('keeps separate blocks when the measurements differ', () => {
    const ctx = binaryCtx(
      [
        makeRelation({ primaryIdx: 0, secondaryIdx: 2, flags: 0, sepArcsec: 88.4, paDeg: 202, sepPaEpochJd: J2000_JD }),
        makeRelation({ primaryIdx: 1, secondaryIdx: 2, flags: 0, sepArcsec: 90.1, paDeg: 204, sepPaEpochJd: J2000_JD }),
      ],
      {
        starLabels: new Map<number, string>([
          [0, 'Acrux'],
          [1, 'Acrux B'],
          [2, 'HD 108250'],
        ]),
      },
    );
    const out = formatStarHover(2, D_CAM, ctx);
    expect(out.lines).toContain('Visual companion of Acrux');
    expect(out.lines).toContain('Visual companion of Acrux B');
  });

  it('single-relation secondaries render exactly as before', () => {
    const ctx = binaryCtx([
      makeRelation({ flags: 0, sepArcsec: 5.3, paDeg: 132, sepPaEpochJd: J2000_JD }),
    ]);
    const out = formatStarHover(1, D_CAM, ctx);
    expect(out.lines.filter((l) => l.startsWith('Visual companion'))).toEqual([
      'Visual companion of Sirius A',
    ]);
  });

  it('adds no companion line for a star in no relation', () => {
    const ctx = binaryCtx([
      makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: FLAG_HAS_ORBIT, pDays: 100 }),
    ]);
    // idx 2 is neither a primary nor a secondary here.
    const out = formatStarHover(2, D_CAM, ctx);
    expect(out.lines.some((l) => /orbits|companion/i.test(l))).toBe(false);
  });

  it('drops companion lines entirely when binaries.bin is absent', () => {
    const out = formatStarHover(1, D_CAM, binaryCtx([], { binaries: null }));
    expect(out.lines.some((l) => /orbits|companion/i.test(l))).toBe(false);
  });
});

describe('formatStarHover — system card for screen-collapsed multiples', () => {
  // Castor-like sextuple over 6 records: 0=A, 1=Aa2 (inner of A),
  // 2=B, 3=Bb2 (inner of B), 4=C, 5=D. Relations in topological order.
  const SYSTEM_RELS = [
    makeRelation({ primaryIdx: 0, secondaryIdx: 2 }),
    makeRelation({ primaryIdx: 0, secondaryIdx: 1 }),
    makeRelation({ primaryIdx: 2, secondaryIdx: 3 }),
    makeRelation({ primaryIdx: 0, secondaryIdx: 4 }),
    makeRelation({ primaryIdx: 0, secondaryIdx: 5 }),
  ];
  const LABELS = new Map<number, string>([
    [0, 'Castor'],
    [1, 'Castor Aa2'],
    [2, 'Castor B'],
    [3, 'Castor Bb2'],
    [4, 'Castor C'],
    [5, 'Castor D'],
  ]);
  const sysCtx = (over: Partial<StarHoverFormatContext> = {}): StarHoverFormatContext =>
    buildCtx({
      starLabels: LABELS,
      constellation: new Float32Array(6),
      spectClass: new Float32Array(6).fill(8),
      luminosityClass: new Uint8Array(6).fill(255),
      flags: new Uint8Array(6),
      periodDays: new Float32Array(6),
      amplitudeMag: new Float32Array(6),
      gaiaSourceId: new BigUint64Array(6),
      sid: new Uint32Array(6),
      binaries: makeBinaries(SYSTEM_RELS),
      ...over,
    });

  it('fully collapsed multiple: any member hover yields the full roster card', () => {
    const ctx = sysCtx({ membership: membershipOf(makeBinaries(SYSTEM_RELS), () => true) });
    for (const member of [0, 3]) {
      const out = formatStarHover(member, D_CAM, ctx);
      expect(out.name).toBe('Castor system');
      expect(out.lines).toEqual([
        'Lyra · 7.1 pc',
        '6 components:',
        'Castor, Castor B, Castor Aa2, Castor Bb2, Castor C, Castor D',
      ]);
    }
  });

  it('close-in viewing (nothing suppressed): per-component card unchanged', () => {
    const ctx = sysCtx({ membership: membershipOf(makeBinaries(SYSTEM_RELS), () => false) });
    const out = formatStarHover(2, D_CAM, ctx);
    expect(out.name).toBe('Castor B');
  });

  it('partially collapsed: roster lists only the overlapping cluster, not the whole system', () => {
    // Close-up Castor: only the spectroscopic inner pair (secondary 1)
    // is still suppressed; B/Bb2/C/D are resolved or off-screen.
    const ctx = sysCtx({ membership: membershipOf(makeBinaries(SYSTEM_RELS), (i) => i === 1) });
    const out = formatStarHover(0, D_CAM, ctx);
    expect(out.name).toBe('Castor system');
    expect(out.lines).toEqual([
      'Lyra · 7.1 pc',
      '2 of 6 components here:',
      'Castor, Castor Aa2',
    ]);
  });

  it('visibly separated member of a collapsed system keeps its own card (Proxima case)', () => {
    // α Cen from Sol: A+B collapse (secondary 1 suppressed); C sits
    // 2.2° away, its relation unsuppressed. Hovering C must NOT show
    // the system card even though other members are collapsed.
    const rels = [
      makeRelation({ primaryIdx: 0, secondaryIdx: 1 }),
      makeRelation({ primaryIdx: 0, secondaryIdx: 2 }),
    ];
    const ctx = buildCtx({
      starLabels: new Map([[0, 'Rigil Kentaurus'], [1, 'Toliman'], [2, 'Proxima Centauri']]),
      binaries: makeBinaries(rels),
      membership: membershipOf(makeBinaries(rels), (i) => i === 1),
    });
    expect(formatStarHover(2, D_CAM, ctx).name).toBe('Proxima Centauri');
    // Hovering the A+B composite point shows the cluster card for the
    // two overlapping members only.
    const out = formatStarHover(0, D_CAM, ctx);
    expect(out.name).toBe('Rigil Kentaurus system');
    expect(out.lines[1]).toBe('2 of 3 components here:');
    expect(out.lines[2]).toBe('Rigil Kentaurus, Toliman');
  });

  it('plain binary never swaps to a system card, suppressed or not', () => {
    const rels = [makeRelation({ primaryIdx: 0, secondaryIdx: 1 })];
    const ctx = buildCtx({
      binaries: makeBinaries(rels),
      membership: membershipOf(makeBinaries(rels), () => true),
    });
    expect(formatStarHover(0, D_CAM, ctx).name).toBe('Vega');
  });

  it('no membership hook (formatter reused without live collapse state): no swap', () => {
    const ctx = sysCtx();
    expect(formatStarHover(0, D_CAM, ctx).name).toBe('Castor');
  });

  it('planet-system members ride the roster: collapsed planets list by name, capped', () => {
    // Fake planet-shaped provider alongside the binary one: Castor
    // additionally "hosts" nine named bodies, all collapsed. Exercises
    // the mixed-kind roster (star names resolved, planet names carried
    // by the member) and the +N-more cap.
    const reg = membershipOf(makeBinaries(SYSTEM_RELS), () => true);
    const bodies = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((name, i) => ({
      target: { kind: 'planet' as const, idx: 100 + i },
      name,
    }));
    reg.register({
      membersOf: (t) =>
        t.kind === 'star' && t.idx === 0
          ? [{ target: { kind: 'star', idx: 0 }, name: null }, ...bodies]
          : [],
      collapsedClusterOf: (t) =>
        t.kind === 'star' && t.idx === 0
          ? [{ target: { kind: 'star', idx: 0 }, name: null }, ...bodies]
          : [],
    });
    const out = formatStarHover(0, D_CAM, sysCtx({ membership: reg }));
    expect(out.name).toBe('Castor system');
    // 6 stars + 9 planets = 15 members, all collapsed at the hover point.
    expect(out.lines[1]).toBe('15 components:');
    expect(out.lines[2]).toBe(
      'Castor, Castor B, Castor Aa2, Castor Bb2, Castor C, Castor D, b, c, d, e + 5 more',
    );
  });
});
