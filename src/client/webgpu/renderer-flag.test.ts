import { describe, expect, it } from 'vitest';
import { parseRendererFlag } from './renderer-flag';

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
