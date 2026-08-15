// One froxel-grid layer: one fragment per screen cell, each marching the
// Edenhofer grid across that cell ray's own slice shell. See ./README.md.
precision highp float;
precision highp int;
precision highp sampler3D;

#include <stellata_dust_raymarch>

uniform vec3 uAbsCameraPos;      // absolute ICRS heliocentric pc
uniform mat3 uCameraBasis;       // columns: right, up, −forward (view→world)
uniform vec2 uTanHalfFov;        // tan of half the horizontal / vertical FOV
uniform vec2 uGridDims;          // cells across the frustum, x and y
uniform float uCoverageRadiusPc; // the sphere inscribed in the data cube
uniform float uFillStepPc;
uniform float uSlices;
uniform float uSliceIndex;       // this layer, 0-based
uniform float uSMinPc;           // near clamp when the camera sits inside coverage

// A slice can never span more than the outermost shell of a ray crossing the
// full 2×radius chord, which is 223 steps at the pin; the bound keeps the loop
// countable and makes an off-pin config fail loud in the readout rather than
// hang the tab.
const int MAX_FILL_STEPS = 256;

out vec4 outColumn;

void main() {
    vec2 ndc = (gl_FragCoord.xy / uGridDims) * 2.0 - 1.0;
    vec3 dir = normalize(uCameraBasis * vec3(ndc * uTanHalfFov, -1.0));

    float b = dot(uAbsCameraPos, dir);
    float c = dot(uAbsCameraPos, uAbsCameraPos) - uCoverageRadiusPc * uCoverageRadiusPc;
    float disc = b * b - c;
    if (disc <= 0.0) { outColumn = vec4(0.0); return; }
    float root = sqrt(disc);
    float far = -b + root;
    if (far <= 0.0) { outColumn = vec4(0.0); return; }
    float near = max(max(-b - root, 0.0), uSMinPc);
    if (far <= near) { outColumn = vec4(0.0); return; }

    // Log-spaced over the ray's own [entry, exit], so a camera outside
    // coverage spends none of its 32 slices on empty space.
    float ratio = pow(far / near, 1.0 / uSlices);
    float shellNear = near * pow(ratio, uSliceIndex);
    float shellFar = shellNear * ratio;

    float span = shellFar - shellNear;
    int steps = min(int(ceil(span / uFillStepPc)), MAX_FILL_STEPS);
    float dt = span / float(steps);
    float density = 0.0;
    for (int i = 0; i < MAX_FILL_STEPS; i++) {
        if (i >= steps) break;
        density += dustDensityAt(uAbsCameraPos + dir * (shellNear + (float(i) + 0.5) * dt));
    }
    outColumn = vec4(density * dt * uDustAvPerDensityPc, 0.0, 0.0, 1.0);
}
