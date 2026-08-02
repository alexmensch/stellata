// The write tail every extended-source emitter shares: column → gain →
// both attachments → the inline operator off-target. Registered as
// stellata_extended_emitter. See README.md § Unit.
//
// Composes the unit and the operator, so it pulls both chunks in; their
// guards make the order irrelevant and a second paste inert.
#ifndef STELLATA_EXTENDED_EMITTER
#define STELLATA_EXTENDED_EMITTER

#include <stellata_hdr_emission>
#include <stellata_tonemap>

/** Every attachment cleared for a fragment the volume does not cover.
 *  Neither attachment 1 nor 2 has a default: skip one on one branch and it
 *  reads whatever the texel last held. */
void stellataEmitNothing(out vec4 fragColor, out vec4 statistic, out vec4 diffuse) {
    fragColor = vec4(0.0);
    statistic = vec4(0.0);
    diffuse = vec4(0.0);
}

/** A raymarched column taken to display luminance at one solid angle, clamped
 *  at the ceiling. The gain is unclamped by contract, so the CALLER clamps the
 *  product — which is the same three lines for the summation angle and the
 *  pixel one, differing only in which Ω they run on. */
vec3 stellataGainedColumn(
    vec3 column,
    float exposure,
    float magPerArcsec2,
    float omegaArcsec2
) {
    return min(
        column * stellataSurfaceBrightnessLuminance(
            exposure, magPerArcsec2, omegaArcsec2),
        vec3(STELLATA_LUMA_CEIL));
}

/**
 * `column` is the layer's own integrated column, per channel, carrying
 * whatever chromaticity the raymarch built; `magPerArcsec2` is the
 * surface brightness a unit column represents. The gain collapses the
 * magnitude round-trip to one scalar, so hue survives it untouched.
 *
 * THREE attachments, and each takes a different quantity.
 *
 * `diffuse` (attachment 2) is the display value, gained by the eye's rod
 * summation solid angle — **pre-summation**. It is only the flux inside that
 * patch once the resolve has averaged it over the patch, which is the whole
 * reason it is a separate attachment (../summation/README.md). Attachment 0
 * stays black for a diffuse fragment on-target: the resolve owns that write.
 *
 * `statistic` (attachment 1) takes `omegaPxArcsec2` instead — the display
 * concession is not light, and the adaptation model reads retinal
 * illuminance. Extended source, so flux and peak are the same quantity and
 * alpha is 1: the additive blend must SUM the statistic, not scale it a
 * second time (../attachments/README.md § One blend equation, every
 * attachment).
 *
 * Off-target there is no attachment 2 and no pass to run the convolution, so
 * the summation anchor is gone entirely and BOTH volumetric emitters fall
 * back to the pixel solid angle. One rule rather than a per-layer opt-out:
 * the concession IS the pass. The operator runs here in that case,
 * undithered — these layers stack several fragments on one pixel and the
 * dither keys on fragCoord alone.
 */
void stellataEmitExtendedSource(
    vec3 column,
    float exposure,
    float magPerArcsec2,
    float omegaSummationArcsec2,
    float omegaPxArcsec2,
    float hdrTarget,
    float whitePoint,
    float highlightDesat,
    out vec4 fragColor,
    out vec4 statistic,
    out vec4 diffuse
) {
    float physicalL = dot(column, STELLATA_LUMA_WEIGHTS)
        * stellataSurfaceBrightnessLuminance(exposure, magPerArcsec2, omegaPxArcsec2);
    statistic = stellataStatisticTexel(physicalL, physicalL, 1.0);

    // Clamped before the convolution rather than after, so fp16 additive
    // accumulation across overlapping volumes cannot overflow. Nothing
    // reaches the ceiling pre-summation at the shipped epochs.
    diffuse = vec4(
        stellataGainedColumn(column, exposure, magPerArcsec2, omegaSummationArcsec2),
        1.0);

    if (hdrTarget > 0.5) {
        fragColor = vec4(0.0);
        return;
    }
    fragColor = vec4(stellataTonemapUndithered(
        stellataGainedColumn(column, exposure, magPerArcsec2, omegaPxArcsec2),
        whitePoint, highlightDesat), 1.0);
}

#endif
