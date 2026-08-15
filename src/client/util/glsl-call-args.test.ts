import { describe, expect, it } from 'vitest';
import { glslCallArgs } from './glsl-call-args';

describe('glslCallArgs', () => {
  it('splits the top level only, through a nested call', () => {
    expect(glslCallArgs('outColor = vec4(mix(a, b, t), alpha);', 'vec4'))
      .toEqual(['mix(a, b, t)', 'alpha']);
  });

  it('takes the sole argument of a one-argument call', () => {
    const src = 'outDiffuse = stellataOccluderTexel(opacity * uFade);';
    expect(glslCallArgs(src, 'stellataOccluderTexel')).toEqual(['opacity * uFade']);
  });

  it('skips a hit inside a longer identifier', () => {
    // The pins assert on argument TEXT, so matching `texel(` inside
    // `stellataStatisticTexel(` would pin a different call and still pass.
    const src = 'vec4 x = stellataOccluderTexel(a);\n vec4 y = texel(b);';
    expect(glslCallArgs(src, 'texel')).toEqual(['b']);
  });

  it('throws rather than guessing on a name that is absent', () => {
    expect(() => glslCallArgs('void main() {}', 'stellataStatisticTexel'))
      .toThrow('no stellataStatisticTexel( in shader');
  });

  it('throws on an unbalanced call', () => {
    expect(() => glslCallArgs('vec4(a, b', 'vec4')).toThrow('unbalanced vec4( in shader');
  });
});
