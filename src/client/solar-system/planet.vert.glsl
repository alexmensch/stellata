precision highp float;

#include <common>
#include <logdepthbuf_pars_vertex>
// Shared apparent-magnitude → disc-pixel-size mapping. Stars and
// planets use the same chunk; see its header for the rationale.
#include <stellata_perceptual_disc>

// Per-vertex (quad corner): xy in [-0.5, 0.5].
in vec2 aCorner;

// Per-instance:
//   iHostLocalPos — host position in the renderer's local frame.
//     Refreshed on every floating-origin recenter; static otherwise.
//   iLocalRel     — planet position relative to host, in the host's
//     local plane frame, post-orientation. Sum (iHostLocalPos +
//     iLocalRel) gives the planet's renderer-local position.
//   iRadiusPc     — planet equatorial radius in pc (for true angular
//     diameter and the reflected-light apparent-mag formula).
//   iColour       — representative single-colour RGB.
//   iSolidity     — 1 = rocky (crisp edge), 0 = gas-giant (fuzzy).
//   iAlbedoP      — geometric albedo p, V-band.
//   iHostAbsmag   — host star's absolute magnitude.
//   iPhaseCoefsA  — Mallama 2018 phase polynomial (c0,c1,c2,c3) in
//                   α-degrees, ΔV in mag. See phase-function.ts.
//   iPhaseCoefsB  — (c4,c5,c6,alphaMaxDeg). The .w slot doubles as
//                   a sentinel: alphaMaxDeg = 0 disables Mallama and
//                   the renderer uses Lambertian for every α — the
//                   default Pluto and every exoplanet hit.
//   iPhaseCoefsC  — (c7,_,_,_). Only Mercury carries a degree-7 term;
//                   the other three slots are reserved.
//   iEclipseDim   — true-eclipse flux dim on a planet behind the
//                   host's physical disc (1 = no dim).
in vec3 iHostLocalPos;
in vec3 iLocalRel;
in float iRadiusPc;
in vec3 iColour;
in float iSolidity;
in float iAlbedoP;
in float iHostAbsmag;
in vec4 iPhaseCoefsA;
in vec4 iPhaseCoefsB;
in vec4 iPhaseCoefsC;
in float iEclipseDim;

uniform vec2 uViewport;       // CSS pixels
uniform float uPixelRatio;
uniform float uFovYRad;

// Render mode — same convention as the star pipeline:
//   0 = glow (additive halo for distant point-glow planets)
//   1 = disc (per-channel-max, close-range resolved planets)
//   2 = core mask (depth-only for disc cores, occludes background)
uniform int uRenderMode;

// Visibility cutoff (mag slider); shared with stars.
uniform float uMaxAppMag;

// Flat instance index to hide (-1 = none). The planet sibling of the
// star pipeline's uHideFocusIdx: observe mode parks the camera AT the
// focal body, whose disc would otherwise render from the interior.
uniform int uHideIdx;

// Perceptual-disc shaping. All shared with the star pipeline.
uniform float uSizeMin;
uniform float uSizeMax;
uniform float uSizeSpan;
uniform float uSizeKnee;

// Disc ↔ spheroid-mesh crossfade band in physSize/appSize ratio
// (MESH_FADE_START/END_RATIO from mesh-crossfade.ts — the mesh layer
// evaluates the same smoothstep from the other end).
uniform vec2 uMeshFadeRatio;

// Chart-mode flat-disc sizing — same uniforms (same { value } slots)
// as the star pipeline's chart branch; see chart-mode/README.md.
uniform float uChartDiscMaxPx;
uniform float uChartDiscMinPx;
uniform float uChartMagBright;
uniform float uMonochrome;

out vec3 vColor;
out vec2 vUv;
out float vAppMag;
out float vPhysRatio;
out float vSoftness;
out float vMeshFade;
out float vAaWidth;

const float LOG10 = 2.302585093;
const float PI_CONST = 3.14159265358979323846;

// Phase-curve polynomial in α-degrees; this helper just evaluates
// whatever the buffer carries (degree 7 — c7 rides coefsC.x, zero for
// every planet but Mercury).
float mallamaDV(vec4 coefsA, vec4 coefsB, vec4 coefsC, float aDeg) {
  return coefsA.x
       + aDeg * (coefsA.y
       + aDeg * (coefsA.z
       + aDeg * (coefsA.w
       + aDeg * (coefsB.x
       + aDeg * (coefsB.y
       + aDeg * (coefsB.z
       + aDeg * coefsC.x))))));
}

