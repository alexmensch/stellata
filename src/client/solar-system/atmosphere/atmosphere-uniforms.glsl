// Atmosphere-scatter uniform contract shared by the mesh disc-airlight and the
// limb-halo shell frags. Filled per frame by applyAtmoUniforms in
// planet-mesh-layer.ts (values in planet-radius units). Keep in lockstep with
// sharedAtmoUniforms() there.
uniform vec3 uCenterView;
uniform float uRadiusPc;
uniform float uAtmoRadius;
// The body's north pole in VIEW space, and its polar radius in equatorial
// radii — ../planets/spheroid-pure.ts:polarRadiusRatio, which the mesh scale
// reads too and must agree with. Both frags map through
// stellata_deflattenedCamera / …Dir before marching; without that the
// unit-sphere geometry downstream describes a body that is not the one drawn.
uniform vec3 uPoleView;
uniform float uPolarRadiusR;
uniform float uScaleHeightR;
uniform float uScaleHeightM;
uniform vec3 uBetaRayleigh;
uniform float uBetaMie;
uniform vec3 uBetaAbsorb;
uniform float uMieG;
uniform vec3 uSunColour;
