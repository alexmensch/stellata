// Close-range spheroid mesh LOD for planet bodies. See README.md
// § Planet mesh LOD for the crossfade + lazy-texture contract.

import * as THREE from 'three';
import type { MemberSphere } from '../../local-depth/bracket/slice-pure';
import { KM_PC } from '../../util/astronomy-constants';
import { MAX_SHADOW_CASTERS } from './body-shadow-pure';
import { hostIrradianceLuminance, meshSurfaceLuminance } from './emission/mesh-surface-pure';
import { umbralDepthRad, umbralGlow } from './eclipses/umbral-glow-pure';
import {
  meanLuminanceOf,
  requiredMapWidth,
  rungsOf,
  selectRung,
} from './textures/texture-ladder';
import {
  evictionOrder,
  supersededRungs,
  TEXTURE_VRAM_BUDGET_BYTES,
  textureBytes,
  type ResidentTexture,
} from './textures/texture-budget-pure';
import { polarRadiusRatio } from './spheroid-pure';
import {
  RELIEF_ELEV_SPAN_M,
  reliefHorizonUniform,
} from './surface-relief/surface-relief-pure';
import {
  pickHdrEmitterUniforms,
  type HdrEmitterUniforms,
} from '../../hdr/hdr-pipeline';
import { relativeLuminance } from '../../hdr/tonemap-pure';
import { phaseAngleFor, phaseRatioToLambert } from '../phase-function';
import type { PlanetBodyField } from './planet-body-field';
import {
  systemFamily,
  type Planet,
  type PlanetAtmosphere,
  type PlanetRings,
} from '../planet-system';
import { meshFadeFromPhysPx, TEXTURE_PREFETCH_PX } from './mesh-crossfade';
import {
  poleRaDecDegAt,
  type RotationElements,
  spinDegAt,
} from './rotation/rotation-elements-pure';
import meshVert from './planet-mesh.vert.glsl?raw';
import meshFrag from './planet-mesh.frag.glsl?raw';
import ringsVert from './rings/planet-rings.vert.glsl?raw';
import ringsFrag from './rings/planet-rings.frag.glsl?raw';
import atmoVert from '../atmosphere/planet-atmosphere.vert.glsl?raw';
import atmoFrag from '../atmosphere/planet-atmosphere.frag.glsl?raw';
import atmoScatterChunk from '../atmosphere/atmosphere-scatter.glsl?raw';
import atmoUniformsChunk from '../atmosphere/atmosphere-uniforms.glsl?raw';
import {
  ATMO_N_LIGHT,
  ATMO_N_VIEW,
  type AtmoDiscMeans,
  type AtmosphereParams,
  MIE_G_DEFAULT,
  SUN_COLOUR,
  atmoDiscMeans,
  atmosphereParamsOf,
} from '../atmosphere/atmosphere-scattering-pure';
import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import { markOccludingEmitter } from '../../hdr/attachments/attachment-gate';

// Splice the shared atmosphere GLSL — the uniform contract and the
// single-scattering integrator — into both the mesh disc and the shell
// fragment sources; the sample-count #defines ride each material so the GLSL
// loop bounds track atmosphere-scattering-pure.ts.
const ATMO_CHUNKS: Record<string, string> = {
  '#include <stellata_atmosphere_uniforms>': atmoUniformsChunk,
  '#include <stellata_atmosphere_scatter>': atmoScatterChunk,
};
const withAtmoChunks = (frag: string): string =>
  Object.entries(ATMO_CHUNKS).reduce((src, [inc, chunk]) => src.replace(inc, chunk), frag);
const MESH_FRAG = withAtmoChunks(meshFrag);
const ATMO_FRAG = withAtmoChunks(atmoFrag);
const ATMO_DEFINES = { ATMO_N_VIEW, ATMO_N_LIGHT } as const;

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Per-body scattering state in planet-radius units: the row's own params and
 *  the disc means that normalise what the shader emits from them. Both derived
 *  once — there is no global multiplier on a published optical depth, by
 *  design (`../atmosphere/README.md` § No global knobs). */
interface AtmoBase {
  /** `polarRadiusRatio` — the shaders scale the ray's polar component by its
   *  reciprocal so the unit-sphere march geometry describes the body drawn. */
  polarR: number;
  sunColour: readonly [number, number, number];
  params: AtmosphereParams;
  discMeans: AtmoDiscMeans;
}

function computeAtmoBase(
  radiusKm: number,
  polarR: number,
  atmo: PlanetAtmosphere,
): AtmoBase {
  const params = atmosphereParamsOf(atmo, radiusKm);
  const sunColour = atmo.sunColour ?? SUN_COLOUR;
  return {
    polarR,
    sunColour,
    params,
    // The airlight rides the illuminant and the surface does not, so the
    // normaliser has to know which.
    discMeans: atmoDiscMeans(params, relativeLuminance(sunColour)),
  };
}

/** The atmosphere-scatter uniforms shared by the mesh disc airlight and the
 *  atmosphere shell (values filled per frame by applyAtmoUniforms). */
function sharedAtmoUniforms(): Record<string, THREE.IUniform> {
  return {
    uCenterView: { value: new THREE.Vector3() },
    uRadiusPc: { value: 1 },
    uAtmoRadius: { value: 1.02 },
    uPoleView: { value: new THREE.Vector3(0, 1, 0) },
    uPolarRadiusR: { value: 1 },
    uScaleHeightR: { value: 0.01 },
    uScaleHeightM: { value: 0.01 },
    uBetaRayleigh: { value: new THREE.Vector3() },
    uBetaMie: { value: 0 },
    uBetaAbsorb: { value: new THREE.Vector3() },
    uMieG: { value: MIE_G_DEFAULT },
    uSunColour: { value: new THREE.Vector3(SUN_COLOUR[0], SUN_COLOUR[1], SUN_COLOUR[2]) },
  };
}

