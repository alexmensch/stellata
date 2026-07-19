import { beforeEach, describe, expect, it } from 'vitest';
import { setUnit } from '../../ui/distance-util';
import {
  moonNamesOf,
  SOL_BODIES,
  SOL_PLANETS,
  type PlanetSystem,
} from '../../solar-system/planet-system';
import { orbitDescriptorFor } from '../../solar-system/orbit-descriptor';
import {
  formatPlanetHover,
  type PlanetHoverFormatContext,
} from './planet-hover-format';

// Helper: per-body distance/mag map keyed by name, so the test inputs
// read in calling order rather than as bare numeric vectors. `bodies`
// defaults to the planets; a moon test passes SOL_BODIES.
function buildCtx(
  byName: { [name: string]: { appMag?: number | null } },
  bodies: readonly PlanetSystem['planets'][number][] = SOL_PLANETS,
): PlanetHoverFormatContext {
  const system: PlanetSystem = { hostStarIdx: 0, planets: bodies };
  return {
    planets: bodies,
    appMagFor(planetIdx) {
      const entry = byName[bodies[planetIdx].name];
      return entry?.appMag ?? null;
    },
    orbitOf(planetIdx) {
      const p = bodies[planetIdx];
      return p ? orbitDescriptorFor(p, system, null) : null;
    },
    moonsOf(planetIdx) {
      return moonNamesOf(bodies, planetIdx);
    },
  };
}

