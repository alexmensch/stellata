// The rod-summation convolution: mean diffuse flux over the eye's summation
// patch, read from the diffuse attachment or its downsampled copy.
// Registered as stellata_summation; CPU mirror in summation-pure.ts.
// See README.md.
#ifndef STELLATA_SUMMATION
#define STELLATA_SUMMATION

// Mirrors MAX_KERNEL_REACH_TEXELS (summation-pure.ts). A loop bound must be
// a constant, and the downsample factor is what keeps the real reach under
// it whatever the FOV.
const int STELLATA_SUMMATION_REACH = 5;

/**
 * Mean diffuse display luminance over the summation disc. `sourceTexel` is
 * the fragment's own position in `source`, in texels; `radiusTexels` is the
 * patch radius there; `extent` is the live sub-rect, since the source is
 * sized for the widest downsample factor and the rest of it is stale.
 *
 * The weight is the fraction of each texel inside the disc, and dividing by
 * the summed weight is what leaves a **uniform** field exactly unchanged —
 * the Milky Way band's display level from Sol depends on that identity, not
 * on an approximation. Sampling with `texture` rather than `texelFetch`
 * makes each tap bilinear, which is what carries a coarse source back to
 * display resolution without blocking.
 *
 * Clamping to the edge rather than falling to zero is the right boundary for
 * an eye: the patch of a fragment near the frame edge reaches sky the frame
 * does not contain, and treating that as black would ring the border.
 */
vec3 stellataSummationMean(
    sampler2D source,
    vec2 sourceTexel,
    float radiusTexels,
    vec2 extent
) {
    vec2 invSize = 1.0 / vec2(textureSize(source, 0));
    vec2 hi = extent - 0.5;
    vec3 acc = vec3(0.0);
    float weight = 0.0;
    for (int dy = -STELLATA_SUMMATION_REACH; dy <= STELLATA_SUMMATION_REACH; dy++) {
        for (int dx = -STELLATA_SUMMATION_REACH; dx <= STELLATA_SUMMATION_REACH; dx++) {
            vec2 offset = vec2(float(dx), float(dy));
            float w = clamp(radiusTexels + 0.5 - length(offset), 0.0, 1.0);
            if (w <= 0.0) continue;
            vec2 texel = clamp(sourceTexel + offset, vec2(0.5), hi);
            acc += w * texture(source, texel * invSize).rgb;
            weight += w;
        }
    }
    // No zero-weight guard: the centre tap's own weight is
    // min(1, radiusTexels + 0.5) >= 0.5 for any radius >= 0.
    return acc / weight;
}

#endif
