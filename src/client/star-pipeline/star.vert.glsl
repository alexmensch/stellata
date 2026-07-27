precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_vertex>
// Shared apparent-magnitude → disc-pixel-size mapping. Same physics
// for any point of light (stars, planets, ...). See the chunk header
// for what perceptualDmEff / perceptualAppSizePx do.
#include <stellata_perceptual_disc>
// Shared magnitude → linear-luminance unit (stellataPointSourcePeak).
#include <stellata_hdr_emission>

// Exposure — the whole scene's single brightness anchor, shared with
// every other physical layer. Pinned to the naked-eye base epoch until
// H6 routes the magnitude slider through it.
uniform float uExposure;

uniform vec3 uCameraPos;
uniform float uMaxAppMag;
uniform float uMinDistSol;
uniform float uMaxDistSol;
uniform uint uSpectMask;
// Index of a star to suppress entirely (all three passes — disc, glow, core
// mask — share this vertex shader). Set to the focused-star index in
// OBSERVE mode so the star the camera is parked on doesn't render. -1 in
// every other mode disables the suppression by construction (gl_InstanceID
// is non-negative).
uniform int uHideFocusIdx;
// Member stars of the frame's active local-depth clusters (-1 = empty
// slot; slot count pinned to MIRROR_CAPACITY in star-pipeline.test.ts).
// A member's main-pass instance collapses in all three passes — the
// local pass's mirror draws render it instead
// (src/client/local-depth/README.md § Full membership).
uniform int uLocalMemberIdx[8];
// Pass index — 0=glow, 1=disc, 2=core mask. Shared with the frag shader;
// the vert reads it so the composite-suppress sentinel below can drop
// the disc and core-mask passes for sub-pixel binary secondaries while
// the glow pass still runs.
uniform int uRenderMode;
// Force-center the focused star at NDC (0,0). At extreme close approach
// (~5×10⁻⁸ pc for Sol-class stars), float32 cancellation in the matrix
// chain can drift the projected centre by visible pixels even though
// `controls.target = focused star + lookAt` puts it mathematically at
// view-origin. JS-side stellata sets this to the focused-star index
// when the camera-target alignment holds; -1 means use the default
// projection path.
uniform int uPinFocusToCenter;
uniform float uPixelRatio;
uniform float uSizeMin;
uniform float uSizeMax;
uniform float uSizeSpan;
// Soft-knee saturation extent (magnitudes). 0 = hard-clamp at sizeSpan
// (legacy); larger values let bright stars keep growing past the
// linear ceiling. See the perceptual-disc chunk for the formula and
// the rationale (Sol-vs-Barnard ratio at close approach).
uniform float uSizeKnee;
// Chart-mode disc sizing. Stars render as flat hard-edged discs whose
// pixel diameter spreads linearly between [Min, Max] across the visible
// magnitude range [Bright, MaxAppMag]. Linear in mag = log10 in flux,
// matching naked-eye perception (defined that way). Uniforms read only
// when uMonochrome > 0.5; outside chart mode the existing physical-size
// + apparent-magnitude blend formula runs unchanged.
uniform float uChartDiscMaxPx;   // brightest end (e.g. 28 px)
uniform float uChartDiscMinPx;   // faintest end (e.g. 1.5 px)
uniform float uChartMagBright;   // magnitude that maps to MAX (e.g. -2.0)
uniform float uMonochrome;       // 0 = colour mode, 1 = chart mode (shared with frag)

