import * as THREE from 'three';
import type { Cloud, CloudCatalog } from './cloud-loader';
import type { CloudSurface } from './cloud-surfaces-loader';
import absorptionVert from './cloud-absorption.vert.glsl?raw';
import absorptionFrag from './cloud-absorption.frag.glsl?raw';
import rimFrag from './cloud-rim.frag.glsl?raw';
import rimVert from '../fresnel-shell/fresnel-shell.vert.glsl?raw';
import { viewingDistanceForExtent } from '../camera/focus/focus-transition';
import { angularDiameterPx } from '../camera/controls/star-geometry';
// Registers the stellata_fresnel_rim chunk the rim shader includes —
// removing this import breaks the shader compile at first render.
import {
  DEFAULT_FACE_ON_FLOOR,
  DEFAULT_FRESNEL_POWER,
  SHELL_RIM_BLUE,
} from '../fresnel-shell/fresnel-shell';

// Shared sphere geometries. The absorption mesh is slightly circumscribed
// (1.03) to cover tessellation sag — its raymarch clips to the analytic
// unit sphere, so the overhang discards. The rim-fallback sphere IS the
// rendered surface, so it sits at exactly 1 with finer tessellation.
const SEGMENTS_LON = 32;
const SEGMENTS_LAT = 16;
const ABSORPTION_MESH_RADIUS = 1.03;
const RIM_SEGMENTS_LON = 48;
const RIM_SEGMENTS_LAT = 24;

// Rim silhouette calibrated whisper-level: peak intensity ≈ 0.05–0.15 of
// a threshold-visible star's glow, losing to any physical signal. (The
// boundary shells run alphaLimb 0.45–0.5; clouds sit far below that
// deliberately — 96 rims at shell strength would dominate the sky.)
const ALPHA_LIMB_DEFAULT = 0.15;
const RIM_GAIN_DEFAULT = 1.0;
const STEPS_DEFAULT = 14;

// Chart/mono mode: solid black ink so the stippled outline reads as a
// definite chart annotation against the paper background.
const INK_COLOR_DEFAULT = 0x000000;
const INK_ALPHA_DEFAULT = 0.95;

const ABSORPTION_RENDER_ORDER = -2;
// Rim shells draw with the reference wireframes at −1 — annotation
// chrome, deliberately NOT extincted by the absorption pass.
const RIM_RENDER_ORDER = -1;

/** Star-pipeline uniforms the absorption shader shares by reference. */
export interface CloudSharedUniforms {
  uFovYRad: { value: number };
  uViewport: { value: THREE.Vector2 };
}

function localSharedUniforms(): CloudSharedUniforms {
  return {
    uFovYRad: { value: Math.PI / 3.6 },
    uViewport: { value: new THREE.Vector2(1920, 1080) },
  };
}

/**
 * Molecular-cloud layer — two decoupled components per cloud:
 *
 * - Absorption: per-cloud ellipsoid raymarch of the calibrated Plummer
 *   model (cloud-absorption.frag.glsl), an alpha-only over that dims the
 *   diffuse background. Physics, so it is ALWAYS on in realistic mode —
 *   never declutter-gated — and hidden only in chart mode.
 * - Rim shell: the fresnel-rim orientation silhouette on the per-cloud
 *   isosurface mesh (cloud-surfaces.bin; ellipsoid fallback when a cloud
 *   has no traced surface), gated at the `representational` declutter
 *   floor (`molecularCloudEllipsoids`). In chart mode it renders as a
 *   stippled outline instead.
 *
 * Lives in absolute ICRS space; the group's position is rebased by
 * -worldOffset each frame so the geometry stays anchored when the
 * floating origin shifts on focus changes.
 */
export class MolecularClouds {
  readonly group: THREE.Group;
  readonly clouds: Cloud[];
  private absorptionGroup: THREE.Group;
  private rimGroup: THREE.Group;
  private absorptionMaterials: THREE.ShaderMaterial[] = [];
  private rimMaterial: THREE.ShaderMaterial;
  private absorptionGeometry: THREE.SphereGeometry;
  private rimFallbackGeometry: THREE.SphereGeometry;
  /** Owned per-cloud isosurface geometries (disposed with the layer). */
  private rimSurfaceGeometries: THREE.BufferGeometry[] = [];
  private mono = false;
  /** Absorption meshes in catalog order, for picking. Cloud index is
   *  stashed on `mesh.userData.cloudIdx` so raycast results resolve back
   *  to a cloud without a separate uuid→index Map. */
  private meshes: THREE.Mesh[] = [];

  // User-tunable from the dev console via `stellata.cloudLayer.set*()`.
  private rimGain = RIM_GAIN_DEFAULT;

