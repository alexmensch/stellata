precision highp float;

#include <common>

// Camera position in shell-local units (shell radius = 1). The camera
// never enters the shell: the tightest orbit floor is ~2.4 body radii
// and the largest shell (Titan) is 1.12 R.
uniform vec3 uCamPosShell;
// Body → host direction, unit, same frame.
uniform vec3 uSunDirShell;
uniform vec3 uAtmoColour;
// Body radius as a fraction of the shell radius, R / (R + h).
uniform float uBodyRadiusFrac;
uniform float uLimbStrength;
uniform float uScatterStrength;
uniform float uFade;

in vec3 vPosL;

out vec4 outColor;

// Henyey-Greenstein asymmetry for the back-lit forward-scatter ring.
const float HG_G = 0.85;
// Day-side gate band on dot(limb normal, sun): a soft wrap past the
// geometric terminator stands in for twilight refraction.
const float DAY_WRAP_LO = -0.15;
const float DAY_WRAP_HI = 0.25;

void main() {
  vec3 dir = normalize(vPosL - uCamPosShell);

  // Closest approach of the view ray to the body centre gives the
  // impact parameter; the optical path through the shell is the chord
  // (both halves when the ray misses the body, entry-to-surface when
  // it hits), normalised by the body-grazing maximum. Squaring biases
  // the density toward the limb so the disc face stays untinted.
  float t0 = -dot(uCamPosShell, dir);
  vec3 p0 = uCamPosShell + t0 * dir;
  float b2 = dot(p0, p0);
  float rb = uBodyRadiusFrac;
  float outerHalf = sqrt(max(1.0 - b2, 0.0));
  float bodyHalf = sqrt(max(rb * rb - b2, 0.0));
  float path = b2 < rb * rb ? outerHalf - bodyHalf : 2.0 * outerHalf;
  float density = clamp(path / (2.0 * sqrt(1.0 - rb * rb)), 0.0, 1.0);
  density *= density;

  // Day-side limb glow: lit where the shell's closest-approach normal
  // faces the host.
  float day = smoothstep(DAY_WRAP_LO, DAY_WRAP_HI, dot(normalize(p0), uSunDirShell));

  // Back-lit refraction / forward-scatter ring: peak-normalised HG
  // against the light propagation direction, ramping in smoothly as
  // the phase angle approaches 180° (body between camera and host).
  float cosT = dot(dir, -uSunDirShell);
  float denom = 1.0 + HG_G * HG_G - 2.0 * HG_G * cosT;
  float hg = (1.0 - HG_G * HG_G) / (denom * sqrt(denom));
  float hgPeak = (1.0 - HG_G * HG_G) / pow(1.0 - HG_G, 3.0);
  float scatter = hg / hgPeak;

  float glow = (uLimbStrength * day + uScatterStrength * scatter) * density;
  // Additive blending — alpha is ignored by the (One, One) equation.
  outColor = vec4(uAtmoColour * glow * uFade, 1.0);
}
