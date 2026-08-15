// One level of the statistic attachment's reduction: area-weighted means
// of the flux channel, of the masked flux, and of the mask itself.
// Mirrored by combineReductionTexels in reduction-pure.ts. See README.md.

precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSource;
uniform vec2 uSourceSize;
// 1 on the pass reading the RG16F statistic attachment, which carries the
// flux in R and the lit-surface mask in G and so has no masked-mean
// channel of its own — this is where that product is formed.
uniform float uFromStatistic;

out vec4 outLevel;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  ivec2 bound = ivec2(uSourceSize);
  float weight = 0.0;
  vec3 numerator = vec3(0.0);
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      ivec2 c = base + ivec2(dx, dy);
      // The ragged edge of an odd level: out-of-bounds taps contribute
      // nothing to either the numerator or the weight, which is what keeps
      // the running mean exact rather than edge-biased.
      if (c.x >= bound.x || c.y >= bound.y) continue;
      vec4 t = texelFetch(uSource, c, 0);
      vec3 s = uFromStatistic > 0.5 ? vec3(t.r, t.r * t.g, t.g) : t.rgb;
      weight += t.a;
      numerator += t.a * s;
    }
  }
  outLevel = vec4(
      weight > 0.0 ? numerator / weight : vec3(0.0),
      weight * 0.25);
}
