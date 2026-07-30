// Single-scattering atmosphere integrator shared by the planet mesh (disc
// airlight) and atmosphere shell (limb halo). CPU mirror + calibration in
// atmosphere-scattering-pure.ts; model rationale in README.md § Atmospheres.
// Requires ATMO_N_VIEW / ATMO_N_LIGHT as #defines (material `defines`).
// Geometry is planet-radius units, planet centred at origin (rPlanet = 1).

const float STELLATA_RAYLEIGH_PHASE_K = 3.0 / (16.0 * PI);
const float STELLATA_INV_4PI = 1.0 / (4.0 * PI);
// Mirror of MS_STRENGTH / LIGHT_JITTER_STRIDE / TWILIGHT_SCATTER_FRAC in
// atmosphere-scattering-pure.ts; atmosphere-glsl-drift.test.ts pins them.
const float STELLATA_MS_STRENGTH = 0.2;
const float STELLATA_LIGHT_JITTER_STRIDE = 0.6180339887;
const float STELLATA_TWILIGHT_SCATTER_FRAC = 0.055;
// Stands in for an unbounded shadow span; only ever min/maxed against a ray
// parameter, never multiplied, so it just has to dwarf one.
const float STELLATA_SHADOW_FAR = 1e20;

float stellata_rayleighPhase(float mu) {
  return STELLATA_RAYLEIGH_PHASE_K * (1.0 + mu * mu);
}

float stellata_miePhase(float mu, float g) {
  float g2 = g * g;
  float denom = max(1.0 + g2 - 2.0 * g * mu, 1e-6);
  return STELLATA_INV_4PI * (1.0 - g2) / (denom * sqrt(denom));
}

