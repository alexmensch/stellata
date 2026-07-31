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

/** Both attachments cleared for a fragment the volume does not cover.
 *  Attachment 1 has no default: skip it on one branch and the statistic
 *  reads whatever the texel last held. */
void stellataEmitNothing(out vec4 fragColor, out vec4 statistic) {
    fragColor = vec4(0.0);
    statistic = vec4(0.0);
}

/**
 * `column` is the layer's own integrated column, per channel, carrying
 * whatever chromaticity the raymarch built; `magPerArcsec2` is the
 * surface brightness a unit column represents. The gain collapses the
 * magnitude round-trip to one scalar, so hue survives it untouched.
 *
 * Extended source, so flux and peak are the same quantity and alpha is 1
 * — the additive blend must SUM the statistic, not scale it a second time
 * (statistic/README.md § One blend equation, two attachments).
 *
 * Off-target the operator runs here, undithered: these layers stack
 * several fragments on one pixel and the dither keys on fragCoord alone.
 */
void stellataEmitExtendedSource(
    vec3 column,
    float exposure,
    float magPerArcsec2,
    float omegaPxArcsec2,
    float hdrTarget,
    float whitePoint,
    float highlightDesat,
    out vec4 fragColor,
    out vec4 statistic
) {
    float gain = stellataSurfaceBrightnessLuminance(
        exposure, magPerArcsec2, omegaPxArcsec2);
    vec3 emitted = min(column * gain, vec3(STELLATA_LUMA_CEIL));

    float emittedL = dot(emitted, STELLATA_LUMA_WEIGHTS);
    statistic = stellataStatisticTexel(emittedL, emittedL, 1.0);

    fragColor = hdrTarget > 0.5
        ? vec4(emitted, 1.0)
        : vec4(stellataTonemapUndithered(emitted, whitePoint, highlightDesat), 1.0);
}

#endif
