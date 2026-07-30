// Two rules every texture read here lives by. Precision: the ES 3.00
// fragment default is lowp sampler2D, which represents neither uSources'
// 1e-8 parsec distances nor its 1e3 CSS-px centres. And every read is
// textureLod — neighbouring fragments are unrelated sources, so an
// implicit-derivative mip choice is arbitrary.
precision highp float;
precision highp int;
precision highp sampler2D;

// One fragment per light source; the numbers here are pinned against
// coverage-pure.ts by coverage-glsl-drift.test.ts.
const int COVERAGE_TAPS = 64;
const float GOLDEN_ANGLE = 2.399963229728653;
const float SELF_OCCLUSION_SLACK = 0.001;
const float CLEAR_DEPTH_EPS = 1.0e-6;
const float RING_MIN_SIN_OPENING = 1.0e-6;
const float ADAPT_EDGE_RAMP_PX = 12.0;
const int COVERAGE_MAX_RINGS = 3;

// Nx1: (screenX, screenY) CSS px, footprint radius px, radial camera
// distance pc. One texel per source, in the order the walk collected them.
uniform sampler2D uSources;
uniform int uSourceCount;
// Occluder depth, single bracket, quarter of the drawing buffer's pixels.
uniform sampler2D uOccluderDepth;
uniform vec2 uBracketPc;
uniform vec2 uViewportPx;
uniform vec2 uTanHalfFov;
uniform float uPxPerRadian;

// Ring extinction, view space. xyz = annulus centre / unit pole,
// w = outer radius pc / inner:outer ratio. uRingAlphaScale folds the
// crossfade weight so the statistic tracks the alpha actually composited;
// a zero slot is unused.
uniform vec4 uRingCentre[COVERAGE_MAX_RINGS];
uniform vec4 uRingPole[COVERAGE_MAX_RINGS];
uniform float uRingAlphaScale[COVERAGE_MAX_RINGS];
uniform sampler2D uRingStrip0;
uniform sampler2D uRingStrip1;
uniform sampler2D uRingStrip2;

out vec4 outThroughput;

vec2 coverageTap(int i) {
  float r = sqrt((float(i) + 0.5) / float(COVERAGE_TAPS));
  float theta = float(i) * GOLDEN_ANGLE;
  return r * vec2(cos(theta), sin(theta));
}

float viewDistanceFromDepth(float depth01) {
  float near = uBracketPc.x;
  float far = uBracketPc.y;
  float zNdc = 2.0 * depth01 - 1.0;
  return (2.0 * far * near) / ((far + near) - zNdc * (far - near));
}

bool tapOccluded(float depth01, float sourceDepthPc, float slackPc) {
  if (depth01 >= 1.0 - CLEAR_DEPTH_EPS) return false;
  return viewDistanceFromDepth(depth01) < sourceDepthPc - slackPc;
}

float ringTransmission(float stripAlpha, float sinOpeningAngle) {
  float a = clamp(stripAlpha, 0.0, 1.0);
  if (a <= 0.0) return 1.0;
  if (a >= 1.0) return 0.0;
  return pow(1.0 - a, 1.0 / max(abs(sinOpeningAngle), RING_MIN_SIN_OPENING));
}

// One annulus against one view ray. The sampler comes in as a parameter
// because GLSL ES 3.0 cannot index a sampler array by a loop variable.
float ringRayTransmission(
  sampler2D strip, vec4 centre, vec4 pole, float alphaScale,
  vec3 dir, float sourceRadialPc
) {
  if (centre.w <= 0.0) return 1.0;
  float sinB = dot(dir, pole.xyz);
  if (abs(sinB) < RING_MIN_SIN_OPENING) return 1.0;
  float t = dot(centre.xyz, pole.xyz) / sinB;
  if (t <= 0.0 || t >= sourceRadialPc) return 1.0;
  float r = length(t * dir - centre.xyz);
  float innerRatio = pole.w;
  if (r < innerRatio * centre.w || r > centre.w) return 1.0;
  float u = (r / centre.w - innerRatio) / (1.0 - innerRatio);
  return ringTransmission(textureLod(strip, vec2(u, 0.5), 0.0).a * alphaScale, sinB);
}

float ringThroughput(vec3 dir, float sourceRadialPc) {
  return ringRayTransmission(
      uRingStrip0, uRingCentre[0], uRingPole[0], uRingAlphaScale[0],
      dir, sourceRadialPc)
    * ringRayTransmission(
      uRingStrip1, uRingCentre[1], uRingPole[1], uRingAlphaScale[1],
      dir, sourceRadialPc)
    * ringRayTransmission(
      uRingStrip2, uRingCentre[2], uRingPole[2], uRingAlphaScale[2],
      dir, sourceRadialPc);
}

void main() {
  int i = int(gl_FragCoord.x);
  if (i >= uSourceCount) {
    outThroughput = vec4(1.0);
    return;
  }
  vec4 src = texelFetch(uSources, ivec2(i, 0), 0);
  vec2 centrePx = src.xy;
  float radiusPx = src.z;
  float distPc = src.w;

  // Axis depth, not radial distance: the depth buffer's own convention,
  // and off-axis the two differ by orders more than the slack allows.
  vec2 centreNdc = vec2(
    2.0 * (centrePx.x / uViewportPx.x) - 1.0,
    1.0 - 2.0 * (centrePx.y / uViewportPx.y));
  vec3 centreRay = vec3(centreNdc * uTanHalfFov, -1.0);
  float sourceDepthPc = distPc / length(centreRay);
  float slackPc = max(radiusPx / uPxPerRadian, SELF_OCCLUSION_SLACK) * sourceDepthPc;
  // The taps spread over the disc the CPU clipping term integrates, so the
  // two compose exactly. The slack stays on the true footprint radius —
  // it is the source's own body, not the ramp.
  float tapRadiusPx = max(radiusPx, 0.5 * ADAPT_EDGE_RAMP_PX);

  float sum = 0.0;
  float n = 0.0;
  for (int k = 0; k < COVERAGE_TAPS; k++) {
    vec2 px = centrePx + coverageTap(k) * tapRadiusPx;
    vec2 uv = vec2(px.x / uViewportPx.x, 1.0 - px.y / uViewportPx.y);
    // Out of frame: the CPU clipping term already owns this tap, so it
    // leaves both sides of the mean rather than counting the loss twice.
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
    n += 1.0;
    if (tapOccluded(textureLod(uOccluderDepth, uv, 0.0).r, sourceDepthPc, slackPc)) continue;
    vec3 tapRay = vec3(vec2(2.0 * uv.x - 1.0, 2.0 * uv.y - 1.0) * uTanHalfFov, -1.0);
    float rayLen = length(tapRay);
    sum += ringThroughput(tapRay / rayLen, sourceDepthPc * rayLen);
  }
  outThroughput = vec4(n > 0.0 ? sum / n : 1.0);
}