// Physical-size rendering term. A star's rendered pixel diameter equals
// its true angular diameter through the camera's projection:
//   pxSize = 2·atan(R · radiusFactor / d) · viewport.y / fov_y_rad
// R is the per-star physical radius in pc — iLogRadius is in solar
// radii (matching catalog.physicalRadius), so we multiply through by
// uRSunPc (≈ 2.2543e-8 pc/R_sun) to land in pc-relative-to-d.
// radiusFactor is the variability modulation. Falls off as 1/d in the
// small-angle regime and saturates as d → R (disc fills the frame).
uniform float uFovYRad;   // camera vertical FOV in radians
uniform float uRSunPc;    // 1 R_sun in parsecs; canonical R_SUN_PC in src/client/util/astronomy-constants.ts
uniform vec2 uViewport;   // viewport size in CSS pixels (for quad expansion)
// Peak-disc cap, mirroring the TS-side ZOOM_FLOOR_FRACTION. Driven from a
// single source in stellata.ts. Bounds any resolved disc (variable or
// not) so a supergiant at the orbit floor can't overflow the viewport.
uniform float uMaxPhysFrac;     // peak disc fraction of min(viewport) (= ZOOM_FLOOR_FRACTION)

// Variability. Pulsation runs on the MODEL clock (getT()), at real GCVS
// periods — like binary orbital motion, and responding to the same
// time-warp. uModelDays is the model time in days since J2000; per-star
// period is in days (0 = not a variable), per-star amplitude in magnitudes.
// At 1× every real period is far longer than a frame, so long-period
// variables (Miras, hundreds of days) are imperceptible until time-warp
// engages — deliberate, matching binary orbits. uMinPeriodSec survives
// ONLY as an anti-strobe guard: uModelDaysPerRealSec (the warp rate in
// model-days per real second) floors the effective period so no cycle
// completes faster than uMinPeriodSec in real time under heavy warp.
uniform float uModelDays;
uniform float uModelDaysPerRealSec;
uniform float uMinPeriodSec;

// Interstellar-dust extinction. Dust-field uniforms + the camera→star
// raymarch live in the shared chunk; A_V is added to appMag with a
// matching colour-index shift (E(B-V) = A_V / R_V) to redden the star.
// The primary source is the per-star prepass texture (one march per
// star per camera move — see extinction-prepass.ts); the in-vertex
// march is the fallback when the prepass is unavailable or disabled.
#include <stellata_dust_raymarch>
uniform sampler2D uAvPrepassTex;    // star-indexed A_V, R channel
uniform float uAvPrepassEnabled;    // 1 = texelFetch path, 0 = in-vertex march
uniform float uDustEnabled;         // 0 = no texture bound, 1 = bound
uniform float uExtinctionStrength;  // user knob; multiplied onto uDustEnabled
uniform vec3 uWorldOffset;          // absolute coord of renderer's local origin

// Object/camera matrices. RawShaderMaterial doesn't auto-inject these
// (ShaderMaterial would); declare what we use. Three.js's WebGLRenderer
// still uploads modelViewMatrix per-object and projectionMatrix per-camera
// regardless of material type, so declaration alone is enough.
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

const float R_V = 3.1; // canonical interstellar reddening ratio: A_V / E(B-V)

// Per-vertex: unit-square corner in [-0.5, +0.5] × [-0.5, +0.5], used to
// expand each instanced quad around its projected star centre.
in vec2 aCorner;

