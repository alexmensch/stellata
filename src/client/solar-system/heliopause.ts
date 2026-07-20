// Heliopause asymmetric-ellipsoid shell + apex SVG label. See
// src/client/solar-system/README.md § Heliopause boundary.

import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { AU_PC } from '../util/astronomy-constants';
import { ECLIPTIC_NORTH_POLE_ICRS } from './orbit-rings-layer';
import {
  FresnelShell,
  createFresnelShellMaterial,
  createShellSilhouetteLabel,
} from '../fresnel-shell/fresnel-shell';
import type { ShellCardInfo, ShellPickSurface } from '../fresnel-shell/shell-registry';

// Nose (upwind apex) direction: the interstellar He inflow measured by
// IBEX/Ulysses, J2000 ecliptic (λ, β) = (255.7°, 5.1°) — McComas et al.
// 2015 (ApJS 220, 22). NOT the solar apex of motion vs nearby stars
// (RA 17h53m, Dec +27.4°), which sits ~47° away and once shipped here —
// the heliosphere is shaped by motion relative to the Local Interstellar
// Cloud, not relative to the stellar neighbourhood.
const NOSE_ECL_LON_RAD = 255.7 * Math.PI / 180;
const NOSE_ECL_LAT_RAD = 5.1 * Math.PI / 180;

const ECL_TO_ICRS = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  ECLIPTIC_NORTH_POLE_ICRS.clone(),
);

// ICRS ≈ RA 17h00m (255.04°), Dec −17.60°. Pure unit vector.
const APEX_DIR_ICRS = new THREE.Vector3(
  Math.cos(NOSE_ECL_LAT_RAD) * Math.cos(NOSE_ECL_LON_RAD),
  Math.cos(NOSE_ECL_LAT_RAD) * Math.sin(NOSE_ECL_LON_RAD),
  Math.sin(NOSE_ECL_LAT_RAD),
).applyQuaternion(ECL_TO_ICRS).normalize();

// Ellipsoid geometry (AU). 115 / 115 / 161 with the centre offset
// 39 AU toward antiapex lands the upwind boundary at 122 AU and the
// downwind at 200 AU (115 + 39 + … wait, 161 + 39 = 200 ✓).
const SEMI_EQUATORIAL_AU = 115;
const SEMI_MAJOR_AU = 161;
const CENTRE_OFFSET_AU = 39;
const UPWIND_APEX_AU = SEMI_MAJOR_AU - CENTRE_OFFSET_AU; // 122
const DOWNWIND_APEX_AU = SEMI_MAJOR_AU + CENTRE_OFFSET_AU; // 200

// Sphere tessellation. 64 longitudes × 32 latitudes — silhouette reads
// smooth at any zoom we afford. Cost is negligible (one mesh, one
// draw call), so there's no reason to ride a tighter budget here.
const SPHERE_W_SEGMENTS = 64;
const SPHERE_H_SEGMENTS = 32;

// Same dim chrome family as the per-planet orbit rings so the
// solar-system layer reads as a single coherent visual layer. Limb
// (silhouette) alpha is the peak; face-on geometry receives only a
// small fraction of it so the upwind apex region doesn't paint the
// shell as a flat disc against the starfield.
const COLOUR = new THREE.Color(0xc8d6ff);
const ALPHA_LIMB = 0.45;

/** Upwind apex point relative to SOL (parsecs). Sol is the catalog
 *  origin, so the renderer-local position is this minus worldOffset —
 *  consumers (label overlay, hover picker) must apply that offset;
 *  under planet focus the origin sits on the focused planet, not Sol. */
export const HELIOPAUSE_APEX_SOL_PC: Readonly<THREE.Vector3> =
  APEX_DIR_ICRS.clone().multiplyScalar(UPWIND_APEX_AU * AU_PC);

/** DOM element id of the SVG `<text>` node that renders the apex label.
 *  Exported so the hover picker can hit-test the label's bounding rect
 *  via getElementById — single source so the id can't drift between
 *  the label engine and the hover picker. */
