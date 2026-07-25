import { describe, it, expect } from 'vitest';
import {
  buildPulsationParams,
  pulsationParamsForType,
  PULSATION_PARAMS_DEFAULT,
} from './pulsation-params-pure';
import {
  VAR_TYPE_UNKNOWN,
  VAR_TYPE_PULSATING,
  VAR_TYPE_ECLIPSING,
  VAR_TYPE_OTHER,
  VAR_TYPE_MIRA,
  VAR_TYPE_SEMIREGULAR,
  VAR_TYPE_CEPHEID,
  VAR_TYPE_RR_LYRAE,
  VAR_TYPE_DSCT,
} from '../../../../scripts/catalog/catalog-pure';

describe('pulsationParamsForType', () => {
  it('maps each pulsator family to its {ρ, ΔB−V}', () => {
    expect(pulsationParamsForType(VAR_TYPE_MIRA)).toEqual({ rho: 1.4, colorSwing: 0.35 });
    expect(pulsationParamsForType(VAR_TYPE_SEMIREGULAR)).toEqual({ rho: 1.2, colorSwing: 0.2 });
    expect(pulsationParamsForType(VAR_TYPE_CEPHEID)).toEqual({ rho: 1.15, colorSwing: 0.3 });
    expect(pulsationParamsForType(VAR_TYPE_RR_LYRAE)).toEqual({ rho: 1.1, colorSwing: 0.25 });
    expect(pulsationParamsForType(VAR_TYPE_DSCT)).toEqual({ rho: 1.02, colorSwing: 0.05 });
  });

  it('falls back to the default row for generic/unbucketed types', () => {
    for (const t of [VAR_TYPE_UNKNOWN, VAR_TYPE_PULSATING, VAR_TYPE_ECLIPSING, VAR_TYPE_OTHER]) {
      expect(pulsationParamsForType(t)).toEqual(PULSATION_PARAMS_DEFAULT);
    }
    expect(PULSATION_PARAMS_DEFAULT).toEqual({ rho: 1.1, colorSwing: 0.1 });
  });

  it('Mira ρ implies a bounded peak-to-peak disc swing (√ρ ≈ 1.18, not order-of-magnitude)', () => {
    // The whole point of the R+T split: a Mira's on-screen disc swings
    // by ≤ ~18% up from the static radius, matching interferometry —
    // not the 25× the constant-T V-band model produced.
    expect(Math.sqrt(pulsationParamsForType(VAR_TYPE_MIRA).rho)).toBeCloseTo(1.1832, 4);
  });
});

describe('buildPulsationParams', () => {
  it('emits per-instance ρ + colour-swing arrays from the varType column', () => {
    const varType = new Uint8Array([
      VAR_TYPE_MIRA,
      VAR_TYPE_CEPHEID,
      VAR_TYPE_UNKNOWN,
    ]);
    const { rho, colorSwing } = buildPulsationParams(varType);
    expect(rho.length).toBe(3);
    expect(rho[0]).toBeCloseTo(1.4, 6);
    expect(rho[1]).toBeCloseTo(1.15, 6);
    expect(rho[2]).toBeCloseTo(1.1, 6); // default (non-variable)
    expect(colorSwing[0]).toBeCloseTo(0.35, 6);
    expect(colorSwing[1]).toBeCloseTo(0.3, 6);
    expect(colorSwing[2]).toBeCloseTo(0.1, 6);
  });
});