// Per-instance: attributes that vary from star to star.
// iPosition is in the renderer's local frame — which may be offset from
// absolute catalog space via the CPU-side floating-origin mechanism (see
// Stellata.recenterOrigin). Do NOT use length(iPosition) for any
// distance-from-Sol computation; use iDistSol instead.
in vec3 iPosition;
in float iAbsmag;
in float iCi;
in float iSpectClass;
in float iLogRadius;
in float iPeriodDays;   // 0 = not a variable
in float iAmplitudeMag; // 0 = not a variable (V-band magnitude amplitude)
// Per-type pulsation params (buildPulsationParams from catalog varType),
// packed as one attribute to stay under the WebGL2 16-attribute budget.
// iPuls.x = ρ (peak-to-peak physical-radius ratio); iPuls.y = ΔB−V
// (peak-to-peak colour swing). Miras carry a small ρ (their V-band
// amplitude is dominated by a temperature swing, not radius) and a large
// colour swing. See src/client/star-pipeline/pulsation/README.md.
in vec2 iPuls;
in float iLumClass;     // 0=WD, 2=V, 4=III, 6-9=supergiant/hypergiant, 255=?
in float iDistSol;      // |absolute position| — precomputed at load
// Best Gaia DR3 Apsis Teff per star (gspphot ∪ gspspec), 0.0 when neither
// solution is available. Gates the Apsis-direct branch in ciToColor below;
// the JS-side mirror is bestApsisTeff() in star-color-routing-pure.ts.
in float iTeffApsis;
// Composite-suppress flag written by BinaryOrbitField each frame. 1.0 =
// collapse the disc + core-mask passes for this instance (the additive
// glow pass still runs and sums the two near-coincident point sources
// correctly). Used for the dimmer member of a sub-pixel binary pair.
in float iCompositeSuppress;
// Geometric eclipse-occlusion factor written by EclipsePhotometryField
// each frame. 1.0 = no occlusion; values in (0, 1) mean the back
// component of an orbital binary pair is partially hidden by the front
// component along the camera line of sight. Folded into appMag in the
// glow pass only (the disc pass at close range resolves the occlusion
// geometrically via the depth buffer; double-applying here would dim
// the back disc's non-occluded fragments too). See
// src/client/binaries/eclipse/README.md.
in float iEclipseDim;
// Pulsation-suppress flag. 1.0 disables the GCVS-amplitude radial
// pulsation block below. Built once at catalog-load from
// `catalog.varType` alone (binary-independent), not rewritten per frame.
// See src/client/binaries/eclipse/README.md § Pulsation gate for eclipsing
// binaries.
in float iSuppressPulsation;
#ifdef LOCAL_DEPTH_PASS
// Mirror-draw slot → source catalog index. Replaces gl_InstanceID for
// every star-indexed lookup (extinction texel, hide/pin compares) so a
// mirror slot behaves exactly like its source instance. Both compile
// variants stay within the 16-attribute WebGL2 minimum (pinned per-
// variant in star-pipeline.test.ts).
in float iSourceIdx;
#define STAR_SELF_ID int(iSourceIdx + 0.5)
#else
#define STAR_SELF_ID gl_InstanceID
#endif

out float vAppMag;
out vec3 vColor;
out vec2 vUv;          // (-0.5..+0.5) passed to frag for the disk mask
out float vPhysRatio;  // physSize / pxSize, in [0,1] — 1 means the physical
                       // term is driving the size (close range, resolve as a
                       // disc); 0 means the apparent-mag term is driving
                       // (distant, render as a soft glow)
out float vSoftness;   // 0 = crisp (white dwarf), 1 = fuzzy (hypergiant) —
                       // drives halo falloff and disc-edge AA width
// Chart-mode anti-aliasing. Width of the disc edge in vUv units, computed
// per quad in the vertex shader as `1.0 / pxSize`. Stable across quad
// sizes — the alternative `fwidth(r)` blows up near the quad centre where
// the screen-space derivative of `length(vUv)` is undefined, leaving the
// inner disc faint or invisible.
out float vAaWidth;
out float vLocalMember; // 1 = local-depth-cluster member (main variant only)
// Linear luminance at the centre of this star's display kernel. Constant
// per instance, so the interpolation across the quad is exact.
out float vPeakL;

const float LOG10 = 2.302585093;

// Blackbody → sRGB lookup table indexed by B-V. 256×1 texture; the
// Ballesteros 2012 B-V→Teff conversion and Planck + CIE 1931 + sRGB
// D65 transform are baked in at LUT build time (see scripts/colour/blackbody-lut.ts).
// BV_MIN / BV_MAX must match ./blackbody-lut.ts.
uniform sampler2D uColorLut;
const float BV_MIN = -0.4;
const float BV_MAX = 2.0;