export const HELIOPAUSE_LABEL_ELEMENT_ID = 'heliopause-label';

/** Focus-target display name + card content (registered into the shell
 *  registry). Non-luminous, so no magnitude rows. */
export const HELIOPAUSE_LABEL = 'Heliopause';
export const HELIOPAUSE_CARD: ShellCardInfo = {
  typeLine: 'Solar-wind boundary',
  size: [
    { label: 'Upwind', value: `${UPWIND_APEX_AU} AU` },
    { label: 'Laterally', value: `${SEMI_EQUATORIAL_AU} AU` },
    { label: 'Downwind tail', value: `${DOWNWIND_APEX_AU} AU` },
  ],
  knownFrom: 'Voyager 1 & 2 crossings',
};

/** Max distance from Sol to the shell surface (the downwind apex), pc —
 *  the framing extent so focus pulls out to fit the whole teardrop. */
export const HELIOPAUSE_EXTENT_PC = DOWNWIND_APEX_AU * AU_PC;

/** Visibility predicate for the apex SVG label — declutter-governed, not
 *  focus-coupled, mirroring the Local Bubble label (`local-bubble.ts`):
 *  chart mode off and the `heliopauseLabel` detail floor permitted. The
 *  label engine layers a near-plane guard on top (a sample behind the
 *  camera near plane means the camera is inside the ellipsoid → hide), so
 *  the label appears exactly when the shell reads on screen. Shared with
 *  the hover picker so the eligibility rule can't drift between them. */
export function isHeliopauseApexVisible(stellata: Stellata): boolean {
  return !stellata.getMonochrome() && stellata.detailPermits('heliopauseLabel');
}

// Group quaternion that rotates +Z onto the antiapex direction in ICRS.
// Same value the Heliopause instance applies to its group; precomputed
// at module load so the label overlay can pre-rotate its sample points
// without depending on the live class instance.
const GROUP_QUATERNION = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  APEX_DIR_ICRS.clone().negate(),
);

export class Heliopause extends FresnelShell {
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.SphereGeometry;

  constructor() {
    // renderOrder = 1: shares the slot with star glow (both are dim
    // chrome). See src/client/star-pipeline/README.md §RenderOrder ladder
    // for the full cross-layer hierarchy.
    super(createFresnelShellMaterial({ colour: COLOUR, alphaLimb: ALPHA_LIMB }), 1);
    // Rotate the entire group so its local +Z aligns with the antiapex
    // direction in ICRS. The mesh inside scales + translates within
    // that rotated frame.
    this.group.quaternion.copy(GROUP_QUATERNION);

    this.geometry = new THREE.SphereGeometry(1, SPHERE_W_SEGMENTS, SPHERE_H_SEGMENTS);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    // Scale to ellipsoid semi-axes in parsecs. Local (x, y, z) →
    // (equatorial, equatorial, major) since z = antiapex axis.
    const eqPc = SEMI_EQUATORIAL_AU * AU_PC;
    const majorPc = SEMI_MAJOR_AU * AU_PC;
    this.mesh.scale.set(eqPc, eqPc, majorPc);
    // Translate centre 39 AU along the rotated +Z = antiapex.
    this.mesh.position.set(0, 0, CENTRE_OFFSET_AU * AU_PC);

    this.group.add(this.mesh);
  }

  // The mesh is built in the constructor and never detaches, so the shell
  // is always ready — visibility is governed purely by the declutter floor
  // (`heliopauseShell`) + chart mode in the base, plus the automatic
  // hide-when-inside back-face cull. No focus coupling: like the Local
  // Bubble, it's a free-standing structure the declutter cycle owns.
  protected shellReady(): boolean {
    return true;
  }

