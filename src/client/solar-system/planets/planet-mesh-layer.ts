// Close-range spheroid mesh LOD for planet bodies. See README.md
// § Planet mesh LOD for the crossfade + lazy-texture contract.

import * as THREE from 'three';
import type { MemberSphere } from '../../local-depth/bracket/slice-pure';
import { KM_PC } from '../../util/astronomy-constants';
import { MAX_SHADOW_CASTERS } from './body-shadow-pure';
import { hostIrradianceLuminance, meshSurfaceLuminance } from './emission/mesh-surface-pure';
import { umbralDepthFromOffsets, umbralGlow } from './eclipses/umbral-glow-pure';
import {
  meanLuminanceOf,
  requiredMapWidth,
  rungsOf,
  selectRung,
} from './textures/texture-ladder';
import {
  evictionOrder,
  otherRungs,
  textureBytes,
  textureVramBudgetBytes,
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
import {
  phaseAngleFor,
  phaseAngleFromLegs,
  phaseRatioToLambert,
} from '../phase-function';
import { ringPhaseFactor } from './rings/ring-photometry-pure';
import type { PlanetBodyField } from './planet-body-field';
import {
  systemFamily,
  type Planet,
  type PlanetAtmosphere,
  type PlanetRings,
} from '../planet-system';
import { meshFadeFromPhysPx, TEXTURE_PREFETCH_PX } from './mesh-crossfade';
import {
  poleRaDecDegInto,
  type PoleRaDec,
  type RotationElements,
  spinDegAt,
} from './rotation/rotation-elements-pure';
import {
  type AtmoDiscMeans,
  type AtmosphereParams,
  SUN_COLOUR,
  atmoDiscMeans,
  atmosphereParamsOf,
} from '../atmosphere/atmosphere-scattering-pure';
import type {
  EmitterMaterial, SolarSystemMaterials,
} from '../materials/emitter-material';
import { makeGlslSolarSystemMaterials } from '../materials/glsl-materials';
import { mark as perfMark, measure as perfMeasure } from '../../debug/perf-hud';
import { markOccludingEmitter } from '../../hdr/attachments/attachment-gate';

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

/** Geometry pole tilt: SphereGeometry's +Y pole (texture v = 1, the
 *  image top) onto the body-frame +z the IAU chain treats as north. */
export const POLE_TILT = new THREE.Quaternion().setFromAxisAngle(
  X_AXIS,
  Math.PI / 2,
);

const _iauTmpA = new THREE.Quaternion();
const _iauTmpB = new THREE.Quaternion();
const _iauPole: PoleRaDec = { raDeg: 0, decDeg: 0 };

/** IAU pole frame `Rz(90°+α0)·Rx(90°−δ0)` at model time `t` → `out`. */
export function iauPoleQuat(
  rot: RotationElements,
  t: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const { raDeg, decDeg } = poleRaDecDegInto(rot, t, _iauPole);
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
  material: EmitterMaterial;
  geometry: THREE.RingGeometry;
}

interface AtmosphereEntry {
  mesh: THREE.Mesh;
  material: EmitterMaterial;
  shellRadiusPc: number;
}

/** The texture slots a not-ready map releases back to its build-time
 *  stand-in. Each slot's OWN, snapshotted at entry creation: the WebGPU
 *  factory seeds one per slot because three merges texture uniforms
 *  whose values match at shader build — re-seeding onto one shared
 *  placeholder before first render would fuse the slots and the losers'
 *  writes would never reach the GPU again. */
const TEXTURE_SLOTS = ['uMap', 'uNormalMap', 'uHorizonA', 'uHorizonB', 'uSkyView'] as const;

type SlotFallbacks = Record<(typeof TEXTURE_SLOTS)[number], THREE.Texture>;

interface MeshEntry {
  mesh: THREE.Mesh;
  material: EmitterMaterial;
  /** Body radius, extended to the ring outer edge / atmosphere shell
   *  when present — the local-depth-pass bounding sphere. */
  boundRadiusPc: number;
  radiusPc: number;
  slotFallbacks: SlotFallbacks;
  ring?: RingEntry;
  atmosphere?: AtmosphereEntry;
  /** Present iff the body has an atmosphere; shared by the mesh disc
   *  airlight and the shell limb halo. */
  atmoBase?: AtmoBase;
}

const RELIEF_SUFFIX = '-normal';
/** The two halves of one body's horizon map, azimuths 0–3 then 4–7. */
const HORIZON_SUFFIXES = ['-horizon-a', '-horizon-b'] as const;
const SKY_VIEW_SUFFIX = '-skyview';
const RINGS_SUFFIX = '-rings';

/** Resident bytes per texel of each upload format the layer narrows to. The
 *  VRAM budget is charged from this, so a map that narrows without a row here
 *  would be over-charged and evict maps that fit. */
const TEXEL_BYTES = new Map<THREE.PixelFormat, number>([
  [THREE.RedFormat, 1],
  [THREE.RGFormat, 2],
  [THREE.RGBAFormat, 4],
]);

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
  /** Which backend's surfaces this layer builds (`../materials/README.md`). */
  private readonly materials: SolarSystemMaterials;
  // A copy: the loader assigns its own forced options over whatever it is
  // handed, and the exported constant is what the tests read.
  private readonly loader = new THREE.ImageBitmapLoader()
    .setOptions({ ...TEXTURE_DECODE_OPTIONS });
  private readonly requestRender: (reason: string) => void;
  /** Widest texture this device accepts. Bounds the ladder, and stands in for
   *  the device tier the VRAM budget is sized on. */
  private readonly maxTextureSize: number;
  private readonly vramBudgetBytes: number;
  private readonly entries = new Map<number, MeshEntry>();
  private readonly textures = new Map<string, TextureState>();
  /** Frames are counted only to answer "was this drawn just now" during
   *  eviction; nothing else reads it. */
  private frame = 0;
  /** Body -> the colour rung currently DRAWN (fully resident). Distinct
   *  from what has been requested: a wider rung loads in the background
   *  and only replaces this once it is ready. */
  private readonly shownRung = new Map<string, number>();
  /** Body -> the rung selection asked for most recently, drawn or still in
   *  flight. Anything else that lands is dead on arrival: promotion can only
   *  free what is already resident, so without this a rung the demand moved
   *  past mid-fetch stayed resident and undrawn until budget pressure found
   *  it — and a body could hold its whole ladder rather than one rung. */
  private readonly requestedRung = new Map<string, number>();
  /** Colour-map key -> the body and rung width behind it. The inverse of
   *  `textureKey`, kept as a record rather than re-parsed out of the key. */
  private readonly rungOf = new Map<string, { body: string; width: number }>();

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
    requestRender: (reason: string) => void,
    maxTextureSize: number,
    /** The TSL surfaces on a WebGPU boot; absent = the shipped GLSL ones
     *  (`../materials/README.md`). */
    materials?: (placeholder: THREE.Texture) => SolarSystemMaterials,
  ) {
    this.field = field;
    this.textureBaseUrl = textureBaseUrl;
    this.requestRender = requestRender;
    this.maxTextureSize = maxTextureSize;
    this.vramBudgetBytes = textureVramBudgetBytes(maxTextureSize);
    this.hdr = pickHdrEmitterUniforms(hdr);
    this.uPixelRatio = hdr.uPixelRatio;
    this.group = new THREE.Group();
    this.group.name = 'planet-meshes';
    this.geometry = new THREE.SphereGeometry(1, 128, 64);
    this.placeholder = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1,
    );
    this.placeholder.needsUpdate = true;
    // Same unique-version rule as the loaded maps below: an eviction can
    // swap a slot BACK to the placeholder, and that swap has to rebuild
    // the bind group too.
    this.placeholder.version = this.placeholder.id + 1;
    this.materials = materials?.(this.placeholder)
      ?? makeGlslSolarSystemMaterials({ hdr: this.hdr, placeholder: this.placeholder });
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
          // One scalar per texel, so R8 — a quarter of the RGBA8 an
          // ImageBitmap of the same grayscale file would otherwise upload as.
          this.ensureTexture(textureKey(planet.name, SKY_VIEW_SUFFIX), {
            ext: 'webp', format: THREE.RedFormat,
          });
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
        material.uniforms.uNormalMap.value = entry.slotFallbacks.uNormalMap;
        material.uniforms.uHasNormalMap.value = 0;
      }
      // Half a horizon is worse than none: the shader interpolates across the
      // seam between the two maps, so one placeholder would read as a skyline
      // at the encoding's floor over the azimuths it covers.
      const horizonA = this.useTexture(textureKey(planet.name, HORIZON_SUFFIXES[0]));
      const horizonB = this.useTexture(textureKey(planet.name, HORIZON_SUFFIXES[1]));
      const skyView = this.useTexture(textureKey(planet.name, SKY_VIEW_SUFFIX));
      if (skyView?.state === 'ready') {
        material.uniforms.uSkyView.value = skyView.tex;
        material.uniforms.uHasSkyView.value = 1;
      } else {
        material.uniforms.uSkyView.value = entry.slotFallbacks.uSkyView;
        material.uniforms.uHasSkyView.value = 0;
      }
      if (horizonA?.state === 'ready' && horizonB?.state === 'ready') {
        material.uniforms.uHorizonA.value = horizonA.tex;
        material.uniforms.uHorizonB.value = horizonB.tex;
        material.uniforms.uHasHorizonMap.value = 1;
      } else {
        material.uniforms.uHorizonA.value = entry.slotFallbacks.uHorizonA;
        material.uniforms.uHorizonB.value = entry.slotFallbacks.uHorizonB;
        material.uniforms.uHasHorizonMap.value = 0;
      }
      if (texState?.state === 'ready') {
        material.uniforms.uMap.value = texState.tex;
        material.uniforms.uHasMap.value = 1;
      } else {
        material.uniforms.uMap.value = entry.slotFallbacks.uMap;
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
    const want = selectRung(
      body,
      requiredMapWidth(physPx, this.pixelRatio()),
      shown,
      this.maxTextureSize,
    );
    // A body with no ladder row ships no map at all (Uranus, future
    // exoplanets) and takes the representative-colour base path.
    if (want === null) return;
    // Recorded even when it is what we already draw, so a rung still in flight
    // from a demand that has since receded is recognised as superseded when it
    // lands rather than sitting resident and undrawn.
    this.requestedRung.set(body, want);
    if (want === shown) return;
    const key = textureKey(planet.name, `-${want}`);
    this.rungOf.set(key, { body, width: want });
    this.ensureTexture(key, { ext: 'jpg' });
    if (this.useTexture(key)?.state === 'ready') {
      this.shownRung.set(body, want);
      this.releaseOtherRungs(planet, want);
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
    const hostAngRad = hostRadiusPc / dHpPc;
    const depth = umbralDepthFromOffsets(
      this.tmpCaster.x, this.tmpCaster.y, this.tmpCaster.z, distPc,
      this.tmpSun.x, this.tmpSun.y, this.tmpSun.z,
      parent.radiusKm * KM_PC, hostAngRad,
    );
    umbralGlow(
      parent.atmosphere, parent.radiusKm, distPc / KM_PC,
      hostAngRad, depth, out,
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
    this.rungOf.delete(key);
  }

  /** Free every rung of a body except the one now drawn. Narrower rungs are
   *  outgrown; wider ones are only ever left behind after the body shrank
   *  well past them, so both are memory the screen cannot show. */
  private releaseOtherRungs(planet: Planet, shownWidth: number): void {
    const body = ladderKey(planet.name);
    const rungs = rungsOf(body);
    if (rungs === null) return;
    const held = rungs.filter((w) => this.isResident(textureKey(planet.name, `-${w}`)));
    for (const w of otherRungs(held, shownWidth)) {
      this.releaseTexture(textureKey(planet.name, `-${w}`));
    }
  }

  /** Evict least-recently-drawn maps until the resident set is back inside
   *  this device's texture budget. Nothing drawn this frame is a candidate. */
  private enforceTextureBudget(): void {
    // Summed before anything is allocated: this runs every frame and is over
    // budget on almost none of them, which is the same reason evictionOrder
    // returns before its own filter and sort.
    let total = 0;
    for (const state of this.textures.values()) {
      if (state.state === 'ready') total += state.bytes;
    }
    if (total <= this.vramBudgetBytes) return;

    const resident: ResidentTexture[] = [];
    for (const [key, state] of this.textures) {
      if (state.state !== 'ready') continue;
      resident.push({ key, bytes: state.bytes, lastFrame: state.lastFrame });
    }
    for (const key of evictionOrder(resident, this.vramBudgetBytes, this.frame)) {
      const rung = this.rungOf.get(key);
      this.releaseTexture(key);
      // A colour rung that goes must stop being the drawn one, or the body
      // renders its placeholder until it happens to grow into a new rung.
      if (rung && this.shownRung.get(rung.body) === rung.width) {
        this.shownRung.delete(rung.body);
      }
    }
  }

  /** Fill the material's uCasters array with view-space shadow spheres
   *  for one drawn body — its parent when it is a moon, its moons when
   *  it is a parent (moon-on-moon events are out of scope). Returns the
   *  caster count. */
  private writeCasters(
    material: EmitterMaterial,
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
    const sunLocal = (ring.material.uniforms.uSunDirLocal.value as THREE.Vector3)
      .copy(this.tmpSun)
      .applyQuaternion(this.tmpQuatInv);
    const camLocal = (ring.material.uniforms.uCamPosLocal.value as THREE.Vector3)
      .copy(camera.position)
      .sub(this.tmpPlanet)
      .applyQuaternion(this.tmpQuatInv);
    ring.material.uniforms.uRingPhaseScale.value = ringPhaseFactor(
      planet.rings?.systemPhotometry,
      phaseAngleFromLegs(
        camLocal.x, camLocal.y, camLocal.z,
        sunLocal.x, sunLocal.y, sunLocal.z,
      ),
      planet.phaseCoefficients,
    );
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
    const material = this.materials.planetMesh();
    // The per-body constants, over the factory's neutral defaults —
    // written here so neither backend's factory needs a `Planet`.
    material.uniforms.uReliefHorizon.value = reliefHorizonOf(planet);
    material.uniforms.uTerrainAlbedo.value = planet.albedo;
    material.uniforms.uTermSoftness.value = planet.terminatorSoftness ?? 0;
    const mesh = new THREE.Mesh(this.geometry, material.material);
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
    const slotFallbacks = Object.fromEntries(TEXTURE_SLOTS.map(
      (slot) => [slot, material.uniforms[slot].value as THREE.Texture],
    )) as SlotFallbacks;
    const entry: MeshEntry = { mesh, material, boundRadiusPc, radiusPc, slotFallbacks };
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
    const material = this.materials.planetAtmosphere();
    const mesh = new THREE.Mesh(this.geometry, material.material);
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
    const material = this.materials.planetRings();
    material.uniforms.uInnerRatio.value = innerRatio;
    material.uniforms.uOuterPc.value = outerPc;
    material.uniforms.uEqRadiusPc.value = planet.radiusKm * KM_PC;
    material.uniforms.uPolarRadiusPc.value =
      planet.radiusKm * KM_PC * polarRadiusRatio(planet);
    const mesh = new THREE.Mesh(geometry, material.material);
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
   *  signal. Two maps qualify: the normal, whose blue is a constant and
   *  whose alpha is unused (`stellataReliefNormal` samples `.rg` and
   *  reconstructs z), and the sky-view factor, which is one scalar written
   *  to a grayscale file. WebGL2 RG8 and R8 are both colour-renderable and
   *  filterable, so mipmaps and anisotropy carry over unchanged. */
  private ensureTexture(
    key: string,
    { ext, format }: { ext: TextureExt; format?: THREE.PixelFormat },
  ): void {
    if (this.textures.has(key)) return;
    this.textures.set(key, { state: 'loading' });
    this.loader.load(
      `${this.textureBaseUrl}textures/${key}.${ext}`,
      (bitmap) => {
        // The colour ladder is clamped before it asks, but the relief and ring
        // maps ship one fixed width each — Earth's normal map is 8192 — so the
        // cap has to be enforced where every map passes. An oversized upload
        // fails and leaves the body white; refusing here takes the
        // representative-colour path instead, which is a designed fallback.
        if (bitmap.width > this.maxTextureSize || bitmap.height > this.maxTextureSize) {
          bitmap.close();
          this.resolveTexture(key, { state: 'missing' });
          return;
        }
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
        // Globally unique version, in place of needsUpdate's 1. The mesh
        // materials swap texture-node VALUES as maps arrive, and three's
        // WebGPU backend rebuilds a bind group only when the new object's
        // version differs from the old one's — two version-1 textures
        // alias and the draw keeps sampling the replaced GPU texture.
        // Uploads still happen exactly once on either backend (both
        // compare the version per texture object, not per slot).
        tex.version = tex.id + 1;
        const bytesPerTexel = TEXEL_BYTES.get(format ?? THREE.RGBAFormat) ?? 4;
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
    // A colour rung the demand outgrew or fell back past while it was in
    // flight is never going to be drawn. This is the only place it can be
    // reclaimed: promotion frees resident rungs, and a loading one is not
    // resident yet. Fetches can land out of order — an evicted wider rung
    // comes back off the HTTP cache while a narrower one is still on the
    // wire — so ordering cannot be relied on instead.
    const rung = this.rungOf.get(key);
    if (rung && this.requestedRung.get(rung.body) !== rung.width) {
      this.releaseTexture(key);
    }
    this.requestRender('planet-texture');
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
    this.shownRung.clear();
    this.requestedRung.clear();
    this.rungOf.clear();
    this.geometry.dispose();
    this.placeholder.dispose();
  }
}
