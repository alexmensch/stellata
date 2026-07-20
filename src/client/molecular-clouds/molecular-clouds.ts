import * as THREE from 'three';
import type { Cloud, CloudCatalog, CloudClass } from './cloud-loader';
import cloudVert from './cloud.vert.glsl?raw';
import cloudFrag from './cloud.frag.glsl?raw';
import { viewingDistanceForExtent } from '../camera/focus/focus-transition';
import { angularDiameterPx } from '../camera/controls/star-geometry';
// Registers the stellata_fresnel_rim chunk the fragment shader includes —
// removing this import breaks the shader compile at first render.
import {
  DEFAULT_FACE_ON_FLOOR,
  DEFAULT_FRESNEL_POWER,
} from '../fresnel-shell/fresnel-shell';
import { buildOctaveLadder, MAX_OCTAVES } from './cloud-presence-pure';

// Shared sphere geometry — every cloud is one unit sphere scaled by its
// semi-axes via the per-cloud Mesh matrix. The raymarch clips to the
// analytic unit sphere, so the mesh is slightly circumscribed (1.03) to
// cover the tessellation sag at 32×16 — the overhang discards.
const SEGMENTS_LON = 32;
const SEGMENTS_LAT = 16;
const MESH_RADIUS = 1.03;

// Whisper-glow tints by taxonomy (docs/molecular-clouds.md § 9): dark →
// neutral warm grey-brown, sf → slightly warmer, hii → faint red bias.
const CLASS_TINTS: Record<CloudClass, number> = {
  dark: 0x8f7a66,
  sf: 0xa08258,
  hii: 0xa4746b,
};

// Rim silhouette calibrated whisper-level: peak intensity ≈ 0.05–0.15 of
// a threshold-visible star's glow, losing to any physical signal. (The
// boundary shells run alphaLimb 0.45–0.5; clouds sit far below that
// deliberately — 96 rims at shell strength would dominate the sky.)
const ALPHA_LIMB_DEFAULT = 0.15;
const GLOW_GAIN_DEFAULT = 1.0;
const STEPS_DEFAULT = 14;
const TEX_GAIN_DEFAULT = 0.6;

// Chart/mono mode: solid black ink so the isobar contour reads as a
// definite chart annotation against the paper background.
const MONO_COLOR_DEFAULT = 0x000000;
const MONO_OPACITY_DEFAULT = 0.95;

/** Star-pipeline uniforms the presence shader shares by reference. */
export interface CloudSharedUniforms {
  uMaxAppMag: { value: number };
  uFovYRad: { value: number };
  uViewport: { value: THREE.Vector2 };
}

function localSharedUniforms(): CloudSharedUniforms {
  return {
    uMaxAppMag: { value: 6.5 },
    uFovYRad: { value: Math.PI / 3.6 },
    uViewport: { value: new THREE.Vector2(1920, 1080) },
  };
}

/**
 * Molecular-cloud presence layer: per-cloud ellipsoid meshes running the
 * band-limited density raymarch in cloud.frag.glsl — absorption alpha
 * over the diffuse background plus a fresnel-rim whisper glow. A
 * `representational`-tier declutter element; the caller gates `update`'s
 * `visible` flag on the floor permit.
 *
 * Lives in absolute ICRS space; the group's position is rebased by
 * -worldOffset each frame so the geometry stays anchored when the
 * floating origin shifts on focus changes.
 */
export class MolecularClouds {
  readonly group: THREE.Group;
  readonly clouds: Cloud[];
  readonly noiseModel: CloudCatalog['noiseModel'];
  private materials: THREE.ShaderMaterial[] = [];
  private geometry: THREE.SphereGeometry;
  private mono = false;
  /** Mesh references in catalog order, for picking ray-ellipsoid analytically.
   *  Cloud index is stashed on `mesh.userData.cloudIdx` so raycast results
   *  resolve back to a cloud without a separate uuid→index Map. */
  private meshes: THREE.Mesh[] = [];

  // User-tunable from the dev console via `stellata.cloudLayer.set*()`.
  private tintOverride: THREE.Color | null = null;
  private monoColor = new THREE.Color(MONO_COLOR_DEFAULT);
  private glowGain = GLOW_GAIN_DEFAULT;
  private monoOpacity = MONO_OPACITY_DEFAULT;