  /** The registry pick surface: the 62-point ellipsoid silhouette (in
   *  step with the apex label) + the label bbox, gated on the shell's
   *  live rendered visibility. */
  shellPickSurface(): ShellPickSurface {
    return {
      labelElementId: HELIOPAUSE_LABEL_ELEMENT_ID,
      visible: () => this.isVisible(),
      sampleCount: () => HELIOPAUSE_SAMPLE_POINTS_SOL.length,
      sampleLocalInto: (i, worldOffset, out) => {
        out.copy(HELIOPAUSE_SAMPLE_POINTS_SOL[i]).sub(worldOffset);
      },
    };
  }

  override dispose(): void {
    this.geometry.dispose();
    super.dispose();
  }
}

/** Sample points distributed on the heliopause's ellipsoid surface,
 *  pre-rotated through the group quaternion, expressed relative to SOL
 *  (renderer-local = point − worldOffset, exactly like
 *  `HELIOPAUSE_APEX_SOL_PC`). Projecting these to screen each frame
 *  gives a screen-space bounding box that hugs the egg's silhouette
 *  tightly — within the tessellation precision of the sample grid.
 *  Computed once at module load; geometry is static.
 *
 *  Surface points (not AABB corners) — points off the surface sit
 *  further from the centre than the silhouette and produce a loose
 *  bbox that reads as "label floating in space." For the (115, 115,
 *  161) AU ellipsoid the AABB corners sit at √(a² + a² + c²) ≈ 229 AU
 *  from centre, ~40% beyond the actual silhouette extent.
 *
 *  Exported so the hover picker can hit-test the projected silhouette
 *  bbox against the cursor — same 62 points, same near-plane guard,
 *  so the hover surface stays in lockstep with the label engine. */
export const HELIOPAUSE_SAMPLE_POINTS_SOL: readonly THREE.Vector3[] = (() => {
  const arr: THREE.Vector3[] = [];
  const cz = CENTRE_OFFSET_AU * AU_PC;
  const a = SEMI_EQUATORIAL_AU * AU_PC;
  const c = SEMI_MAJOR_AU * AU_PC;
  // 12 longitudes × 5 mid-latitudes + 2 poles = 62 points. Plenty
  // dense for a tight silhouette bbox; cost is 62 vec3 transforms
  // per frame.
  const N_LONGS = 12;
  const N_LATS = 5;
  for (let i = 0; i < N_LATS; i++) {
    const theta = (i + 0.5) / N_LATS * Math.PI; // avoid degenerate poles here
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j < N_LONGS; j++) {
      const phi = (j / N_LONGS) * 2 * Math.PI;
      const v = new THREE.Vector3(
        a * sinT * Math.cos(phi),
        a * sinT * Math.sin(phi),
        cz + c * cosT,
      );
      v.applyQuaternion(GROUP_QUATERNION);
      arr.push(v);
    }
  }
  // Antiapex/apex tips at the poles.
  arr.push(new THREE.Vector3(0, 0, cz + c).applyQuaternion(GROUP_QUATERNION));
  arr.push(new THREE.Vector3(0, 0, cz - c).applyQuaternion(GROUP_QUATERNION));
  return arr;
})();

/** Mount the SVG "Heliopause" label and bind per-frame projection.
 *  Thin wrapper around the shared distance-gated label engine that
 *  carries the heliopause-specific configuration: the 62-sample
 *  ellipsoid silhouette, the bottom-right anchor direction, and the
 *  visibility predicate gated on the same orbit-ring heuristic the
 *  planet labels use — so the heliopause label appears whenever any
 *  planet ring would draw and vanishes in lockstep with the last
 *  planet label. */
export function createHeliopauseLabel(stellata: Stellata): void {
  createShellSilhouetteLabel(stellata, {
    elementId: HELIOPAUSE_LABEL_ELEMENT_ID,
    sampleCount: HELIOPAUSE_SAMPLE_POINTS_SOL.length,
    getWorldSample: (i, out) =>
      out.copy(HELIOPAUSE_SAMPLE_POINTS_SOL[i]).sub(stellata.getWorldOffset()),
    visible: () => isHeliopauseApexVisible(stellata),
  });
}