  constructor(
    catalog: CloudCatalog,
    surfaces: Map<number, CloudSurface> | null = null,
    shared: CloudSharedUniforms = localSharedUniforms(),
  ) {
    this.clouds = catalog.clouds;
    this.group = new THREE.Group();
    this.absorptionGroup = new THREE.Group();
    this.absorptionGroup.renderOrder = ABSORPTION_RENDER_ORDER;
    this.rimGroup = new THREE.Group();
    this.rimGroup.renderOrder = RIM_RENDER_ORDER;
    this.group.add(this.absorptionGroup, this.rimGroup);

    this.absorptionGeometry = new THREE.SphereGeometry(
      ABSORPTION_MESH_RADIUS, SEGMENTS_LON, SEGMENTS_LAT);
    this.rimFallbackGeometry = new THREE.SphereGeometry(1, RIM_SEGMENTS_LON, RIM_SEGMENTS_LAT);
    this.rimMaterial = this.makeRimMaterial();

    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];

      const mat = this.makeAbsorptionMaterial(c, shared);
      this.absorptionMaterials.push(mat);
      const mesh = new THREE.Mesh(this.absorptionGeometry, mat);
      mesh.position.copy(c.centerAbs);
      mesh.quaternion.copy(c.quat);
      mesh.scale.set(c.axes[0], c.axes[1], c.axes[2]);
      mesh.frustumCulled = false; // group origin is offset per frame
      mesh.renderOrder = ABSORPTION_RENDER_ORDER;
      mesh.userData.cloudIdx = i;
      this.meshes.push(mesh);
      this.absorptionGroup.add(mesh);