describe('formatPlanetHover', () => {
  beforeEach(() => {
    // fmtDistAuto switches to AU below 0.01 pc, but inside the AU band
    // it doesn't read the pc/ly unit toggle. Pin to 'pc' anyway so any
    // future regression that leaks the toggle into the AU tier surfaces.
    setUnit('pc');
  });

  it('formats Mercury from 0.31 AU away (camera distance + appMag)', () => {
    // 0.31 AU in pc = 0.31 / 206264.806 = 1.5029e-6 pc.
    // fmtDistAuto switches to AU below 0.01 pc; sub-AU values get
    // three decimals ("0.310 AU"), the AU 1–100 tier uses one
    // ("1.0 AU"), and ≥100 AU floor-rounds. Test pins each tier.
    const out = formatPlanetHover(0, 0.31 / 206264.80624709636, buildCtx({
      Mercury: { appMag: -2.5 },
    }));
    expect(out.name).toBe('Mercury');
    expect(out.lines).toEqual([
      '0.310 AU · Vmag -2.5',
      'Period 0.24 yr',
      'Radius 0.38 R⊕ (2,440 km)',
    ]);
  });

  it('formats Earth at a representative orbital distance', () => {
    // Earth idx = 2. A fixed 1 AU camera distance for golden-string
    // stability; the live hover path reads the pick's camera distance.
    const out = formatPlanetHover(2, 1 / 206264.80624709636, buildCtx({
      Earth: { appMag: -3.99 },
    }));
    expect(out.name).toBe('Earth');
    expect(out.lines).toEqual([
      '1.0 AU · Vmag -4.0',
      'Period 1.00 yr',
      'Radius 1.00 R⊕ (6,371 km)',
    ]);
  });

  it('formats Jupiter (whole-year period, thousands-separated radius)', () => {
    // Jupiter idx = 4. 5.2 AU camera distance, appMag −2.7 at Earth
    // opposition (sign explicit when negative).
    const out = formatPlanetHover(4, 5.2 / 206264.80624709636, buildCtx({
      Jupiter: { appMag: -2.7 },
    }));
    expect(out.name).toBe('Jupiter');
    // Kepler 3rd law: 5.203^1.5 ≈ 11.86 → rounds to 12 (>= 10 tier).
    expect(out.lines).toEqual([
      '5.2 AU · Vmag -2.7',
      'Period 12 yr',
      'Radius 11.0 R⊕ (69,911 km)',
    ]);
  });

  it('positive-mag planet renders an explicit + sign', () => {
    const out = formatPlanetHover(8, 39 / 206264.80624709636, buildCtx({
      Pluto: { appMag: 14.3 },
    }));
    expect(out.name).toBe('Pluto');
    expect(out.lines[0]).toBe('39.0 AU · Vmag +14.3');
  });

  it('drops the Vmag half of the head line when appMag is null', () => {
    // The provider should never hand the formatter a null appMag (the
    // pick path returns null whenever the planet isn't visible) but
    // guard the formatter against the degenerate state — the camera
    // distance still renders.
    const out = formatPlanetHover(2, 1 / 206264.80624709636, buildCtx({
      Earth: { appMag: null },
    }));
    expect(out.name).toBe('Earth');
    expect(out.lines).toEqual([
      '1.0 AU',
      'Period 1.00 yr',
      'Radius 1.00 R⊕ (6,371 km)',
    ]);
  });

  it('a moon shows a day-scale period against its parent, not solar years', () => {
    // Europa's body index in SOL_BODIES; period is Kepler-III against
    // Jupiter's GM (~3.55 d), NOT planetPeriodYears on its tiny
    // parent-relative AU (which would read "0.00 yr").
    const europaIdx = SOL_BODIES.findIndex((b) => b.name === 'Europa');
    const out = formatPlanetHover(
      europaIdx,
      671100 / 1.495978707e8 / 206264.80624709636,
      buildCtx({ Europa: { appMag: 5.3 } }, SOL_BODIES),
    );
    expect(out.name).toBe('Europa');
    expect(out.lines[1]).toBe('Period 3.55 d');
  });

  it('returns empty payload for out-of-range index', () => {
    const out = formatPlanetHover(99, 1, buildCtx({}));
    expect(out).toEqual({ name: '', lines: [] });
  });

  it('a moon-parenting planet lists its moons; four Galileans fit uncapped', () => {
    const jupiter = SOL_BODIES.findIndex((p) => p.name === 'Jupiter');
    const out = formatPlanetHover(
      jupiter, 1, buildCtx({ Jupiter: { appMag: -2.7 } }, SOL_BODIES));
    expect(out.lines[out.lines.length - 1])
      .toBe('Moons Io, Europa, Ganymede, Callisto');
  });

  it("Saturn's seven moons truncate to the hover name cap", () => {
    const saturn = SOL_BODIES.findIndex((p) => p.name === 'Saturn');
    const out = formatPlanetHover(
      saturn, 1, buildCtx({ Saturn: { appMag: 0.5 } }, SOL_BODIES));
    expect(out.lines[out.lines.length - 1])
      .toBe('Moons Mimas, Enceladus, Tethys +4 more');
  });

  it('moonless bodies and moons themselves carry no roster line', () => {
    for (const name of ['Mercury', 'Europa']) {
      const idx = SOL_BODIES.findIndex((p) => p.name === name);
      const out = formatPlanetHover(idx, 1, buildCtx({}, SOL_BODIES));
      expect(out.lines.some((l) => l.startsWith('Moons'))).toBe(false);
    }
  });

  it('swaps to the roster card when the body has a collapsed cluster', () => {
    // Jupiter (idx 4) with two of its moons sub-pixel: the membership
    // queries report the Jupiter sub-system (Jupiter + its moons) —
    // one hierarchy level, never the whole Sol roster.
    const jupiter = { target: { kind: 'planet' as const, idx: 4 }, name: 'Jupiter' };
    const moons = ['Io', 'Europa', 'Ganymede', 'Callisto'].map((name, i) => ({
      target: { kind: 'planet' as const, idx: 30 + i },
      name,
    }));
    const ctx = buildCtx({ Jupiter: { appMag: -2.7 } }, SOL_BODIES);
    ctx.targetOf = (i) => ({ kind: 'planet', idx: i });
    ctx.membership = {
      membersOf: (t) =>
        t.kind === 'planet' && t.idx === 4 ? [jupiter, ...moons] : [],
      collapsedClusterOf: (t) =>
        t.kind === 'planet' && t.idx === 4 ? [jupiter, moons[0], moons[1]] : [],
    };
    const out = formatPlanetHover(4, 5.2 / 206264.80624709636, ctx);
    expect(out.name).toBe('Jupiter system');
    expect(out.lines).toEqual([
      '5.2 AU',
      '3 of 5 components here:',
      'Jupiter, Io, Europa',
    ]);
  });

  it('keeps the per-body card when nothing is collapsed onto it', () => {
    const ctx = buildCtx({ Jupiter: { appMag: -2.7 } });
    ctx.targetOf = (i) => ({ kind: 'planet', idx: i });
    ctx.membership = { membersOf: () => [], collapsedClusterOf: () => [] };
    expect(formatPlanetHover(4, 5.2 / 206264.80624709636, ctx).name).toBe('Jupiter');
  });
});
