precision highp float;

#include <common>
#include <stellata_atmosphere_uniforms>
#include <stellata_atmosphere_scatter>
// The scene-wide unit (STELLATA_LUMA_CEIL) and operator. The operator runs
// inline here whenever the frame is not rendering into the HDR target —
// see ../../hdr/README.md § Fallback.
#include <stellata_hdr_emission>
#include <stellata_tonemap>

// HDR seam, bound by reference from HdrPipeline.emitterUniforms.
uniform float uHdrTarget;      // 1 = target bound, emit linear L untouched
uniform float uWhitePoint;
uniform float uHighlightDesat;

// uMap is always bound (1×1 white placeholder when the body has no texture)
// — sampling an unbound texture is undefined in WebGL.
uniform sampler2D uMap;
uniform float uHasMap;
// DEM-derived tangent-space relief, RG only (data/textures/README.md
// § Surface relief). Shipped for three bodies; absent everywhere else, so
// the geometric normal is the base case, not a fallback.
uniform sampler2D uNormalMap;
uniform float uHasNormalMap;
uniform vec3 uColour;
// Planet → host-star direction in VIEW space; per-fragment Lambert
// against it is what produces the day/night terminator.
uniform vec3 uSunDirView;
uniform float uFade;
// φ_body(α)/φ_Lambert(α), CPU-computed via phase-function.ts
// (phaseRatioToLambert) and clamped there — corrects the Lambert
// disc-integrated output to the body's measured phase curve.
uniform float uPhaseScale;
// Surface luminance in the scene-wide HDR unit, CPU-computed via
// mesh-surface-pure.ts (meshSurfaceLuminance): the disc's mean surface
// brightness divided by the disc means of everything multiplied on top, so
// the shaded, textured disc integrates to the body's true flux.
uniform float uSurfaceLuminance;
// Host irradiance on the same scale (hostIrradianceLuminance) — what
// scattered sunlight rides, carrying no surface albedo. Separate from
// uSurfaceLuminance so the airlight-to-surface ratio is fixed by physics.
uniform float uAirlightLuminance;
// Terminator softness half-width on dot(n, sunDir); 0 = airless hard
// cut (Planet.terminatorSoftness).
uniform float uTermSoftness;
// View-space shadow casters (xyz centre, w radius) — a moon's parent,
// or a planet's moons. Count mirrors MAX_SHADOW_CASTERS in
// body-shadow-pure.ts, the vitest-pinned CPU mirror of the loop below.
const int MAX_CASTERS = 8;
uniform vec4 uCasters[MAX_CASTERS];
uniform int uCasterCount;
// Host angular radius from the body — penumbra half-width per unit
// distance along the sun ray.
uniform float uSunAngRad;
// Atmosphere airlight over the lit disc (final = surface·T_view + L_air).
// uHasAtmosphere gates the whole block; the scatter uniforms it reads are the
// shared contract (planet-atmosphere.frag.glsl reads the same set).
uniform float uHasAtmosphere;

in vec3 vNormalV;
in vec3 vPosV;
in vec2 vUvM;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outStatistic;
// Attachment 2 holds the diffuse emitters until the resolve convolves them,
// and this surface is drawn in front of them
// (../../hdr/attachments/README.md § The gate).
layout(location = 2) out vec4 outDiffuse;

// Limb darkening: full brightness face-on, dimming toward the
// silhouette. Carries the whole visual character of texture-less
// bodies (Uranus) and reads subtly on textured ones.
//
// Changing either value here without mesh-surface-pure.ts changes the
// disc mean uSurfaceLuminance divides out, which silently shifts every
// body off its true flux. lambertLimbDiscMean is the closed form.
const float LIMB_FLOOR = 0.45;
const float LIMB_EXP = 0.5;

// Geometric normal perturbed by one relief texel, in the equirect tangent
// frame: east = cross(pole, n) is the direction of increasing longitude,
// north the meridian tangent completing it. Blue carries no signal — z is
// positive by construction on a heightfield, so it reconstructs — and both
// tangents degenerate at the poles, where the map's own longitude
// derivative is already zeroed. CPU mirror: surface-relief-pure.ts.
vec3 stellataReliefNormal(vec3 n, vec3 pole, vec2 enc) {
  vec3 e = cross(pole, n);
  float eLen = length(e);
  if (eLen < 1e-6) return n;
  vec3 east = e / eLen;
  vec3 north = cross(n, east);
  vec2 t = enc * 2.0 - 1.0;
  return normalize(east * t.x + north * t.y + n * sqrt(max(1.0 - dot(t, t), 0.0)));
}