// Interleaved gradient noise — a cheap per-fragment [0,1) hash used to jitter
// the ray-march sample lattice so the low sample count reads as fine noise
// rather than a fixed moiré grid.
float stellata_atmoJitter(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

const vec3 STELLATA_LUMA = vec3(0.2126, 0.7152, 0.0722); // Rec.709

float stellata_luma(vec3 c) {
  return dot(c, STELLATA_LUMA);
}

// Second (far) positive root of |o + t·d| = radius, or -1 on a miss.
float stellata_farRoot(vec3 o, vec3 d, float radius) {
  float b = dot(o, d);
  float c = dot(o, o) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}

// Camera-ray entry against the atmosphere shell (radius rAtmo, origin-centred,
// planet-radius units). Returns the discriminant; near/far roots land in
// t0/t1 (meaningful only when the discriminant is > 0). Shared by both frags.
float stellata_shellEntry(vec3 o, vec3 dir, float rAtmo, out float t0, out float t1) {
  float b = dot(o, dir);
  float disc = b * b - (dot(o, o) - rAtmo * rAtmo);
  float root = disc > 0.0 ? sqrt(disc) : 0.0;
  t0 = -b - root;
  t1 = -b + root;
  return disc;
}

// True when o + t·dir (t > 0) enters the unit body sphere ahead of the camera
// — the shell shader discards these so the disc path owns them.
bool stellata_hitsBodyAhead(vec3 o, vec3 dir) {
  float b = dot(o, dir);
  float disc = b * b - (dot(o, o) - 1.0);
  return disc > 0.0 && -b - sqrt(disc) > 0.0;
}

// Scale a vector's component along `pole` by s, leaving the equatorial part
// alone — the seam between an oblate body and a march that assumes a unit
// sphere. s = 1/polarR maps a spheroid of polar radius polarR (equatorial
// radii) onto the unit sphere, s = polarR inverts it. Linear about the body
// centre, so a ray maps to a ray with its parameter unchanged; callers
// renormalise directions. Normals scale by the inverse transpose, which for
// this diagonal map is the inverse.
vec3 stellata_scalePolar(vec3 v, vec3 pole, float s) {
  return v + pole * (dot(v, pole) * (s - 1.0));
}

// The planetary shadow along o + t·d as the single t-interval it always is:
// inside the infinite shadow cylinder (a quadratic in t) and anti-sunward of
// the terminator plane (a half-space). s0 > s1 means the ray never enters it.
// Solving the shadow beats sampling it — a point-per-segment lit/unlit test
// quantises the lit sample count into ATMO_N_VIEW contours across the
// terminator, and the fixed 0.15-radius smoothing that used to hide them was
// 956 km on Earth: sunlight in the densest layers 32° past the terminator.
void stellata_shadowSpan(vec3 o, vec3 d, vec3 sunDir, out float s0, out float s1) {
  // Inverted and unbounded, so it reads as empty against any ray parameter.
  s0 = STELLATA_SHADOW_FAR;
  s1 = -STELLATA_SHADOW_FAR;
  float oS = dot(o, sunDir);
  float dS = dot(d, sunDir);
  vec3 oP = o - oS * sunDir;
  vec3 dP = d - dS * sunDir;
  float a = dot(dP, dP);
  float b = dot(oP, dP);
  float c = dot(oP, oP) - 1.0;

  float lo, hi;
  if (a > 1e-12) {
    float disc = b * b - a * c;
    if (disc <= 0.0) return;
    float r = sqrt(disc);
    lo = (-b - r) / a;
    hi = (-b + r) / a;
  } else {
    // Ray parallel to the shadow axis: its impact parameter never changes.
    if (c >= 0.0) return;
    lo = -STELLATA_SHADOW_FAR;
    hi = STELLATA_SHADOW_FAR;
  }

  if (abs(dS) > 1e-12) {
    float th = -oS / dS;
    if (dS > 0.0) hi = min(hi, th); else lo = max(lo, th);
  } else if (oS >= 0.0) {
    return;
  }
  s0 = lo;
  s1 = hi;
}

// Fraction of the march segment centred on t with half-width h that falls
// outside the shadow span — the exact quadrature weight for a hard shadow,
// and continuous in the ray's geometry, so the lit sample count cannot step.
//
// Both bounds are offsets FROM t, which is load-bearing: t is the ray
// parameter from the camera, so t ± h are large and nearly equal, and 1/(2h)
// amplifies whatever their float32 difference loses — full-strength sunlight
// speckling the anti-solar face, patterned by the march jitter. Clamped
// first, a segment wholly inside or outside the shadow returns exactly 0 or 1.
float stellata_litFraction(float t, float h, float s0, float s1) {
  float lo = max(s0 - t, -h);
  float hi = min(s1 - t, h);
  return 1.0 - max(hi - lo, 0.0) / (2.0 * h);
}

// Altitude of the planetary shadow's upper edge directly above a surface
// point with sun-cosine sunCos — 0 on the lit side, 1/cos(delta) − 1 delta
// past the geometric terminator. Only the column above it still sees the host.
float stellata_shadowEdgeAltitude(float sunCos) {
  if (sunCos >= 0.0) return 0.0;
  return 1.0 / sqrt(max(1.0 - sunCos * sunCos, 1e-12)) - 1.0;
}

// Vertical scattering optical depth per channel (absorption excluded).
vec3 stellata_verticalScatterTau(vec3 betaRs, float betaMs, float hR, float hM) {
  return betaRs * hR + vec3(betaMs * hM);
}

// Twilight: the fraction of host irradiance the lit atmosphere scatters down
// onto the surface below it. The shadow edge climbing out of the scattering
// column is what extinguishes it, so its angular reach is the body's own
// scale height.
vec3 stellata_twilightIrradiance(float sunCos, float hR, vec3 tauScatter) {
  return tauScatter * (STELLATA_TWILIGHT_SCATTER_FRAC
    * exp(-stellata_shadowEdgeAltitude(sunCos) / hR));
}

// Airlight radiance (before sun colour) + view-path transmittance along
// o + t·d for t ∈ [tStart, tStop]. `jitter` ∈ [0,1) offsets the sample
// lattice per fragment (anti-banding).
void stellata_atmosphereRadiance(
  vec3 o, vec3 d, float tStart, float tStop, float rAtmo,
  vec3 sunDir, float hR, float hM,
  vec3 betaRs, float betaMs, vec3 betaA, float g, float jitter,
  out vec3 inscatter, out vec3 transmittance
) {
  float span = tStop - tStart;
  inscatter = vec3(0.0);
  transmittance = vec3(1.0);
  if (span <= 0.0) return;

  float segLen = span / float(ATMO_N_VIEW);
  float shadow0, shadow1;
  stellata_shadowSpan(o, d, sunDir, shadow0, shadow1);
  float mu = dot(d, sunDir);
  float pR = stellata_rayleighPhase(mu);
  float pM = stellata_miePhase(mu, g);

  float viewOdR = 0.0;
  float viewOdM = 0.0;
  float litSum = 0.0;

  for (int i = 0; i < ATMO_N_VIEW; i++) {
    float t = tStart + (float(i) + jitter) * segLen;
    vec3 p = o + t * d;
    float h = max(length(p) - 1.0, 0.0);
    float dR = exp(-h / hR);
    float dM = exp(-h / hM);
    viewOdR += dR * segLen;
    viewOdM += dM * segLen;

    float lit = stellata_litFraction(t, 0.5 * segLen, shadow0, shadow1);
    litSum += lit;
    if (lit <= 0.0) continue;
    float sExit = stellata_farRoot(p, sunDir, rAtmo);
    if (sExit <= 0.0) continue;

    // Decorrelate the light-march offset from the view-march (and per view
    // sample) so the two lattices don't beat into a moiré.
    float lightJit = fract(jitter + float(i) * STELLATA_LIGHT_JITTER_STRIDE);
    float lStep = sExit / float(ATMO_N_LIGHT);
    float lightOdR = 0.0;
    float lightOdM = 0.0;
    for (int j = 0; j < ATMO_N_LIGHT; j++) {
      float s = (float(j) + lightJit) * lStep;
      vec3 q = p + s * sunDir;
      float hq = max(length(q) - 1.0, 0.0);
      lightOdR += exp(-hq / hR) * lStep;
      lightOdM += exp(-hq / hM) * lStep;
    }

    vec3 tau = betaRs * (viewOdR + lightOdR) + (betaMs + betaA) * (viewOdM + lightOdM);
    vec3 attn = exp(-tau);
    vec3 scatter = betaRs * (dR * pR) + betaMs * (dM * pM);
    inscatter += scatter * attn * segLen * lit;
  }

  transmittance = exp(-(betaRs * viewOdR + (betaMs + betaA) * viewOdM));
  // Isotropic multiple-scattering fill: fraction-scattered × opacity × sunlit.
  float litFrac = litSum / float(ATMO_N_VIEW);
  vec3 scatterC = betaRs + betaMs;
  vec3 ssAlbedo = scatterC / max(scatterC + betaA, vec3(1e-6));
  vec3 ms = ssAlbedo * (1.0 - transmittance) * (litFrac * STELLATA_MS_STRENGTH);
  inscatter += ms;
}
