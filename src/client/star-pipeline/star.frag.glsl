precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_fragment>
// Shared radial intensity profile (perceptualDiscProfile). Same I(r)
// for any point of light — see the chunk header for the super-Gaussian
// formula and the brightness-PSF-saturation rationale.
#include <stellata_perceptual_disc>
// The luminance unit — read here only for the statistic attachment's
// texel rule and LUMA_CEIL (src/client/hdr/emission/README.md § Unit).
#include <stellata_hdr_emission>
// The scene-wide operator. Applied inline here whenever the frame is
// NOT rendering into the HDR target, which — while the ship gate stays
// false — is the shipped path, not just fallback hardware. See
// src/client/hdr/README.md § Fallback.
#include <stellata_tonemap>

// HDR seam, bound by reference from HdrPipeline.emitterUniforms.
uniform float uHdrTarget;      // 1 = target bound, emit linear L untouched
uniform float uWhitePoint;
uniform float uHighlightDesat;

uniform float uMonochrome; // 0 = colour, 1 = ink-on-paper (multiply)
// Render mode:
//   0 = glow pass (additive, distant unresolved points)
//   1 = disc pass (per-channel max, close-range resolved stars; see
//       applyDiscBlendDefaults in stellata.ts for the blend rationale)
//   2 = core depth-mask (depth-only, only the bright core of disc-pass
//       stars). Renders before any background layer so the Milky Way,
//       molecular clouds, and galactic grid depth-fail behind disc cores.
//       The mesh is gated on (focused star || warping) CPU-side to skip
//       the draw call entirely when no star can be in the disc pass.
uniform int uRenderMode;
// The just-visible floor: instrument limit plus the manual EV trim. The
// vertex shader culls at the wider uCullMag, so this shader is what
// actually sets the faint edge — it fades glow-pass intensity to zero
// across the 0.5-mag taper past the threshold and discards those stars
// from the disc pass entirely.
uniform float uThresholdMag;
// The instrument's limit — chart-mode disc sizing only, which inherits
// neither adaptation nor the trim.
uniform float uLimitMag;

// Star profile tuning (debug panel knobs).
//   uVisibleThreshold — curve fullness. Higher = visible disc fills more
//     of the calibrated quad; lower = longer dim outer tail.
//   uVisibleK         — derived: -log(uVisibleThreshold). Provided as a
//     uniform to avoid recomputing log() per fragment.
//   uCoreThreshold    — glow value above which the disc pass writes near
//     depth (occludes background). Below this, depth is pushed to the far
//     plane so background stars peek through the soft halo via the later
//     glow pass.
//   uDiscardThreshold — glow value below which the fragment is dropped
//     entirely (no color, no depth). Set just above 0 so the very-zero
//     edge doesn't cost a write.
//   uDistNMin / uDistNMax — super-Gaussian exponent at the distant /
//     close-range ends of vPhysRatio. Low n = Gaussian (fuzzy), high n =
//     plateau-with-edge (disc-like).
//   uLumBiasMin / uLumBiasMax — multiplied onto n by luminosity-class
//     softness (dwarf → hypergiant). Hypergiants stay fuzzier than
//     dwarfs at equivalent distance.
uniform float uVisibleThreshold;
uniform float uVisibleK;
uniform float uCoreThreshold;
uniform float uDiscardThreshold;
uniform float uDistNMin;
uniform float uDistNMax;
uniform float uLumBiasMin;
uniform float uLumBiasMax;

in float vAppMag;
in vec3 vColor;
in vec2 vUv;
in float vPhysRatio; // 1 = physical-size-driven (render as solid disc),
                     // 0 = apparent-mag-driven (render as soft point glow)
in float vSoftness;  // 0 = crisp (WD) … 1 = fuzzy (hypergiant)
in float vAaWidth;   // chart-mode disc edge width in vUv units (1 CSS px)
in float vLocalMember; // 1 = local-depth-cluster member (main variant only)
in float vPeakL;     // linear luminance at the kernel's centre
in float vFluxPeakL; // the same kernel renormalised to carry true flux

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outStatistic;

// Write a star fragment. `glow` is the unit-peak display kernel and
// `vPeakL` the star's physical luminance, so the product is linear light
// in the scene-wide unit — written straight into the target, or put
// through the operator here when there isn't one.
//
// Alpha stays the kernel value, exactly as before HDR: the glow pass's
// AdditiveBlending multiplies rgb by it, which is what gives that pass
// its squared falloff. Peak luminance is identical on both paths, so
// calibration matches; what differs off-target is that the operator runs
// per-fragment before that multiply and before overlapping stars sum, so
// saturated stars read slightly fatter and dense fields over-brighten.
//
// Undithered: star quads overlap, and the dither is a function of
// fragCoord alone, so dithering here would bias each pixel by its own
// offset once per overlapping star.
//
// The statistic attachment takes alpha 1 rather than the kernel value:
// one blend equation runs over both attachments, so the glow pass's
// SrcAlpha factor would scale the flux channel a second time and the
// integral would come out short by ∫glow² / ∫glow.
void starEmission(float glow) {
    vec3 emitted = vColor * (vPeakL * glow);
    outColor = uHdrTarget > 0.5
        ? vec4(emitted, glow)
        : vec4(stellataTonemapUndithered(emitted, uWhitePoint, uHighlightDesat), glow);
    outStatistic = stellataStatisticTexel(vFluxPeakL * glow, 0.0, 1.0);
}