void main() {
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(-vPosV);
  float sunCos = dot(n, uSunDirView);
  // Relief modulates the DIRECT term and nothing else: every other consumer
  // of sunCos below keeps the geometric normal, each for its own reason
  // (README.md § Surface relief). A crater rim catching the light is this
  // one cosine.
  vec3 nRelief = uHasNormalMap > 0.5
    ? stellataReliefNormal(n, uPoleView, texture(uNormalMap, vUvM).rg)
    : n;
  float sunCosRelief = dot(nRelief, uSunDirView);
  // Lambert cosine away from the terminator; a smoothstep band of
  // half-width uTermSoftness carries twilight past it on atmospheric
  // bodies. The 1e-4 floor keeps the airless w=0 case a hard cut
  // without a divide-by-zero smoothstep. Both ride the LOCAL horizon: a
  // sunward slope stays lit past the GEOMETRIC terminator, which is the
  // Moon's field of lit peaks. Physical twilight is a separate term and
  // stays geometric (../atmosphere/README.md § Skylight).
  float w = max(uTermSoftness, 1e-4);
  float dayside = smoothstep(-w, w, sunCosRelief) * max(sunCosRelief, w);
  // Inter-body shadows: attenuate per caster on the ray toward the sun.
  // Penumbra half-width grows as tAlong·uSunAngRad, so shadows are
  // soft-edged and the antumbral (annular) case falls out naturally.
  // Mirrors casterShadowFactor in body-shadow-pure.ts.
  float shadow = 1.0;
  for (int i = 0; i < MAX_CASTERS; i++) {
    if (i >= uCasterCount) break;
    vec3 d = uCasters[i].xyz - vPosV;
    float tAlong = dot(d, uSunDirView);
    if (tAlong <= 0.0) continue;
    float missPc = length(d - tAlong * uSunDirView);
    float pen = max(tAlong * uSunAngRad, 1e-30);
    shadow *= smoothstep(uCasters[i].w - pen, uCasters[i].w + pen, missPc);
  }
  float ndotv = clamp(dot(n, v), 0.0, 1.0);
  // Atmospheric bodies: the scattering governs the limb, so the ad-hoc
  // surface limb-darkening is dropped (it double-darkened the disc edge into
  // a black rim). Airless bodies keep it as their whole limb character.
  float limb = uHasAtmosphere > 0.5 ? 1.0 : mix(LIMB_FLOOR, 1.0, pow(ndotv, LIMB_EXP));
  // The day map is sRGB-authored imagery loaded raw, so it decodes to
  // linear before it multiplies a physical luminance. uColour is already
  // linear (Planet.colour), so only the sampled branch decodes.
  vec3 base = mix(uColour, stellataSrgbDecode(texture(uMap, vUvM).rgb), uHasMap);
  // Everything reflected off the ground shares this scale, so a term added to
  // it needs no albedo factor of its own.
  vec3 surfaceScale = base * uSurfaceLuminance * shadow;
  vec3 col = surfaceScale * (dayside * limb * uPhaseScale);

  if (uHasAtmosphere > 0.5) {
    // Skylight: the air overhead scattering host light down — noon skylight on
    // the lit side, the twilight band past the terminator. sunCos is the
    // REAL-space cosine, unlike the march below — solar depression is measured
    // against the ground observer's true local horizontal, the ellipsoid normal.
    col += surfaceScale * stellata_skyIrradiance(sunCos, uScaleHeightR,
      stellata_verticalScatterTau(uBetaRayleigh, uBetaMie, uScaleHeightR, uScaleHeightM),
      uBetaAbsorb * uScaleHeightM);

    // Airlight in front of this fragment + the transmittance the surface
    // radiance loses on its way out, marched in the unit-sphere frame. The
    // fragment's smooth surface point IS its direction there: normals scale by
    // the inverse transpose, which for this diagonal map is the inverse, so
    // squashing the normal's polar component and renormalising lands on it.
    vec3 surf = normalize(stellata_scalePolar(normalize(vNormalV), uPoleView, uPolarRadiusR));
    vec3 o = stellata_deflattenedCamera(uCenterView, uRadiusPc, uPoleView, uPolarRadiusR);
    vec3 toSurf = surf - o;
    float tStop = length(toSurf);
    vec3 dir = toSurf / tStop;
    vec3 sunDirR = stellata_deflattenedDir(uSunDirView, uPoleView, uPolarRadiusR);
    float t0, t1;
    float discA = stellata_shellEntry(o, dir, uAtmoRadius, t0, t1);
    float tStart = discA > 0.0 ? max(t0, 0.0) : 0.0;
    vec3 inscatter;
    vec3 transmittance;
    stellata_atmosphereRadiance(
      o, dir, tStart, tStop, uAtmoRadius, sunDirR,
      uScaleHeightR, uScaleHeightM, uBetaRayleigh, uBetaMie, uBetaAbsorb, uMieG,
      stellata_atmoJitter(gl_FragCoord.xy),
      inscatter, transmittance);
    col = col * transmittance + inscatter * uSunColour * uAirlightLuminance;
  }

  col = min(col, vec3(STELLATA_LUMA_CEIL));
  // True surface brightness, and the alpha mirrors attachment 0's so the
  // LOD crossfade composites both attachments alike. The mask cuts at the
  // geometric terminator because that is where the disc mean the exposure
  // pin holds at L_TARGET is defined (../../hdr/exposure/README.md).
  float surfaceL = dot(col, STELLATA_LUMA_WEIGHTS);
  float lit = step(0.0, sunCos) * step(0.5, shadow);
  outStatistic = stellataStatisticTexel(surfaceL, lit, uFade);
  // Undithered: the ring annulus and the atmosphere shell alpha-blend over
  // this surface, so a pixel can take more than one planet fragment and the
  // fragCoord-keyed dither would bias it once per layer.
  if (uHdrTarget < 0.5) {
    col = stellataTonemapUndithered(col, uWhitePoint, uHighlightDesat);
  }
  outColor = vec4(col, uFade);
  outDiffuse = stellataOccluderTexel(uFade);
}