      this.rimGroup.add(this.makeRimMesh(c, surfaces?.get(c.sid)));
    }
  }

  /** Per-frame: rebase to the floating origin and gate the rim shells on
   *  the declutter permit. Absorption is physics — it stays on in
   *  realistic mode regardless of `rimPermitted`. */
  update(worldOffset: THREE.Vector3, rimPermitted: boolean) {
    this.group.position.copy(worldOffset).negate();
    this.absorptionGroup.visible = !this.mono;
    this.rimGroup.visible = rimPermitted;
  }

  /** The cloud provider's localPositionInto leg: writes the cloud's
   *  local-frame centroid into `out` when the cloud exists, returns
   *  `true`. Returns `false` (and leaves `out` untouched) when the
   *  index is out of range. */
  cloudLocalPositionInto(cloudIdx: number, worldOffset: THREE.Vector3, out: THREE.Vector3): boolean {
    const c = this.clouds[cloudIdx];
    if (!c) return false;
    out.copy(c.centerAbs).sub(worldOffset);
    return true;
  }

  /** Chart mode: absorption hides entirely; the rim material swaps to the
   *  stippled-outline ink pass (normal blending over the paper). */
  setMonochrome(on: boolean) {
    if (this.mono === on) return;
    this.mono = on;
    this.absorptionGroup.visible = !on;
    this.rimMaterial.uniforms.uChart.value = on ? 1 : 0;
    this.rimMaterial.blending = on ? THREE.NormalBlending : THREE.AdditiveBlending;
  }

  /**
   * Console-accessible debug levers. Live-update the materials so
   * tweaking happens without restart. Examples:
   *   stellata.cloudLayer.setOpacity(5)        // boost the rim glow
   *   stellata.cloudLayer.setColor(0xff8844)   // override the rim blue
   *   stellata.cloudLayer.setRimParams({ fresnelPower: 4 })
   */
  setOpacity(x: number) {
    this.rimGain = Math.max(0, x);
    this.rimMaterial.uniforms.uOpacity.value = this.rimGain;
  }
  setColor(hex: number) {
    (this.rimMaterial.uniforms.uColour.value as THREE.Color).setHex(hex);
  }
  setMonoOpacity(x: number) {
    this.rimMaterial.uniforms.uInkAlpha.value = Math.max(0, x);
  }
  setMonoColor(hex: number) {
    (this.rimMaterial.uniforms.uInk.value as THREE.Color).setHex(hex);
  }
  /** Absorption raymarch step count (§ 9.1 lever — the sampling rules
   *  are not). */
  setSteps(n: number) {
    const steps = Math.max(4, Math.min(24, Math.round(n)));
    for (const mat of this.absorptionMaterials) mat.uniforms.uSteps.value = steps;
  }
  /** Rim-glow shape levers, shared vocabulary with the fresnel shells. */
  setRimParams(p: { alphaLimb?: number; faceOnFloor?: number; fresnelPower?: number }) {
    const u = this.rimMaterial.uniforms;
    if (p.alphaLimb !== undefined) u.uAlphaLimb.value = p.alphaLimb;
    if (p.faceOnFloor !== undefined) u.uFaceOnFloor.value = p.faceOnFloor;
    if (p.fresnelPower !== undefined) u.uFresnelPower.value = p.fresnelPower;
  }
  /** Force-boost the rim glow — handy for "is the layer rendering at
   *  all?" debugging. Pass null to restore the configured gain. */
  setDebugBoost(strength: number | null) {
    this.rimMaterial.uniforms.uOpacity.value = strength === null ? this.rimGain : strength;
  }

  /**
   * Return the index of the cloud the ray hits closest to its origin, or
   * null if no cloud is hit. The renderer's depth-test means foreground
   * stars block clicks from reaching clouds behind them, but we don't
   * test against star geometry here — that's a star pick, handled by
   * `Picker.pickStar` in camera/picker.ts. Caller should pick the star
   * first and fall back to a cloud pick when no star is hit.
   */
  raycast(raycaster: THREE.Raycaster): number | null {
    const hits = raycaster.intersectObjects(this.meshes, false);
    if (hits.length === 0) return null;
    // intersectObjects sorts by distance ascending, so first hit wins.
    const idx = hits[0].object.userData.cloudIdx;
    return typeof idx === 'number' ? idx : null;
  }

  dispose() {
    this.absorptionGeometry.dispose();
    this.rimFallbackGeometry.dispose();
    for (const g of this.rimSurfaceGeometries) g.dispose();
    for (const mat of this.absorptionMaterials) mat.dispose();
    this.rimMaterial.dispose();
  }

  private makeAbsorptionMaterial(
    cloud: Cloud,
    shared: CloudSharedUniforms,
  ): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: absorptionVert,
      fragmentShader: absorptionFrag,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      // Alpha-only premultiplied-over: rgb = 0, so NormalBlending becomes
      // (ONE, ONE−α) = background × (1 − absorption).
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      // BackSide: exactly one fragment per covered pixel from outside AND
      // inside (the raymarch segment is analytic either way); FrontSide
      // would kill the inside-the-cloud absorption.
      side: THREE.BackSide,
      uniforms: {
        uAxes: { value: new THREE.Vector3(cloud.axes[0], cloud.axes[1], cloud.axes[2]) },
        uN0Cal: { value: cloud.n0Cal },
        uRflat: { value: cloud.rflatPc },
        uP: { value: cloud.p },
        uUEnv: { value: cloud.uEnv },
        uInvQuat: {
          value: new THREE.Matrix3().setFromMatrix4(
            new THREE.Matrix4().makeRotationFromQuaternion(cloud.quat.clone().conjugate()),
          ),
        },
        uSteps: { value: STEPS_DEFAULT },
        uFovYRad: shared.uFovYRad,
        uViewport: shared.uViewport,
      },
    });
  }

  private makeRimMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: rimVert,
      fragmentShader: rimFrag,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // FrontSide + outward winding = the fresnel-shell hide-when-inside
      // contract: the shell back-face-culls when the camera is inside the
      // cloud (absorption keeps working from inside — it is BackSide).
      side: THREE.FrontSide,
      uniforms: {
        uColour: { value: new THREE.Color(SHELL_RIM_BLUE) },
        uAlphaLimb: { value: ALPHA_LIMB_DEFAULT },
        uFaceOnFloor: { value: DEFAULT_FACE_ON_FLOOR },
        uFresnelPower: { value: DEFAULT_FRESNEL_POWER },
        uOpacity: { value: this.rimGain },
        uChart: { value: 0 },
        uInk: { value: new THREE.Color(INK_COLOR_DEFAULT) },
        uInkAlpha: { value: INK_ALPHA_DEFAULT },
      },
    });
  }

  private makeRimMesh(cloud: Cloud, surface: CloudSurface | undefined): THREE.Mesh {
    let mesh: THREE.Mesh;
    if (surface) {
      // Traced isosurface — vertex positions are absolute ICRS pc with
      // outward winding baked by the build; normals compute at runtime.
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
      geometry.computeVertexNormals();
      this.rimSurfaceGeometries.push(geometry);
      mesh = new THREE.Mesh(geometry, this.rimMaterial);
    } else {
      // Ellipsoid fallback (out-of-grid clouds, or no cloud-surfaces.bin):
      // the density envelope u = uEnv, where the absorption ends.
      mesh = new THREE.Mesh(this.rimFallbackGeometry, this.rimMaterial);
      mesh.position.copy(cloud.centerAbs);
      mesh.quaternion.copy(cloud.quat);
      mesh.scale.set(
        cloud.axes[0] * cloud.uEnv,
        cloud.axes[1] * cloud.uEnv,
        cloud.axes[2] * cloud.uEnv,
      );
    }
    mesh.frustumCulled = false;
    mesh.renderOrder = RIM_RENDER_ORDER;
    return mesh;
  }
}

