// Single-scattering atmosphere integrator shared by the planet mesh (disc
// airlight) and atmosphere shell (limb halo). CPU mirror + calibration in
// atmosphere-scattering-pure.ts; model rationale in README.md § Atmospheres.
// Requires ATMO_N_VIEW / ATMO_N_LIGHT as #defines (material `defines`).
// Geometry is planet-radius units, planet centred at origin (rPlanet = 1).

const float STELLATA_RAYLEIGH_PHASE_K = 3.0 / (16.0 * PI);
const float STELLATA_INV_4PI = 1.0 / (4.0 * PI);
// Mirror of MS_STRENGTH / LIGHT_JITTER_STRIDE / SHADOW_SOFT in
// atmosphere-scattering-pure.ts.
const float STELLATA_MS_STRENGTH = 0.2;
const float STELLATA_LIGHT_JITTER_STRIDE = 0.6180339887;
const float STELLATA_SHADOW_SOFT = 0.15;

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

// Fraction of a point lit by the sun: 1 unless it is BOTH anti-sunward of the
// terminator plane AND inside the planet's shadow cylinder. Smoothed over
// STELLATA_SHADOW_SOFT (planet-radius units) so the atmosphere terminator is
// a continuous rolloff, not a hard 0/1 that quantises into moiré contours.
float stellata_sunLit(vec3 p, vec3 sunDir) {
  float sunT = dot(p, sunDir);
  float impact = sqrt(max(dot(p, p) - sunT * sunT, 0.0));
  return max(
    smoothstep(0.0, STELLATA_SHADOW_SOFT, sunT),
    smoothstep(1.0 - STELLATA_SHADOW_SOFT, 1.0 + STELLATA_SHADOW_SOFT, impact));
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

    float lit = stellata_sunLit(p, sunDir);
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
