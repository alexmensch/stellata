import { describe, it, expect } from 'vitest';
import { buildPulsationSuppressMask } from './pulsation-suppress-pure';
import {
  VAR_TYPE_UNKNOWN,
  VAR_TYPE_PULSATING,
  VAR_TYPE_ECLIPSING,
  VAR_TYPE_OTHER,
} from '../../../scripts/catalog/catalog-pure';

describe('buildPulsationSuppressMask', () => {
  it('suppresses every eclipsing binary, regardless of orbit, and nothing else', () => {
    const varType = new Uint8Array([
      VAR_TYPE_UNKNOWN,
      VAR_TYPE_PULSATING,
      VAR_TYPE_ECLIPSING,
      VAR_TYPE_OTHER,
      VAR_TYPE_ECLIPSING,
    ]);
    const mask = buildPulsationSuppressMask(varType);
    expect(Array.from(mask)).toEqual([0, 0, 1, 0, 1]);
  });

  it('returns an all-zero mask when no star is eclipsing', () => {
    const mask = buildPulsationSuppressMask(
      new Uint8Array([VAR_TYPE_PULSATING, VAR_TYPE_OTHER]),
    );
    expect(Array.from(mask)).toEqual([0, 0]);
  });
});
