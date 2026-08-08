// Luminance-domain extended Reinhard + highlight desaturation + sRGB
// encode + dither, in one call. Registered as stellata_tonemap; CPU
// mirror in tonemap-pure.ts. See README.md § Operator.
//
// Guarded so this chunk and stellata_hdr_emission can land in the same
// stage in either order — three pastes each #include textually wherever
// it appears. Both declare the luma weights behind a shared guard rather
// than one depending on the other; `chunk-constant-drift.test.ts` pins
// the declarations against LUMA_WEIGHTS in tonemap-pure.ts.
#ifndef STELLATA_TONEMAP
#define STELLATA_TONEMAP

#ifndef STELLATA_LUMA_WEIGHTS_DECLARED
#define STELLATA_LUMA_WEIGHTS_DECLARED
const vec3 STELLATA_LUMA_WEIGHTS = vec3(0.2126, 0.7152, 0.0722);
#endif

float stellataReinhardExtended(float y, float whitePoint) {
    return y * (1.0 + y / (whitePoint * whitePoint)) / (1.0 + y);
}

// L_THRESH and TOE_GAMMA in tonemap-pure.ts; chunk-constant-drift pins both.
const float STELLATA_TOE_KNEE = 0.02;
const float STELLATA_TOE_GAMMA = 3.5331045;

/** Detection rolloff below the threshold: sub-threshold light compresses
 *  to black over TOE_BLACK_MAG magnitudes rather than rendering at its
 *  near-linear Reinhard value. Identity at and above the knee. */
float stellataFaintToe(float y) {
    return y < STELLATA_TOE_KNEE
        ? STELLATA_TOE_KNEE * pow(y / STELLATA_TOE_KNEE, STELLATA_TOE_GAMMA)
        : y;
}

vec3 stellataSrgbEncode(vec3 c) {
    vec3 v = clamp(c, 0.0, 1.0);
    return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v));
}

/** Inverse of stellataSrgbEncode. What a layer sampling sRGB-authored
 *  imagery needs before lighting it: the maps load with NoColorSpace, so
 *  the raw texel is display-encoded and multiplying it by a physical
 *  luminance would light the body with a gamma-bent albedo. CPU mirror is
 *  srgbDecode in tonemap-pure.ts. */
vec3 stellataSrgbDecode(vec3 c) {
    vec3 v = clamp(c, 0.0, 1.0);
    return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(0.04045, v));
}

/** Interleaved-gradient noise, ±0.5/255 — breaks up the 8-bit banding
 *  the faint Milky Way gradient shows without it. */
float stellataDither(vec2 fragCoord) {
    float n = fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
    return (n - 0.5) / 255.0;
}

/** The operator without the dither. What an emitter applying the
 *  operator inline must call when more than one of its fragments can
 *  land on the same pixel: the dither is a function of fragCoord alone,
 *  so N additively-blended fragments would add the SAME offset N times —
 *  a coherent brightness bias over dense fields, not noise that cancels.
 *  Anything that covers each pixel once (the resolve pass, a fullscreen
 *  volume) wants `stellataTonemap`. */
vec3 stellataTonemapUndithered(vec3 hdr, float whitePoint, float desat) {
    float y = dot(hdr, STELLATA_LUMA_WEIGHTS);
    if (y <= 0.0) return vec3(0.0);
    float yd = stellataReinhardExtended(stellataFaintToe(y), whitePoint);
    float white = 1.0 - exp(-desat * max(y / whitePoint - 1.0, 0.0));
    vec3 desaturated = mix(hdr * (yd / y), vec3(yd), white);
    return stellataSrgbEncode(desaturated);
}

vec3 stellataTonemap(vec3 hdr, float whitePoint, float desat, vec2 fragCoord) {
    return stellataTonemapUndithered(hdr, whitePoint, desat) + stellataDither(fragCoord);
}

#endif
