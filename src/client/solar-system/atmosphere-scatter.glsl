// Single-scattering atmosphere integrator shared by the planet mesh (disc
// airlight) and atmosphere shell (limb halo). CPU mirror + calibration in
// atmosphere-scattering-pure.ts; model rationale in README.md § Atmospheres.
// Requires ATMO_N_VIEW / ATMO_N_LIGHT as #defines (material `defines`).
// Geometry is planet-radius units, planet centred at origin (rPlanet = 1).

const float STELLATA_RAYLEIGH_PHASE_K = 3.0 / (16.0 * PI);
const float STELLATA_INV_4PI = 1.0 / (4.0 * PI);

float stellata_rayleighPhase(float mu) {
  return STELLATA_RAYLEIGH_PHASE_K * (1.0 + mu * mu);
}

float stellata_miePhase(float mu, float g) {
  float g2 = g * g;
  float denom = max(1.0 + g2 - 2.0 * g * mu, 1e-6);
  return STELLATA_INV_4PI * (1.0 - g2) / (denom * sqrt(denom));
}

// Second (far) positive root of |o + t·d| = radius, or -1 on a miss.
float stellata_farRoot(vec3 o, vec3 d, float radius) {
  float b = dot(o, d);
  float c = dot(o, o) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}

bool stellata_inPlanetShadow(vec3 p, vec3 d) {
  float b = dot(p, d);
  float c = dot(p, p) - 1.0;
  float disc = b * b - c;
  if (disc < 0.0) return false;
  return -b - sqrt(disc) > 0.0;
}

// Airlight radiance (before sun colour) + view-path transmittance along
// o + t·d for t ∈ [tStart, tStop].
void stellata_atmosphereRadiance(
  vec3 o, vec3 d, float tStart, float tStop, float rAtmo,
  vec3 sunDir, float hR, float hM,
  vec3 betaRs, float betaMs, vec3 betaA, float g,
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

  for (int i = 0; i < ATMO_N_VIEW; i++) {
    float t = tStart + (float(i) + 0.5) * segLen;
    vec3 p = o + t * d;
    float h = max(length(p) - 1.0, 0.0);
    float dR = exp(-h / hR);
    float dM = exp(-h / hM);
    viewOdR += dR * segLen;
    viewOdM += dM * segLen;

    if (stellata_inPlanetShadow(p, sunDir)) continue;

    float sExit = stellata_farRoot(p, sunDir, rAtmo);
    if (sExit <= 0.0) continue;
    float lStep = sExit / float(ATMO_N_LIGHT);
    float lightOdR = 0.0;
    float lightOdM = 0.0;
    for (int j = 0; j < ATMO_N_LIGHT; j++) {
      float s = (float(j) + 0.5) * lStep;
      vec3 q = p + s * sunDir;
      float hq = max(length(q) - 1.0, 0.0);
      lightOdR += exp(-hq / hR) * lStep;
      lightOdM += exp(-hq / hM) * lStep;
    }

    vec3 tau = betaRs * (viewOdR + lightOdR) + (betaMs + betaA) * (viewOdM + lightOdM);
    vec3 attn = exp(-tau);
    vec3 scatter = betaRs * (dR * pR) + betaMs * (dM * pM);
    inscatter += scatter * attn * segLen;
  }

  transmittance = exp(-(betaRs * viewOdR + (betaMs + betaA) * viewOdM));
}
