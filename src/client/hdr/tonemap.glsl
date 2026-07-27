// Luminance-domain extended Reinhard + highlight desaturation + sRGB
// encode + dither, in one call. Registered as stellata_tonemap; CPU
// mirror in tonemap-pure.ts. See README.md § Operator.

const vec3 STELLATA_LUMA_WEIGHTS = vec3(0.2126, 0.7152, 0.0722);

float stellataReinhardExtended(float y, float whitePoint) {
    return y * (1.0 + y / (whitePoint * whitePoint)) / (1.0 + y);
}

vec3 stellataSrgbEncode(vec3 c) {
    vec3 v = clamp(c, 0.0, 1.0);
    return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v));
}

/** Interleaved-gradient noise, ±0.5/255 — breaks up the 8-bit banding
 *  the faint Milky Way gradient shows without it. */
float stellataDither(vec2 fragCoord) {
    float n = fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
    return (n - 0.5) / 255.0;
}

vec3 stellataTonemap(vec3 hdr, float whitePoint, float desat, vec2 fragCoord) {
    float y = dot(hdr, STELLATA_LUMA_WEIGHTS);
    if (y <= 0.0) return vec3(0.0);
    float yd = stellataReinhardExtended(y, whitePoint);
    float white = 1.0 - exp(-desat * max(y / whitePoint - 1.0, 0.0));
    vec3 desaturated = mix(hdr * (yd / y), vec3(yd), white);
    return stellataSrgbEncode(desaturated) + stellataDither(fragCoord);
}
