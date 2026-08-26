// Interleaved gradient noise of a fragment position — the one hash both
// the output dither and every raymarch's ray-start jitter ride. Registered
// as stellata_ign; TSL mirror in ../../webgpu/tsl/jitter-tsl.ts, constants
// in tonemap-pure.ts.
//
// Guarded because a shader that dithers through stellata_tonemap can also
// jitter its own ray start off this chunk, and three pastes each #include
// textually wherever it appears — see ../emission/emission.glsl.
#ifndef STELLATA_IGN
#define STELLATA_IGN

const float STELLATA_IGN_SCALE = 52.9829189;
const vec2 STELLATA_IGN_DOT = vec2(0.06711056, 0.00583715);

/** Static per pixel and never reseeded per frame: animated jitter
 *  shimmers (docs/science-molecular-clouds.md § 9.1 rules 3–4). */
float stellataIgn(vec2 fragCoord) {
    return fract(STELLATA_IGN_SCALE * fract(dot(fragCoord, STELLATA_IGN_DOT)));
}

#endif
