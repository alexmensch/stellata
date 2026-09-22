import { describe, expect, it } from 'vitest';
import { callArgs } from './call-args';

describe('callArgs', () => {
  it('splits the top level only, through a nested call', () => {
    expect(callArgs('outColor = vec4(mix(a, b, t), alpha);', 'vec4'))
      .toEqual(['mix(a, b, t)', 'alpha']);
  });

  it('takes the sole argument of a one-argument call', () => {
    const src = 'outDiffuse = occluderTexelTsl(opacity * uFade);';
    expect(callArgs(src, 'occluderTexelTsl')).toEqual(['opacity * uFade']);
  });

  it('skips a hit inside a longer identifier', () => {
    // The pins assert on argument TEXT, so matching `texel(` inside
    // `statisticTexelTsl(` would pin a different call and still pass.
    const src = 'vec4 x = occluderTexelTsl(a);\n vec4 y = texel(b);';
    expect(callArgs(src, 'texel')).toEqual(['b']);
  });

  it('throws rather than guessing on a name that is absent', () => {
    expect(() => callArgs('void main() {}', 'statisticTexelTsl'))
      .toThrow('no statisticTexelTsl( in shader');
  });

  it('throws on an unbalanced call', () => {
    expect(() => callArgs('vec4(a, b', 'vec4')).toThrow('unbalanced vec4( in shader');
  });
});
