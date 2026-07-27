// Resolve the HDR render target to the canvas. uTonemapEnabled = 0 is
// the pass-through A/B path (README.md § Dev switches).
precision highp float;
precision highp int;

#include <stellata_tonemap>

uniform sampler2D uHdrTexture;
uniform float uWhitePoint;
uniform float uHighlightDesat;
uniform float uTonemapEnabled;

out vec4 outColor;

void main() {
    vec4 hdr = texelFetch(uHdrTexture, ivec2(gl_FragCoord.xy), 0);
    if (uTonemapEnabled < 0.5) {
        outColor = hdr;
        return;
    }
    outColor = vec4(
        stellataTonemap(hdr.rgb, uWhitePoint, uHighlightDesat, gl_FragCoord.xy),
        hdr.a
    );
}
