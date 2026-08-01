// Resolve the HDR render target to the canvas: attachment 0 plus the
// diffuse attachment averaged over the eye's summation patch, then the
// operator. uTonemapEnabled = 0 is the pass-through A/B path
// (README.md § Dev switches).
precision highp float;
precision highp int;

#include <stellata_tonemap>
#include <stellata_summation>

uniform sampler2D uHdrTexture;
uniform sampler2D uDiffuseTexture;
uniform float uSummationRadiusTexels;
uniform float uSummationTexelScale;
uniform vec2 uSummationExtent;
uniform float uWhitePoint;
uniform float uHighlightDesat;
uniform float uTonemapEnabled;

out vec4 outColor;

void main() {
    vec4 hdr = texelFetch(uHdrTexture, ivec2(gl_FragCoord.xy), 0);
    // The diffuse emitters write attachment 2 and leave attachment 0 alone,
    // so this add is the only path their light reaches the canvas by
    // (summation/README.md). Additive because the two are disjoint sets of
    // emitters over the same pixel, exactly as the blend would have been.
    vec3 linear = hdr.rgb + stellataSummationMean(
        uDiffuseTexture,
        gl_FragCoord.xy * uSummationTexelScale,
        uSummationRadiusTexels,
        uSummationExtent
    );
    if (uTonemapEnabled < 0.5) {
        outColor = vec4(linear, hdr.a);
        return;
    }
    outColor = vec4(
        stellataTonemap(linear, uWhitePoint, uHighlightDesat, gl_FragCoord.xy),
        hdr.a
    );
}
