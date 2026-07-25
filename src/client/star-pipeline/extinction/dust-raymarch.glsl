// Edenhofer dust-density raymarch, shared by the extinction prepass
// (extinction-prepass.frag.glsl) and star.vert.glsl's fallback path.
// Returns raw physical A_V; callers apply uDustEnabled /
// uExtinctionStrength gating. Step-count calibration rationale in
// ./README.md. CPU mirror for tests:
// dust-raymarch-pure.ts — keep the decode + integration in sync.

uniform highp sampler3D uDustTexture;
uniform float uDustBoundsPc;
uniform float uDustDensityMin;
uniform float uDustLogRatio;
uniform float uDustAvPerDensityPc;

const int DUST_STEPS = 48;

float dustRaymarchAV(vec3 absFrom, vec3 absTo) {
    vec3 delta = absTo - absFrom;
    float lenPc = length(delta);
    if (lenPc < 0.001) return 0.0;
    float stepPc = lenPc / float(DUST_STEPS);

    float invRange = 0.5 / uDustBoundsPc; // maps [-bounds, +bounds] → [0, 1]
    float accumDensity = 0.0;
    for (int i = 0; i < DUST_STEPS; i++) {
        float t = (float(i) + 0.5) / float(DUST_STEPS);
        vec3 uvw = (absFrom + delta * t) * invRange + 0.5;
        // Cheap bbox test — sampling outside just clamps to the edge which
        // is zero-padded at the volume boundary, so skipping is an
        // optimisation not a correctness requirement.
        if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) continue;
        float encoded = texture(uDustTexture, uvw).r;
        // Inverse of the Python side's pure-log encoding over
        // [densityMin, densityMax]: decoded = densityMin * exp(sample * logRatio).
        accumDensity += uDustDensityMin * exp(encoded * uDustLogRatio);
    }
    return accumDensity * stepPc * uDustAvPerDensityPc;
}