void main() {
    float r = length(vUv);
    if (r > 0.5) discard;

    // Defensive default — the halo branch below conditionally writes
    // gl_FragDepth, and once any path writes it the unwritten paths leave
    // it undefined per GLSL spec. The chunk below adds nothing on top:
    // README.md § Depth encoding.
    gl_FragDepth = gl_FragCoord.z;
    #include <logdepthbuf_fragment>

    // Chart mode: flatten everything. Stars render as solid hard-edged
    // discs filling the inscribed circle of the calibrated quad, against
    // the paper background under MultiplyBlending. No glow profile, no
    // halo, no luminosity-class softening — the brightness-driven quad
    // size is the only encoding of magnitude. The vertex shader passes
    // vAaWidth as 1 CSS pixel in vUv space so the edge is always one
    // pixel wide regardless of quad size. (Earlier `fwidth(r)` was
    // unstable near the quad centre — `length(vUv)` has an undefined
    // screen-space derivative at vUv = 0 and tiny quads ended up with
    // disc≈0.5 in the middle, rendering as a faint grey rather than
    // solid black.)
    if (uMonochrome > 0.5) {
        if (uRenderMode == 0 && vPhysRatio >= STELLATA_PHYS_RATIO_THRESHOLD) discard;
        if (uRenderMode == 1 && vPhysRatio <  STELLATA_PHYS_RATIO_THRESHOLD) discard;
        if (uRenderMode == 2 && vPhysRatio <  STELLATA_PHYS_RATIO_THRESHOLD) discard;
        if (vAppMag > uLimitMag) discard;
        float aa = max(vAaWidth, 1e-3);
        float disc = 1.0 - smoothstep(0.5 - aa, 0.5, r);
        if (disc <= 0.0) discard;
        outStatistic = vec4(0.0);
        if (uRenderMode == 2) {
            outColor = vec4(0.0); // material has colorWrite = false on the mask
            return;
        }
        // MultiplyBlending: rgb = 1.0 leaves dst unchanged, rgb = 0.0
        // multiplies dst toward black. mix(1, 0, disc) paints solid
        // black ink with an antialiased outer pixel.
        outColor = vec4(vec3(1.0 - disc), 1.0);
        return;
    }

    float glow = perceptualDiscProfile(
        r, vSoftness, vPhysRatio,
        uVisibleThreshold, uVisibleK,
        uDistNMin, uDistNMax,
        uLumBiasMin, uLumBiasMax);

    if (uRenderMode == 2) {
        // Core depth-mask — write near depth only for disc-pass cores.
        // Same disc-pass gates so we don't write depth for stars that
        // wouldn't render colour. Halo is discarded so background layers
        // can paint through it (the disc pass handles the halo's own
        // depth via gl_FragDepth = 1.0 below).
        if (vPhysRatio < STELLATA_PHYS_RATIO_THRESHOLD) discard;
        if (vAppMag > uThresholdMag) discard;
        if (glow < uCoreThreshold) discard;
        // Local-depth-cluster member: stamp the nearest possible depth.
        // The member's true standard depth quantises to 1.0 past ~7 AU
        // and TIES background glow instead of occluding it; the local
        // pass repaints the core, and membership range (a ≥5 px disc)
        // guarantees nothing renderable sits between camera and disc.
        if (vLocalMember > 0.5) gl_FragDepth = 0.0;
        outColor = vec4(0.0); // ignored — material has colorWrite = false
        outStatistic = vec4(0.0);
        return;
    }

    if (uRenderMode == 0) {
        // Glow pass — only point-dominated stars. Additive blending so
        // overlapping distant stars accumulate brightness.
        if (vPhysRatio >= STELLATA_PHYS_RATIO_THRESHOLD) discard;
        // Soft taper: fade to zero across the 0.5-mag band past the
        // just-visible threshold so the faint edge is never a hard
        // cutoff. It multiplies emitted luminance now, so the fade is
        // photometric rather than profile-only.
        float tap = 1.0 - smoothstep(
            uThresholdMag, uThresholdMag + STELLATA_SOFT_TAPER_MARGIN_MAG, vAppMag);
        glow *= tap;
        starEmission(glow);
    } else {
        // Disc pass — only disc-dominated stars. Per-channel MaxEquation
        // blending (see applyDiscBlendDefaults); depth handling below
        // decides whether each fragment occludes the background.
        if (vPhysRatio < STELLATA_PHYS_RATIO_THRESHOLD) discard;
        // The taper region (m_thresh, m_thresh + 0.5] is glow-only —
        // resolved discs at threshold would render as a sub-pixel speck
        // and read as a hard cutoff anyway, so keep the disc pass crisp.
        if (vAppMag > uThresholdMag) discard;
        // Drop the imperceptible outer fringe entirely so it doesn't cost
        // a depth write or a no-op blend.
        if (glow < uDiscardThreshold) discard;
        // Halo fragments (glow below the core threshold) paint their dim
        // colour with low alpha but push depth to the far plane, so the
        // later glow pass's background stars pass the depth test and
        // accumulate additively — the haze stays visible while distant
        // stars peek through it.
        if (glow < uCoreThreshold) gl_FragDepth = 1.0;
        starEmission(glow);
    }
}
