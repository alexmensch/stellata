import { describe, expect, it } from 'vitest';
import { parseGateOverride } from './gate-override';

describe('parseGateOverride', () => {
  it('selects the verdict to show', () => {
    expect(parseGateOverride('#webgpu-gate=no-api')).toBe('no-api');
    expect(parseGateOverride('#webgpu-gate=no-adapter')).toBe('no-adapter');
    expect(parseGateOverride('#a=b&webgpu-gate=no-adapter')).toBe('no-adapter');
  });

  it('keeps force as the spelling for the commoner verdict', () => {
    expect(parseGateOverride('#webgpu-gate=force')).toBe('no-api');
  });

  // A bare or mistyped fragment must not blank the app.
  it('ignores every other form', () => {
    for (const h of ['', '#', '#webgpu-gate', '#webgpu-gate=', '#webgpu-gate=1',
      '#webgpu-gate=true', '#webgpu-gate=supported', '#foo=bar']) {
      expect(parseGateOverride(h)).toBeNull();
    }
  });
});
