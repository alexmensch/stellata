import { describe, expect, it } from 'vitest';
import { keplerPeriodDays, orbitDescriptorFor } from './orbit-descriptor';
import { SOL_BODIES, SOL_PLANETS, type PlanetSystem } from '../planet-system';
import { AU_KM } from '../../util/astronomy-constants';

const SYSTEM: PlanetSystem = { hostStarIdx: 0, planets: SOL_BODIES };
const bodyNamed = (name: string) => SOL_BODIES.find((p) => p.name === name)!;

describe('keplerPeriodDays', () => {
  it('recovers the Galilean sidereal periods from Jupiter GM', () => {
    const jupiterGM = SOL_PLANETS[4].gravParamGM!;
    // Io 1.769 d, Europa 3.551 d, Ganymede 7.155 d from the parent-relative
    // semi-major axes — Kepler III against Jupiter's mass, not the Sun's.
    expect(keplerPeriodDays(bodyNamed('Io').semiMajorAxisAu * AU_KM, jupiterGM)).toBeCloseTo(1.77, 1);
    expect(keplerPeriodDays(bodyNamed('Europa').semiMajorAxisAu * AU_KM, jupiterGM)).toBeCloseTo(3.55, 1);
    expect(keplerPeriodDays(bodyNamed('Ganymede').semiMajorAxisAu * AU_KM, jupiterGM)).toBeCloseTo(7.15, 1);
  });
});

describe('orbitDescriptorFor', () => {
  it('describes a planet against its host star in AU / years (solar mass)', () => {
    const d = orbitDescriptorFor(bodyNamed('Earth'), SYSTEM, 'Sol');
    expect(d).not.toBeNull();
    expect(d!.parentName).toBe('Sol');
    expect(d!.axisUnit).toBe('AU');
    expect(d!.semiMajorAxis).toBeCloseTo(1.0, 2);
    expect(d!.periodUnit).toBe('yr');
    expect(d!.period).toBeCloseTo(1.0, 2);
  });

  it('carries a null parent when the host star is unnamed', () => {
    const d = orbitDescriptorFor(bodyNamed('Earth'), SYSTEM, null);
    expect(d!.parentName).toBeNull();
  });

  it('describes a moon against its parent planet in km / days (parent GM)', () => {
    const d = orbitDescriptorFor(bodyNamed('Europa'), SYSTEM, 'Sol');
    expect(d).not.toBeNull();
    expect(d!.parentName).toBe('Jupiter');
    expect(d!.axisUnit).toBe('km');
    expect(d!.semiMajorAxis).toBeCloseTo(671100, -1);
    expect(d!.periodUnit).toBe('d');
    expect(d!.period).toBeCloseTo(3.55, 1);
  });

  it('returns null for a moon whose parent record carries no GM', () => {
    // Mars has no gravParamGM (its moons are out of scope); a hypothetical
    // Martian moon has no parent mass to derive a period from.
    const phantom = { ...bodyNamed('Europa'), parentName: 'Mars' };
    expect(orbitDescriptorFor(phantom, SYSTEM, 'Sol')).toBeNull();
  });
});