// Analytic inverse of Ballesteros 2012. Mirrored from
// `ballesterosBvFromTeff` in scripts/colour/blackbody-lut-pure.ts — keep
// the two in sync. Picks the positive quadratic root.
float ballesterosBvFromTeff(float teff) {
    float k = teff / 4600.0;
    float disc = sqrt(4.0 + 1.1664 * k * k);
    float u = (2.0 - 2.32 * k + disc) / (2.0 * k);
    return u / 0.92;
}

// Sample the dust-reddened-B-V → linear-sRGB LUT and renormalise to
// relative luminance 1, so `vColor * vPeakL` has luminance exactly
// vPeakL and chromaticity carries no brightness side-channel. The table
// itself is peak-normalised (a Y=1 table runs to 1.88 at the blue end
// and won't fit uint8) — scripts/colour/README.md.
vec3 ciToColor(float bvVal) {
    float t = clamp((bvVal - BV_MIN) / (BV_MAX - BV_MIN), 0.0, 1.0);
    vec3 chroma = texture(uColorLut, vec2(t, 0.5)).rgb;
    return chroma / max(dot(chroma, STELLATA_LUMA_WEIGHTS), 1e-6);
}

// The off-screen-sentinel varying payload, shared by every early return
// below so a newly added varying can't be missed in one of them. The
// quad lands fully outside NDC and is clipped before rasterization, so
// the values only have to be defined, not meaningful.
void emitOffscreenSentinel(float appMag, float softness) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAppMag = appMag;
    vColor = vec3(0.0);
    vUv = aCorner;
    vPhysRatio = 0.0;
    vSoftness = softness;
    vAaWidth = 0.0;
    vPeakL = 0.0;
}