/**
 * Compute a comfortable camera offset distance for viewing the given cloud
 * — the magnitude users pull back by when "fly to" snaps the camera. Uses
 * the cloud's largest semi-axis so a long, thin cloud (Cepheus, Aquila
 * Rift) gets enough pull-back to fit lengthwise in view, but small clouds
 * (Musca) don't park the camera a kpc away. The 2.4× factor matches the
 * tan(half-FoV) at our 60° vertical FoV with a bit of margin.
 */
export function cloudViewingDistancePc(cloud: Cloud): number {
  const maxAxis = Math.max(cloud.axes[0], cloud.axes[1], cloud.axes[2]);
  return viewingDistanceForExtent(maxAxis);
}

// Scratch vectors / quaternion used by the silhouette projection — kept
// at module scope so the per-frame distance-vector overlay calls allocate
// nothing.
const scratchDirLocal = /*@__PURE__*/ new THREE.Vector3();
const scratchU = /*@__PURE__*/ new THREE.Vector3();
const scratchV = /*@__PURE__*/ new THREE.Vector3();
const scratchQuatInv = /*@__PURE__*/ new THREE.Quaternion();

/**
 * Pixel diameter the cloud's silhouette spans on screen at the current
 * camera distance — the per-cloud analogue of `Stellata.renderedSizePx`.
 *
 * When `viewDir` is supplied (a world-space unit vector from the cloud
 * centroid toward the camera), the silhouette diameter is the silhouette
 * ellipse's major axis under the proper quadric projection — tight for
 * any orientation. For an axis-aligned view of a prolate cloud (axes
 * [10, 1, 1] viewed along the long axis) this returns the short axis
 * diameter (= 2), not the long-axis diameter (= 20).
 *
 * When `viewDir` is omitted, falls back to the longest semi-axis — the
 * legacy conservative answer used by `cloudViewingDistancePc`. This is
 * what the distance-vector chevron-tip clearance still wants when the
 * caller isn't yet plumbed for a view direction.
 */
export function renderedCloudSizePx(
  cloud: Cloud,
  dCamPc: number,
  angularToPx: number,
  viewDir?: THREE.Vector3,
): number {
  let R: number;
  if (viewDir) {
    // Rotate the world-space view direction into the cloud's local frame
    // so the silhouette ellipse computed below uses the same axis-aligned
    // basis as the cloud's `axes` array.
    scratchQuatInv.copy(cloud.quat).conjugate();
    scratchDirLocal.copy(viewDir).applyQuaternion(scratchQuatInv).normalize();

    const a2 = cloud.axes[0] * cloud.axes[0];
    const b2 = cloud.axes[1] * cloud.axes[1];
    const c2 = cloud.axes[2] * cloud.axes[2];

    // Build an orthonormal basis (u, v) perpendicular to dirLocal so the
    // ellipsoid quadric M = diag(a², b², c²) can be projected to that
    // 2D plane. Pick the world axis least aligned with dirLocal as the
    // seed for cross-product, avoiding numerical degeneracies.
    const ax = Math.abs(scratchDirLocal.x);
    const ay = Math.abs(scratchDirLocal.y);
    const az = Math.abs(scratchDirLocal.z);
    if (ax <= ay && ax <= az) scratchU.set(1, 0, 0);
    else if (ay <= az) scratchU.set(0, 1, 0);
    else scratchU.set(0, 0, 1);
    scratchU.crossVectors(scratchDirLocal, scratchU).normalize();
    scratchV.crossVectors(scratchDirLocal, scratchU);

    // Projected 2x2 matrix entries (u^T M u, u^T M v, v^T M v).
    const ux = scratchU.x; const uy = scratchU.y; const uz = scratchU.z;
    const vx = scratchV.x; const vy = scratchV.y; const vz = scratchV.z;
    const muu = a2 * ux * ux + b2 * uy * uy + c2 * uz * uz;
    const mvv = a2 * vx * vx + b2 * vy * vy + c2 * vz * vz;
    const muv = a2 * ux * vx + b2 * uy * vy + c2 * uz * vz;

    // Larger eigenvalue of the 2x2 [[muu, muv], [muv, mvv]] = silhouette
    // major-axis squared.
    const trace = muu + mvv;
    const disc = Math.sqrt(Math.max(0, (muu - mvv) * (muu - mvv) + 4 * muv * muv));
    const lambdaMax = 0.5 * (trace + disc);
    R = Math.sqrt(Math.max(0, lambdaMax));
  } else {
    R = Math.max(cloud.axes[0], cloud.axes[1], cloud.axes[2]);
  }
  return angularDiameterPx(R, Math.max(dCamPc, 1e-30), angularToPx);
}
