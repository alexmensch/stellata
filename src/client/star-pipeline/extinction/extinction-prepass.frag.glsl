// Per-star A_V prepass: one texel per star, one camera→star raymarch
// per texel. star.vert.glsl consumes the R channel via texelFetch.
// See ./README.md.
precision highp float;
precision highp int;

#include <stellata_dust_raymarch>

// RGBA float absolute star positions (pc), star i at texel
// (i % width, i / width). Padding texels beyond the catalog hold the
// origin; their marches are wasted but never read.
uniform sampler2D uPosTex;
uniform vec3 uAbsCameraPos; // absolute ICRS heliocentric pc

out vec4 outAv;

void main() {
    vec3 starAbs = texelFetch(uPosTex, ivec2(gl_FragCoord.xy), 0).rgb;
    outAv = vec4(dustRaymarchAV(uAbsCameraPos, starAbs), 0.0, 0.0, 1.0);
}
