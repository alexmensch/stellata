import { describe, expect, it } from 'vitest';
import {
  apparentMagFromCamera,
  appMagCameraDisplay,
  coarseProvenance,
  formatEarthRadii,
  formatKm,
  formatMagnitude,
  formatSolarRadii,
  formatVariability,
} from './physical-format';

describe('formatSolarRadii', () => {
  it('widens precision as the value shrinks', () => {
    expect(formatSolarRadii(695.5)).toBe('696 R☉');
    expect(formatSolarRadii(2.362)).toBe('2.4 R☉');
    expect(formatSolarRadii(0.0084)).toBe('0.01 R☉');
  });
});

describe('formatEarthRadii', () => {
  it('keeps the km figure in parens', () => {
    expect(formatEarthRadii(69911)).toBe('11.0 R⊕ (69,911 km)');
    expect(formatEarthRadii(6371)).toBe('1.00 R⊕ (6,371 km)');
    expect(formatEarthRadii(2439.7)).toBe('0.38 R⊕ (2,440 km)');
  });
});

describe('formatKm', () => {
  it('thousands-separates deterministically', () => {
    expect(formatKm(69911)).toBe('69,911');
    expect(formatKm(999)).toBe('999');
  });
});

describe('apparentMagFromCamera', () => {
  it('equals absmag at 10 pc', () => {
    expect(apparentMagFromCamera(0.58, 10)).toBeCloseTo(0.58, 10);
  });

  it('follows the 5·log10(d) − 5 law', () => {
    expect(apparentMagFromCamera(0.58, 100)).toBeCloseTo(5.58, 10);
    expect(apparentMagFromCamera(0.58, 1)).toBeCloseTo(-4.42, 10);
  });
});

describe('appMagCameraDisplay', () => {
  it('renders the signed value at any distance (equals absMag at 10 pc)', () => {
    expect(appMagCameraDisplay(0.58, 10)).toBe('+0.6');
    expect(appMagCameraDisplay(0.58, 1)).toBe('-4.4');
    expect(appMagCameraDisplay(0.58, 100)).toBe('+5.6');
  });

  it('the Sun from 1 AU reads -26.7 (the real solar apparent magnitude)', () => {
    expect(appMagCameraDisplay(4.83, 1 / 206264.80624709636)).toBe('-26.7');
  });

  it('renders "—" for degenerate distances', () => {
    expect(appMagCameraDisplay(0.58, 0)).toBe('—');
    expect(appMagCameraDisplay(0.58, NaN)).toBe('—');
  });
});

describe('formatVariability', () => {
  it('formats period + amplitude, day precision widening below 10d', () => {
    expect(formatVariability(332, 7.6)).toBe('Period 332d · Δmag 7.6');
    expect(formatVariability(0.567, 1.0)).toBe('Period 0.57d · Δmag 1.0');
  });

  it('returns null for non-variables', () => {
    expect(formatVariability(0, 0)).toBeNull();
    expect(formatVariability(332, 0)).toBeNull();
  });
});

describe('formatMagnitude', () => {
  it('always carries an explicit sign', () => {
    expect(formatMagnitude(4.42)).toBe('+4.4');
    expect(formatMagnitude(-4.42)).toBe('-4.4');
    expect(formatMagnitude(0)).toBe('+0.0');
  });
});

describe('coarseProvenance', () => {
  it('lists each populated id source in fixed order', () => {
    expect(
      coarseProvenance({ gaiaSourceId: 123n, hip: 91262, hd: 172167, gl: 'Gl 721' }),
    ).toEqual(['Gaia DR3', 'Hipparcos', 'HD', 'Gliese']);
    expect(coarseProvenance({ hd: 1 })).toEqual(['HD']);
  });

  it('a synthetic promoted companion is known from WDS alone', () => {
    expect(
      coarseProvenance({ gaiaSourceId: 0n, syntheticCompanion: true }),
    ).toEqual(['WDS']);
  });

  it('no ids at all → Tycho-2 (the AT-HYG rows with no other identifiers)', () => {
    expect(coarseProvenance({ gaiaSourceId: 0n, hip: 0 })).toEqual(['Tycho-2']);
  });
});
