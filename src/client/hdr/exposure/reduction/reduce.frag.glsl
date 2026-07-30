// One level of the statistic attachment's reduction: area-weighted mean of
// the flux channel, max of the peak channel. Mirrored by
// combineReductionTexels in reduction-pure.ts. See README.md.

precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSource;
uniform vec2 uSourceSize;

out vec4 outLevel;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  ivec2 bound = ivec2(uSourceSize);
  float weight = 0.0;
  float numerator = 0.0;
  float peak = 0.0;
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      ivec2 c = base + ivec2(dx, dy);
      // The ragged edge of an odd level: out-of-bounds taps contribute
      // nothing to either the numerator or the weight, which is what keeps
      // the running mean exact rather than edge-biased.
      if (c.x >= bound.x || c.y >= bound.y) continue;
      vec4 t = texelFetch(uSource, c, 0);
      weight += t.a;
      numerator += t.a * t.r;
      peak = max(peak, t.g);
    }
  }
  outLevel = vec4(
      weight > 0.0 ? numerator / weight : 0.0,
      peak,
      0.0,
      weight * 0.25);
}
