// Box-average the diffuse attachment down by an integer factor, so the
// convolution's flat disc spans a bounded number of texels at every FOV.
// Pairs with ../../util/fullscreen-pass.vert.glsl. See README.md.
precision highp float;
precision highp int;

uniform sampler2D uDiffuseTexture;
uniform int uFactor;
uniform ivec2 uSourceSize;

out vec4 outColor;

// Mirrors MAX_DOWNSAMPLE (summation-pure.ts). The loop bound has to be a
// constant; uFactor breaks out of it.
const int STELLATA_MAX_DOWNSAMPLE = 32;

void main() {
    ivec2 base = ivec2(gl_FragCoord.xy) * uFactor;
    vec3 acc = vec3(0.0);
    float n = 0.0;
    for (int dy = 0; dy < STELLATA_MAX_DOWNSAMPLE; dy++) {
        if (dy >= uFactor) break;
        for (int dx = 0; dx < STELLATA_MAX_DOWNSAMPLE; dx++) {
            if (dx >= uFactor) break;
            // Clamped rather than skipped: the last row and column of texels
            // are a partial box when the size is not a multiple of the
            // factor, and re-reading an edge texel is what keeps the mean a
            // mean instead of dividing by a short count.
            ivec2 texel = min(base + ivec2(dx, dy), uSourceSize - 1);
            acc += texelFetch(uDiffuseTexture, texel, 0).rgb;
            n += 1.0;
        }
    }
    outColor = vec4(acc / max(n, 1.0), 1.0);
}
