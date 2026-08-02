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
const float STELLATA_ARCSEC_TO_RAD = 4.84813681109536e-6;
const float STELLATA_LOG10 = 2.302585092994046;
const float STELLATA_SQRT12 = 3.4641016151377544;

/** Inverse of `pixelSolidAngleArcsec2` — CSS px per radian recovered from
 *  the pixel solid angle. A layer needing a plate scale takes it from
 *  `uOmegaPxArcsec2` through this rather than carrying a second uniform,
 *  so a resize can never leave the two disagreeing about the viewport. */
float stellataPxPerRadian(float omegaPxArcsec2) {
    return 1.0 / (STELLATA_ARCSEC_TO_RAD * sqrt(max(omegaPxArcsec2, 1e-12)));
}

/** Radius, in pc, over which a raymarch step must smooth its profile for a
 *  point-sampled fragment to carry the pixel's AREA average of the column
 *  rather than the profile's value at the pixel centre. One CSS pixel
 *  subtends `distancePc / pxPerRadian`; `sqrt(12)` matches the second moment
 *  of a square footprint, which is the order the softening below corrects to.
 *  Grows along the ray, so it is a cone rather than a cylinder.
 *
 *  Load-bearing for the display convolution, not cosmetic: the convolution
 *  can only average what the rasteriser sampled, and an aliased Sérsic cusp
 *  survives it — 3.95 mag on M31's nucleus. summation/README.md § Footprint. */
float stellataFootprintPc(float distancePc, float omegaPxArcsec2) {
    return distancePc / (stellataPxPerRadian(omegaPxArcsec2) * STELLATA_SQRT12);
}

/** A profile radius smoothed over the footprint. For a spherically symmetric
 *  profile this is exactly TRANSVERSE smoothing — `|p|² + eps²` splits into
 *  the parallel and perpendicular parts of `p`, so adding `eps²` to the whole
 *  radius adds it to the perpendicular part alone. */
float stellataSoftenRadius(float radiusPc, float footprintPc) {
    return sqrt(radiusPc * radiusPc + footprintPc * footprintPc);
}

/** How much of the footprint lies along `axis` for a ray running `dirUnit`:
 *  the perpendicular disc's extent projected onto that axis. Zero when the
 *  ray runs along the axis, which is what a separable profile needs — the
 *  vertical scale height is finer than the footprint at wide FOV, so
 *  softening a face-on disc along z would suppress the column instead of
 *  averaging it. */
float stellataFootprintAlong(vec3 dirUnit, vec3 axis) {
    float c = dot(dirUnit, axis);
    return sqrt(max(0.0, 1.0 - c * c));
}

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
 *  above. See attachments/README.md § The unit. */
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

/** Luminance from an extended source of surface brightness
 *  `magPerArcsec2` spread over `omegaArcsec2`. The flux magnitude inside
 *  that solid angle is `magPerArcsec2 - 2.5*log10(omegaArcsec2)`, and
 *  feeding that through stellataLuminanceForMag collapses the log
 *  round-trip to this product — which is why a layer can apply it as one
 *  scalar gain and keep its chromaticity.
 *
 *  The pixel solid angle is the physical answer; a display path takes the
 *  rod summation solid angle instead (README.md § Extended sources).
 *
 *  Unclamped: a layer scaling a per-channel column by this must clamp the
 *  product against STELLATA_LUMA_CEIL, not the factor. */
float stellataSurfaceBrightnessLuminance(
    float exposure,
    float magPerArcsec2,
    float omegaArcsec2
) {
    return stellataLuminanceForMag(exposure, magPerArcsec2) * omegaArcsec2;
}

/** The extended-source threshold surface brightness recovered from the rod
 *  summation solid angle — the inverse of `rodSummationSolidAngleArcsec2`.
 *  A consumer needing threshold back in the magnitude domain (the chart
 *  isobar contours a surface brightness) takes it from the same uniform
 *  the gain runs on rather than a second one, so the contour and the
 *  emission cannot disagree about where threshold is. */
float stellataExtendedThresholdSb(float omegaSummationArcsec2, float limitMag) {
    return limitMag + 2.5 * log(max(omegaSummationArcsec2, 1e-12)) / STELLATA_LOG10;
}

#endif