void main() {
    // Off-screen-sentinel early-returns below skip <logdepthbuf_vertex>,
    // leaving vFragDepth undefined for that vertex. Safe because the
    // suppression conditions read only per-instance attributes — all 4
    // verts of the quad share the path and land at the same off-screen
    // NDC, so the primitive is fully NDC-clipped before rasterization
    // and the fragment shader never executes for it. A future change
    // that makes the off-screen position per-vertex would break this
    // invariant and need to write vFragDepth before returning.
    bool isLocalMember = false;
#ifndef LOCAL_DEPTH_PASS
    for (int k = 0; k < 8; k++) {
        isLocalMember = isLocalMember || gl_InstanceID == uLocalMemberIdx[k];
    }
#endif
    vLocalMember = isLocalMember ? 1.0 : 0.0;
    // A member keeps its core depth-mask draw (mode 2): the stamp is what
    // stops main-pass background from painting inside the core the local
    // pass repaints — MaxEquation blending cannot paint over it later.
    // Only the colour passes collapse in favour of the mirror draws.
    bool suppressed = STAR_SELF_ID == uHideFocusIdx
        || (isLocalMember && uRenderMode != 2);
    if (suppressed) {
        emitOffscreenSentinel(0.0, 0.0);
        return;
    }
    // Sub-pixel binary secondaries: drop the opaque disc (mode 1) and
    // the core depth-mask (mode 2). The additive glow (mode 0) still
    // runs so the two co-located point sources sum brightness under
    // additive blending. Same off-screen-sentinel pattern as the focus
    // hide above — see the comment block there for the vFragDepth
    // safety argument.
    if (iCompositeSuppress > 0.5 && (uRenderMode == 1 || uRenderMode == 2)) {
        emitOffscreenSentinel(0.0, 0.0);
        return;
    }

    vec3 worldPos = iPosition;
    float distCam = distance(worldPos, uCameraPos);

    // Floor at 1e-30 only to keep log(dPc) finite in the appMag calc;
    // small enough that the per-star physical orbit floor (down to ~5e-8
    // pc for Sol-class) never hits it, so physSize = 2·atan(R/d) can
    // grow all the way to fill the viewport at the manual-zoom limit.
    float dPc = max(distCam, 1e-30);
    float appMag = iAbsmag + 5.0 * (log(dPc) / LOG10 - 1.0);

    // Variability — the R+T amplitude split (docs/science-stellar-modelling.md
    // § Variable-star pulsation). The three modulations are anchored to a
    // single phase, φ = 0 = maximum light:
    //   (1) magMod shifts appMag by the FULL GCVS V-band amplitude, driving
    //       point-glow size at ranges where the star isn't already saturated.
    //       A distant Mira still fades out near minimum — physical, desired.
    //   (2) radiusFactor swings the resolved disc by the per-type physical
    //       ratio ρ (interferometry, not V-band): min radius at max light,
    //       peak-to-peak ρ. Miras carry a small ρ because their large V-band
    //       amplitude is almost all temperature, not radius.
    //   (3) ciMod reddens the LUT-input B−V toward minimum light by the
    //       per-type colour swing ΔB−V (applied below at the LUT sample).
    float R_pc = pow(10.0, iLogRadius) * uRSunPc;
    float angularToPx = uViewport.y / max(uFovYRad, 1e-9);
    float radiusFactor = 1.0;
    float magMod = 0.0;
    float ciMod = 0.0;
    if (iPeriodDays > 0.0 && iAmplitudeMag > 0.0 && iSuppressPulsation < 0.5) {
        // Anti-strobe: floor the effective period (in model days) so a cycle
        // never completes faster than uMinPeriodSec in real time. At 1× the
        // floor (uModelDaysPerRealSec ≈ 1/86400 × uMinPeriodSec) is a few
        // seconds of model time — below every real period — so it bites only
        // under heavy time-warp on short-period variables.
        float minModelDays = uModelDaysPerRealSec * uMinPeriodSec;
        float periodDaysEff = max(iPeriodDays, minModelDays);
        // Phase 0 at J2000, wrapped to [0,1) so the cos() argument stays
        // small — float32 loses precision in cos() of a large angle, which
        // would jitter short-period variables. Absolute-phase anchoring
        // (φ = 0 at the GCVS epoch of maximum light) folds in as
        // fract((uModelDays − iEpochDays) / period) once that per-star
        // attribute lands; the φ = 0 = max-light convention below is already
        // set up for it.
        float phase = fract(uModelDays / periodDaysEff);
        float c = cos(6.2831853 * phase);

        // φ = 0 = maximum light. magMod most-negative (brightest) at φ = 0;
        // radiusFactor MINIMUM at max light (interferometry puts minimum
        // diameter near maximum light) via the negative exponent, spanning
        // [ρ^−0.5, ρ^+0.5] over a cycle; disc reddens toward minimum.
        magMod = -0.5 * iAmplitudeMag * c;
        appMag += magMod;
        radiusFactor = pow(iPuls.x, -0.5 * c);
        ciMod = -0.5 * iPuls.y * c;
    }

    // Geometric eclipse-occlusion dim, glow pass only. Disc pass at
    // close range resolves the occlusion via the depth buffer; double-
    // applying here would dim the back disc's non-occluded fragments.
    // Buffer defaults to 1.0 (no-dim); EclipsePhotometryField writes
    // [DIM_FLOOR, 1) for partial occlusion and exactly 0 at totality.
    // Totality collapses the quad (off-screen-sentinel pattern above):
    // a floored +7.5 mag residual is still visible on a bright
    // close-range back body, and the depth buffer can't hide it (the
    // pair's separation sits inside one log-depth bucket).
    if (uRenderMode == 0 && iEclipseDim < 1.0) {
        if (iEclipseDim <= 0.0) {
            emitOffscreenSentinel(0.0, 0.0);
            return;
        }
        appMag += -2.5 * log(iEclipseDim) / LOG10;
    }

    // Visibility prefilter — dust-independent. Spectral mask and distance
    // band are absolute filters (not affected by extinction). The magnitude
    // band is monotonic in dust: A_V ≥ 0, so a star whose unextincted
    // appMag already sits above (uMaxAppMag + 0.5) cannot become visible
    // after extinction — the prefilter is exact, no dust headroom needed.
    // Skip the extinction read for those stars — a texelFetch on the
    // prepass path, the full 48-tap raymarch on the fallback path (where
    // this is the dominant vertex-shader saving).
    bool spectOk = (uSpectMask & (1u << uint(iSpectClass))) != 0u;
    bool distOk = iDistSol >= uMinDistSol && iDistSol <= uMaxDistSol;
    bool magOkPrelim = appMag <= uMaxAppMag + 0.5;

    // Luminosity-class softness: linear from white dwarf (0) → hypergiant
    // (9). Unknown (iLumClass = 255) falls back to main-sequence-dwarf
    // softness. Feeds the fragment shader's glow falloff and disc-edge AA
    // width so supergiants look "fluffier" than dwarfs at the same radius.
    float lumClass = iLumClass < 100.0 ? iLumClass : 2.0;
    float softness = clamp(lumClass / 9.0, 0.0, 1.0);

    if (!(spectOk && distOk && magOkPrelim)) {
        emitOffscreenSentinel(appMag, softness);
        return;
    }

    // Survivors only: per-star dust extinction. Fast path reads the
    // prepass cache (one texelFetch); fallback marches camera→star in
    // absolute space (the dust grid is anchored to Sol, not the floating
    // local origin). A_V is added to appMag so the brightness filter sees
    // the dimmed value, and the colour is reddened by E(B-V) = A_V / R_V.
    float dustEffective = uDustEnabled * uExtinctionStrength;
    float absorbAV = 0.0;
    if (dustEffective > 0.0) {
        if (uAvPrepassEnabled > 0.5) {
            int w = textureSize(uAvPrepassTex, 0).x;
            ivec2 avTexel = ivec2(STAR_SELF_ID % w, STAR_SELF_ID / w);
            absorbAV = texelFetch(uAvPrepassTex, avTexel, 0).r * dustEffective;
        } else {
            absorbAV = dustRaymarchAV(uCameraPos + uWorldOffset, worldPos + uWorldOffset)
                * dustEffective;
        }
    }
    appMag += absorbAV;
    // Intrinsic B-V from the Apsis-first routing priority. Tier 1/2
    // (Apsis gspphot ∪ gspspec) walks back through Ballesteros⁻¹; tier 3
    // (Ballesteros via catalog ci, with stars-parse's 0.65 solar fallback
    // baked in) is the fall-through. Dust reddening then composes on top
    // for the observer-position-dependent chromaticity shift.
    float intrinsicBv = (iTeffApsis > 0.0)
        ? ballesterosBvFromTeff(iTeffApsis)
        : iCi;
    // Dust reddening + the per-frame variability colour swing (ciMod < 0
    // near maximum light = bluer/hotter) both shift the same LUT input.
    float effectiveCi = intrinsicBv + absorbAV / R_V + ciMod;

    // Final magnitude check with the extincted value. Soft taper: stars
    // within +0.5 mag of the limit still pass through and render in the
    // glow pass at fading intensity (frag shader handles the smoothstep),
    // so the limit doesn't pop in/out as the slider moves.
    if (appMag > uMaxAppMag + 0.5) {
        emitOffscreenSentinel(appMag, softness);
        return;
    }

    vAppMag = appMag;
    vColor = ciToColor(effectiveCi);
    vUv = aCorner;
    vSoftness = softness;

    float pxSize;
    if (uMonochrome > 0.5) {
        // Chart-mode flat-disc sizing. appMag is already the post-magMod
        // value, so variables breathe between (appMag - amp/2) and
        // (appMag + amp/2) in pixel space exactly the way Sky Atlas's
        // glyph implies. Stars brighter than the bright reference get
        // clamped to MAX; everything from there to the slider limit
        // spreads linearly into [MAX..MIN].
        float chartT = clamp(
            (appMag - uChartMagBright)
                / max(uMaxAppMag - uChartMagBright, 0.001),
            0.0, 1.0);
        pxSize = mix(uChartDiscMaxPx, uChartDiscMinPx, chartT);
        // Force the frag shader's chart-mode disc path. (Outside chart
        // mode this is computed below from physSize/appSize.)
        vPhysRatio = 1.0;
        // Chart is deliberately non-photometric and returns before the
        // frag shader touches luminance; the assignment only keeps the
        // varying defined.
        vPeakL = 0.0;
    } else {
        // Apparent-magnitude size term — the perceptual-disc abstraction.
        // Same √Δm + soft-knee mapping a planet would use (3re.16); the
        // chunk owns the math + rationale.
        float dMEff = perceptualDmEff(appMag, uMaxAppMag, uSizeSpan, uSizeKnee);
        float appSize = perceptualAppSizePx(dMEff, uSizeMin, uSizeMax, uSizeSpan);

        // Physical-size term. True angular diameter projected to pixels:
        // 2·atan(R/d) is the angle the disc subtends at the camera,
        // multiplied by viewport.y/fov_y to convert radians to pixels.
        // radiusFactor is the per-type variability modulation (ρ-bounded).
        float physSize = 2.0 * atan(R_pc * radiusFactor / dPc) * angularToPx;

        // Emitted luminance, in the scene-wide HDR unit. The footprint
        // above is now purely a display kernel — brightness rides on the
        // peak instead of the quad size. Two properties this line is
        // load-bearing for:
        //   · The divisor takes the star's TRUE angular radius, so it is
        //     the unclamped physSize and it applies whichever term wins
        //     max(appSize, physSize) below — no pop at the disc/glow
        //     split, and no artificial brightening at the zoom floor
        //     where the clamp bites.
        //   · CSS pixels, not device pixels, so a resolved disc's
        //     surface brightness doesn't change with devicePixelRatio.
        vPeakL = stellataPointSourcePeak(uExposure, appMag, 0.5 * physSize);

        // Up-clamp so a max-radius supergiant at the manual-zoom orbit
        // floor can't overflow the viewport (the ρ-bounded pulse no longer
        // needs the old per-frame amplitude compression). Mirrored in
        // renderedSizePx.
        physSize = min(physSize, uMaxPhysFrac * min(uViewport.x, uViewport.y));

        pxSize = max(appSize, physSize);
        vPhysRatio = clamp(physSize / max(pxSize, 0.001), 0.0, 1.0);
    }

    // Edge AA in vUv units. The quad spans pxSize CSS pixels; vUv ranges
    // [-0.5, +0.5] across that span, so 1 CSS pixel ≈ 1/pxSize in vUv
    // space. The chart-mode frag shader uses this directly to keep the
    // disc's antialiased edge at exactly one pixel wide regardless of
    // size. Outside chart mode the frag uses a different profile and
    // ignores this varying.
    vAaWidth = 1.0 / max(pxSize, 0.5);

    // Project the star centre to clip space, then offset each corner in
    // screen space by aCorner × pxSize. Multiplying the clip-space offset
    // by centreClip.w makes it perspective-correct (so the quad stays the
    // same pixel size regardless of depth).
    vec4 centreClip = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
    if (STAR_SELF_ID == uPinFocusToCenter) {
        // Bypass float32 cancellation in the matrix chain at extreme
        // close approach. The focused star is mathematically at view
        // (0, 0, -distCam) since controls.target = star and lookAt()
        // aligns -Z with target; substitute the canonical projection.
        centreClip = projectionMatrix * vec4(0.0, 0.0, -dPc, 1.0);
    }
    vec2 pixelOffset = aCorner * pxSize * uPixelRatio;
    vec2 ndcOffset = pixelOffset / (uViewport * uPixelRatio) * 2.0;
    gl_Position = centreClip + vec4(ndcOffset * centreClip.w, 0.0, 0.0);

    #include <logdepthbuf_vertex>
}
