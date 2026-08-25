import * as THREE from 'three';
import { GAL_TO_ICRS, GALACTIC_CENTRE_PC } from '../galactic/galactic-coords';
import { SB_ZERO_POINT, lumaNormalisedTint } from '../hdr/emission/emission-pure';
import type { HdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { markDiffuseEmitter } from '../hdr/attachments/attachment-gate';
import type { EmitterMaterial } from '../solar-system/materials/emitter-material';
import {
  makeGlslBandMaterials, type BandMaterials, type BandSharedSlots,
} from './band-materials';
import type { DustField } from '../loaders/dust-loader';
import {
  BULGE_AXIS_RATIO,
  BULGE_COLOR_RGB,
  BULGE_DENSITY0,
  BULGE_TINT_RGB,
  BULGE_HALF_THICKNESS_PC,
  BULGE_RADIUS_PC,
  BULGE_SCALE_RADIUS_PC,
  DISC_COLOR_RGB,
  DISC_DENSITY0,
  DISC_HALF_THICKNESS_PC,
  DISC_RADIUS_PC,
  DISC_SCALE_HEIGHT_PC,
  DISC_SCALE_LENGTH_PC,
  DISC_THICK_DENSITY_FRACTION,
  DISC_THICK_SCALE_HEIGHT_PC,
  DISC_TINT_RGB,
  SOL_GALACTOCENTRIC_PC,
  galacticDirection,
  sightlineColumn,
} from './milkyway-column-pure';

// Bounded volumetric raymarch through proxy meshes (disc + oblate
// bulge), AdditiveBlending. See src/client/milkyway/README.md.

// --- Output calibration ------------------------------------------------

/** Luminance-weighted emission column the Galactic-centre sightline
 *  (l = 0, b = 0) integrates to, from the CPU mirror of the shader's
 *  raymarch. Pinned in ./milkyway.test.ts so a profile or quadrature
 *  change is visible. */
export const GC_SIGHTLINE_COLUMN = sightlineColumn(
  SOL_GALACTOCENTRIC_PC,
  galacticDirection(0, 0),
);

/** Surface brightness the Galactic-centre sightline resolves to, a
 *  **check** rather than the calibration it used to be — see
 *  ./calibration/README.md for what replaced it and why 20.0 was wrong
 *  by ~3 mag. Pinned against the resolved-star-corrected residual. */
export const GC_SIGHTLINE_MAG_ARCSEC2 =
  SB_ZERO_POINT - 2.5 * Math.log10(GC_SIGHTLINE_COLUMN);

// Raymarch step count is fixed in the shader (32 steps). Performance
// has been fine in practice even with two materials each running
// 32 steps; bump up if the user reports stutter.

// --- Frame transform constants ----------------------------------------

const GAL_QUAT = new THREE.Quaternion().setFromRotationMatrix(GAL_TO_ICRS);

export interface MilkywayDeps {
  /** The star pipeline's `uLimitMag`, by reference. Only the chart-mode
   *  isobar contour reads it — the band's brightness is photometric, so
   *  the exposure model reaches it through `uExposure` instead. */
  uLimitMag: { value: number };
  /** `HdrPipeline.emitterUniforms`, spread in by reference so exposure,
   *  pixel solid angle and the inline-operator branch reach both
   *  components with one write. */
  hdr: HdrEmitterUniforms;
}

/** Per-component density / colour / scale parameters. Exposed as an
 *  interface so the dev-console levers can target either component.
 *
 *  `tint` is the uniform and is luma-normalised; `authoredColor` is the
 *  palette the colour picker round-trips. Writing the authored value into
 *  the uniform would make a hue edit move the component's flux. */
interface ComponentMaterials {
  surface: EmitterMaterial;
  density0: THREE.IUniform;
  tint: THREE.IUniform;
  authoredColor: THREE.Color;
  meshScale: THREE.Vector3;
}

function tintColor(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color(...lumaNormalisedTint([r, g, b]));
}

function rgbOf(c: THREE.Color): { r: number; g: number; b: number } {
  return { r: c.r, g: c.g, b: c.b };
}

export class MilkyWay {
  /** Scene-attached group containing both proxy meshes. Consumer adds
   *  this to the main scene; renderOrder = -3 keeps both meshes behind
   *  the molecular clouds (-2), galactic reference rings (-1), and
   *  stars (0/1). */
  readonly group: THREE.Group;

  private discMesh: THREE.Mesh;
  private bulgeMesh: THREE.Mesh;

  private disc: ComponentMaterials;
  private bulge: ComponentMaterials;

  /** The slots both components hold by reference to each other. They come
   *  from the material factory rather than being built here: on WebGPU
   *  they are TSL nodes, and a write has to reach the shader through them
   *  (README.md § The material seam). */
  private shared: BandSharedSlots;
  private readonly materials: BandMaterials;

  private enabled = true;
  private isobar = false;

  constructor(deps: MilkywayDeps, materials?: BandMaterials) {
    this.materials = materials ?? makeGlslBandMaterials({
      hdr: deps.hdr,
      uLimitMag: deps.uLimitMag,
    });
    this.shared = this.materials.shared;

    // --- Disc -----------------------------------------------------------
    const discGeom = new THREE.SphereGeometry(1, 96, 48);
    this.disc = this.makeComponent({
      isBulge: false,
      meshScale: new THREE.Vector3(
        DISC_RADIUS_PC,
        DISC_RADIUS_PC,
        DISC_HALF_THICKNESS_PC,
      ),
      density0: DISC_DENSITY0,
      authoredColor: new THREE.Color(...DISC_COLOR_RGB),
      tint: new THREE.Color(...DISC_TINT_RGB),
    });
    this.discMesh = this.buildMesh(discGeom, this.disc);

    // --- Bulge ----------------------------------------------------------
    const bulgeGeom = new THREE.SphereGeometry(1, 64, 32);
    this.bulge = this.makeComponent({
      isBulge: true,
      meshScale: new THREE.Vector3(
        BULGE_RADIUS_PC,
        BULGE_RADIUS_PC,
        BULGE_HALF_THICKNESS_PC,
      ),
      density0: BULGE_DENSITY0,
      authoredColor: new THREE.Color(...BULGE_COLOR_RGB),
      tint: new THREE.Color(...BULGE_TINT_RGB),
    });
    this.bulgeMesh = this.buildMesh(bulgeGeom, this.bulge);

    this.group = new THREE.Group();
    this.group.add(this.discMesh);
    this.group.add(this.bulgeMesh);
  }

  private makeComponent(opts: {
    isBulge: boolean;
    meshScale: THREE.Vector3;
    density0: number;
    authoredColor: THREE.Color;
    tint: THREE.Color;
  }): ComponentMaterials {
    const surface = this.materials.component({
      isBulge: opts.isBulge,
      meshScalePc: opts.meshScale,
      density0: opts.density0,
      tint: opts.tint,
      discScaleLengthPc: DISC_SCALE_LENGTH_PC,
      discScaleHeightPc: DISC_SCALE_HEIGHT_PC,
      discThickScaleHeightPc: DISC_THICK_SCALE_HEIGHT_PC,
      discThickFraction: DISC_THICK_DENSITY_FRACTION,
      bulgeScaleRadiusPc: BULGE_SCALE_RADIUS_PC,
      bulgeAxisRatio: BULGE_AXIS_RATIO,
    });
    return {
      surface,
      density0: surface.uniforms.uDensity0,
      tint: surface.uniforms.uColor,
      authoredColor: opts.authoredColor,
      meshScale: opts.meshScale,
    };
  }

  private buildMesh(geom: THREE.SphereGeometry, comp: ComponentMaterials): THREE.Mesh {
    const mesh = new THREE.Mesh(geom, comp.surface.material);
    // Mesh-local axes align with galactic axes by virtue of this
    // quaternion. mesh.scale extends the unit sphere into galactic-frame
    // pc per axis (radial, radial, vertical).
    mesh.quaternion.copy(GAL_QUAT);
    mesh.scale.copy(comp.meshScale);
    // The mesh is huge but its bounding sphere is centred on the local
    // mesh origin; per-frame we rebase mesh.position to the galactic
    // centre under the floating origin. Auto-frustum-culling would
    // mis-cull when the camera is offset far from Sol.
    mesh.frustumCulled = false;
    mesh.renderOrder = -3;
    markDiffuseEmitter(mesh);
    return mesh;
  }

  /** Wire the dust voxel field into the shared uniforms. The volumetric
   *  raymarch only uses analytical dust, so we just set the enabled
   *  flag — the texture itself isn't sampled by this shader anymore.
   *  We keep the API for symmetry with the per-star pipeline so a
   *  single attachDust call keeps both layers in sync. */
  attachDust(dust: DustField | null) {
    const u = this.shared;
    if (dust === null) {
      u.uDustEnabled.value = 0;
      return;
    }
    u.uDustAvPerDensityPc.value = dust.params.avPerDensityPerPc;
    u.uDustEnabled.value = 1;
  }

  setExtinctionStrength(x: number) {
    this.shared.uExtinctionStrength.value = Math.max(0, x);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.group.visible = on;
  }

  isEnabled(): boolean { return this.enabled; }

  /**
   * Chart-mode hook. The original design rendered an isobar contour pass
   * here; the volumetric layer is currently hidden entirely in chart mode
   * while the contour treatment is refined. The blending / uniform
   * switch is preserved against future re-enable.
   */
  setIsobar(on: boolean) {
    if (this.isobar === on) return;
    this.isobar = on;
    this.shared.uChartIsobar.value = on ? 1 : 0;
    for (const mat of [this.disc.surface.material, this.bulge.surface.material]) {
      mat.blending = on ? THREE.NormalBlending : THREE.AdditiveBlending;
      mat.depthWrite = false;
      mat.needsUpdate = true;
    }
    // Hard-hide both meshes under chart mode (independent of setEnabled,
    // which gates the whole group from the user-facing toggle).
    this.discMesh.visible = !on;
    this.bulgeMesh.visible = !on;
  }

  setGlowMagOffset(x: number) {
    this.shared.uGlowMagOffset.value = x;
  }

  setDiscDensity(x: number) {
    this.disc.density0.value = Math.max(0, x);
  }
  setBulgeDensity(x: number) {
    this.bulge.density0.value = Math.max(0, x);
  }

  setDiscColor(r: number, g: number, b: number) {
    this.setComponentColor(this.disc, r, g, b);
  }
  setBulgeColor(r: number, g: number, b: number) {
    this.setComponentColor(this.bulge, r, g, b);
  }

  private setComponentColor(c: ComponentMaterials, r: number, g: number, b: number) {
    c.authoredColor.setRGB(r, g, b);
    (c.tint.value as THREE.Color).copy(tintColor(r, g, b));
  }

  /** Set the wavelength-reddening per-channel τ multipliers. CCM
   *  default is (0.751, 1.0, 1.32). Larger spread = more dramatic
   *  reddening. */
  setReddeningRGB(r: number, g: number, b: number) {
    (this.shared.uReddeningRGB.value as THREE.Vector3).set(r, g, b);
  }

  /** Read-only snapshot of all tunable values, for the dev tuning panel
   *  to initialise its inputs from the live state. */
  getValues() {
    const c = this.shared.uReddeningRGB.value as THREE.Vector3;
    return {
      glowMagOffset: this.shared.uGlowMagOffset.value,
      discDensity: this.disc.density0.value,
      bulgeDensity: this.bulge.density0.value,
      extinctionStrength: this.shared.uExtinctionStrength.value,
      discColor: rgbOf(this.disc.authoredColor),
      bulgeColor: rgbOf(this.bulge.authoredColor),
      reddening: { r: c.x, g: c.y, b: c.z },
    };
  }

  /** Per-frame update. Re-anchors both meshes to the galactic centre
   *  under the floating-origin offset, and refreshes the camera-side
   *  frame uniforms. Call once before scene render. */
  update(_camera: THREE.PerspectiveCamera, worldOffset: THREE.Vector3) {
    if (!this.enabled) return;

    // Both meshes sit at the galactic centre in absolute ICRS, which
    // becomes (GALACTIC_CENTRE_PC - worldOffset) in renderer-local frame.
    const galCenterLocal = this.shared.uGalCenter.value as THREE.Vector3;
    galCenterLocal.copy(GALACTIC_CENTRE_PC).sub(worldOffset);
    this.discMesh.position.copy(galCenterLocal);
    this.bulgeMesh.position.copy(galCenterLocal);

    (this.shared.uWorldOffset.value as THREE.Vector3).copy(worldOffset);
  }

  dispose() {
    this.discMesh.geometry.dispose();
    this.bulgeMesh.geometry.dispose();
    this.disc.surface.dispose();
    this.bulge.surface.dispose();
  }
}
