import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STAR_RENDER_DEFAULTS } from '../../filters/filter-state';
import {
  KERNEL_FLUX_FIT,
  KERNEL_FLUX_FIT_N_MAX,
  KERNEL_FLUX_FIT_N_MIN,
  perceptualDiscFluxIntegral,
} from './perceptual-disc-flux-pure';
import { perceptualDiscExponent } from './perceptual-disc-pure';

const { visibleThreshold, distNMin, distNMax, lumBiasMin, lumBiasMax } = STAR_RENDER_DEFAULTS;
const visibleK = -Math.log(visibleThreshold);

const chunk = readFileSync(
  fileURLToPath(new URL('./perceptual-disc.glsl', import.meta.url)),
  'utf8',
);

/** Body of a GLSL function, comments stripped and whitespace collapsed. */
function glslBody(name: string): string {
  const m = chunk.match(new RegExp(`float ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (m === null) throw new Error(`${name} not declared in perceptual-disc.glsl`);
  return m[1].replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
}

/** The integral the fit approximates, by brute-force quadrature over the
 *  profile as `perceptual-disc.glsl` defines it. Independent of the fit. */
function integrateProfile(n: number, discardThreshold = 0): number {
  const steps = 200_000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    const raw = Math.exp(-visibleK * u ** n);
    const profile = Math.max(0, (raw - visibleThreshold) / (1 - visibleThreshold));
    if (profile < discardThreshold) continue;
    sum += profile * u;
  }
  return ((Math.PI / 2) * sum) / steps;
}

// The shader runs these two on the GPU and this file's copies are what the
// accuracy claims above are measured against. Nothing at compile time ties
// them together, so a typo in either copy would shift the statistic's flux
// channel — the exposure — with every test above still passing.
describe('GLSL drift', () => {
  it('declares the same fit coefficients as KERNEL_FLUX_FIT', () => {
    const polynomial = glslBody('perceptualDiscFluxIntegral').split('return')[1];
    expect(polynomial.match(/-?\d+\.\d+/g)?.map(Number)).toEqual([...KERNEL_FLUX_FIT]);
  });

  it('shapes the exponent the same way perceptualDiscExponent does', () => {
    expect(glslBody('perceptualDiscExponent')).toBe(
      'float distN = mix(distNMin, distNMax, smoothstep(0.0, 0.5, physRatio));'
      + ' float lumBias = mix(lumBiasMin, lumBiasMax, softness);'
      + ' return distN * lumBias;',
    );
  });

  it('shapes the profile on that exponent rather than re-deriving it', () => {
    expect(glslBody('perceptualDiscProfile')).toContain('perceptualDiscExponent(');
  });
});

describe('perceptualDiscExponent', () => {
  const n = (softness: number, physRatio: number) =>
    perceptualDiscExponent(softness, physRatio, distNMin, distNMax, lumBiasMin, lumBiasMax);

  it('spans exactly the range the flux fit claims', () => {
    expect(n(1, 0)).toBeCloseTo(KERNEL_FLUX_FIT_N_MIN, 10);
    expect(n(0, 0.5)).toBeCloseTo(KERNEL_FLUX_FIT_N_MAX, 10);
  });

  it('is monotone in physRatio and saturates at the smoothstep shoulder', () => {
    expect(n(0, 0.25)).toBeGreaterThan(n(0, 0));
    expect(n(0, 0.5)).toBeGreaterThan(n(0, 0.25));
    expect(n(0, 1)).toBeCloseTo(n(0, 0.5), 12);
  });

  it('a hypergiant stays fuzzier than a dwarf at equal physRatio', () => {
    expect(n(1, 0.3)).toBeLessThan(n(0, 0.3));
  });
});

describe('perceptualDiscFluxIntegral', () => {
  it('matches brute-force quadrature to better than 0.3% across the range', () => {
    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      const n = KERNEL_FLUX_FIT_N_MIN
        + ((KERNEL_FLUX_FIT_N_MAX - KERNEL_FLUX_FIT_N_MIN) * i) / 40;
      const exact = integrateProfile(n);
      worst = Math.max(worst, Math.abs(perceptualDiscFluxIntegral(n) - exact) / exact);
    }
    expect(worst).toBeLessThan(0.003);
  });

  it('is 0.0029 mag of flux at worst — inside the acceptance budget', () => {
    let worst = 0;
    for (let i = 0; i <= 40; i++) {
      const n = KERNEL_FLUX_FIT_N_MIN
        + ((KERNEL_FLUX_FIT_N_MAX - KERNEL_FLUX_FIT_N_MIN) * i) / 40;
      const exact = integrateProfile(n);
      worst = Math.max(worst, Math.abs(perceptualDiscFluxIntegral(n) - exact) / exact);
    }
    expect(2.5 * Math.log10(1 + worst)).toBeLessThan(0.005);
  });

  it('grows with n — a plateau kernel carries more flux than a Gaussian one', () => {
    expect(perceptualDiscFluxIntegral(10)).toBeGreaterThan(perceptualDiscFluxIntegral(2));
    expect(perceptualDiscFluxIntegral(2)).toBeGreaterThan(perceptualDiscFluxIntegral(1.32));
  });

  it('ignoring the discard fringe costs under 0.3%, which is why it is not modelled', () => {
    for (const n of [KERNEL_FLUX_FIT_N_MIN, 2.2, KERNEL_FLUX_FIT_N_MAX]) {
      const full = integrateProfile(n, 0);
      const clipped = integrateProfile(n, STAR_RENDER_DEFAULTS.discardThreshold);
      expect(1 - clipped / full).toBeLessThan(0.003);
    }
  });

  it('the flux-correct kernel integrates back to the source flux', () => {
    // A kernel D px across emitting flux F writes F/(Φ·D²) at its peak, so
    // summing value·area over the quad must return F.
    const D = 13;
    const F = 1234.5;
    const n = 2.004;
    const peak = F / (perceptualDiscFluxIntegral(n) * D * D);
    const integrated = peak * integrateProfile(n) * D * D;
    expect(integrated / F).toBeCloseTo(1, 2);
  });
});
