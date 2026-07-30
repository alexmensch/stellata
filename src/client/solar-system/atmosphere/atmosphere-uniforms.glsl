// Atmosphere-scatter uniform contract shared by the mesh disc-airlight and the
// limb-halo shell frags. Filled per frame by applyAtmoUniforms in
// planet-mesh-layer.ts (values in planet-radius units). Keep in lockstep with
// sharedAtmoUniforms() there.
uniform vec3 uCenterView;
uniform float uRadiusPc;
uniform float uAtmoRadius;
// The body's north pole in VIEW space, and its polar radius in equatorial
// radii (1 − flattening). Both shaders scale the ray's polar component by
// 1/uPolarRadiusR before marching, which is the only thing that makes the
// unit-sphere geometry downstream describe the oblate body actually drawn.
uniform vec3 uPoleView;
uniform float uPolarRadiusR;
uniform float uScaleHeightR;
uniform float uScaleHeightM;
uniform vec3 uBetaRayleigh;
uniform float uBetaMie;
uniform vec3 uBetaAbsorb;
uniform float uMieG;
uniform vec3 uSunColour;
