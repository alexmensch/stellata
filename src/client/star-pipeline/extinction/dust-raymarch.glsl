// Edenhofer dust-density raymarch, shared by the extinction prepass
// (extinction-prepass.frag.glsl) and star.vert.glsl's fallback path.
// Returns raw physical A_V; callers apply uDustEnabled /
// uExtinctionStrength gating. Tap-count rationale in ./README.md.
// CPU mirror: dust-raymarch-pure.ts — keep the clip, decode and
// integration in sync.

uniform highp sampler3D uDustTexture;
uniform float uDustBoundsPc;
uniform float uDustDensityMin;
uniform float uDustLogRatio;
uniform float uDustAvPerDensityPc;

const float DUST_TAP_PC = 15.0;
const int DUST_TAPS_MIN = 4;
const int DUST_TAPS_MAX = 96;
const float SLAB_PARALLEL_EPS_PC = 1e-6;

void slabClip(float f, float d, float b, inout float t0, inout float t1) {
    if (abs(d) > SLAB_PARALLEL_EPS_PC) {
        float ta = (-b - f) / d;
        float tb = (b - f) / d;
        t0 = max(t0, min(ta, tb));
        t1 = min(t1, max(ta, tb));
    } else if (abs(f) > b) {
        t0 = 1.0;
        t1 = 0.0;
    }
}

float dustRaymarchAV(vec3 absFrom, vec3 absTo) {
    vec3 delta = absTo - absFrom;
    float lenPc = length(delta);
    if (lenPc < 0.001) return 0.0;

    float t0 = 0.0;
    float t1 = 1.0;
    slabClip(absFrom.x, delta.x, uDustBoundsPc, t0, t1);
    slabClip(absFrom.y, delta.y, uDustBoundsPc, t0, t1);
    slabClip(absFrom.z, delta.z, uDustBoundsPc, t0, t1);
    if (t1 <= t0) return 0.0;

    float inCubeLenPc = (t1 - t0) * lenPc;
    int taps = clamp(int(ceil(inCubeLenPc / DUST_TAP_PC)), DUST_TAPS_MIN, DUST_TAPS_MAX);
    float invRange = 0.5 / uDustBoundsPc; // maps [-bounds, +bounds] → [0, 1]
    float accumDensity = 0.0;
    for (int i = 0; i < taps; i++) {
        float t = t0 + (t1 - t0) * ((float(i) + 0.5) / float(taps));
        vec3 uvw = clamp((absFrom + delta * t) * invRange + 0.5, 0.0, 1.0);
        float encoded = texture(uDustTexture, uvw).r;
        // Inverse of the Python side's pure-log encoding over
        // [densityMin, densityMax]: decoded = densityMin * exp(sample * logRatio).
        accumDensity += uDustDensityMin * exp(encoded * uDustLogRatio);
    }
    return accumDensity * (inCubeLenPc / float(taps)) * uDustAvPerDensityPc;
}
