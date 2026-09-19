import { describe, expect, it } from 'vitest';
import { parseExtinctionRefillMode, parseGateOverride, parseRendererFlag } from './renderer-flag';

describe('parseRendererFlag', () => {
  it('reads #renderer=webgpu', () => {
    expect(parseRendererFlag('#renderer=webgpu')).toBe('webgpu');
  });

  it('reads the explicit #renderer=webgl2 escape hatch', () => {
    expect(parseRendererFlag('#renderer=webgl2')).toBe('webgl2');
  });

  it('is null on an empty hash (the shipped default boot)', () => {
    expect(parseRendererFlag('')).toBe(null);
    expect(parseRendererFlag('#')).toBe(null);
  });

  it('is null on an unrelated or malformed fragment', () => {
    expect(parseRendererFlag('#foo=bar')).toBe(null);
    expect(parseRendererFlag('#renderer=quantum')).toBe(null);
    expect(parseRendererFlag('#renderer')).toBe(null);
  });

  it('finds the flag among other fragment params', () => {
    expect(parseRendererFlag('#a=b&renderer=webgpu')).toBe('webgpu');
  });
});

describe('parseGateOverride', () => {
  // The value picks which gate page, because the two verdicts give
  // different advice and a supporting browser fails neither probe.
  it('selects the verdict to show', () => {
    expect(parseGateOverride('#webgpu-gate=no-api')).toBe('no-api');
    expect(parseGateOverride('#webgpu-gate=no-adapter')).toBe('no-adapter');
    expect(parseGateOverride('#renderer=webgpu&webgpu-gate=no-adapter')).toBe('no-adapter');
  });

  it('keeps force as the spelling for the commoner verdict', () => {
    expect(parseGateOverride('#webgpu-gate=force')).toBe('no-api');
  });

  // A bare or mistyped fragment must not blank the app.
  it('ignores every other form', () => {
    for (const h of ['', '#', '#webgpu-gate', '#webgpu-gate=', '#webgpu-gate=1',
      '#webgpu-gate=true', '#webgpu-gate=supported', '#renderer=webgpu']) {
      expect(parseGateOverride(h)).toBeNull();
    }
  });

  it('leaves the renderer flag alone', () => {
    expect(parseRendererFlag('#webgpu-gate=force')).toBeNull();
    expect(parseRendererFlag('#renderer=webgpu&webgpu-gate=force')).toBe('webgpu');
  });
});

describe('parseExtinctionRefillMode', () => {
  it('selects the refill schedule', () => {
    expect(parseExtinctionRefillMode('#av-refill=survivors')).toBe('survivors');
    expect(parseExtinctionRefillMode('#av-refill=sliced')).toBe('sliced');
    expect(parseExtinctionRefillMode('#renderer=webgpu&av-refill=survivors')).toBe('survivors');
  });

  // The shipped boot carries no fragment, and a typo must not pick a kernel.
  it('is null on every other form', () => {
    for (const h of ['', '#', '#av-refill', '#av-refill=', '#av-refill=morton', '#renderer=webgpu']) {
      expect(parseExtinctionRefillMode(h)).toBeNull();
    }
  });
});