/** Geometry pole tilt: SphereGeometry's +Y pole (texture v = 1, the
 *  image top) onto the body-frame +z the IAU chain treats as north. */
export const POLE_TILT = new THREE.Quaternion().setFromAxisAngle(
  X_AXIS,
  Math.PI / 2,
);

const _iauTmpA = new THREE.Quaternion();
const _iauTmpB = new THREE.Quaternion();

/** IAU pole frame `Rz(90°+α0)·Rx(90°−δ0)` at model time `t` → `out`. */
export function iauPoleQuat(
  rot: RotationElements,
  t: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const { raDeg, decDeg } = poleRaDecDegAt(rot, t);
  return out
    .setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(90 + raDeg))
    .multiply(_iauTmpA.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(90 - decDeg)));
}

/** Full mesh orientation: the IAU body→ICRS composition
 *  `Rz(90°+α0)·Rx(90°−δ0)·Rz(W)`, then POLE_TILT. The map-centre
 *  offset rides the spin term so texture features land on their true
 *  longitudes. Exported so tests pin the exact rendered composition
 *  against external ephemeris truth. */
export function iauMeshOrientationQuat(
  rot: RotationElements,
  t: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const spinDeg = spinDegAt(rot, t) + (rot.mapCenterLonDeg ?? 0);
  return iauPoleQuat(rot, t, out)
    .multiply(_iauTmpB.setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(spinDeg)))
    .multiply(POLE_TILT);
}

interface RingEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.RingGeometry;
}

interface AtmosphereEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  shellRadiusPc: number;
}

interface MeshEntry {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Body radius, extended to the ring outer edge / atmosphere shell
   *  when present — the local-depth-pass bounding sphere. */
  boundRadiusPc: number;
  radiusPc: number;
  ring?: RingEntry;
  atmosphere?: AtmosphereEntry;
  /** Present iff the body has an atmosphere; shared by the mesh disc
   *  airlight and the shell limb halo. */
  atmoBase?: AtmoBase;
}

const RELIEF_SUFFIX = '-normal';
/** The two halves of one body's horizon map, azimuths 0–3 then 4–7. */
const HORIZON_SUFFIXES = ['-horizon-a', '-horizon-b'] as const;
const RINGS_SUFFIX = '-rings';

/** The one place a body name becomes a texture key — and the one place it is
 *  lowercased, so `textures` and the fetched URL cannot disagree on case.
 *  A colour map's suffix is its rung width (`-8192`); the relief and ring
 *  maps ship one width each and carry a named suffix instead. */
const textureKey = (name: string, suffix = ''): string =>
  `${name.toLowerCase()}${suffix}`;

/** The ladder key for a body — the colour map's key without any rung. */
const ladderKey = (name: string): string => name.toLowerCase();

/** The body's DEM elevation span, or null where it ships no relief maps —
 *  which bodies fetch them and the fallback limb bound are the same question. */
const reliefSpanOf = (planet: Planet): readonly [number, number] | null =>
  RELIEF_ELEV_SPAN_M[textureKey(planet.name)] ?? null;

/** The body's own limb bound on relief lighting, in the shader's units.
 *  Zero for bodies with no map — the shader never reads it there. */
const reliefHorizonOf = (planet: Planet): THREE.Vector2 => {
  const span = reliefSpanOf(planet);
  return span
    ? new THREE.Vector2(...reliefHorizonUniform(span, planet.radiusKm))
    : new THREE.Vector2();
};

type TextureExt = 'jpg' | 'png' | 'webp';

/** Decode options for every planet map. `imageOrientation` puts the flip in the
 *  bitmap, where no GL state can skip it: three issues no UNPACK_FLIP_Y_WEBGL
 *  at all for an ImageBitmap source, so a pixel-store cache desynced from GL
 *  (`../../loaders/README.md`) cannot reach these maps, and a map that arrives
 *  unflipped shades the mirrored hemisphere with no other symptom.
 *  `premultiplyAlpha: 'none'` keeps each horizon map's fourth azimuth, which
 *  rides the alpha channel, from scaling the other three — spelled out because
 *  `setOptions` replaces the loader's own defaults instead of merging. */
export const TEXTURE_DECODE_OPTIONS = {
  imageOrientation: 'flipY',
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
} as const;

type TextureState =
  | { state: 'loading' }
  | { state: 'ready'; tex: THREE.Texture; bytes: number; lastFrame: number }
  | { state: 'missing' };

export class PlanetMeshLayer {
  readonly group: THREE.Group;

  private readonly field: PlanetBodyField;
  private readonly textureBaseUrl: string;
  /** The seam's slots by reference — read per frame for the live exposure
   *  and pixel solid angle, and spread into every material so the
   *  inline-operator branch tracks `HdrPipeline`. */
  private readonly hdr: HdrEmitterUniforms;
  private readonly uPixelRatio: THREE.IUniform<number> | undefined;
  private readonly geometry: THREE.SphereGeometry;
  private readonly placeholder: THREE.DataTexture;
  // A copy: the loader assigns its own forced options over whatever it is
  // handed, and the exported constant is what the tests read.
  private readonly loader = new THREE.ImageBitmapLoader()
    .setOptions({ ...TEXTURE_DECODE_OPTIONS });
  private readonly requestRender: () => void;
  private readonly entries = new Map<number, MeshEntry>();
  private readonly textures = new Map<string, TextureState>();
  /** Frames are counted only to answer "was this drawn just now" during
   *  eviction; nothing else reads it. */
  private frame = 0;
  /** Body -> the colour rung currently DRAWN (fully resident). Distinct
   *  from what has been requested: a wider rung loads in the background
   *  and only replaces this once it is ready. */
  private readonly shownRung = new Map<string, number>();

