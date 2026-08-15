// Edenhofer dust-density raymarch, shared by the extinction prepass
// (extinction-prepass.frag.glsl), star.vert.glsl's fallback path, and — for
// dustDensityAt alone — the band's froxel fill (../../dust/froxel/).
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

float dustDensityAt(vec3 absPos) {
    vec3 uvw = absPos * (0.5 / uDustBoundsPc) + 0.5; // [-bounds, +bounds] → [0, 1]
    // Cheap bbox test — sampling outside just clamps to the edge which
    // is zero-padded at the volume boundary, so skipping is an
    // optimisation not a correctness requirement.
    if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
    // Inverse of the Python side's pure-log encoding over
    // [densityMin, densityMax]: decoded = densityMin * exp(sample * logRatio).
    return uDustDensityMin * exp(texture(uDustTexture, uvw).r * uDustLogRatio);
}

float dustRaymarchAV(vec3 absFrom, vec3 absTo) {
    vec3 delta = absTo - absFrom;
    float lenPc = length(delta);
    if (lenPc < 0.001) return 0.0;
    float stepPc = lenPc / float(DUST_STEPS);

    float accumDensity = 0.0;
    for (int i = 0; i < DUST_STEPS; i++) {
        float t = (float(i) + 0.5) / float(DUST_STEPS);
        accumDensity += dustDensityAt(absFrom + delta * t);
    }
    return accumDensity * stepPc * uDustAvPerDensityPc;
}