float lambertPhi(float alpha) {
  return (sin(alpha) + (PI_CONST - alpha) * cos(alpha)) / PI_CONST;
}

void main() {
  // View-space positions (frame-independent — host and planet both
  // move through the same modelViewMatrix). Distances are in pc
  // because there is no scale baked into modelMatrix.
  vec3 planetLocal = iHostLocalPos + iLocalRel;
  vec4 planetView = modelViewMatrix * vec4(planetLocal, 1.0);
  vec4 hostView   = modelViewMatrix * vec4(iHostLocalPos, 1.0);

  // Defensive against degenerate geometry (viewer exactly at the
  // planet, or planet exactly at the host) → kill the quad. The
  // viewer→host distance is deliberately NOT tested — observe mode
  // parks the camera exactly at the host, and its planets must render.
  // The hidden instance (observe anchor body) kills through the same
  // path, in every pass — a hidden body must not write depth either.
  float d_vp = length(planetView.xyz);
  float d_hp = length(planetView.xyz - hostView.xyz);
  if (gl_InstanceID == uHideIdx || d_vp <= 0.0 || d_hp <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAppMag = 0.0;
    vColor = vec3(0.0);
    vUv = aCorner;
    vPhysRatio = 0.0;
    vSoftness = 0.0;
    vMeshFade = 0.0;
    vAaWidth = 0.0;
    return;
  }

  // Phase angle α = ∠(viewer → planet → host). vph = planet → viewer,
  // hph = planet → host. The phase factor φ(α) prefers the Mallama
  // 2018 empirical polynomial when one is supplied for the body and α
  // sits inside its validity range; otherwise Lambert is the
  // fallback. CPU mirror in `phase-function.ts` is vitest-pinned.
  vec3 vphHat = normalize(-planetView.xyz);
  vec3 hphHat = normalize(hostView.xyz - planetView.xyz);
  float cosA = clamp(dot(vphHat, hphHat), -1.0, 1.0);
  float alpha = acos(cosA);
  float phi;
  float alphaMaxDeg = iPhaseCoefsB.w;
  float alphaDeg = alpha * (180.0 / PI_CONST);
  if (alphaMaxDeg > 0.0 && alphaDeg <= alphaMaxDeg) {
    // Polynomial path. Saturn's ring contribution rides on c0 < 0,
    // which makes φ(0) > 1 (intentional — `albedo` represents the
    // globe's α=0 reflectance, the c0 boost stacks the ring system
    // on top).
    float dV = mallamaDV(iPhaseCoefsA, iPhaseCoefsB, iPhaseCoefsC, alphaDeg);
    phi = exp(-dV * 0.4 * LOG10);
  } else if (alphaMaxDeg > 0.0) {
    // Anchor-scaled Lambert past the published validity bound:
    // Lambert(α) × (poly(αmax) / Lambert(αmax)). Preserves brightness
    // continuity at αmax and keeps each planet's empirical character
    // (Saturn's c0 boost; Mars's faster-than-Lambert darkening)
    // extending out instead of snapping to a uniform Lambertian
    // sphere. CPU mirror in phase-function.ts.
    float dVb = mallamaDV(iPhaseCoefsA, iPhaseCoefsB, iPhaseCoefsC, alphaMaxDeg);
    float boundaryFlux = exp(-dVb * 0.4 * LOG10);
    float alphaMaxRad = alphaMaxDeg * (PI_CONST / 180.0);
    phi = lambertPhi(alpha) * (boundaryFlux / lambertPhi(alphaMaxRad));
  } else {
    // No published curve — pure Lambertian (Pluto, Uranus, Neptune,
    // every exoplanet via stellata-bk5).
    phi = lambertPhi(alpha);
  }

  // Reflected-light apparent magnitude:
  //
  //   m_host_at_planet = M_host + 5·log10(d_hp / 10pc)
  //   m_planet         = m_host_at_planet
  //                    − 2.5·log10( p · (R/d_vp)² · φ(α) )
  //
  // The viewer→host distance d_vh cancels out of the physical formula
  // and MUST NOT appear: observe mode parks the camera exactly at the
  // host, so any d_vh term evaluates log(0) there and kills every
  // planet of the focused host. CPU mirror (vitest-pinned):
  // perceptual-magnitude.ts planetApparentMagnitude.
  //
  // Verified against Jupiter (R=69,911 km, p=0.538) under Lambert:
  //   • Earth at opposition (d_hp=5.2 AU, d_vp=4.2 AU): −2.7 ✓
  //   • Outside heliopause (d_vp=144.8 AU): +5.2 ✓
  //   • α Cen (1.34 pc): +21 ✓
  float m_host_at_planet = iHostAbsmag + 5.0 * (log(d_hp) / LOG10 - 1.0);
  float radRatio = iRadiusPc / d_vp;
  float reflFactor = iAlbedoP * radRatio * radRatio * max(phi, 0.0);
  float appMag = m_host_at_planet - 2.5 * log(max(reflFactor, 1e-30)) / LOG10;

  // True-eclipse dim, glow pass only — the star pipeline's iEclipseDim
  // fold verbatim. The disc pass needs no dim: its per-channel-max
  // blend already keeps the darker back disc from painting over the
  // host's saturated disc.
  if (uRenderMode == 0 && iEclipseDim < 1.0) {
    appMag += -2.5 * log(iEclipseDim) / LOG10;
  }

  // Soft taper: pass a 0.5-mag overshoot so the glow pass can fade
  // intensity to zero across the threshold band — same hysteresis
  // the star pipeline uses to avoid pop-in/out as the slider moves.
  if (appMag > uMaxAppMag + 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAppMag = appMag;
    vColor = vec3(0.0);
    vUv = aCorner;
    vPhysRatio = 0.0;
    vSoftness = 1.0 - iSolidity;
    vMeshFade = 0.0;
    vAaWidth = 0.0;
    return;
  }

  // Physical disc size in CSS pixels. θ = 2·atan(R/d_vp).
  float angularToPx = uViewport.y / max(uFovYRad, 1e-9);
  float physSize = 2.0 * atan(iRadiusPc / d_vp) * angularToPx;

  float pxSize;
  if (uMonochrome > 0.5) {
    // Chart-mode flat-disc sizing — the star vertex shader's chart
    // branch verbatim: magnitude-linear px, disc pass forced, no
    // mesh handoff (the mesh LOD hides in chart mode).
    float chartT = clamp(
        (appMag - uChartMagBright)
            / max(uMaxAppMag - uChartMagBright, 0.001),
        0.0, 1.0);
    pxSize = mix(uChartDiscMaxPx, uChartDiscMinPx, chartT);
    vPhysRatio = 1.0;
    vMeshFade = 0.0;
  } else {
    // Apparent-magnitude size via the perceptual-disc chunk. No
    // unconditional pixel floor — sub-pixel planets fade naturally
    // when their reflected-light flux drops below the slider cutoff.
    float dMEff = perceptualDmEff(appMag, uMaxAppMag, uSizeSpan, uSizeKnee);
    float appSize = perceptualAppSizePx(dMEff, uSizeMin, uSizeMax, uSizeSpan);

    // Disc ramps out as the spheroid mesh ramps in, keyed on the
    // physSize/appSize ratio: the band starts at 1 — exactly where the
    // max() below switches to the physical term — so the disc and the
    // mesh (drawn at physSize) share the same footprint through the
    // whole fade and the handoff cannot pop in size.
    vMeshFade = smoothstep(
        uMeshFadeRatio.x, uMeshFadeRatio.y, physSize / max(appSize, 1e-6));

    pxSize = max(appSize, physSize);
    vPhysRatio = clamp(physSize / max(pxSize, 0.001), 0.0, 1.0);
  }
  // One CSS pixel in vUv units — the chart frag's edge-AA width.
  vAaWidth = 1.0 / max(pxSize, 0.5);
  vAppMag = appMag;
  vColor = iColour;
  vUv = aCorner;
  // Solidity → softness: rocky (1) reads crisp like a white dwarf
  // (softness 0); gas-giant (0) reads fuzzy like a hypergiant
  // (softness 1). Same shaping the star pipeline uses for lumClass.
  vSoftness = clamp(1.0 - iSolidity, 0.0, 1.0);

  // Project the planet centre, then offset each corner in screen
  // space by aCorner × pxSize. Mirrors the star vertex shader's
  // perspective-correct pixel-stable quad expansion.
  vec4 centreClip = projectionMatrix * vec4(planetView.xyz, 1.0);
  vec2 pixelOffset = aCorner * pxSize * uPixelRatio;
  vec2 ndcOffset = pixelOffset / (uViewport * uPixelRatio) * 2.0;
  gl_Position = centreClip + vec4(ndcOffset * centreClip.w, 0.0, 0.0);

  #include <logdepthbuf_vertex>
}
