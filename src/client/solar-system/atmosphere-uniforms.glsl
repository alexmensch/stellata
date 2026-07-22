// Atmosphere-scatter uniform contract shared by the mesh disc-airlight and the
// limb-halo shell frags. Filled per frame by applyAtmoUniforms in
// planet-mesh-layer.ts (values in planet-radius units). Keep in lockstep with
// sharedAtmoUniforms() there.
uniform vec3 uCenterView;
uniform float uRadiusPc;
uniform float uAtmoRadius;
uniform float uScaleHeightR;
uniform float uScaleHeightM;
uniform vec3 uBetaRayleigh;
uniform float uBetaMie;
uniform vec3 uBetaAbsorb;
uniform float uMieG;
uniform vec3 uSunColour;