  private readonly tmpPlanet = new THREE.Vector3();
  private readonly tmpHost = new THREE.Vector3();
  private readonly tmpSun = new THREE.Vector3();
  private readonly tmpSunView = new THREE.Vector3();
  private readonly tmpCenterView = new THREE.Vector3();
  private readonly tmpPoleView = new THREE.Vector3();
  private readonly tmpCaster = new THREE.Vector3();
  private readonly viewInverse = new THREE.Matrix4();
  private readonly tmpQuatRing = new THREE.Quaternion();
  private readonly tmpQuatInv = new THREE.Quaternion();
  private readonly tmpUmbra: [number, number, number] = [0, 0, 0];

  constructor(
    field: PlanetBodyField,
    textureBaseUrl: string,
    hdr: HdrEmitterUniforms & { uPixelRatio?: THREE.IUniform<number> },
    requestRender: () => void,
  ) {
    this.field = field;
    this.textureBaseUrl = textureBaseUrl;
    this.requestRender = requestRender;
    this.hdr = pickHdrEmitterUniforms(hdr);
    this.uPixelRatio = hdr.uPixelRatio;
    this.group = new THREE.Group();
    this.group.name = 'planet-meshes';
    this.geometry = new THREE.SphereGeometry(1, 128, 64);
    this.placeholder = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1,
    );
    this.placeholder.needsUpdate = true;
  }

  /** Append camera-relative bounding spheres for every mesh-visible
   *  body (ring annulus included via the stored bound). The
   *  local-depth-pass bracket input; empty while the layer is hidden. */
  collectSpheres(camera: THREE.PerspectiveCamera, out: MemberSphere[]): void {
    if (!this.group.visible) return;
    for (const entry of this.entries.values()) {
      if (!entry.mesh.visible) continue;
      out.push({
        distPc: entry.mesh.position.distanceTo(camera.position),
        radiusPc: entry.boundRadiusPc,
      });
    }
  }

  /** Per-frame: show/scale/light every body inside the crossfade band.
   *  Reads the body field's live buffers, so recentres and scrubber
   *  motion need no extra hooks. `t` is the model clock (getT()) —
   *  IAU spin runs on it like binary orbits. */
  update(camera: THREE.PerspectiveCamera, t: number): void {
    // Chart mode inks the bodies as flat discs (chart-mode/README.md);
    // a lit photographic sphere has no place on paper.
    this.group.visible = this.field.group.visible && !this.field.monochrome;
    if (!this.group.visible) return;
    perfMark('solar.mesh');
    this.frame++;

    // camera.matrixWorldInverse is refreshed inside render(), AFTER
    // this update — the stored value is one frame stale, so view-space
    // sun and caster uniforms built from it swim against the surface
    // under camera motion. Derive a fresh inverse here.
    camera.updateMatrixWorld();
    this.viewInverse.copy(camera.matrixWorld).invert();

    const shown = new Set<number>();
    const n = this.field.liveInstanceCount;
    for (let idx = 0; idx < n; idx++) {
      if (idx === this.field.hiddenInstanceIdx) continue;
      const planet = this.field.planetAt(idx);
      if (!planet) continue;
      if (!this.field.planetLocalPositionInto(idx, this.tmpPlanet)) continue;

      const radiusPc = planet.radiusKm * KM_PC;
      const physPx = this.field.physicalPlanetSizePx(idx, camera.position);
      if (physPx >= TEXTURE_PREFETCH_PX) {
        this.ensureColourRung(planet, physPx);
        if (reliefSpanOf(planet)) {
          this.ensureTexture(textureKey(planet.name, RELIEF_SUFFIX), {
            ext: 'webp', format: THREE.RGFormat,
          });
          // Not RG: all four channels of each horizon plane carry an
          // azimuth, alpha included.
          for (const suffix of HORIZON_SUFFIXES) {
            this.ensureTexture(textureKey(planet.name, suffix), { ext: 'webp' });
          }
        }
        if (planet.rings) {
          this.ensureTexture(textureKey(planet.name, RINGS_SUFFIX), { ext: 'png' });
        }
      }
      const fade = meshFadeFromPhysPx(physPx);
      if (fade <= 0) continue;

      const entry = this.entries.get(idx) ?? this.createEntry(idx, planet);
      shown.add(idx);
      const { mesh, material } = entry;
      mesh.visible = true;
      mesh.position.copy(this.tmpPlanet);
      mesh.scale.set(radiusPc, radiusPc * polarRadiusRatio(planet), radiusPc);

      const hp = this.field.hostPlanetOf(idx);
      if (planet.rotation) {
        iauMeshOrientationQuat(planet.rotation, t, mesh.quaternion);
      } else {
        // Fallback for bodies without published elements: geometry
        // pole (+Y) → orbital-plane normal (host frame +Z) → ICRS via
        // the host orientation; prime meridian arbitrary but fixed.
        const orientation = hp === null
          ? null
          : this.field.hostOrientationOf(hp.hostStarIdx);
        if (orientation) {
          mesh.quaternion.copy(orientation).multiply(POLE_TILT);
        }
      }

      // Host-star direction: world frame (the ring + phase lighting frame),
      // with a view-space copy for the terminator, disc airlight, and shell.
      let hasSun = false;
      let dHpPc = 0;
      if (hp && this.field.getHostLocalPositionInto(hp.hostStarIdx, this.tmpHost)) {
        this.tmpSun.subVectors(this.tmpHost, this.tmpPlanet);
        dHpPc = this.tmpSun.length();
        if (dHpPc > 0) {
          this.tmpSun.divideScalar(dHpPc);
          hasSun = true;
        }
      }
      // Emission into the scene-wide HDR unit. Both scalars fall to 0
      // without a host: an unlit body reflects nothing, where the old
      // display encoding fell back to a full-brightness 1.
      const texState = this.colourState(planet);
      const hostAbsmag = hasSun ? (this.field.hostAbsmagOf(hp!.hostStarIdx) ?? 0) : 0;
      const exposure = this.hdr.uExposure.value;
      const omegaPx = this.hdr.uOmegaPxArcsec2.value;
      const airlightL = hasSun
        ? hostIrradianceLuminance(exposure, omegaPx, hostAbsmag, dHpPc)
        : 0;
      const surfaceL = hasSun
        ? meshSurfaceLuminance(
            exposure, omegaPx, hostAbsmag, dHpPc, planet.albedo,
            this.baseMeanLuminance(planet, texState),
            entry.atmoBase?.discMeans,
          )
        : 0;
      if (hasSun) this.tmpSunView.copy(this.tmpSun).transformDirection(this.viewInverse);
      this.tmpCenterView.copy(this.tmpPlanet).applyMatrix4(this.viewInverse);
      // The mesh's LOCAL +Y is the axis mesh.scale flattens, so the body's
      // north pole in view space is that axis through the orientation. The
      // atmosphere shaders need it to undo the flattening.
      this.tmpPoleView.set(0, 1, 0)
        .applyQuaternion(mesh.quaternion)
        .transformDirection(this.viewInverse);
      (material.uniforms.uPoleView.value as THREE.Vector3).copy(this.tmpPoleView);

      if (entry.ring) {
        this.updateRing(entry.ring, planet, hp, t, camera, hasSun, fade, airlightL);
      }

      material.uniforms.uSurfaceLuminance.value = surfaceL;
      material.uniforms.uAirlightLuminance.value = airlightL;
      // Refracted sunlight in the parent's umbra — the coppery red of a
      // totally eclipsed body, which the caster loop alone drives to black.
      if (hasSun && hp && this.umbralGlowFor(hp, dHpPc, this.tmpUmbra)) {
        (material.uniforms.uUmbralGlow.value as THREE.Vector3).set(...this.tmpUmbra);
      } else {
        (material.uniforms.uUmbralGlow.value as THREE.Vector3).set(0, 0, 0);
      }
      material.uniforms.uPhaseScale.value = hasSun && planet.phaseCoefficients
        ? phaseRatioToLambert(
            planet.phaseCoefficients,
            phaseAngleFor(
              this.tmpPlanet.x - camera.position.x,
              this.tmpPlanet.y - camera.position.y,
              this.tmpPlanet.z - camera.position.z,
              this.tmpHost.x - camera.position.x,
              this.tmpHost.y - camera.position.y,
              this.tmpHost.z - camera.position.z,
            ),
          )
        : 1;
      material.uniforms.uCasterCount.value =
        hasSun && hp ? this.writeCasters(material, hp) : 0;

      if (hasSun) {
        (material.uniforms.uSunDirView.value as THREE.Vector3).copy(this.tmpSunView);
        const hostRadiusPc = this.field.hostRadiusOf(hp!.hostStarIdx);
        material.uniforms.uSunAngRad.value =
          hostRadiusPc !== null ? hostRadiusPc / dHpPc : 0;
      }

      // Atmosphere: the mesh disc airlight and the shell limb halo share the
      // per-body base params + the global tuning; both gate on host light.
      if (entry.atmoBase) {
        material.uniforms.uHasAtmosphere.value = hasSun ? 1 : 0;
        if (hasSun) {
          this.applyAtmoUniforms(material.uniforms, entry.atmoBase, radiusPc);
        }
        if (entry.atmosphere) {
          this.updateAtmosphere(
            entry.atmosphere, entry.atmoBase, radiusPc, hasSun, airlightL, fade,
          );
        }
      }

      material.uniforms.uFade.value = fade;
      const reliefState = this.useTexture(textureKey(planet.name, RELIEF_SUFFIX));
      if (reliefState?.state === 'ready') {
        material.uniforms.uNormalMap.value = reliefState.tex;
        material.uniforms.uHasNormalMap.value = 1;
      } else {
        material.uniforms.uNormalMap.value = this.placeholder;
        material.uniforms.uHasNormalMap.value = 0;
      }
      // Half a horizon is worse than none: the shader interpolates across the
      // seam between the two maps, so one placeholder would read as a skyline
      // at the encoding's floor over the azimuths it covers.
      const horizonA = this.useTexture(textureKey(planet.name, HORIZON_SUFFIXES[0]));
      const horizonB = this.useTexture(textureKey(planet.name, HORIZON_SUFFIXES[1]));
      if (horizonA?.state === 'ready' && horizonB?.state === 'ready') {
        material.uniforms.uHorizonA.value = horizonA.tex;
        material.uniforms.uHorizonB.value = horizonB.tex;
        material.uniforms.uHasHorizonMap.value = 1;
      } else {
        material.uniforms.uHorizonA.value = this.placeholder;
        material.uniforms.uHorizonB.value = this.placeholder;
        material.uniforms.uHasHorizonMap.value = 0;
      }
      if (texState?.state === 'ready') {
        material.uniforms.uMap.value = texState.tex;
        material.uniforms.uHasMap.value = 1;
      } else {
        material.uniforms.uMap.value = this.placeholder;
        material.uniforms.uHasMap.value = 0;
        (material.uniforms.uColour.value as THREE.Color).setRGB(
          planet.colour[0], planet.colour[1], planet.colour[2],
        );
      }
    }

    for (const [idx, entry] of this.entries) {
      if (!shown.has(idx)) {
        entry.mesh.visible = false;
        if (entry.ring) entry.ring.mesh.visible = false;
        if (entry.atmosphere) entry.atmosphere.mesh.visible = false;
      }
    }
    // After the hide pass, so a body that stopped being drawn this frame is
    // already a candidate rather than waiting a frame to become one.
    this.enforceTextureBudget();
    perfMeasure('solar.mesh');
  }

  /** The disc mean `meshSurfaceLuminance` divides out, matching whichever
   *  base the fragment shader is about to sample: the day map's measured
   *  mean when one is bound, else the representative colour's own
   *  luminance — which is exactly what the flat-colour branch emits, so
   *  that path is exact. */
  private baseMeanLuminance(planet: Planet, texState: TextureState | undefined): number {
    const mean = meanLuminanceOf(ladderKey(planet.name));
    if (texState?.state === 'ready' && mean !== null) return mean;
    return relativeLuminance([planet.colour[0], planet.colour[1], planet.colour[2]]);
  }

  /** The drawing buffer's pixel ratio, `min(devicePixelRatio, 2)`. Read live
   *  off the shared uniform rather than `window`, so a resize, an FOV change
   *  and a drag onto a different-DPR monitor all reach tier selection through
   *  the one value the renderer itself is using. */
  private pixelRatio(): number {
    return this.uPixelRatio?.value ?? 1;
  }

  /** Request the rung this body needs at its current projected size, and
   *  promote it to the drawn rung once it is FULLY resident — decoded,
   *  uploaded, mips built. Swapping on first byte would show a frame of
   *  bottom-mip, which is the pop the lead-the-swap rule exists to avoid. */
  private ensureColourRung(planet: Planet, physPx: number): void {
    const body = ladderKey(planet.name);
    const shown = this.shownRung.get(body) ?? null;
    const want = selectRung(body, requiredMapWidth(physPx, this.pixelRatio()), shown);
    // A body with no ladder row ships no map at all (Uranus, future
    // exoplanets) and takes the representative-colour base path.
    if (want === null || want === shown) return;
    const key = textureKey(planet.name, `-${want}`);
    this.ensureTexture(key, { ext: 'jpg' });
    if (this.useTexture(key)?.state === 'ready') {
      this.shownRung.set(body, want);
      this.releaseSupersededRungs(planet, want);
    }
  }

  /**
   * Per-channel refracted-sunlight illuminance in the parent's umbra, as a
   * fraction of direct host irradiance — the coppery red of a totally
   * eclipsed Moon. Zero unless this body is a moon whose parent HAS an
   * atmosphere to refract through: an airless caster really does throw a
   * black shadow, and the giants carry no `atmosphere` row.
   *
   * The depth is measured at the body CENTRE and the shader spreads it with
   * `1 − shadow`, so the eclipsed part of a partly-immersed disc glows while
   * the uneclipsed limb stays bright. The umbra's own edge-to-centre colour
   * gradient — the turquoise rim — is therefore not resolved across the disc;
   * it would need this geometry per fragment.
   */
  private umbralGlowFor(
    hp: { hostStarIdx: number; planetIdx: number },
    dHpPc: number,
    out: [number, number, number],
  ): boolean {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    const ps = this.field.getAttachedPlanetSystem(hp.hostStarIdx);
    if (!ps || dHpPc <= 0) return false;
    const parentIdx = systemFamily(ps.planets).parentIdx[hp.planetIdx];
    if (parentIdx < 0) return false;
    const parent = ps.planets[parentIdx];
    if (!parent.atmosphere) return false;
    const flat = this.field.instanceIndexOf(hp.hostStarIdx, parentIdx);
    const hostRadiusPc = this.field.hostRadiusOf(hp.hostStarIdx);
    if (flat === null || hostRadiusPc === null) return false;
    if (!this.field.planetLocalPositionInto(flat, this.tmpCaster)) return false;

    // Body → parent, and the body → host direction already in tmpSun.
    this.tmpCaster.sub(this.tmpPlanet);
    const distPc = this.tmpCaster.length();
    if (distPc <= 0) return false;
    const parentRadiusPc = parent.radiusKm * KM_PC;
    // Angular separation of the two centres seen from the body: the parent's
    // offset from the host direction, small-angle.
    const along = this.tmpCaster.dot(this.tmpSun);
    if (along <= 0) return false;
    const missRad = Math.sqrt(
      Math.max(0, this.tmpCaster.lengthSq() - along * along),
    ) / distPc;
    const depth = umbralDepthRad(
      parentRadiusPc / distPc, missRad, hostRadiusPc / dHpPc,
    );
    umbralGlow(
      parent.atmosphere, parent.radiusKm, distPc / KM_PC,
      hostRadiusPc / dHpPc, depth, out,
    );
    return out[0] > 0 || out[1] > 0 || out[2] > 0;
  }

  /** The colour-map state for the rung currently drawn, if any. Touching it
   *  marks it used this frame, which is what keeps eviction off anything on
   *  screen. */
  private colourState(planet: Planet): TextureState | undefined {
    const shown = this.shownRung.get(ladderKey(planet.name));
    if (shown === undefined) return undefined;
    return this.useTexture(textureKey(planet.name, `-${shown}`));
  }

  /** Is this map resident, WITHOUT claiming it was drawn. Residency and use
   *  are different questions: stamping here would keep a superseded rung
   *  looking fresh at exactly the moment it is being released. */
  private isResident(key: string): boolean {
    return this.textures.get(key)?.state === 'ready';
  }

  /** Look a texture up and stamp it as used this frame. */
  private useTexture(key: string): TextureState | undefined {
    const state = this.textures.get(key);
    if (state?.state === 'ready') state.lastFrame = this.frame;
    return state;
  }

  /** Drop one resident map and its decoded bitmap. */
  private releaseTexture(key: string): void {
    const state = this.textures.get(key);
    if (state?.state !== 'ready') return;
    state.tex.dispose();
    (state.tex.image as ImageBitmap).close();
    this.textures.delete(key);
  }

  /** Free the narrower rungs of a body now showing a wider one. Selection
   *  never downgrades, so nothing will ask for them again. */
  private releaseSupersededRungs(planet: Planet, shownWidth: number): void {
    const body = ladderKey(planet.name);
    const rungs = rungsOf(body);
    if (rungs === null) return;
    const held = rungs.filter((w) => this.isResident(textureKey(planet.name, `-${w}`)));
    for (const w of supersededRungs(held, shownWidth)) {
      this.releaseTexture(textureKey(planet.name, `-${w}`));
    }
  }

  /** Evict least-recently-drawn maps until the resident set is back inside
   *  TEXTURE_VRAM_BUDGET_BYTES. Nothing drawn this frame is a candidate. */
  private enforceTextureBudget(): void {
    const resident: ResidentTexture[] = [];
    let total = 0;
    for (const [key, state] of this.textures) {
      if (state.state !== 'ready') continue;
      resident.push({ key, bytes: state.bytes, lastFrame: state.lastFrame });
      total += state.bytes;
    }
    if (total <= TEXTURE_VRAM_BUDGET_BYTES) return;
    for (const key of evictionOrder(resident, TEXTURE_VRAM_BUDGET_BYTES, this.frame)) {
      this.releaseTexture(key);
      // A colour rung that goes must stop being the drawn one, or the body
      // renders its placeholder until it happens to grow into a new rung.
      const dash = key.lastIndexOf('-');
      if (dash > 0 && /^\d+$/.test(key.slice(dash + 1))) {
        this.shownRung.delete(key.slice(0, dash));
      }
    }
  }

  /** Fill the material's uCasters array with view-space shadow spheres
   *  for one drawn body — its parent when it is a moon, its moons when
   *  it is a parent (moon-on-moon events are out of scope). Returns the
   *  caster count. */
  private writeCasters(
    material: THREE.ShaderMaterial,
    hp: { hostStarIdx: number; planetIdx: number },
  ): number {
    const ps = this.field.getAttachedPlanetSystem(hp.hostStarIdx);
    if (!ps) return 0;
    const family = systemFamily(ps.planets);
    const casters = material.uniforms.uCasters.value as THREE.Vector4[];
    const parentIdx = family.parentIdx[hp.planetIdx];
    let count = 0;
    if (parentIdx >= 0) {
      count += this.writeCaster(casters, count, hp.hostStarIdx, parentIdx);
    } else {
      const children = family.childIdxs[hp.planetIdx];
      for (let c = 0; c < children.length && count < MAX_SHADOW_CASTERS; c++) {
        count += this.writeCaster(casters, count, hp.hostStarIdx, children[c]);
      }
    }
    return count;
  }

  /** Write one caster's view-space sphere into `casters[slot]`; returns
   *  1 on success, 0 when the body isn't resolvable. */
  private writeCaster(
    casters: THREE.Vector4[],
    slot: number,
    hostStarIdx: number,
    planetIdx: number,
  ): number {
    const flat = this.field.instanceIndexOf(hostStarIdx, planetIdx);
    if (flat === null) return 0;
    const body = this.field.planetAt(flat);
    if (!body || !this.field.planetLocalPositionInto(flat, this.tmpCaster)) return 0;
    this.tmpCaster.applyMatrix4(this.viewInverse);
    casters[slot].set(
      this.tmpCaster.x,
      this.tmpCaster.y,
      this.tmpCaster.z,
      body.radiusKm * KM_PC,
    );
    return 1;
  }

  /** `out` ← Rz(90°+α0)·Rx(90°−δ0): local +z lands on the body's IAU
   *  pole in ICRS. */

  /** Pose + light the ring annulus: equatorial plane from the IAU
   *  pole (host orbital plane when elements are absent), sun and
   *  camera rotated into the ring-local frame for the fragment
   *  shader's lit-face / shadow tests. Hidden until the radial strip
   *  texture arrives — rings have no representative-colour fallback. */
  private updateRing(
    ring: RingEntry,
    planet: Planet,
    hp: { hostStarIdx: number; planetIdx: number } | null,
    t: number,
    camera: THREE.PerspectiveCamera,
    hasSun: boolean,
    fade: number,
    airlightL: number,
  ): void {
    const texState = this.useTexture(textureKey(planet.name, RINGS_SUFFIX));
    if (texState?.state !== 'ready' || !hasSun) {
      ring.mesh.visible = false;
      return;
    }
    if (planet.rotation) {
      iauPoleQuat(planet.rotation, t, this.tmpQuatRing);
    } else {
      const orientation = hp === null
        ? null
        : this.field.hostOrientationOf(hp.hostStarIdx);
      if (!orientation) {
        ring.mesh.visible = false;
        return;
      }
      this.tmpQuatRing.copy(orientation);
    }
    ring.mesh.visible = true;
    ring.material.uniforms.uRingMap.value = texState.tex;
    ring.material.uniforms.uFade.value = fade;
    ring.material.uniforms.uAirlightLuminance.value = airlightL;
    ring.mesh.position.copy(this.tmpPlanet);
    ring.mesh.quaternion.copy(this.tmpQuatRing);

    this.tmpQuatInv.copy(this.tmpQuatRing).invert();
    (ring.material.uniforms.uSunDirLocal.value as THREE.Vector3)
      .copy(this.tmpSun)
      .applyQuaternion(this.tmpQuatInv);
    (ring.material.uniforms.uCamPosLocal.value as THREE.Vector3)
      .copy(camera.position)
      .sub(this.tmpPlanet)
      .applyQuaternion(this.tmpQuatInv);
  }

  /** Write the shared single-scattering uniforms (planet-radius-unit base
   *  params × the global debug tuning) onto a mesh or shell material.
   *  `tmpCenterView` must already hold the body's view-space centre. The pole
   *  travels with each material's other view-space directions instead — the
   *  relief tangent frame needs it on airless bodies too. */
  private applyAtmoUniforms(
    u: Record<string, THREE.IUniform>,
    base: AtmoBase,
    radiusPc: number,
  ): void {
    const p = base.params;
    (u.uCenterView.value as THREE.Vector3).copy(this.tmpCenterView);
    u.uPolarRadiusR.value = base.polarR;
    u.uRadiusPc.value = radiusPc;
    u.uAtmoRadius.value = p.rAtmo;
    u.uScaleHeightR.value = p.hR;
    u.uScaleHeightM.value = p.hM;
    (u.uBetaRayleigh.value as THREE.Vector3).set(p.betaRs[0], p.betaRs[1], p.betaRs[2]);
    u.uBetaMie.value = p.betaMs;
    (u.uBetaAbsorb.value as THREE.Vector3).set(p.betaA[0], p.betaA[1], p.betaA[2]);
    u.uMieG.value = p.g;
    (u.uSunColour.value as THREE.Vector3).set(
      base.sunColour[0], base.sunColour[1], base.sunColour[2]);
  }

  /** Pose the limb-halo shell on the body and feed it the shared scatter
   *  uniforms plus its view-space sun direction, exposure, and fade. */
  private updateAtmosphere(
    atmo: AtmosphereEntry,
    base: AtmoBase,
    radiusPc: number,
    hasSun: boolean,
    airlightL: number,
    fade: number,
  ): void {
    if (!hasSun) {
      atmo.mesh.visible = false;
      return;
    }
    atmo.mesh.visible = true;
    atmo.mesh.position.copy(this.tmpPlanet);
    this.applyAtmoUniforms(atmo.material.uniforms, base, radiusPc);
    (atmo.material.uniforms.uPoleView.value as THREE.Vector3).copy(this.tmpPoleView);
    (atmo.material.uniforms.uSunDirView.value as THREE.Vector3).copy(this.tmpSunView);
    atmo.material.uniforms.uAirlightLuminance.value = airlightL;
    atmo.material.uniforms.uFade.value = fade;
  }

  private createEntry(idx: number, planet: Planet): MeshEntry {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: meshVert,
      fragmentShader: MESH_FRAG,
      uniforms: {
        ...pickHdrEmitterUniforms(this.hdr),
        uMap: { value: this.placeholder },
        uHasMap: { value: 0 },
        uNormalMap: { value: this.placeholder },
        uHasNormalMap: { value: 0 },
        uReliefHorizon: { value: reliefHorizonOf(planet) },
        uHorizonA: { value: this.placeholder },
        uHorizonB: { value: this.placeholder },
        uHasHorizonMap: { value: 0 },
        uTerrainAlbedo: { value: planet.albedo },
        uColour: { value: new THREE.Color(1, 1, 1) },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uFade: { value: 0 },
        uPhaseScale: { value: 1 },
        uSurfaceLuminance: { value: 0 },
        uUmbralGlow: { value: new THREE.Vector3() },
        uAirlightLuminance: { value: 0 },
        uTermSoftness: { value: planet.terminatorSoftness ?? 0 },
        uCasters: {
          value: Array.from({ length: MAX_SHADOW_CASTERS }, () => new THREE.Vector4()),
        },
        uCasterCount: { value: 0 },
        uSunAngRad: { value: 0 },
        uHasAtmosphere: { value: 0 },
        ...sharedAtmoUniforms(),
      },
      defines: { ...ATMO_DEFINES },
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = 'planet-mesh';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2.8;
    markOccludingEmitter(mesh);
    this.group.add(mesh);
    const radiusPc = planet.radiusKm * KM_PC;
    const boundRadiusPc = Math.max(
      planet.rings ? planet.rings.outerRadiusKm : 0,
      planet.radiusKm + (planet.atmosphere?.heightKm ?? 0),
    ) * KM_PC;
    const entry: MeshEntry = { mesh, material, boundRadiusPc, radiusPc };
    if (planet.rings) entry.ring = this.createRing(planet, planet.rings);
    if (planet.atmosphere) {
      entry.atmoBase = computeAtmoBase(
        planet.radiusKm, polarRadiusRatio(planet), planet.atmosphere,
      );
      entry.atmosphere = this.createAtmosphere(planet, planet.atmosphere);
    }
    this.entries.set(idx, entry);
    return entry;
  }

  // Slightly-larger spherical shell over the shared unit sphere. The
  // fragment shader integrates the view ray's single-scattered airlight
  // analytically, in the frame where the body is a unit sphere, so the shell
  // needs no per-body geometry — the mesh over-covers toward the poles and the
  // excess discards (../atmosphere/README.md § Shell extents).
  private createAtmosphere(planet: Planet, atmo: PlanetAtmosphere): AtmosphereEntry {
    const shellRadiusPc = (planet.radiusKm + atmo.heightKm) * KM_PC;
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: atmoVert,
      fragmentShader: ATMO_FRAG,
      uniforms: {
        ...pickHdrEmitterUniforms(this.hdr),
        ...sharedAtmoUniforms(),
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uAirlightLuminance: { value: 0 },
        uFade: { value: 0 },
      },
      defines: { ...ATMO_DEFINES },
      transparent: true,
      // Premultiplied over (not additive): the shell adds airlight AND
      // occludes the background by its opacity (frag alpha = 1 − view-path
      // transmittance), so a dense limb chord that scatters no light toward
      // the eye still extincts the stars behind it. Additive left the
      // shadowed base transparent and leaked stars through the ring gap.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.name = 'planet-atmosphere';
    mesh.frustumCulled = false;
    // After the body mesh (2.8) and rings (2.81), depth-tested so the body
    // occludes the far hemisphere.
    mesh.renderOrder = 2.82;
    mesh.scale.setScalar(shellRadiusPc);
    mesh.visible = false;
    markOccludingEmitter(mesh);
    this.group.add(mesh);
    return { mesh, material, shellRadiusPc };
  }

  private createRing(planet: Planet, rings: PlanetRings): RingEntry {
    const outerPc = rings.outerRadiusKm * KM_PC;
    const innerRatio = rings.innerRadiusKm / rings.outerRadiusKm;
    const geometry = new THREE.RingGeometry(innerRatio, 1, 128, 1);
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: ringsVert,
      fragmentShader: ringsFrag,
      uniforms: {
        ...pickHdrEmitterUniforms(this.hdr),
        uRingMap: { value: this.placeholder },
        uInnerRatio: { value: innerRatio },
        uOuterPc: { value: outerPc },
        uEqRadiusPc: { value: planet.radiusKm * KM_PC },
        uPolarRadiusPc: { value: planet.radiusKm * KM_PC * polarRadiusRatio(planet) },
        uSunDirLocal: { value: new THREE.Vector3(0, 0, 1) },
        uCamPosLocal: { value: new THREE.Vector3(0, 0, 1) },
        uFade: { value: 0 },
        uAirlightLuminance: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'planet-rings';
    mesh.frustumCulled = false;
    // After the body mesh (2.8) so the near-side ring segment draws
    // over the depth the body just wrote; far side depth-fails.
    mesh.renderOrder = 2.81;
    mesh.scale.setScalar(outerPc);
    mesh.visible = false;
    markOccludingEmitter(mesh);
    this.group.add(mesh);
    return { mesh, material, geometry };
  }

  /** `format` narrows the GPU upload below RGBA8 where channels carry no
   *  signal — the only such map is the normal, whose blue is a constant
   *  and whose alpha is unused, so RG8 halves its VRAM with nothing for
   *  the shader to notice (`stellataReliefNormal` samples `.rg` and
   *  reconstructs z). WebGL2 RG8 is colour-renderable and filterable, so
   *  mipmaps and anisotropy carry over unchanged. */
  private ensureTexture(
    key: string,
    { ext, format }: { ext: TextureExt; format?: THREE.PixelFormat },
  ): void {
    if (this.textures.has(key)) return;
    this.textures.set(key, { state: 'loading' });
    this.loader.load(
      `${this.textureBaseUrl}textures/${key}.${ext}`,
      (bitmap) => {
        const tex = new THREE.Texture(bitmap);
        // The bitmap carries the flip. Belt-and-braces: three skips the upload
        // flip entirely for a bitmap source, so this changes nothing today and
        // holds the orientation if that ever stops being true.
        tex.flipY = false;
        // Raw sRGB values, matching the pipeline's convention of
        // writing colours to the framebuffer without a colorspace
        // transform (star/planet shaders do the same).
        tex.colorSpace = THREE.NoColorSpace;
        if (format) tex.format = format;
        tex.wrapS = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        // RG8 halves what an RGBA8 upload of the same map would cost; the
        // relief branch is the only one that narrows (.50).
        const bytesPerTexel = format === THREE.RGFormat ? 2 : 4;
        this.resolveTexture(key, {
          state: 'ready',
          tex,
          bytes: textureBytes(bitmap.width, bitmap.height, bytesPerTexel),
          lastFrame: this.frame,
        });
      },
      undefined,
      (err) => {
        // Texture-less bodies (Uranus, future exoplanets) take the
        // representative-colour base path — a 404 is expected data. A failed
        // decode is not, and lands here too: it would strip every body's map
        // at once, so log rather than let the only signal be flat planets.
        console.warn(`planet map ${key} unavailable`, err);
        this.resolveTexture(key, { state: 'missing' });
      },
    );
  }

  /** Both outcomes change what the body draws, and both land between
   *  ticks — a body left on the placeholder would sit there until
   *  something else woke the render gate. */
  private resolveTexture(key: string, state: TextureState): void {
    this.textures.set(key, state);
    this.requestRender();
  }

  dispose(): void {
    for (const { mesh, material, ring, atmosphere } of this.entries.values()) {
      this.group.remove(mesh);
      material.dispose();
      if (ring) {
        this.group.remove(ring.mesh);
        ring.material.dispose();
        ring.geometry.dispose();
      }
      if (atmosphere) {
        this.group.remove(atmosphere.mesh);
        atmosphere.material.dispose();
      }
    }
    this.entries.clear();
    for (const t of this.textures.values()) {
      if (t.state !== 'ready') continue;
      t.tex.dispose();
      // Texture.dispose frees the GL object; the decoded bitmap is ours. Safe
      // only while THREE.Cache stays off — an enabled Cache keys bitmaps by
      // URL and would hand this closed one to the next load.
      (t.tex.image as ImageBitmap).close();
    }
    this.textures.clear();
    this.geometry.dispose();
    this.placeholder.dispose();
  }
}