  // The shared uMaxAppMag uniform reference last bound by setIsobar. Cached
  // so repeated isobar toggles don't replace the wrapper on every call (which
  // would silently abandon any prior binding the caller may have expected to
  // remain live).
  private boundMagUniform: { value: number } | null = null;

  constructor(catalog: CloudCatalog, shared: CloudSharedUniforms = localSharedUniforms()) {
    this.clouds = catalog.clouds;
    this.noiseModel = catalog.noiseModel;
    this.group = new THREE.Group();
    this.group.renderOrder = -2; // draw before stars so stars composit on top

    this.geometry = new THREE.SphereGeometry(MESH_RADIUS, SEGMENTS_LON, SEGMENTS_LAT);

    const nm = catalog.noiseModel;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const mat = this.makeMaterial(c, nm, shared);
      this.materials.push(mat);

      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.position.copy(c.centerAbs);
      mesh.quaternion.copy(c.quat);
      mesh.scale.set(c.axes[0], c.axes[1], c.axes[2]);
      mesh.frustumCulled = false; // group origin is offset per frame
      mesh.renderOrder = -2;
      mesh.userData.cloudIdx = i;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Per-frame: rebase the group to compensate for the floating origin. */
  update(worldOffset: THREE.Vector3, visible: boolean) {
    this.group.visible = visible;
    if (!visible) return;
    this.group.position.copy(worldOffset).negate();
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

  setMonochrome(on: boolean) {
    if (this.mono === on) return;
    this.mono = on;
    for (const mat of this.materials) {
      mat.uniforms.uMonochrome.value = on ? 1 : 0;
      mat.uniforms.uOpacity.value = on ? this.monoOpacity : this.glowGain;
    }
  }

  /**
   * Chart-mode isobar pass. When on, each cloud's fragment shader emits
   * only a thin outline at the A_V iso-line driven by uMaxAppMag — a
   * topographic-contour treatment that follows the user's "minimally
   * visible magnitude" slider.
   */
  setIsobar(on: boolean, magnitudeUniform: { value: number }) {
    const rebind = this.boundMagUniform !== magnitudeUniform;
    for (const mat of this.materials) {
      mat.uniforms.uChartIsobar.value = on ? 1 : 0;
      // Reuse the stellata's shared uMaxAppMag uniform reference so the
      // isobar threshold tracks the slider live without per-frame writes.
      // Only rebind on first call or if the caller swapped to a different
      // shared reference — repeated rebinds with the same wrapper silently
      // abandon prior bindings.
      if (rebind) mat.uniforms.uMaxAppMag = magnitudeUniform;
    }
    this.boundMagUniform = magnitudeUniform;
  }

  /**
   * Console-accessible debug levers. Live-update all cloud materials so
   * tweaking happens without restart. Examples:
   *   stellata.cloudLayer.setOpacity(5)        // boost the rim glow
   *   stellata.cloudLayer.setColor(0xff8844)   // override class tints
   *   stellata.cloudLayer.setRimParams({ fresnelPower: 4 })
   */
  setOpacity(x: number) {
    this.glowGain = Math.max(0, x);
    if (!this.mono) {
      for (const mat of this.materials) mat.uniforms.uOpacity.value = this.glowGain;
    }
  }
  setColor(hex: number) {
    this.tintOverride = new THREE.Color(hex);
    for (const mat of this.materials) mat.uniforms.uTint.value = this.tintOverride;
  }
  setMonoOpacity(x: number) {
    this.monoOpacity = Math.max(0, x);
    if (this.mono) {
      for (const mat of this.materials) mat.uniforms.uOpacity.value = this.monoOpacity;
    }
  }
  setMonoColor(hex: number) {
    this.monoColor.setHex(hex);
    for (const mat of this.materials) mat.uniforms.uMonoColor.value = this.monoColor;
  }
  /** Raymarch step count (§ 9.1 lever — the sampling rules are not). */
  setSteps(n: number) {
    const steps = Math.max(4, Math.min(24, Math.round(n)));
    for (const mat of this.materials) mat.uniforms.uSteps.value = steps;
  }
  /** Fine-octave texture strength (clamped [0.6, 1.4] in-shader). */
  setTexGain(x: number) {
    for (const mat of this.materials) mat.uniforms.uTexGain.value = Math.max(0, x);
  }
  /** Rim-glow shape levers, shared vocabulary with the fresnel shells. */
  setRimParams(p: { alphaLimb?: number; faceOnFloor?: number; fresnelPower?: number }) {
    for (const mat of this.materials) {
      if (p.alphaLimb !== undefined) mat.uniforms.uAlphaLimb.value = p.alphaLimb;
      if (p.faceOnFloor !== undefined) mat.uniforms.uFaceOnFloor.value = p.faceOnFloor;
      if (p.fresnelPower !== undefined) mat.uniforms.uFresnelPower.value = p.fresnelPower;
    }
  }
  /** Force-boost the rim glow — handy for "is the layer rendering at
   *  all?" debugging. Pass null to restore the configured gain. */
  setDebugBoost(strength: number | null) {
    for (const mat of this.materials) {
      mat.uniforms.uOpacity.value =
        strength === null
          ? (this.mono ? this.monoOpacity : this.glowGain)
          : strength;
    }
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
    this.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
  }

  private makeMaterial(
    cloud: Cloud,
    nm: CloudCatalog['noiseModel'],
    shared: CloudSharedUniforms,
  ): THREE.ShaderMaterial {
    const ladder = buildOctaveLadder(2 * cloud.axes[0], nm);
    const octLambda = new Array<number>(MAX_OCTAVES).fill(0);
    const octAmp = new Array<number>(MAX_OCTAVES).fill(0);
    for (let k = 0; k < ladder.lambdasPc.length; k++) {
      octLambda[k] = ladder.lambdasPc[k];
      octAmp[k] = ladder.amps[k];
    }
    const invQuat = new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().makeRotationFromQuaternion(cloud.quat.clone().conjugate()),
    );
    return new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      // Premultiplied-over in one draw: rgb carries the additive rim glow,
      // alpha the absorption — NormalBlending becomes (ONE, ONE−α), i.e.
      // glow + background × (1 − absorption). Without premultipliedAlpha,
      // src.a multiplies into rgb a second time and the glow collapses.
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      // BackSide: exactly one fragment per covered pixel from outside AND
      // inside (the raymarch segment is analytic either way); FrontSide
      // would kill the inside-the-cloud absorption.
      side: THREE.BackSide,
      uniforms: {
        uAxes: { value: new THREE.Vector3(cloud.axes[0], cloud.axes[1], cloud.axes[2]) },
        uInvQuat: { value: invQuat },
        uN0Cal: { value: cloud.n0Cal },
        uRflat: { value: cloud.rflatPc },
        uP: { value: cloud.p },
        uUEnv: { value: cloud.uEnv },
        uSigmaS: { value: cloud.sigmaS },
        uSeed: { value: cloud.seed },
        uRidgedExp: { value: nm.ridgedExponent[cloud.cloudClass] },
        uTint: { value: this.tintOverride ?? new THREE.Color(CLASS_TINTS[cloud.cloudClass]) },
        uOctLambda: { value: octLambda },
        uOctAmp: { value: octAmp },
        uNumOct: { value: ladder.lambdasPc.length },
        uDomainStretch: { value: nm.domainStretchMajor },
        uClampSigma: { value: nm.noiseClampSigma },
        uRidgedCount: { value: nm.ridgedFinestCount },
        uSteps: { value: STEPS_DEFAULT },
        uOpacity: { value: this.glowGain },
        uAlphaLimb: { value: ALPHA_LIMB_DEFAULT },
        uFaceOnFloor: { value: DEFAULT_FACE_ON_FLOOR },
        uFresnelPower: { value: DEFAULT_FRESNEL_POWER },
        uTexGain: { value: TEX_GAIN_DEFAULT },
        uMaxAppMag: shared.uMaxAppMag,
        uFovYRad: shared.uFovYRad,
        uViewport: shared.uViewport,
        uMonochrome: { value: 0 },
        uMonoColor: { value: this.monoColor },
        uChartIsobar: { value: 0 },
      },
    });
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
