// Apparent magnitude → linear luminance in the HDR unit, and the peak a
// point source's display kernel carries. Registered as
// stellata_hdr_emission; CPU mirror in emission-pure.ts. See README.md
// § Unit.
//
// Guarded because an emitter that computes a per-pixel magnitude needs
// this chunk and stellata_tonemap in the same stage, and three pastes
// each #include textually wherever it appears. The luma weights sit
// behind their own guard for the same reason — see tonemap.glsl.
#ifndef STELLATA_HDR_EMISSION
#define STELLATA_HDR_EMISSION

#ifndef STELLATA_LUMA_WEIGHTS_DECLARED
#define STELLATA_LUMA_WEIGHTS_DECLARED
const vec3 STELLATA_LUMA_WEIGHTS = vec3(0.2126, 0.7152, 0.0722);
#endif

const float STELLATA_LUMA_CEIL = 4096.0;
const float STELLATA_PI = 3.141592653589793;

float stellataLuminanceForMag(float exposure, float appMag) {
    return exposure * pow(10.0, -0.4 * appMag);
}

/** `physRadiusPx` is the source's true angular radius in CSS pixels,
 *  uncapped by any viewport-fraction clamp. Below 1 px the source is
 *  unresolved and its whole flux lands on the peak; above it the
 *  emission is true surface brightness. */
float stellataPointSourcePeak(float exposure, float appMag, float physRadiusPx) {
    float flux = stellataLuminanceForMag(exposure, appMag);
    float spread = max(1.0, STELLATA_PI * physRadiusPx * physRadiusPx);
    return min(flux / spread, STELLATA_LUMA_CEIL);
}

/** The same kernel renormalised to carry the source's true FLUX rather than
 *  its true peak — the adaptation statistic's flux channel. The display
 *  kernel preserves peak and inflates energy, so dividing by its own area
 *  integral `fluxIntegral * D^2` (perceptualDiscFluxIntegral) makes the
 *  integral return stellataLuminanceForMag instead. Clamped like the display
 *  peak: a clamped read is a lower bound the adaptation loop closes from
 *  above. See statistic/README.md § The unit. */
float stellataKernelFluxPeak(
    float exposure,
    float appMag,
    float quadDiameterPx,
    float fluxIntegral
) {
    float area = fluxIntegral * quadDiameterPx * quadDiameterPx;
    float flux = stellataLuminanceForMag(exposure, appMag);
    return min(flux / max(area, 1e-9), STELLATA_LUMA_CEIL);
}

/** One texel of the statistic attachment: flux-correct luminance in R,
 *  peak-correct in G. `alpha` must be whatever the same fragment writes to
 *  attachment 0, because one blend equation runs over both attachments —
 *  an emitter that wants its flux SUMMED under an alpha-scaled additive
 *  blend passes a pre-divided R. Both channels clamp at the ceiling for the
 *  reason the display peak does: a clamped read is a lower bound the
 *  adaptation loop closes from above
 *  (exposure/reduction/README.md § Measure at the base exposure). */
vec4 stellataStatisticTexel(float fluxL, float peakL, float alpha) {
    return vec4(
        min(fluxL, STELLATA_LUMA_CEIL),
        min(peakL, STELLATA_LUMA_CEIL),
        0.0,
        alpha);
}

/** Luminance one pixel receives from an extended source of surface
 *  brightness `magPerArcsec2`. The pixel's flux magnitude is
 *  `magPerArcsec2 - 2.5*log10(omegaPxArcsec2)`, and feeding that through
 *  stellataLuminanceForMag collapses the log round-trip to this product —
 *  which is why a layer can apply it as one scalar gain and keep its
 *  chromaticity.
 *
 *  Unclamped: a layer scaling a per-channel column by this must clamp the
 *  product against STELLATA_LUMA_CEIL, not the factor. */
float stellataSurfaceBrightnessLuminance(
    float exposure,
    float magPerArcsec2,
    float omegaPxArcsec2
) {
    return stellataLuminanceForMag(exposure, magPerArcsec2) * omegaPxArcsec2;
}

#endif
