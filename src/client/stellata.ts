import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { Catalog } from './loaders/catalog-loader';
import { collapsedClusterIndices } from './format/star-companion-format';
import type { DustField, DustParticleData } from './loaders/dust-loader';
import vertexShader from './star-pipeline/star.vert.glsl?raw';
import fragmentShader from './star-pipeline/star.frag.glsl?raw';
import perceptualDiscChunk from './star-pipeline/perceptual-disc.glsl?raw';
import dustRaymarchChunk from './star-pipeline/dust-raymarch.glsl?raw';
import { makeColorLutTexture } from './star-pipeline/blackbody-lut';
import { bestApsisTeff } from './star-pipeline/star-color-routing-pure';
import {
  DustParticleLayer,
  type DustParticleSharedUniforms,
} from './dust/dust-particle-layer';

// Register the perceptual-disc chunk so star.{vert,frag} (and any
// future point-source layer) can `#include <stellata_perceptual_disc>`
// via three.js's standard ShaderChunk preprocessor. Side-effect at
// module load — runs once before any material compiles.
(THREE.ShaderChunk as Record<string, string>)['stellata_perceptual_disc'] =
  perceptualDiscChunk;
(THREE.ShaderChunk as Record<string, string>)['stellata_dust_raymarch'] =
  dustRaymarchChunk;
import { GalacticDisc } from './galactic/galactic-disc';
import { LocalGroupLayer } from './local-group/local-group';
import { lgViewingDistancePc, maxSemiAxisPc } from './local-group/local-group-loader';
import { LG_EMISSION_SHELVED, LocalGroupEmission } from './local-group/local-group-emission';
import type { LgCatalog } from './local-group/local-group-loader';
import { MAX_DISTANCE_PC, CAMERA_FAR_PC } from '../../scripts/local-group/build-local-group-pure';
import { GalacticGrid } from './galactic/galactic-grid';
import { HudOverlay } from './overlays/hud-overlay';
import { GALACTIC_CENTRE_PC } from './galactic/galactic-coords';
import { MolecularClouds, renderedCloudSizePx } from './molecular-clouds/molecular-clouds';
import type { CloudCatalog } from './molecular-clouds/cloud-loader';
import { MilkyWay } from './milkyway/milkyway';
import { ObserveControls } from './camera/observe/observe-controls';
import { mark as perfMark, measure as perfMeasure, frame as perfFrame } from './debug/perf-hud';
import {
  angularToPx as angularToPxPure,
  sortedDistRange,
} from './camera/controls/star-geometry';
import * as starPhysics from './camera/controls/star-physics';
import { ZOOM_FLOOR_FRACTION } from './camera/controls/star-physics';
import { Picker } from './camera/controls/picker';
import { AimController } from './camera/controls/aim-controller';
import {
  WarpController,
  type WarpInfo,
  type WarpPhaseInfo,
} from './camera/warp/warp-controller';
import { ObserveTransition } from './camera/observe/observe-transition';
import { PoiStore } from './poi/poi-store';
import { InputController } from './camera/controls/input-controller';
import {
  FocusController,
  type FrameAnchor,
  GLOBAL_MIN_DIST_PC,
} from './camera/focus/focus-controller';
import type { FocusableProviders, Target } from './camera/focus/focus-target';
import { parkDistance } from './camera/focus/focus-transition';
import { cloudViewingDistancePc } from './molecular-clouds/molecular-clouds';
import { focalRideStep, shouldRecenterFocalOrigin } from './camera/focus/focal-ride-pure';
import { getPlanetSystem, hasPlanets, type PlanetSystem } from './solar-system/planet-system';
import { OrbitRingsLayer } from './solar-system/orbit-rings-layer';
import { PlanetBodyField } from './solar-system/planet-body-field';
import { PlanetMeshLayer } from './solar-system/planet-mesh-layer';
import { LocalDepthPass } from './local-depth/local-depth-pass';
import { SolarSystemCluster } from './solar-system/local-cluster';
import { MIRROR_CAPACITY, StarLocalMirror } from './star-pipeline/star-local-mirror';
import { StarLocalCluster } from './star-pipeline/star-local-cluster';
import {
  discWindowPc,
  PHYS_RATIO_THRESHOLD,
  RESOLVED_DISC_MIN_PX,
} from './star-pipeline/star-local-cluster-pure';
import type { PerceptualDiscUniforms } from './star-pipeline/perceptual-disc-uniforms';
import {
  Heliopause,
  HELIOPAUSE_LABEL,
  HELIOPAUSE_CARD,
  HELIOPAUSE_EXTENT_PC,
  HELIOPAUSE_LABEL_ELEMENT_ID,
  HELIOPAUSE_SAMPLE_POINTS_SOL,
} from './solar-system/heliopause';
import {
  LocalBubbleShell,
  LOCAL_BUBBLE_LABEL,
  LOCAL_BUBBLE_CARD,
  LOCAL_BUBBLE_LABEL_ELEMENT_ID,
} from './local-bubble/local-bubble';
import type { LocalBubbleMesh } from './local-bubble/local-bubble-loader';
import { ShellRegistry } from './fresnel-shell/shell-registry';
import { SHELL_OBJECT_SIDS } from './fresnel-shell/shell-object-sids';
import {
  T_CLAMP_MAX_S,
  T_CLAMP_MIN_S,
  VirtualClock,
  tToJDE,
} from './solar-system/time';
import {
  advancePositionsToEpoch,
  bucketEpochJyr,
  jdeToJulianEpochYear,
  maxSpeedPcPerYr,
} from './loaders/epoch-advance-pure';
import { J2000_JD, KM_PC, R_SUN_PC, MIN_PHYSICAL_RADIUS_R_SUN } from './util/astronomy-constants';
import { apparentMagnitude } from './solar-system/perceptual-magnitude';
// Locally used subset; other warp-timing constants re-exported below
// for external import paths still pointing at './stellata'.
import { DCAM_LOG_FLOOR_PC } from './camera/timing';
export {
  AIM_T_MAX_MS,
  AIM_T_MIN_MS,
  CAMERA_LERP_MS,
  FOCUS_LERP_MS,
  OBSERVE_TRANSITION_MS,
  WARP_REORIENT_MS,
  WARP_T_K_MS,
  WARP_T_MAX_MS,
  WARP_T_MIN_MS,
} from './camera/timing';
import { EventBus } from './util/event-bus';
import {
  DEFAULT_FILTER,
  DEFAULT_FOV,
  type FilterState,
  type MagPresetName,
  STAR_RENDER_DEFAULTS,
  type StarRenderParams,
} from './filters/filter-state';
import { FilterController } from './filters/filter-controller';
import { SceneLayerRegistry, type FrameCtx } from './scene/scene-layer';
import {
  type DetailLevel,
  type SceneElementBinds,
  type SceneElementId,
  SCENE_ELEMENT_IDS,
} from './scene/scene-elements';
import { StarPipeline } from './star-pipeline/star-pipeline';
import {
  ExtinctionPrepass,
  type ExtinctionPrepassUniforms,
} from './star-pipeline/extinction-prepass';
import { BinaryOrbitField } from './binaries/binary-orbit-field';
import { BinaryOrbitPathLayer } from './binaries/binary-orbit-path-layer';
import { ConstellationFigureLayer } from './constellation-figure/constellation-figure-layer';
import {
  EclipsePhotometryField,
  type EclipseRelationDebugRow,
} from './binaries/eclipse-photometry';
import { type BinariesData } from './binaries/binaries-loader';
import { buildPulsationSuppressMask } from './star-pipeline/pulsation-suppress-pure';

export interface StellataOptions {
  canvas: HTMLCanvasElement;
  catalog: Catalog;
}

export type CameraMode = 'navigate' | 'observe';

// Event-bus payload map. Subscribers register via `Stellata.on(name, fn)`
// and the compiler enforces the payload type per event. `state` and
// `frame` are no-payload events.
//
// `focus` / `vector` carry the full kind-tagged Target (or null) — one
// event each for every focusable kind; a payload change from kind A to
// kind B is a single emit, never a clearing emit followed by a set.
//
// Emission pairing contract: every discrete state mutation emits its
// fine-grained event and THEN `state` (the URL-sync trigger) from the
// same mutation site — subscribing to `state` alone observes every
// mutation. The exceptions emit alone: `planetSystem` (derived from a
// focus change that already paired with `state`), `frame` (render-tick
// fanout), and the `focusLerp` / warp-end animation edges (transient,
// not URL-encoded state). Per-event list: src/client/README.md
// § Event bus.
export type StellataEventMap = {
  focus: Target | null;
  planetSystem: PlanetSystem | null;
  filter: Readonly<FilterState>;
  vector: Target | null;
  cameraMode: CameraMode;
  warp: boolean;
  focusLerp: boolean;
  pois: readonly Target[];
  noopClick: { x: number; y: number };
  state: void;
  frame: void;
};

export class Stellata implements FrameAnchor {
  readonly catalog: Catalog;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: TrackballControls;

  private scene: THREE.Scene;
  // Star render pipeline — one InstancedBufferGeometry feeds three
  // ShaderMaterials (core depth-mask / disc / glow). Owns the dispose
  // contract for the densest resource cluster in the app. Per-frame
  // uniform writes still go through `starPipeline.discMaterial.uniforms`
  // from this file; the encapsulation is resource ownership only.
  private starPipeline!: StarPipeline;
  // Dust-particle render layer. Currently shelved — see
  // src/client/star-pipeline/README.md § "Dust extinction + the shelved particle layer".
  private dustParticles!: DustParticleLayer;

  // Floating origin to dodge float32 cancellation when zoomed close to
  // distant stars. worldOffset is the absolute coord that sits at
  // local (0,0,0); _localPositions = catalog.positions − worldOffset
  // bound to the iPosition attribute. Overlays project via the
  // `localPositions` getter so every path stays in the camera's frame.
  private worldOffset = new THREE.Vector3();
  private _localPositions: Float32Array;
  // Pristine J2016.0 catalog positions — the immutable baseline every
  // epoch (re-)advance writes catalog.positions from. Never mutate.
  private readonly _basePositions: Float32Array;
  // Bucketised Julian epoch year catalog.positions currently sits at.
  private _advancedEpochJyr: number;
  private readonly _maxEpochDriftPc: number;
  // Scratch for the focused star's per-re-advance space-motion delta.
  private readonly _epochFollowDelta = new THREE.Vector3();
  // Composite-suppress flag per catalog instance. 0 = render normally;
  // 1 = drop the disc + core depth-mask passes (additive glow still
  // runs). BinaryOrbitField writes per-frame for sub-pixel secondaries.
  private _compositeSuppress: Float32Array;
  // Per-instance geometric-eclipse dim factor. 1 = no occlusion;
  // EclipsePhotometryField writes per-frame for the back component of
  // orbital pairs whose discs overlap from the camera viewpoint.
  private _eclipseDim: Float32Array;
  // Per-instance pulsation-suppress flag. 1 zeros the GCVS-amplitude
  // radial pulsation in the vertex shader for every eclipsing binary
  // (varType == ECLIPSING). Built once at catalog-load (binary-independent).
  // See src/client/binaries/README.md § Pulsation gate for eclipsing binaries.
  private _suppressPulsation: Float32Array;
  // Lazily attached when main.ts loads public/binaries.bin. Null until
  // then — the renderer functions identically with the static catalog
  // positions; binary orbital evolution simply doesn't fire.
  private binaryOrbitField: BinaryOrbitField | null = null;
  private binariesData: BinariesData | null = null;
  private eclipsePhotometryField: EclipsePhotometryField | null = null;

  // Focal-frame ride state. The focal star (when a binary member) drifts
  // along its orbit; the camera + orbit target track that drift so the
  // pinned star stays at NDC centre and unfocus is a pure state change.
  // `_lastAppliedPert` is the perturbation already baked into camera /
  // target / pose caches; each frame the delta since last frame is
  // applied and stored. `_rideFocalIdx` guards the re-seed on focus
  // change (no translate on the frame the focal switches). float64
  // throughout (THREE.Vector3 components are doubles).
  private readonly _focalPert = new THREE.Vector3();
  private readonly _lastAppliedPert = new THREE.Vector3();
  private readonly _rideDelta = new THREE.Vector3();
  private readonly _rideLive = new THREE.Vector3();
  private _rideFocalIdx: number | null = null;

  // Planet-focal ride state — the planet sibling of the binary ride
  // above. A focused planet sweeps its orbit with `t` (fast under
  // scrubber FF); the camera + orbit target translate by its per-frame
  // local-position delta so the body stays under the camera and user
  // pan offsets survive. `_planetRideIdx` reseeds on every 'focus'
  // event (focus change or same-planet refocus both recentre the
  // origin, staleing the cached last position).
  private readonly _planetRideLast = new THREE.Vector3();
  private readonly _planetRideLive = new THREE.Vector3();
  private readonly _planetRideDelta = new THREE.Vector3();
  private _planetRideIdx: number | null = null;

  // Sorted-by-distance-from-Sol index for the core-mask query. Distance
  // from Sol is intrinsic (computed from absolute catalog positions) and
  // therefore stable across floating-origin recenters, so this index is
  // built once at construction. Each frame we slice a window via triangle
  // inequality on the camera's distance-from-Sol, turning a 313k linear
  // scan into a few-hundred-element check.
  private sortedDistFromSol!: Float32Array;
  private sortedByDistFromSol!: Uint32Array;

  // Largest physicalRadius in the catalog, in pc. Drives shouldEnableCoreMask:
  // the core depth-mask only matters when at least one star's angular disc
  // crosses the visibility threshold, and the largest star at the closest
  // approach is the worst case.
  private maxPhysicalRadiusPc!: number;

  // Filter / preset / render-knob state + mutations live in
  // FilterController (filters/README.md); the shell reads the live
  // state through this getter for per-frame gates and dep closures.
  private filters!: FilterController;
  private get filter(): Readonly<FilterState> { return this.filters.getFilter(); }

  // Declutter cycle (scene/README.md § Detail-level declutter cycle).
  // Init all-true so the default detailLevel='all' is behaviour-neutral —
  // the seam changes nothing until V is pressed.
  private readonly detailPermitted: Record<SceneElementId, boolean> =
    Object.fromEntries(SCENE_ELEMENT_IDS.map((id) => [id, true])) as Record<SceneElementId, boolean>;

  private disposed = false;
  private bus = new EventBus<StellataEventMap>();

  // Scene layers register once (registerSceneLayers) and the registry
  // fans out per-frame update / setMonochrome / recenter / dispose —
  // see scene/README.md. frameCtx is the shared per-frame input struct,
  // mutated in place each frame to avoid a per-frame allocation.
  private readonly layers = new SceneLayerRegistry();
  private frameCtx!: { -readonly [K in keyof FrameCtx]: FrameCtx[K] };

  private observe!: ObserveTransition;
  private observeControls!: ObserveControls;

  private clock = new VirtualClock();

  // Focus, distance-vector destination, and cameraMode all live on
  // FocusController (camera/focus/README.md) as Target sum types; the
  // shell keeps thin public shims.
  private focus!: FocusController;
  private monochrome = false;
  private warp!: WarpController;
  private aim!: AimController;

  private poiStore!: PoiStore;
  // Canvas pointer input — click FSM (single/double, both modes),
  // two-finger / gesture roll, shift-pan binding. See
  // camera/controls/README.md § Input controller.
  private input!: InputController;

  // Galactic reference layers. Disc fades in by camera-distance
  // from Sol and is always-on. Grid is gated by `filter.showGalacticGrid`.
  // The HUD (Sol/GC arrows + OBSERVE-mode ring) is gated by
  // `filter.showHud`. Mono mode swaps strokes to a paper-chart palette via
  // setMonochrome on each layer (HUD is CSS-only).
  private galacticDisc: GalacticDisc;
  // Representational layer — only renders when the host is focused.
  private orbitRingsLayer: OrbitRingsLayer;
  private binaryOrbitPathLayer: BinaryOrbitPathLayer;
  private constellationFigureLayer: ConstellationFigureLayer;
  // Active-figure-set signature; skips a rebuild when a filter emit didn't
  // change which constellations draw. Poison '\0' forces the first refresh.
  private conFigureSig = '\0';
  // Physical layer — renders for every attached host regardless of
  // focus, gated by per-planet apparent magnitude + per-host distance cull.
  private planetBodyField: PlanetBodyField;
  private planetMeshLayer: PlanetMeshLayer;
  private readonly localDepthPass = new LocalDepthPass();
  private starLocalMirror: StarLocalMirror;
  private starLocalCluster: StarLocalCluster;
  private solarCluster: SolarSystemCluster;
  // Sol-anchored asymmetric ellipsoid; visible only when Sol is the
  // focused host.
  private heliopause: Heliopause;
  private localBubbleShell: LocalBubbleShell;
  /** Boundary-shell focus-target instances (Local Bubble, heliopause).
   *  Populated by each shell's attach; the kind-agnostic shell dispatch
   *  reads it. See fresnel-shell/shell-registry.ts. */
  readonly shells = new ShellRegistry();
  private galacticGrid: GalacticGrid;
  private hudOverlay: HudOverlay;

  // null until attachLocalGroup() runs; absent layer is a no-op
  // everywhere. Shares the MW disc's FADE_INNER_PC / FADE_OUTER_PC
  // reveal curve.
  private localGroupLayer: LocalGroupLayer | null = null;

  // Volumetric LG emission — the wireframe's luminous sibling, built
  // from the same catalog. No Sol-distance fade and visible during
  // warp (it's light, not reference chrome); only chart mode and its
  // own toggle hide it.
  private lgEmission: LocalGroupEmission | null = null;

  // Molecular cloud overlay. null until attachClouds() runs;
  // the layer loads asynchronously after the catalog and search index so
  // first paint isn't gated on it.
  private clouds: MolecularClouds | null = null;

  // Milky Way analytic background. Constructed eagerly so the
  // band is on during first paint. Dust is wired in once the volumetric
  // texture attaches.
  private milkyway: MilkyWay;

  // Reference to the most recently attached DustField — kept solely so
  // dispose() can release the ~128 MiB Data3DTexture. attachDust(null)
  // clears it.
  private dust: DustField | null = null;

  // Per-star A_V cache. Constructed lazily on the first attachDust so a
  // dust-less session pays nothing; null again after attachDust(null).
  private extinctionPrepass: ExtinctionPrepass | null = null;

  // Pure target resolver; the click FSM in onPointerUp + the observe
  // single/double-click dispatchers stay here as composition-layer
  // orchestration.
  readonly picker!: Picker;

  // Per-kind geometry registry (camera/focus/focus-target.ts). Overlays
  // and pickers dispatch `focusables[target.kind].<leg>(target.idx)`
  // instead of per-kind shell methods.
  readonly focusables!: FocusableProviders;

  // Resolves once every boot-time planet system has attached to the
  // body field (Sol today). URL restore awaits it before applying a
  // planet-focus ref — see the constructor's attach block.
  readonly planetSystemsReady!: Promise<void>;

  constructor({ canvas, catalog }: StellataOptions) {
    this.catalog = catalog;

    // Space-motion propagation: advance catalog.positions off the pristine
    // J2016.0 baseline (snapshotted here, kept immutable) to the model clock
    // (getT() — live-now on a bare load; the clock field is initialised
    // before the body runs) before any consumer reads a position.
    // _localPositions, iDistSol, hover/focus/warp targets, constellation
    // lines, binaries baselines, and eclipse photometry all inherit
    // current-epoch positions by construction. maybeReAdvanceEpoch() re-runs
    // the same pass from the same baseline whenever the scrubbed clock
    // crosses a bucket. See docs/science-catalog-ingestion.md
    // § Current-epoch star positions.
    this._basePositions = new Float32Array(catalog.positions);
    this._advancedEpochJyr = bucketEpochJyr(
      jdeToJulianEpochYear(tToJDE(this.getT())),
    );
    advancePositionsToEpoch(
      this._basePositions,
      catalog.velocities,
      this._advancedEpochJyr,
      catalog.positions,
    );
    // How far any star can sit from its load-epoch position over the full
    // clamped scrub range — the widening the load-time sortedDistFromSol
    // windows need to stay correct at any scrubbed t.
    this._maxEpochDriftPc = maxSpeedPcPerYr(catalog.velocities) * Math.max(
      this._advancedEpochJyr - jdeToJulianEpochYear(tToJDE(T_CLAMP_MIN_S)),
      jdeToJulianEpochYear(tToJDE(T_CLAMP_MAX_S)) - this._advancedEpochJyr,
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();

    // Near plane must be strictly smaller than controls.minDistance,
    // otherwise a maximally-zoomed-in body lands on the clip plane and
    // disappears at the closest zoom. The tightest floor is a focused
    // small moon: minOrbitDistForPlanet(Mimas, R≈198 km) ≈ 1.5e-11 pc, so
    // the near plane sits well below that (a larger 1e-10 pc value clipped
    // every sub-Pluto moon at its park distance). logarithmicDepthBuffer
    // keeps depth precision intact across the widened near→far range. Far
    // plane (`CAMERA_FAR_PC`) is paired with `MAX_DISTANCE_PC` so the build
    // filter and camera can never drift; see build-local-group-pure.ts.
    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_FOV,
      window.innerWidth / window.innerHeight,
      1e-12,
      CAMERA_FAR_PC,
    );
    this.camera.position.set(0, 0, 30);

    // TrackballControls (instead of OrbitControls) because we want
    // unconstrained rotation — no polar clamping at the zenith/nadir, so
    // the user can orbit past the poles continuously.
    this.controls = new TrackballControls(this.camera, canvas);
    this.controls.rotateSpeed = 3.0;
    this.controls.zoomSpeed = 1.1;
    this.controls.panSpeed = 0.6;
    this.controls.staticMoving = false;
    this.controls.dynamicDampingFactor = 0.15;
    this.controls.minDistance = GLOBAL_MIN_DIST_PC;
    this.controls.maxDistance = MAX_DISTANCE_PC;
    this.controls.target.set(0, 0, 0);

    // OBSERVE-mode look-around controller. Starts disabled; enable() runs
    // when the camera mode flips, with TrackballControls.enabled toggled
    // off in the same step so the two schemes never compete for input.
    this.observeControls = new ObserveControls(
      canvas,
      this.camera,
      (fov) => this.setCameraFov(fov),
      () => this.camera.fov,
    );

    // Precompute log10(physicalRadius) per star for the shader (vertex
    // attribute decode: pow(10, iLogRadius) → physical radius in pc),
    // and track the catalog-wide max so shouldEnableCoreMask can reason
    // about the largest disc that could appear at close range.
    // Luminosity class is converted from Uint8 to Float32 since the
    // vertex attribute is a float; 255 (unknown) survives the conversion
    // and is handled inside the shader.
    const logRadii = new Float32Array(catalog.count);
    const lumClassF32 = new Float32Array(catalog.count);
    const distSol = new Float32Array(catalog.count);
    const teffApsis = new Float32Array(catalog.count);
    let maxPhysicalRadius = 0;
    for (let i = 0; i < catalog.count; i++) {
      const r = Math.max(catalog.physicalRadius[i], MIN_PHYSICAL_RADIUS_R_SUN);
      logRadii[i] = Math.log10(r);
      if (r > maxPhysicalRadius) maxPhysicalRadius = r;
      lumClassF32[i] = catalog.luminosityClass[i];
      const x = catalog.positions[i * 3];
      const y = catalog.positions[i * 3 + 1];
      const z = catalog.positions[i * 3 + 2];
      distSol[i] = Math.sqrt(x * x + y * y + z * z);
      teffApsis[i] = bestApsisTeff(catalog.teffGspphot[i], catalog.teffGspspec[i]);
    }
    this.maxPhysicalRadiusPc = maxPhysicalRadius * R_SUN_PC;
    // Local-frame position buffer — starts identical to catalog.positions
    // since worldOffset is (0,0,0) at construction. Recenter rewrites this
    // in place.
    this._localPositions = new Float32Array(catalog.positions);
    this._compositeSuppress = new Float32Array(catalog.count);
    this._eclipseDim = new Float32Array(catalog.count).fill(1);
    // Built here (not attachBinaries) because the gate is varType-driven
    // and binary-independent; see the field declaration for the rationale.
    this._suppressPulsation = buildPulsationSuppressMask(catalog.varType);
    // Sort indices by distance from Sol (ascending). The sorted view lets
    // shouldEnableCoreMask() walk only stars whose Sol-distance falls
    // within `[camDistFromSol - dThresh, camDistFromSol + dThresh]` —
    // typically a few-hundred-element window instead of the full catalog.
    this.sortedByDistFromSol = new Uint32Array(catalog.count);
    for (let i = 0; i < catalog.count; i++) this.sortedByDistFromSol[i] = i;
    this.sortedByDistFromSol.sort((a, b) => distSol[a] - distSol[b]);
    this.sortedDistFromSol = new Float32Array(catalog.count);
    for (let i = 0; i < catalog.count; i++) {
      this.sortedDistFromSol[i] = distSol[this.sortedByDistFromSol[i]];
    }
    // Shared uniforms — all three star passes point at the same value
    // objects, so any setFilter / theme / resize update propagates to
    // every pass without duplicate bookkeeping. uRenderMode is the only
    // divergent uniform; StarPipeline binds it per material.
    const sharedUniforms = {
      uCameraPos: { value: new THREE.Vector3() },
      // Seeded from DEFAULT_FILTER; FilterController owns every later
      // write (constructed below, after the layers its side-effect hook
      // touches exist).
      uMaxAppMag: { value: DEFAULT_FILTER.maxAppMag },
      uMinDistSol: { value: DEFAULT_FILTER.minDistSol },
      uMaxDistSol: { value: DEFAULT_FILTER.maxDistSol },
      uSpectMask: { value: DEFAULT_FILTER.spectMask },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uSizeMin: { value: DEFAULT_FILTER.sizeMin },
      uSizeMax: { value: DEFAULT_FILTER.sizeMax },
      uSizeSpan: { value: DEFAULT_FILTER.sizeSpan },
      uMonochrome: { value: 0 },
      // Chart-mode disc sizing. Pixel range + bright-end
      // magnitude reference; vertex shader uses these only when
      // uMonochrome > 0.5. The same constants are read JS-side by
      // chart-labels.ts to size variable rings + binary wings.
      uChartDiscMaxPx: { value: 28.0 },
      uChartDiscMinPx: { value: 1.5 },
      uChartMagBright: { value: -2.0 },
      // Camera vertical FOV in radians, mirrored from camera.fov whenever
      // setCameraFov runs. The shader needs it to convert a star's angular
      // diameter (2·atan(R/d)) into pixels.
      uFovYRad: { value: (this.camera.fov * Math.PI) / 180 },
      // Solar-radii → parsecs conversion for the physical-size formula.
      // catalog.physicalRadius is in solar radii; iLogRadius decodes back
      // to solar radii via pow(10, x); multiply by uRSunPc to get pc.
      uRSunPc: { value: R_SUN_PC },
      uViewport: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      // Peak-disc cap (mirrored to GLSL); single source of truth in the
      // TS-side ZOOM_FLOOR_FRACTION so the shader and the renderedSizePx
      // mirror clamp resolved discs to the same viewport fraction.
      uMaxPhysFrac: { value: ZOOM_FLOOR_FRACTION },
      // Variability clock. Pulsation runs on the model clock (getT()) at
      // real GCVS periods, so it responds to time-warp like binary orbits.
      // uModelDays is model time in days since J2000; uModelDaysPerRealSec
      // is the warp rate (model days per real second), which floors the
      // effective period via uMinPeriodSec so short-period variables can't
      // strobe under heavy warp. Updated per frame from getT() + the clock
      // rate.
      uModelDays: { value: 0 },
      uModelDaysPerRealSec: { value: 1 / 86400 },
      uMinPeriodSec: { value: 4.0 },

      // Star-disc rendering knobs (debug-panel tunable). See star.frag.glsl
      // for what each parameter shapes; defaults here are the calibrated
      // baseline that ships in production.
      uVisibleThreshold: { value: STAR_RENDER_DEFAULTS.visibleThreshold },
      uVisibleK: { value: -Math.log(STAR_RENDER_DEFAULTS.visibleThreshold) },
      uCoreThreshold: { value: STAR_RENDER_DEFAULTS.coreThreshold },
      uDiscardThreshold: { value: STAR_RENDER_DEFAULTS.discardThreshold },
      uDistNMin: { value: STAR_RENDER_DEFAULTS.distNMin },
      uDistNMax: { value: STAR_RENDER_DEFAULTS.distNMax },
      uLumBiasMin: { value: STAR_RENDER_DEFAULTS.lumBiasMin },
      uLumBiasMax: { value: STAR_RENDER_DEFAULTS.lumBiasMax },
      uSizeKnee: { value: STAR_RENDER_DEFAULTS.sizeKnee },

      // Interstellar-dust extinction. Off by default (uDustEnabled = 0) —
      // attachDust() wires in the Data3DTexture progressively as chunks
      // arrive from the network and bumps uDustEnabled to 1 once the
      // texture is GPU-resident. A separate uExtinctionStrength is a
      // user-facing knob (0 = off, 1 = realism, >1 = amplified).
      //
      // The shader reconstructs absolute positions via iPosition +
      // uWorldOffset / uCameraPos + uWorldOffset, then raymarches through
      // the dust texture in ICRS heliocentric pc to integrate A_V.
      uDustTexture: { value: null as THREE.Data3DTexture | null },
      uDustBoundsPc: { value: 1250.0 },
      // Log-window decode: density = uDustDensityMin * exp(sample * uDustLogRatio).
      // Defaults are overwritten by attachDust() with the manifest's
      // autotuned range; this placeholder avoids divide-by-zero if the
      // shader runs before dust attaches.
      uDustDensityMin: { value: 1e-7 },
      uDustLogRatio: { value: Math.log(1e3) },
      uDustAvPerDensityPc: { value: 2.742 },
      uDustEnabled: { value: 0.0 },
      uExtinctionStrength: { value: 1.0 },
      uWorldOffset: { value: new THREE.Vector3() },
      // Per-star A_V prepass consumers — owned by ExtinctionPrepass
      // (constructed on attachDust); the vertex shader falls back to the
      // in-vertex raymarch while uAvPrepassEnabled is 0.
      uAvPrepassTex: { value: null as THREE.Texture | null },
      uAvPrepassEnabled: { value: 0.0 },
      // OBSERVE-mode focal-star suppression. Set to the focused-star catalog
      // index when the camera is parked on it; -1 disables the gate. All
      // three star passes (disc, glow, core mask) share these uniforms so
      // the suppression fires uniformly.
      uHideFocusIdx: { value: -1 },
      // Member stars of the active local-depth clusters; a member's
      // main-pass instance collapses and the pass's mirror draws render
      // it. Written per frame by StarLocalCluster.update. -1 = empty slot.
      uLocalMemberIdx: { value: new Int32Array(MIRROR_CAPACITY).fill(-1) },
      // Blackbody → sRGB lookup for the star vertex shader's ciToColor.
      // See docs/science-stellar-modelling.md § "Star colour calibration".
      uColorLut: { value: makeColorLutTexture() },
      // Force-center the focused star at NDC (0,0). At the close-approach
      // orbit floor (~5×10⁻⁸ pc for Sol-class stars), float32 cancellation
      // in projectionMatrix * modelViewMatrix * (0,0,0,1) can drift the
      // projected center by visible pixels even though the star is
      // mathematically at view-origin (controls.target = star, lookAt
      // aligns -Z with target). This uniform names the instance to pin;
      // the shader replaces its centreClip with projectionMatrix *
      // (0, 0, -distCam, 1) to bypass the cancellation. -1 disables.
      // Updated each frame in animate() since pan can move target away.
      uPinFocusToCenter: { value: -1 },
    } satisfies PerceptualDiscUniforms & Record<string, THREE.IUniform>;

    this.starPipeline = new StarPipeline({
      scene: this.scene,
      catalog,
      logRadii,
      lumClassF32,
      distSol,
      teffApsis,
      localPositions: this._localPositions,
      compositeSuppress: this._compositeSuppress,
      eclipseDim: this._eclipseDim,
      suppressPulsation: this._suppressPulsation,
      vertexShader,
      fragmentShader,
      sharedUniforms,
      boundingSphereRadiusPc: 60_000,
    });

    this.starLocalMirror = new StarLocalMirror(
      this.starPipeline.geometry,
      vertexShader,
      fragmentShader,
      sharedUniforms,
    );

    // Star-material uniforms passed by reference so floating-origin
    // recenters, resize updates, and dust loads propagate to the
    // particle pass automatically.
    this.dustParticles = new DustParticleLayer(
      this.scene,
      this.starPipeline.discMaterial.uniforms as unknown as DustParticleSharedUniforms,
    );

    // Galactic reference layers — disc is always added; grid hides itself
    // until enabled. The HUD (ring + Sol/GC arrows) is pure SVG inside the
    // existing #overlay so it shares the distance vector's stroke + halo
    // styling and inherits the `body.warping` hide rule for free.
    this.galacticDisc = new GalacticDisc();
    this.scene.add(this.galacticDisc.group);
    this.orbitRingsLayer = new OrbitRingsLayer();
    this.binaryOrbitPathLayer = new BinaryOrbitPathLayer();
    this.starLocalCluster = new StarLocalCluster(
      this.starLocalMirror,
      this.binaryOrbitPathLayer,
      sharedUniforms.uLocalMemberIdx as { value: Int32Array },
      {
        catalog,
        localPositions: () => this._localPositions,
        renderedSizeComponents: (idx, out) => this.renderedSizeComponentsFor(idx, out),
        forEachStarNearCamera: (d, cb) => this.forEachStarNearCamera(d, cb),
        // Membership needs physSize ≥ PHYS_RATIO_THRESHOLD × pxSize with
        // pxSize ≥ RESOLVED_DISC_MIN_PX, so the widest useful window is
        // where the largest star's disc crosses the product.
        scanWindowPc: () =>
          this.discWindowFromUniformsPc(RESOLVED_DISC_MIN_PX * PHYS_RATIO_THRESHOLD),
      },
    );
    this.localDepthPass.register(this.starLocalCluster);
    this.constellationFigureLayer = new ConstellationFigureLayer();
    this.scene.add(this.constellationFigureLayer.group);
    this.planetBodyField = new PlanetBodyField(sharedUniforms);
    this.scene.add(this.planetBodyField.group);
    this.planetMeshLayer = new PlanetMeshLayer(
      this.planetBodyField,
      import.meta.env.BASE_URL,
    );
    this.solarCluster = new SolarSystemCluster(
      this.planetBodyField,
      this.planetMeshLayer,
      this.orbitRingsLayer,
      this.starLocalCluster,
    );
    this.localDepthPass.register(this.solarCluster);
    // Heliopause is Sol-anchored — added once, visibility gated on
    // focused star = Sol OR the heliopause itself being the focus target
    // (updateHeliopauseVisibility, wired below).
    this.heliopause = new Heliopause();
    this.scene.add(this.heliopause.group);
    if (catalog.solIndex >= 0) {
      const si = catalog.solIndex;
      const solAbs = new THREE.Vector3(
        catalog.positions[si * 3],
        catalog.positions[si * 3 + 1],
        catalog.positions[si * 3 + 2],
      );
      this.shells.register('heliopause', {
        label: HELIOPAUSE_LABEL,
        sid: SHELL_OBJECT_SIDS.heliopause,
        card: HELIOPAUSE_CARD,
        centerAbsInto: (out) => {
          out.copy(solAbs);
          return true;
        },
        extentPc: () => HELIOPAUSE_EXTENT_PC,
        pick: {
          labelElementId: HELIOPAUSE_LABEL_ELEMENT_ID,
          visible: () => this.heliopause.isVisible(),
          sampleCount: () => HELIOPAUSE_SAMPLE_POINTS_SOL.length,
          sampleLocalInto: (i, worldOffset, out) =>
            void out.copy(HELIOPAUSE_SAMPLE_POINTS_SOL[i]).sub(worldOffset),
        },
      });
    }
    this.localBubbleShell = new LocalBubbleShell();
    this.scene.add(this.localBubbleShell.group);
    this.localBubbleShell.recenter(this.worldOffset);

    // Picker resolves every layer's "what's under (x, y)?" — composed
    // by the click FSM in onPointerUp and by the hover providers.
    // Layers that attach asynchronously (clouds, Local Group) are
    // read through getters so Picker sees them as soon as they land.
    // `picker` is `readonly` — assigned via writable cast since field
    // initialisation in TS requires bypassing the readonly guard here.
    (this as { picker: Picker }).picker = new Picker({
      domElement: this.renderer.domElement,
      camera: this.camera,
      catalog: this.catalog,
      sortedByDistFromSol: this.sortedByDistFromSol,
      sortedDistFromSol: this.sortedDistFromSol,
      getLocalPositions: () => this._localPositions,
      getFilter: () => this.filter,
      getClouds: () => this.clouds,
      getLocalGroupLayer: () => this.localGroupLayer,
      getShells: () => this.shells,
      getPlanetBodyField: () => this.planetBodyField,
      getWorldOffset: () => this.worldOffset,
      getWarpActive: () => this.warp.isActive(),
      renderedSizePxFn: (idx) => this.renderedSizePxFor(idx),
      resolveCollapsedLead: (idx) => this.collapsedClusterLead(idx),
      fovYRadRef: this.starPipeline.discMaterial.uniforms.uFovYRad as { value: number },
      viewportRef: this.starPipeline.discMaterial.uniforms.uViewport as { value: THREE.Vector2 },
    });
    // The warp / focus-lerp / observe-transition busy checks stay on
    // stellata's aimAt dispatcher because they gate behaviour the
    // controller doesn't know about.
    this.aim = new AimController({
      camera: this.camera,
      controls: this.controls,
      observeControls: this.observeControls,
      getCameraMode: () => this.focus.getCameraMode(),
    });
    // FocusController implements the FocusOps / ObserveFocusOps
    // surfaces consumed by WarpController + ObserveTransition.
    // getWarp / getObserve are lazy because those controllers depend
    // back on FocusController — the construct cycle is broken by
    // deferred resolution at first request.
    this.focus = new FocusController({
      camera: this.camera,
      controls: this.controls,
      observeControls: this.observeControls,
      catalog: this.catalog,
      bus: this.bus,
      frameAnchor: this,
      aim: this.aim,
      setFocalBodyHidden: (target) => this.setFocalBodyHidden(target),
      getClouds: () => this.clouds,
      getLocalGroup: () => this.localGroupLayer,
      getShells: () => this.shells,
      getPlanetField: () => this.planetBodyField,
      getWarp: () => this.warp,
      getObserve: () => this.observe,
      getFocusables: () => this.focusables,
      focalPerturbationInto: (idx, out) =>
        this.binaryOrbitField?.focalPerturbationInto(idx, this.getT(), out) ?? false,
    });
    // Kind-agnostic geometry registry — the shell's per-kind knowledge
    // in one exhaustive record. Lazily-attached layers are read through
    // the private per-kind helpers' getters, so attach cycles need no
    // re-registration. See camera/focus/README.md § FocusableProviders.
    (this as { focusables: FocusableProviders }).focusables = {
      star: {
        localPositionInto: (idx, out) => {
          if (idx < 0 || idx >= this.catalog.count) return false;
          this.starLocalPositionInto(idx, out);
          return true;
        },
        focusParkDistance: (idx) => this.focus.parkDistForStar(idx),
        arrivalRadiusPc: (idx) =>
          Math.max(this.catalog.physicalRadius[idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC,
        renderedSizePx: (idx) => this.renderedSizePxFor(idx),
      },
      cloud: {
        localPositionInto: (idx, out) => this.cloudLocalPositionInto(idx, out),
        focusParkDistance: (idx) => {
          const cloud = this.clouds?.clouds[idx];
          if (!cloud) return 0;
          return parkDistance({
            R_pc: Math.max(cloud.axes[0], cloud.axes[1], cloud.axes[2]),
            dMinFloor: cloudViewingDistancePc(cloud),
          });
        },
        arrivalRadiusPc: () => null,
        renderedSizePx: (idx) => this.renderedCloudSizePx(idx),
      },
      lg: {
        localPositionInto: (idx, out) => this.lgLocalPositionInto(idx, out),
        focusParkDistance: (idx) => {
          const obj = this.localGroupLayer?.objects[idx];
          if (!obj) return 0;
          return parkDistance({
            R_pc: maxSemiAxisPc(obj),
            dMinFloor: lgViewingDistancePc(obj),
          });
        },
        arrivalRadiusPc: () => null,
        renderedSizePx: (idx) => this.renderedLgSizePx(idx),
      },
      shell: {
        localPositionInto: (idx, out) => this.shells.localPositionInto(idx, this.worldOffset, out),
        focusParkDistance: (idx) => this.shells.focusParkDistancePc(idx),
        arrivalRadiusPc: () => null,
        renderedSizePx: (idx) =>
          this.shells.renderedSizePx(idx, this.worldOffset, this.camera.position, this.angularToPx()),
      },
      planet: {
        localPositionInto: (idx, out) =>
          this.planetBodyField.planetLocalPositionInto(idx, out),
        focusParkDistance: (idx) => {
          const p = this.planetBodyField.planetAt(idx);
          if (!p) return 0;
          return starPhysics.parkDistForPlanet(
            p.radiusKm * KM_PC,
            starPhysics.fovMinorRad(this.camera),
          );
        },
        arrivalRadiusPc: (idx) => {
          const p = this.planetBodyField.planetAt(idx);
          return p ? p.radiusKm * KM_PC : null;
        },
        renderedSizePx: (idx) =>
          this.planetBodyField.renderedPlanetSizePx(idx, this.camera.position),
      },
    };
    this.warp = new WarpController({
      camera: this.camera,
      controls: this.controls,
      observeControls: this.observeControls,
      setFocalBodyHidden: (target) => this.setFocalBodyHidden(target),
      bus: this.bus,
      getCameraMode: () => this.focus.getCameraMode(),
      isChartMode: () => this.filter.chart,
      getChartMagBright: () =>
        this.starPipeline.discMaterial.uniforms.uChartMagBright.value as number,
      focus: this.focus,
    });
    this.observe = new ObserveTransition({
      camera: this.camera,
      controls: this.controls,
      observeControls: this.observeControls,
      aim: this.aim,
      setFocalBodyHidden: (target) => this.setFocalBodyHidden(target),
      bus: this.bus,
      focus: this.focus,
      getCameraMode: () => this.focus.getCameraMode(),
      setCameraModeValue: (mode) => this.focus.setCameraModeValue(mode),
    });
    // Orbit rings + heliopause are representational layers gated on
    // host-focus. Planet bodies live in PlanetBodyField and render
    // whenever inside the per-host cull distance regardless of focus.
    this.on('planetSystem', (ps) => {
      this.orbitRingsLayer.setPlanetSystem(ps, this.catalog.solIndex, this.getT());
      this.updateHeliopauseVisibility();
    });
    // The heliopause shows when Sol's system is focused OR when the
    // heliopause itself is the focus target (so focusing it as an object
    // from any vantage reveals it). Both conditions derive from focus
    // state, so one predicate re-evaluated on every focus mutation.
    this.on('focus', () => this.updateHeliopauseVisibility());
    // Orbit paths rebuild on every focus mutation: the focused system's
    // Kepler pairs, or none when focus leaves a multi-star system.
    this.on('focus', () => {
      this.binaryOrbitPathLayer.setSystem(
        this.binariesData,
        this.focus.getFocusedStar(),
        this.catalog.positions,
      );
    });
    // Reseed the planet-focal ride on every focus mutation: focus
    // change AND same-planet refocus both recentre the floating origin,
    // which stales the ride's cached last position (hostLocalPos moved
    // under it). The seed frame re-snaps against the fresh frame.
    this.on('focus', () => { this._planetRideIdx = null; });
    // Constellation figure lines rebuild when the active set changes: the
    // highlighted figure, chart ↔ navigate (chart draws all 88), or the
    // showConstellation master toggle. Detail-cycle permission is a separate
    // push (buildSceneElementBinds).
    this.on('filter', () => this.refreshConstellationFigure());
    this.on('cameraMode', () => this.refreshConstellationFigure());
    // Attach Sol's planet system to the global body field once at
    // startup. Bodies render from now on independent of focus, gated
    // only by apparent-mag visibility + the per-host distance cull.
    // `planetSystemsReady` resolves once the attach table is populated
    // — URL planet-focus restore awaits it (the attach lands on a
    // microtask, after this constructor but potentially after a
    // synchronous applyFromUrl would have run).
    if (catalog.solIndex >= 0 && hasPlanets(catalog, catalog.solIndex)) {
      const solIdx = catalog.solIndex;
      const solAbs = new THREE.Vector3(
        catalog.positions[solIdx * 3],
        catalog.positions[solIdx * 3 + 1],
        catalog.positions[solIdx * 3 + 2],
      );
      this.planetSystemsReady = getPlanetSystem(catalog, solIdx).then((ps) => {
        if (ps !== null) {
          this.planetBodyField.attachHost(
            solIdx,
            ps,
            catalog.absmag[solIdx],
            Math.max(catalog.physicalRadius[solIdx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC,
            solAbs,
            solIdx,
            this.getT(),
          );
        }
      });
    } else {
      this.planetSystemsReady = Promise.resolve();
    }
    this.galacticGrid = new GalacticGrid();
    this.scene.add(this.galacticGrid.group);
    const hudRing = document.getElementById('hud-ring') as unknown as SVGCircleElement;
    const solPath = document.getElementById('sol-arrow') as unknown as SVGPathElement;
    const solBg = document.getElementById('sol-arrow-bg') as unknown as SVGPathElement;
    const gcPath = document.getElementById('gc-arrow') as unknown as SVGPathElement;
    const gcBg = document.getElementById('gc-arrow-bg') as unknown as SVGPathElement;
    const solLabel = document.getElementById('sol-arrow-label') as unknown as SVGTextElement;
    const gcLabel = document.getElementById('gc-arrow-label') as unknown as SVGTextElement;
    // Clicking either label aims the camera at the named object. Sol's
    // local-frame position is just `-worldOffset` (Sol is the catalog
    // origin); GC sits at GALACTIC_CENTRE_PC in absolute space. Handlers are
    // owned by HudOverlay so its dispose() can detach them.
    this.hudOverlay = new HudOverlay(
      hudRing, solPath, solBg, gcPath, gcBg, solLabel, gcLabel,
      () => this.aimAt(this.tmpVec3b.copy(this.worldOffset).negate()),
      () => this.aimAt(this.tmpVec3b.copy(GALACTIC_CENTRE_PC).sub(this.worldOffset)),
    );

    // Milky Way volumetric disc. A flattened ellipsoid mesh anchored at
    // the galactic centre; the fragment shader does a bounded raymarch
    // through its volume. renderOrder = -3 keeps it behind every other
    // layer. The shared uniforms map carries `uMaxAppMag` and `uSizeSpan`
    // from the star pipeline so the magnitude filter applies identically
    // to discrete stars and the diffuse glow.
    this.milkyway = new MilkyWay({
      uMaxAppMag: sharedUniforms.uMaxAppMag,
      uSizeSpan: sharedUniforms.uSizeSpan,
    });
    this.scene.add(this.milkyway.group);

    this.filters = new FilterController({
      camera: this.camera,
      uniforms: sharedUniforms,
      bus: this.bus,
      onFilterApplied: (f) => {
        // Per-host distance cull on the planet body field is closed-form
        // in maxAppMag — refresh the cached cullDistancePc whenever the
        // slider moves so distant hosts stay culled at the new threshold.
        this.planetBodyField.setMaxAppMag(f.maxAppMag);
        // Effective = detail permission AND the user's own toggle.
        this.applyMilkywayEnabled();
        this.applyLgEmissionEnabled();
      },
      refreshOrbitFloor: () => this.focus.refreshOrbitFloor(),
      sceneElementBinds: this.buildSceneElementBinds(),
    });

    // Engage focus on Sol if it exists so measurement and per-star zoom
    // work from the start. setFocus (rather than raw field assignment)
    // wires up controls.minDistance to the per-star orbit floor and
    // snaps controls.target to local (0,0,0) — without this, the
    // unfocused GLOBAL_MIN_DIST_PC clamp set above stays in place AND
    // the pin guard fails because Sol's catalog position is
    // (5e-6, 0, 0) pc (not exactly zero), so recenterOrigin shifts
    // target by 5e-6 and breaks the lengthSq < 1e-12 invariant. Safe
    // at this point in the constructor: handlers aren't subscribed yet
    // and camera/aspect are already initialised.
    if (catalog.solIndex >= 0) {
      this.focus.setFocus(catalog.solIndex);
    }
    // Seed the constellation figure now that filters + focus are live (its
    // handlers only fire on later mutations; a URL restore emits 'filter').
    this.refreshConstellationFigure();
    // No camera-position park here. The bare-URL pose is fully owned by
    // first-load.ts (`applyFirstLoadView`) and `?v=` URLs apply their
    // own cam — both run before first paint in main.ts.

    // Compute initial pixel sizes for the active preset against the real
    // viewport. DEFAULT_FILTER carries placeholder pixel values; this call
    // replaces them with the right numbers before the first frame.
    this.filters.recomputePresetPxSizes();

    this.poiStore = new PoiStore({
      pinnable: {
        star: (idx) => idx >= 0 && idx < catalog.count && catalog.sid[idx] !== 0,
        // Pinnable ⊇ URL-encodable: any attached planet pins in-session,
        // but only Sol's SID domain is wired (main.ts planetDomainIndexOf),
        // so a future non-Sol host's pin works live yet won't round-trip
        // through ?v=.
        planet: (idx) => this.planetBodyField.planetAt(idx) !== null,
        lg: (idx) => (this.localGroupLayer?.objects[idx]?.sid ?? 0) !== 0,
        shell: (idx) => (this.shells.at(idx)?.sid ?? 0) !== 0,
        cloud: () => false,
      },
      onChange: (pois) => {
        this.bus.emit('pois', pois);
        this.bus.emit('state');
      },
    });

    this.frameCtx = {
      camera: this.camera,
      worldOffset: this.worldOffset,
      distFromSol: 0,
      t: 0,
      warpActive: false,
    };
    this.registerSceneLayers();
    this.attachEvents();
    this.animate();
  }

  // Reference layers (galactic disc, LG wireframe): hidden during warp,
  // else distance-faded. Shared update body; null layer → no-op so a
  // lazily-attached layer registers unconditionally.
  private updateWarpGatedRefLayer(
    layer: {
      group: { visible: boolean };
      update: (worldOffset: THREE.Vector3, distFromSol: number) => void;
    } | null,
    ctx: FrameCtx,
    permitted: boolean,
  ): void {
    if (!layer) return;
    // Detail-cycle permission (representational floor) AND's with the warp
    // gate; either false hides the group.
    if (ctx.warpActive || !permitted) {
      layer.group.visible = false;
      return;
    }
    layer.update(ctx.worldOffset, ctx.distFromSol);
  }

  // Rebuild the constellation figure geometry for the active set: the
  // highlighted figure, all 88 in chart mode, or none. Skips the rebuild when
  // the active set is unchanged (filter emits fire on every slider drag).
  private refreshConstellationFigure(): void {
    const f = this.filter;
    const chartActive = f.chart && this.focus.getCameraMode() === 'observe';
    const sig = `${f.showConstellation ? 1 : 0}|${chartActive ? 1 : 0}|${f.highlightCon}`;
    if (sig === this.conFigureSig) return;
    this.conFigureSig = sig;
    let indices: number[];
    if (!f.showConstellation) {
      indices = [];
    } else if (chartActive) {
      indices = this.catalog.constellations.map((_, i) => i);
    } else if (f.highlightCon >= 0) {
      indices = [f.highlightCon];
    } else {
      indices = [];
    }
    this.constellationFigureLayer.setFigures(
      this.catalog.constellations, indices, this._localPositions);
  }

  // One adapter entry per scene layer; registration order is per-frame
  // update order. Lazily-attached layers are read through closures so
  // attach/replace cycles need no re-registration. Warp gating is
  // per-entry: reference layers hide during warp, physical/light layers
  // keep ticking (clouds stay visible during warp by design — flying
  // past Taurus is a feature). See scene/README.md.
  private registerSceneLayers(): void {
    this.layers.register({
      update: (ctx) => {
        this.planetBodyField.update(ctx.camera, ctx.t, performance.now());
        // Ride runs right after the field wrote this frame's positions,
        // mirroring the binary ride's placement after its orbit walk.
        this.applyPlanetFocalRide();
        // Mesh LOD reads the field's freshly-written positions; its
        // group mirrors the field's visibility, so monochrome/hidden
        // need no second hook here.
        this.planetMeshLayer.update(ctx.camera, ctx.t);
      },
      setMonochrome: (on) => this.planetBodyField.setMonochrome(on),
      recenter: (newOrigin) => this.planetBodyField.recenter(newOrigin),
      dispose: () => {
        this.planetBodyField.dispose();
        this.planetMeshLayer.dispose();
      },
    });
    this.layers.register({
      // AFTER the body field: a moon ring's centre is the parent's
      // live iLocalRel — reading it before the field's walk left the
      // rings one frame of sim-time behind the bodies, a visible lag
      // under fast scrub.
      update: (ctx) => {
        const ps = this.focus.getFocusedPlanetSystem();
        const hostPos = ps !== null
          && this.planetBodyField.getHostLocalPositionInto(ps.hostStarIdx, this.tmpHostLocal)
          ? this.tmpHostLocal : null;
        this.orbitRingsLayer.update(
          ctx.camera,
          window.innerHeight,
          hostPos,
          ctx.t,
          (planetIdx, out) => {
            if (ps === null) return false;
            const flat = this.planetBodyField.instanceIndexOf(ps.hostStarIdx, planetIdx);
            return flat !== null
              && this.planetBodyField.planetHostRelPositionInto(flat, out);
          },
        );
      },
      setMonochrome: (on) => this.orbitRingsLayer.setMonochrome(on),
      dispose: () => this.orbitRingsLayer.dispose(),
    });
    this.layers.register({
      // After the field + rings updates it reads; before the main
      // render its suppression uniforms gate. Owns no GPU resources —
      // the star mirror it feeds is disposed with the star cluster.
      update: (ctx) => this.solarCluster.update(ctx.camera),
      dispose: () => {},
    });
    this.layers.register({
      update: (ctx) => {
        this.updateBinaryOrbits();
        // After the walk wrote this frame's slots, so each path rides its
        // pair's live barycentre drift.
        this.binaryOrbitPathLayer.update(this._localPositions, ctx.camera, window.innerHeight);
      },
      recenter: (newOrigin) => this.binaryOrbitField?.recenter(newOrigin),
      dispose: () => {
        this.binaryOrbitField?.dispose();
        this.eclipsePhotometryField?.dispose();
        this.binaryOrbitPathLayer.dispose();
      },
    });
    this.layers.register({
      // After the binary walk + eclipse photometry + path-layer update:
      // membership reads this frame's positions and path visibility, and
      // the mirror sync re-copies the slots those fields just wrote.
      update: (ctx) => this.starLocalCluster.update(ctx.camera, {
        monochrome: this.monochrome,
        focalIdx: this.focus.getFocusedStar(),
        maxAppMag: this.filter.maxAppMag,
      }),
      dispose: () => this.starLocalCluster.dispose(),
    });
    this.layers.register({
      // After the binary + planet walks so a figure vertex that is a binary
      // member re-copies its live slot (orbital motion under scrub, epoch
      // advance, recentre — all land in localPositions with no separate signal).
      update: () => this.constellationFigureLayer.update(this._localPositions),
      setMonochrome: (on) => this.constellationFigureLayer.setMonochrome(on),
      dispose: () => this.constellationFigureLayer.dispose(),
    });
    this.layers.register({
      update: (ctx) => this.updateWarpGatedRefLayer(
        this.galacticDisc, ctx, this.detailPermits('galacticDiscWireframe')),
      setMonochrome: (on) => this.galacticDisc.setMonochrome(on),
      dispose: () => this.galacticDisc.dispose(),
    });
    this.layers.register({
      update: (ctx) => this.updateWarpGatedRefLayer(
        this.localGroupLayer, ctx, this.detailPermits('lgWireframes')),
      setMonochrome: (on) => this.localGroupLayer?.setMonochrome(on),
      dispose: () => this.localGroupLayer?.dispose(),
    });
    this.layers.register({
      update: (ctx) => {
        if (!ctx.warpActive && this.filter.showGalacticGrid) {
          this.galacticGrid.group.visible = true;
          this.galacticGrid.update(ctx.camera.position);
        } else {
          this.galacticGrid.group.visible = false;
        }
      },
      setMonochrome: (on) => this.galacticGrid.setMonochrome(on),
      dispose: () => this.galacticGrid.dispose(),
    });
    this.layers.register({
      update: (ctx) => this.updateHud(ctx.warpActive),
      setMonochrome: (on) => this.hudOverlay.setMonochrome(on),
      dispose: () => this.hudOverlay.dispose(),
    });
    this.layers.register({
      // Layer shelved (CLAUDE.md): visible=false. Flip to true (or
      // restore a FilterState flag) when re-enabling.
      update: (ctx) => this.clouds?.update(ctx.worldOffset, false),
      setMonochrome: (on) => this.clouds?.setMonochrome(on),
      dispose: () => this.clouds?.dispose(),
    });
    this.layers.register({
      // Re-anchors the skybox mesh to camera.position and refreshes the
      // absolute-camera uniform for the raymarch. Visible during warp.
      update: (ctx) => this.milkyway.update(ctx.camera, ctx.worldOffset),
      dispose: () => this.milkyway.dispose(),
    });
    this.layers.register({
      update: (ctx) => this.lgEmission?.update(ctx.worldOffset),
      setMonochrome: (on) => this.lgEmission?.setChartHidden(on),
      dispose: () => this.lgEmission?.dispose(),
    });
    this.layers.register({
      // Visibility is event-driven (host focus), no per-frame update.
      setMonochrome: (on) => this.heliopause.setMonochrome(on),
      recenter: (newOrigin) => this.heliopause.recenter(newOrigin),
      dispose: () => this.heliopause.dispose(),
    });
    this.layers.register({
      // Static shell — only the floating-origin recentre moves it.
      setMonochrome: (on) => this.localBubbleShell.setMonochrome(on),
      recenter: (newOrigin) => this.localBubbleShell.recenter(newOrigin),
      dispose: () => this.localBubbleShell.dispose(),
    });
    this.layers.register({
      dispose: () => this.dustParticles.dispose(),
    });
  }

  /** Subscribe to any event in `StellataEventMap`. Returns an unsubscribe
   *  function. Payload type is inferred from the event name; payload-less
   *  events (`'state'`, `'frame'`) are called without a payload arg. */
  on<K extends keyof StellataEventMap>(
    name: K,
    handler: (payload: StellataEventMap[K]) => void,
  ): () => void {
    return this.bus.on(name, handler);
  }
  getFocusedStar(): number | null { return this.focus.getFocusedStar(); }
  /** Focused object of any kind, or null. Kind-dispatching consumers
   *  pair this with `focusables[kind]`; star-only affordances keep
   *  guarding on `getFocusedStar()`. */
  getFocusedTarget(): Target | null { return this.focus.getFocusedTarget(); }
  /** Focused hard-kind (star / planet) Target, or null when the focus is
   *  empty or soft. Pairs with `focalLocalPositionInto` for overlays that
   *  anchor on the focused object regardless of kind. */
  getFocusedHardTarget(): Target | null { return this.focus.getFocusedHardTarget(); }
  /** Focused object's live local position (any hard kind) into `out`;
   *  false when no hard focus is set. Kind-generic — overlays anchoring
   *  on "the focused object" use this, never a star-only buffer read. */
  focalLocalPositionInto(out: THREE.Vector3): boolean {
    return this.focus.focalLocalPositionInto(out);
  }
  /** Planet system for the currently focused star, or null if the focus
   *  has none (or has not finished loading). The solar-system rendering
   *  layer gates on this — renderers also subscribe to
   *  the 'planetSystem' event to react to focus swaps. */
  getFocusedPlanetSystem(): PlanetSystem | null { return this.focus.getFocusedPlanetSystem(); }
  /** True when planet orbit rings OR binary orbit paths are currently
   *  circumscribing the focus — either already marks the focal object, so
   *  the focus ring suppresses itself. Frame-coherent — the scene-layer
   *  update fan-out runs before `'frame'` event handlers, so overlays
   *  driven by the frame loop (focus ring, etc.) read current-frame data. */
  anyOrbitRingVisible(): boolean {
    return this.orbitRingsLayer.anyOrbitRingVisible()
      || this.binaryOrbitPathLayer.anyOrbitRingVisible();
  }
  /** Renderer-local positions of the focused host's planets (xyz
   *  triples, length 3·N), or null if no system is attached. Host
   *  offset is applied — under planet focus the host is not at the
   *  local origin. Returns a fresh Float32Array copy each call (see
   *  `PlanetBodyField.getHostLocalPositions`) — safe to cache across
   *  frames; the value semantics survive attach grow / detach shift. */
  getFocusedPlanetLocalPositions(): Float32Array | null {
    const ps = this.focus.getFocusedPlanetSystem();
    if (!ps) return null;
    const rel = this.planetBodyField.getHostLocalPositions(ps.hostStarIdx);
    if (!rel) return null;
    if (!this.planetBodyField.getHostLocalPositionInto(ps.hostStarIdx, this.tmpHostLocal)) {
      return null;
    }
    for (let i = 0; i < rel.length; i += 3) {
      rel[i] += this.tmpHostLocal.x;
      rel[i + 1] += this.tmpHostLocal.y;
      rel[i + 2] += this.tmpHostLocal.z;
    }
    return rel;
  }
  /** True when the orbit ring for planet `i` is currently rendering on
   *  the focused host. Used by planet-labels to hide labels in lockstep
   *  with their associated rings — the body stays rendered (subject to
   *  apparent-mag visibility) regardless. */
  isOrbitRingVisible(planetIdx: number): boolean {
    return this.orbitRingsLayer.isOrbitRingVisible(planetIdx);
  }
  /** Rendered disc radius (CSS px) of the focused object, any kind; 0
   *  when nothing is focused. Single source for the arrow-fade coverage
   *  inputs (HUD Sol/GC pair, POI arrows). */
  getFocusedDiscRadiusPx(): number {
    const t = this.focus.getFocusedTarget();
    if (t?.kind === 'star') {
      return starPhysics.renderedDiscPxAtPeak({
        catalog: this.catalog,
        idx: t.idx,
        camPos: this.camera.position,
        localPositions: this._localPositions,
        uniforms: this.starPipeline.discMaterial.uniforms as unknown as starPhysics.StarPhysicsUniforms,
      }) * 0.5;
    }
    if (t?.kind === 'planet') {
      return this.planetBodyField.renderedPlanetSizePx(t.idx, this.camera.position) * 0.5;
    }
    return 0;
  }
  /** Absolute-space coordinate of the renderer's current local origin.
   *  Read-only snapshot; callers must not mutate. URL serialisation
   *  emits this so close-orbit unfocus poses (where worldOffset sits at
   *  the former focal star, not Sol — see the close-orbit unfocus contract) round-trip
   *  exactly through the float32 cam/tgt fields. */
  getWorldOffset(): Readonly<THREE.Vector3> { return this.worldOffset; }
  /** Shift the floating origin to a new absolute position. Star instance
   *  positions, camera, and controls.target are translated to preserve
   *  the user-visible pose; subsequent rendering operates in the new
   *  local frame. URL loading uses this to restore a saved worldOffset
   *  before applying cam/tgt (which then overwrite the camera/target
   *  translations the recentre produced). */
  setWorldOffset(absX: number, absY: number, absZ: number): void {
    this.recenterOrigin(this.tmpRecenter.set(absX, absY, absZ));
  }
  /** Distance-vector destination of any kind, or null. */
  getVectorTarget(): Target | null { return this.focus.getVectorTarget(); }

  /** Virtual clock backing `getT()`; the debug time-scrubber drives it. */
  get timeClock(): VirtualClock { return this.clock; }

  /** Virtual-clock `t` (Unix-seconds) driving the solar-system layer.
   *  Recomputed on every call — callers that need a frame-stable value
   *  should snapshot at the start of the frame. */
  getT(): number {
    return this.clock.getT();
  }
  /** Freeze `t` at a specific Unix-seconds value (URL-restore of a
   *  scrubbed view), or pass `null` to return to live tracking. */
  setT(t: number | null): void {
    if (t === null) {
      this.clock.reset();
    } else {
      this.clock.setRate(0);
      this.clock.setTimeAbsolute(t);
    }
    this.bus.emit('state');
  }
  getMonochrome(): boolean { return this.monochrome; }
  getWarpActive(): boolean { return this.warp.isActive(); }

  /** Jump to the end state of an in-flight warp. Equivalent to letting
   *  the animation run to completion. No-op when idle. Thin shim over
   *  WarpController. */
  skipWarp(): void { this.warp.skip(); }

  /** Read-only snapshot of in-flight warp state for the debug-panel
   *  warp tuning readout. Thin shim over WarpController.getWarpPhase. */
  getWarpPhase(): WarpPhaseInfo | null { return this.warp.getWarpPhase(); }

  /** Warp endpoints + destination identity for read-only consumers (e.g.
   *  the scale-bar focus indicator). B is a shared scratch slot owned by
   *  WarpController. Callers must NOT mutate either, and must not retain
   *  B across frames. Thin shim over WarpController.getWarpInfo. */
  getWarpInfo(): WarpInfo | null { return this.warp.getWarpInfo(); }

  getCameraMode(): CameraMode { return this.focus.getCameraMode(); }
  // True when an observe-mode transition (enter or exit) is in flight.
  // The 'unfocus' kind is excluded — it reuses the controller's state slot
  // for a navigate-mode lerp and shouldn't surface to UI/overlay code
  // gating on observe-mode visibility.
  isObserveTransitionActive(): boolean { return this.observe.isActive(); }

  // True whenever a camera-position lerp is in flight — warp, observe
  // enter/exit, OR the navigate-mode unfocus zoom-out. URL-state writes
  // gate on this to avoid serialising transient mid-lerp poses; the end
  // of each animation schedules a final write with the settled pose.
  isCameraTransitionActive(): boolean {
    return this.warp.isActive() || this.observe.isAnyActive();
  }

  /** True while *any* camera-driving animation is in flight: warp,
   *  aim-slerp, focus-park lerp, OR an observe transition (enter / exit /
   *  navigate-close-zoom unfocus). Sites that need a uniform "the camera
   *  is currently animating" gate should call this. Several call sites in
   *  this file deliberately use a narrower predicate — those are
   *  intentional: focus-change can interrupt aim but not warp, cosmetic
   *  cloud picking is suppressed during warp only, etc. */
  isCameraBusy(): boolean { return this.focus.isCameraBusy(); }

  // Cancellation hooks for the focus-park lerp) and the
 // navigate-mode unfocus lerp — both must clear before a new
  // camera-changing action (focus, warp, aim, click) proceeds. Forward
  // to FocusController which owns the focus-park slot and delegates the
  // unfocus path to ObserveTransition.
  cancelFocusLerp() { this.focus.cancelFocusLerp(); }
  cancelUnfocusLerp() { this.focus.cancelUnfocusLerp(); }

  /** Threshold squared-length below which `controls.target` engages the
   *  focused-star pin. Surfaced for the pin debug HUD so the displayed
   *  rule matches the runtime constant exactly. */
  getPinEngageThresholdSq(): number { return this.focus.getPinEngageThresholdSq(); }

  /** Whether the focused-star pin (uPinFocusToCenter) would engage right
   *  now, mirroring the per-frame guard in animate(). Read by the pin
   *  section of the unified debug panel (`debug.panel()`) to display
   *  live state. See FocusController.isPinEngaged for the gating rules. */
  isPinEngaged(): boolean { return this.focus.isPinEngaged(); }

  /** True while an aim animation is in flight. Mirror of getWarpActive
   *  for the camera's other interpolated transition. */
  isAimActive(): boolean { return this.aim.isActive(); }

  // Eased progress of the in-flight observe-mode camera translate, or
  // null if no transition is active. Forwards to the controller; see
  // ObserveTransition.getProgress.
  getObserveTransitionProgress(): { f: number; kind: 'enter' | 'exit' } | null {
    return this.observe.getProgress();
  }

  // Points of interest — thin shims over PoiStore (poi/README.md).

  /** Hide/unhide the rendered body of a hard-focus target — observe
   *  parks the camera AT the object, whose disc would render from the
   *  interior. One choke point dispatching per kind: star → the
   *  uHideFocusIdx shader pin, planet → the body field's uHideIdx.
   *  Passing null (or a kind switch) unhides the other kind's slot. */
  private setFocalBodyHidden(target: Target | null): void {
    this.starPipeline.discMaterial.uniforms.uHideFocusIdx.value =
      target?.kind === 'star' ? target.idx : -1;
    this.planetBodyField.setHiddenInstance(target?.kind === 'planet' ? target.idx : -1);
  }

  getPois(): readonly Target[] { return this.poiStore.get(); }
  togglePoi(target: Target): boolean { return this.poiStore.toggle(target); }
  setPois(targets: readonly Target[]) { this.poiStore.set(targets); }
  clearPois() { this.poiStore.clear(); }

  // Mode-switch entry point. Forwards to the ObserveTransition
  // controller; see camera/observe-transition.ts for the full FSM
  // (re-entry / focus-gate / animate=false guards + bus emit shape).
  // Public so the mode-pill click handler, keyboard 'O' shortcut, and
  // url-state restore can drive mode changes through a single surface.
  setCameraMode(mode: CameraMode, opts: { animate?: boolean } = {}) {
    this.observe.setMode(mode, opts);
  }

  // Focus / vector / travel routing lives on FocusController; the thin
  // shims below preserve the public surface for callers outside the
  // camera/ folder (URL state, search, POI overlay).
  setFocus(idx: number | null) { this.focus.setFocus(idx); }

  private tmpRecenter = new THREE.Vector3();
  // Scratch Vector3 reused for `recenterOrigin`'s return value (the
  // applied delta). Caller-visible only between successive
  // `recenterOrigin` calls; never read outside the synchronous
  // callsite. Avoids a per-recentre allocation on the warp arrival
  // path.
  private _recenterDelta = new THREE.Vector3();

  // Shift the renderer's local origin to `newOrigin` (an absolute-space
  // coordinate). The instance-position buffer is rewritten as `absolute −
  // newOrigin` in JS Number precision (= float64) before being truncated to
  // float32 — the per-axis subtractions happen in high precision first, so
  // the resulting local coordinates near the new origin retain full float32
  // resolution (~10⁻³⁸ near zero). Camera position and orbit target are
  // shifted by the same delta so the user sees no visible jump; only
  // numerical precision improves.
  //
  // Triggered automatically from FocusController.setFocus() and
  // WarpController.tryMidFlyRecentre. Don't call externally — it
  // bypasses the state-change bookkeeping that setFocus threads through.
  //
  // Returns the (dx, dy, dz) world-offset delta applied (newOrigin −
  // previous worldOffset) so callers can migrate auxiliary state
  // captured in the old frame (e.g. updateWarp's pEnd / pStart / A)
  // into the new frame without re-deriving the delta themselves.
  // Returns null on the no-op path (newOrigin equals worldOffset).
  // The returned Vector3 is shared scratch — copy if you need to
  // outlive the next recenterOrigin call.
  //
  // Public for the `FrameAnchor` seam — FocusController.recenterFocusToStar
  // and WarpController.tryMidFlyRecentre invoke it. The "don't call
  // externally" rule still applies to non-warp/non-focus callers; the
  // recentre is a state-mutation primitive, not a routine API.
  recenterOrigin(newOrigin: THREE.Vector3): THREE.Vector3 | null {
    const dx = newOrigin.x - this.worldOffset.x;
    const dy = newOrigin.y - this.worldOffset.y;
    const dz = newOrigin.z - this.worldOffset.z;
    if (dx === 0 && dy === 0 && dz === 0) return null;

    this.writeLocalPositions(newOrigin.x, newOrigin.y, newOrigin.z);

    this.camera.position.x -= dx;
    this.camera.position.y -= dy;
    this.camera.position.z -= dz;
    this.controls.target.x -= dx;
    this.controls.target.y -= dy;
    this.controls.target.z -= dz;

    this.worldOffset.copy(newOrigin);
    // Shader needs the world offset to reconstruct absolute positions for
    // dust-texture sampling (local-frame iPosition + uWorldOffset).
    (this.starPipeline.discMaterial.uniforms.uWorldOffset.value as THREE.Vector3).copy(newOrigin);
    // Layers holding local-frame positions (planet hosts, binary
    // baselines) re-derive them through the registry's recenter hooks.
    this.layers.recenterAll(newOrigin);
    return this._recenterDelta.set(dx, dy, dz);
  }

  // Rewrite _localPositions = catalog.positions − (ox, oy, oz) in float64
  // per axis (float32 write-back) and flag the instance buffer for
  // re-upload. Shared by recenterOrigin (origin moved) and
  // maybeReAdvanceEpoch (absolute positions moved).
  private writeLocalPositions(ox: number, oy: number, oz: number): void {
    const abs = this.catalog.positions;
    const loc = this._localPositions;
    const n = this.catalog.count;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      loc[j] = abs[j] - ox;
      loc[j + 1] = abs[j + 1] - oy;
      loc[j + 2] = abs[j + 2] - oz;
    }
    this.starPipeline.iPositionAttr.needsUpdate = true;
    this.binaryOrbitField?.markBaselinesDirty();
  }

  // Scrubber-time star motion: when the model clock crosses a re-advance
  // bucket, re-run the epoch-advance pass off the immutable J2016.0
  // baseline and rebuild the local frame. Runs at the top of animate() so
  // BinaryOrbitField / eclipse photometry rewrite their active slots on
  // top of the fresh baselines in the same frame. When a star is focused,
  // the camera + orbit target (+ any in-flight transition pose caches)
  // translate by the focal's space-motion delta — the same follow contract
  // applyFocalFrameRide implements for orbital drift — so the pin
  // invariant (target === focal live position) survives the move. Skipped
  // during warp: the warp owns the camera and re-snaps on arrival.
  private maybeReAdvanceEpoch(): void {
    const targetJyr = bucketEpochJyr(jdeToJulianEpochYear(tToJDE(this.getT())));
    if (targetJyr === this._advancedEpochJyr) return;
    const abs = this.catalog.positions;
    const focal = this.focus.getFocusedStar();
    let fx = 0, fy = 0, fz = 0;
    if (focal !== null) {
      fx = abs[focal * 3];
      fy = abs[focal * 3 + 1];
      fz = abs[focal * 3 + 2];
    }
    advancePositionsToEpoch(
      this._basePositions,
      this.catalog.velocities,
      targetJyr,
      abs,
    );
    this._advancedEpochJyr = targetJyr;
    this.writeLocalPositions(this.worldOffset.x, this.worldOffset.y, this.worldOffset.z);
    if (focal !== null && !this.warp.isActive()) {
      const d = this._epochFollowDelta.set(
        abs[focal * 3] - fx,
        abs[focal * 3 + 1] - fy,
        abs[focal * 3 + 2] - fz,
      );
      if (d.lengthSq() > 0) {
        this.camera.position.add(d);
        this.controls.target.add(d);
        this.focus.translateFocusFrame(d);
        this.observe.translateFocusFrame(d);
      }
    }
  }

  // Keep the floating origin locked to the focal object as it moves under
  // time advance. The focal-frame rides translate the camera to follow the
  // object, so under scrubber fast-forward the camera drifts far from the
  // fixed focus-time origin — reviving the float32 modelview cancellation the
  // floating origin exists to prevent (a growing wobble on the focal body).
  // Recentring onto the look target (glued to the object by the ride)
  // restores camera-from-origin ≈ eye distance. Kind-agnostic: every hard
  // focus kind, current or future, benefits with no per-kind code, because
  // the origin is shared by every layer. Skipped during camera-owning
  // animations, which reference the current frame and re-snap themselves.
  private maybeRecenterOnFocalDrift(): void {
    if (this.focus.getFocusedHardTarget() === null) return;
    if (
      this.warp.isActive()
      || this.aim.isActive()
      || this.aim.isObserveAimActive()
      || this.focus.isFocusLerpActive()
      || this.observe.isAnyActive()
    ) return;
    const eye = this.camera.position.distanceTo(this.controls.target);
    if (!shouldRecenterFocalOrigin(this.camera.position.length(), eye)) return;
    this.tmpRecenter.copy(this.controls.target).add(this.worldOffset);
    if (this.recenterOrigin(this.tmpRecenter) !== null) {
      // The planet ride caches the focal's full local position; the recentre
      // shifted the frame under it, so reseed to skip a one-frame jump. The
      // binary ride tracks baseline-relative perturbation (frame-invariant)
      // and needs none.
      this._planetRideIdx = null;
    }
  }

 // recenterFocusToStar moved to FocusController — it
  // mutates focus state (focusedStar + per-star minDistance +
  // planet-system reload), which now lives there.

  // Wire a loaded DustField into the star shader. Safe to call after the
  // Stellata is already rendering — uniforms flip atomically on the next
  // frame. Safe to call multiple times; the most recent dust wins. Pass
  // null to detach (e.g. to disable extinction for a mode toggle).
  attachDust(dust: DustField | null) {
    const u = this.starPipeline.discMaterial.uniforms;
    // Re-attach with a different DustField? Release the previous one's
    // ~128 MiB Data3DTexture before swapping the reference, otherwise
    // the old texture would leak. attachDust is called exactly once
    // today, so this guard is defensive — but the contract reads as
    // "the most recent dust wins" and that contract should hold without
    // tying it to caller discipline.
    if (this.dust !== null && this.dust !== dust) this.dust.dispose();
    this.dust = dust;
    if (dust === null) {
      u.uDustTexture.value = null;
      u.uDustEnabled.value = 0;
      this.extinctionPrepass?.dispose();
      this.extinctionPrepass = null;
      this.milkyway.attachDust(null);
      return;
    }
    u.uDustTexture.value = dust.texture;
    u.uDustBoundsPc.value = dust.params.boundsHalfPc;
    u.uDustDensityMin.value = dust.params.densityMin;
    u.uDustLogRatio.value = dust.params.logRatio;
    u.uDustAvPerDensityPc.value = dust.params.avPerDensityPerPc;
    u.uDustEnabled.value = 1;
    if (this.extinctionPrepass === null) {
      this.extinctionPrepass = new ExtinctionPrepass({
        renderer: this.renderer,
        positions: this.catalog.positions,
        count: this.catalog.count,
        uniforms: u as unknown as ExtinctionPrepassUniforms,
      });
    }
    this.extinctionPrepass.markDirty();
    // Each streamed voxel chunk changes sightline integrals — refresh the
    // cache as the texture densifies.
    dust.onProgress(() => this.extinctionPrepass?.markDirty());
    // Share the same DustField with the Milky Way pass so the band's dust
    // attenuation shows the actual Edenhofer voxel structure (Great Rift,
    // Coalsack, etc.) rather than only the analytic slab.
    this.milkyway.attachDust(dust);
  }

  /** Attach (or replace) the parsed binaries.bin runtime table. Idempotent;
   *  passing null detaches. From the moment the field is attached every
   *  frame walks the binary relation list and perturbs the relevant
   *  star-pipeline `iPosition` slots against `getT()`. */
  attachBinaries(binaries: BinariesData | null): void {
    this.binaryOrbitField?.dispose();
    this.eclipsePhotometryField?.dispose();
    this.binariesData = binaries;
    this.starLocalCluster.setBinaries(binaries);
    if (binaries === null) {
      this.binaryOrbitField = null;
      this.eclipsePhotometryField = null;
      return;
    }
    this.binaryOrbitField = new BinaryOrbitField({
      binaries,
      absolutePositions: this.catalog.positions,
      basePositions: this._basePositions,
      velocities: this.catalog.velocities,
      absoluteMags: this.catalog.absmag,
      localPositions: this._localPositions,
      compositeSuppress: this._compositeSuppress,
      iPositionAttr: this.starPipeline.iPositionAttr,
      iCompositeSuppressAttr: this.starPipeline.iCompositeSuppressAttr,
    });
    this.binaryOrbitField.recenter(this.worldOffset);
    // Re-attach scrubs the prior attach's residual per-instance state.
    // EclipsePhotometryField only tracks its own active slots, so
    // values written under the previous binaries set would otherwise
    // persist on stars the new set doesn't touch.
    this._eclipseDim.fill(1);
    this.starPipeline.iEclipseDimAttr.needsUpdate = true;
    this.eclipsePhotometryField = new EclipsePhotometryField({
      binaries,
      absolutePositions: this.catalog.positions,
      localPositions: this._localPositions,
      absoluteMags: this.catalog.absmag,
      physicalRadiusSolar: this.catalog.physicalRadius,
      eclipseDimBuffer: this._eclipseDim,
      iEclipseDimAttr: this.starPipeline.iEclipseDimAttr,
    });
  }

  private updateBinaryOrbits(): void {
    if (!this.binaryOrbitField) return;
    const uniforms = this.starPipeline.discMaterial.uniforms;
    const viewport = uniforms.uViewport.value as THREE.Vector2;
    const fovYRad = uniforms.uFovYRad.value as number;
    this.binaryOrbitField.update(
      this.getT(),
      this.camera.position,
      this.filter.maxAppMag,
      viewport.y,
      fovYRad,
      this.focus.getFocusedStar(),
    );
    this.applyFocalFrameRide();
    // Runs after the orbit walk so the camera→primary line of sight
    // reads post-perturbation positions; the pair-relative geometry is
    // evaluated independently in float64. See
    // src/client/binaries/README.md § Eclipse photometry.
    this.eclipsePhotometryField?.update(
      this.getT(),
      this.camera.position,
      this.filter.maxAppMag,
      performance.now(),
    );
  }

  // Focal-frame ride: translate the camera, orbit target, and any
  // in-flight camera-transition pose caches by the focal star's per-frame
  // orbital drift so the star stays glued under the camera. Runs right
  // after the orbit walk (which wrote this frame's perturbation into the
  // buffer). Skipped during warp — the warp owns the camera and its
  // per-frame lookAt already tracks the live buffer; lastAppliedPert is
  // kept synced so no jump accrues when the warp ends. On the frame the
  // focal star changes, re-snaps target onto the star's LIVE buffer
  // position: setFocus sampled the perturbation at focus-event time, but
  // under fast scrub sim-time advances between that event and this frame,
  // so the event-time snap goes stale and the star would land off-centre.
  private applyFocalFrameRide(): void {
    const field = this.binaryOrbitField;
    if (!field) return;
    const focal = this.focus.getFocusedStar();
    const hasPert = focal !== null
      && field.focalPerturbationInto(focal, this.getT(), this._focalPert);
    if (!hasPert) this._focalPert.set(0, 0, 0);

    const live = focal !== null
      ? this.starLocalPositionInto(focal, this._rideLive)
      : this._rideLive.set(0, 0, 0);
    const step = focalRideStep({
      focal,
      rideFocalIdx: this._rideFocalIdx,
      warpActive: this.warp.isActive(),
      focalPert: this._focalPert,
      lastAppliedPert: this._lastAppliedPert,
      liveLocal: live,
      target: this.controls.target,
      observeMode: this.focus.getCameraMode() === 'observe',
    });
    this._rideFocalIdx = step.rideFocalIdx;
    this._lastAppliedPert.set(step.px, step.py, step.pz);
    this._rideDelta.set(step.dx, step.dy, step.dz);
    if (this._rideDelta.lengthSq() === 0) return;
    this.camera.position.add(this._rideDelta);
    this.controls.target.add(this._rideDelta);
    this.focus.translateFocusFrame(this._rideDelta);
    this.observe.translateFocusFrame(this._rideDelta);
  }

  // Planet sibling of applyFocalFrameRide, over the shared focalRideStep.
  // The planet's full live local position plays the role the star ride's
  // perturbation does — its frame-to-frame delta is what the camera /
  // target / transition caches translate by, so the body stays glued to
  // controls.target and pan offsets survive. Seed frames (focus change,
  // warp) resync the baseline; the observe-mode guard in focalRideStep
  // suppresses the seed target re-snap, where target is the parsec-ahead
  // look pin rather than on the body.
  private applyPlanetFocalRide(): void {
    const focused = this.focus.getFocusedTarget();
    const idx = focused?.kind === 'planet' ? focused.idx : null;
    if (idx === null) {
      this._planetRideIdx = null;
      return;
    }
    const live = this._planetRideLive;
    if (!this.planetBodyField.planetLocalPositionInto(idx, live)) {
      this._planetRideIdx = null;
      return;
    }
    const step = focalRideStep({
      focal: idx,
      rideFocalIdx: this._planetRideIdx,
      warpActive: this.warp.isActive(),
      focalPert: live,
      lastAppliedPert: this._planetRideLast,
      liveLocal: live,
      target: this.controls.target,
      observeMode: this.focus.getCameraMode() === 'observe',
    });
    this._planetRideIdx = step.rideFocalIdx;
    this._planetRideLast.set(step.px, step.py, step.pz);
    this._planetRideDelta.set(step.dx, step.dy, step.dz);
    if (this._planetRideDelta.lengthSq() === 0) return;
    this.camera.position.add(this._planetRideDelta);
    this.controls.target.add(this._planetRideDelta);
    this.focus.translateFocusFrame(this._planetRideDelta);
    this.observe.translateFocusFrame(this._planetRideDelta);
  }

  /** Debug-HUD view into the eclipse field's per-relation walk for the
   *  current camera/filter/sim-time. Empty when no binaries attached. */
  eclipseDebugRows(starIdx: number | null): EclipseRelationDebugRow[] {
    return this.eclipsePhotometryField?.debugRows(
      this.getT(),
      this.camera.position,
      this.filter.maxAppMag,
      starIdx,
    ) ?? [];
  }

  /** Active eclipse-dim slot count (occluding or decaying). */
  get eclipseActiveDimCount(): number {
    return this.eclipsePhotometryField?.activeDimCount ?? 0;
  }

  /** Rendered disc diameter (px) for one instance — the CPU mirror of the
   *  shader's `max(appSize, physSize)` sizing (`star-physics.ts`). Shared
   *  by the navigate-mode fade closure and the overlay/pick paths. */
  private renderedSizePxFor(idx: number): number {
    return starPhysics.renderedSizePx({
      catalog: this.catalog,
      idx,
      camPos: this.camera.position,
      localPositions: this._localPositions,
      uniforms: this.starPipeline.discMaterial.uniforms as unknown as starPhysics.StarPhysicsUniforms,
      filter: this.filter,
      suppressPulsation: this._suppressPulsation,
    });
  }

  /** Component split of `renderedSizePxFor` — the star local cluster's
   *  membership test needs the disc/glow dominance, not just the max. */
  private renderedSizeComponentsFor(
    idx: number,
    out: starPhysics.RenderedSizeComponents,
  ): starPhysics.RenderedSizeComponents {
    return starPhysics.renderedSizeComponents({
      catalog: this.catalog,
      idx,
      camPos: this.camera.position,
      localPositions: this._localPositions,
      uniforms: this.starPipeline.discMaterial.uniforms as unknown as starPhysics.StarPhysicsUniforms,
      filter: this.filter,
      suppressPulsation: this._suppressPulsation,
    }, out);
  }

  /** User-facing extinction multiplier scaling the A_V re-added on top of
   *  the intrinsic (build-time de-extincted) catalog. 0 = dust-free
   *  universe (stars at intrinsic brightness/colour everywhere, not
   *  "observed from Sol"); 1 = physical realism; values above 1 amplify
   *  dust visually. Independent of attachDust — if no dust is loaded, this
   *  has no effect. Also drives the Milky Way background so the
   *  dust-darkened regions of the band track the same knob. */
  setExtinctionStrength(x: number) {
    this.starPipeline.discMaterial.uniforms.uExtinctionStrength.value = Math.max(0, x);
    this.milkyway.setExtinctionStrength(x);
  }

  /** Dev-console A/B switch for the per-star A_V prepass. false parks the
   *  star shader on the legacy in-vertex raymarch (the before/after
   *  comparison path); true restores the cache. No-op until dust
   *  attaches, and on WebGL2 contexts without EXT_color_buffer_float
   *  (where the fallback is permanent). */
  setExtinctionPrepassEnabled(on: boolean) {
    this.extinctionPrepass?.setEnabled(on);
  }

  /** Direct access to the Milky Way layer for dev-console tuning
   *  (e.g. `stellata.milkywayLayer.setBrightness(0.4)`). */
  get milkywayLayer(): MilkyWay { return this.milkyway; }

  /** Wire the loaded molecular cloud catalog into the scene. Idempotent —
   *  calling again replaces the layer. Pass null to detach. */
  /** Attach (or replace, or detach with null) the Local Group wireframe
   *  layer. Mirrors attachClouds — load is async in main.ts, the layer
   *  appears once the JSON arrives. Empty catalog detaches. */
  attachLocalGroup(catalog: LgCatalog | null) {
    if (this.localGroupLayer) {
      this.scene.remove(this.localGroupLayer.group);
      this.localGroupLayer.dispose();
      this.localGroupLayer = null;
    }
    if (this.lgEmission) {
      this.scene.remove(this.lgEmission.group);
      this.lgEmission.dispose();
      this.lgEmission = null;
    }
    if (catalog === null || catalog.objects.length === 0) return;
    this.localGroupLayer = new LocalGroupLayer(catalog);
    this.localGroupLayer.setMonochrome(this.monochrome);
    this.scene.add(this.localGroupLayer.group);
    if (!LG_EMISSION_SHELVED) {
      const u = this.starPipeline.discMaterial.uniforms;
      this.lgEmission = new LocalGroupEmission(catalog.objects, {
        uMaxAppMag: u.uMaxAppMag as { value: number },
        uSizeSpan: u.uSizeSpan as { value: number },
      });
      this.lgEmission.setChartHidden(this.monochrome);
      this.applyLgEmissionEnabled();
      this.scene.add(this.lgEmission.group);
    }
  }

  /** Attach the parsed Local Bubble shell mesh. The layer is constructed
   *  in the ctor and already in the scene (Sol-anchored, like the
   *  heliopause); this just builds its geometry once the async load
   *  resolves. */
  attachLocalBubble(mesh: LocalBubbleMesh): void {
    this.localBubbleShell.attach(mesh);
    this.localBubbleShell.recenter(this.worldOffset);
    this.localBubbleShell.setMonochrome(this.monochrome);
    this.shells.register('local_bubble', {
      label: LOCAL_BUBBLE_LABEL,
      sid: SHELL_OBJECT_SIDS.local_bubble,
      card: LOCAL_BUBBLE_CARD,
      centerAbsInto: (out) => {
        out.set(mesh.centroidAbs[0], mesh.centroidAbs[1], mesh.centroidAbs[2]);
        return true;
      },
      extentPc: () => mesh.extentPc,
      pick: {
        labelElementId: LOCAL_BUBBLE_LABEL_ELEMENT_ID,
        visible: () => this.localBubbleShell.isVisible(),
        sampleCount: () => this.localBubbleShell.labelSampleCount(),
        sampleLocalInto: (i, worldOffset, out) =>
          void this.localBubbleShell.labelSampleInto(i, worldOffset, out),
      },
    });
  }

  /** Heliopause renders when Sol's planet system is focused OR the
   *  heliopause shell is the focus target. Recomputed on focus /
   *  planetSystem mutations so focusing it as an object reveals it from
   *  any vantage while the Sol-focus behaviour is unchanged. */
  private updateHeliopauseVisibility(): void {
    const ps = this.focus.getFocusedPlanetSystem();
    const solFocused = ps !== null && ps.hostStarIdx === this.catalog.solIndex;
    const t = this.focus.getFocusedTarget();
    const shellFocused = t !== null && t.kind === 'shell' && this.shells.keyOf(t.idx) === 'heliopause';
    this.heliopause.setVisible(solFocused || shellFocused);
  }

  /** The Local Bubble shell layer — read by its silhouette label for the
   *  surface samples + attach state. */
  getLocalBubbleShell(): LocalBubbleShell { return this.localBubbleShell; }

  /** Direct access to the Local Group layer for dev-console / label
   *  wiring in main.ts. null until attachLocalGroup runs. */
  get localGroup(): LocalGroupLayer | null { return this.localGroupLayer; }

  /** Dev-console access to the LG emission layer (brightness /
   *  glow-mag-offset levers). null until attachLocalGroup runs. */
  get localGroupEmission(): LocalGroupEmission | null { return this.lgEmission; }

  attachClouds(catalog: CloudCatalog | null) {
    if (this.clouds) {
      this.scene.remove(this.clouds.group);
      this.clouds.dispose();
      this.clouds = null;
    }
    if (catalog === null || catalog.clouds.length === 0) return;
    this.clouds = new MolecularClouds(catalog);
    this.clouds.setMonochrome(this.monochrome);
    this.scene.add(this.clouds.group);
  }

  /** Catalog of clouds, or null if none are attached. Exposed for search
   *  index integration in main.ts. */
  getCloudCatalog(): CloudCatalog | null {
    return this.clouds ? { count: this.clouds.clouds.length, clouds: this.clouds.clouds } : null;
  }

  /** Direct access to the cloud render layer for dev-console tuning
   *  (`stellata.cloudLayer.setOpacity(0.5)` etc.). null until
   *  attachClouds runs. */
  get cloudLayer(): MolecularClouds | null { return this.clouds; }

  /** Kind-agnostic travel — see FocusController.flyTo. Stars park via
   *  `focusStar`; soft kinds ride the shared focus-park path. */
  flyTo(target: Target, opts: { animate?: boolean } = {}) {
    this.focus.flyTo(target, opts);
  }

  /** LG object's centroid in the renderer's local frame — the lg
   *  provider's localPositionInto leg. */
  private lgLocalPositionInto(idx: number, out: THREE.Vector3): boolean {
    const obj = this.localGroupLayer?.objects[idx];
    if (!obj) return false;
    out.copy(obj.centerAbs).sub(this.worldOffset);
    return true;
  }

  /** Projected silhouette diameter of an LG object in pixels — the
   *  orientation-independent maxAxis bound the hover pickbox uses. */
  private renderedLgSizePx(idx: number): number {
    const obj = this.localGroupLayer?.objects[idx];
    if (!obj) return 0;
    const local = this._tmpRenderLocal;
    if (!this.lgLocalPositionInto(idx, local)) return 0;
    const dCam = Math.max(local.distanceTo(this.camera.position), 1);
    return 2 * Math.atan(maxSemiAxisPc(obj) / dCam) * this.angularToPx();
  }

  private tmpVec3b = new THREE.Vector3();
  private tmpHostLocal = new THREE.Vector3();

  /** Build the dust-particle mesh from loaded data. The layer is shelved
   *  — see src/client/dust/README.md before re-enabling. */
  attachDustParticles(data: DustParticleData) {
    this.dustParticles.attach(data);
  }

  /** Register a lazy fetch for particles.bin. Invoked (once) on the first
   *  setParticleStrength(>0), so the shelved particle layer costs no wire
   *  bytes on loads that never opt in. */
  setDustParticleSource(source: () => Promise<DustParticleData | null>) {
    this.dustParticleSource = source;
  }

  private dustParticleSource: (() => Promise<DustParticleData | null>) | null = null;
  private lastParticleStrength = 0;

  /** User-facing dust-particle visibility (`stellata.setParticleStrength`
   *  console knob). 0 = hidden (default); higher = stronger additive
   *  contribution. First call above 0 triggers the lazy particles.bin
   *  fetch when a source is registered; the requested strength is
   *  re-applied once the mesh attaches. */
  setParticleStrength(x: number) {
    this.lastParticleStrength = Math.max(0, x);
    if (x > 0 && this.dustParticleSource !== null) {
      const source = this.dustParticleSource;
      this.dustParticleSource = null;
      void source().then((data) => {
        if (data === null || this.disposed) return;
        this.dustParticles.attach(data);
        this.dustParticles.setStrength(this.lastParticleStrength);
      });
    }
    this.dustParticles.setStrength(x);
  }


  // Read-only view of the local-frame star positions, bound to the GPU
  // iPosition attribute. Overlays should project through this rather than
  // catalog.positions so their math runs in the same frame as the camera.
  get localPositions(): Float32Array { return this._localPositions; }

  /** Bucketised Julian epoch year the catalog positions currently sit at.
   *  Changes exactly when a re-advance rewrote the positions buffers —
   *  overlays that skip stationary frames must key on it alongside the
   *  camera transform. */
  get advancedEpochJyr(): number { return this._advancedEpochJyr; }

  // Read-only view of the pulsation-suppress mask. Overlays (focus ring,
  // distance vector tip) thread this through renderedSizePx so
  // the SVG estimate tracks the rendered disc on eclipsing-binary
  // primaries whose pulsation has been gated off.
  get suppressPulsation(): Float32Array { return this._suppressPulsation; }

  // Read-only view of the star-shader uniforms, typed against the subsets
  // consumed by star-physics.ts. Overlays / chart / debug surfaces that
  // call the per-star geometry helpers thread these through; keeping the
  // accessor here means the integration shell is still the single point
  // that knows the renderer's material identity.
  get uniforms(): starPhysics.StarPhysicsUniforms & starPhysics.ChartDiscUniforms {
    return this.starPipeline.discMaterial.uniforms as unknown as
      starPhysics.StarPhysicsUniforms & starPhysics.ChartDiscUniforms;
  }

  /** Set (any kind) or clear (null) the distance-vector destination. */
  setVector(target: Target | null) { this.focus.setVector(target); }

  /** Click-handler entry point for "clear whatever's focused" —
   *  including the vector-only case (nothing focused, measurement
   *  vector drawn). See FocusController.unfocus. */
  unfocus(opts: { animate?: boolean } = {}) { this.focus.unfocus(opts); }

  // Filter / preset / FOV / render-knob mutations — thin shims over
  // FilterController (filters/README.md) preserving the public surface
  // for controls.ts, url-state, keyboard shortcuts, and the debug panel.
  setFilter(patch: Partial<FilterState>) { this.filters.setFilter(patch); }
  getFilter(): Readonly<FilterState> { return this.filters.getFilter(); }
  applyMagnitudePreset(name: MagPresetName) { this.filters.applyMagnitudePreset(name); }
  setCameraFov(fov: number) { this.filters.setCameraFov(fov); }
  getCameraFov(): number { return this.filters.getCameraFov(); }
  setStarExaggerationK(k: number, preset?: MagPresetName) {
    this.filters.setStarExaggerationK(k, preset);
  }
  getStarExaggerationK(preset?: MagPresetName): number {
    return this.filters.getStarExaggerationK(preset);
  }
  getStarExaggerationKDefault(preset?: MagPresetName): number {
    return this.filters.getStarExaggerationKDefault(preset);
  }
  setStarRenderParams(patch: Partial<StarRenderParams>) {
    this.filters.setStarRenderParams(patch);
  }
  getStarRenderParams(): StarRenderParams { return this.filters.getStarRenderParams(); }
  clearSizeOverrides(fields: Array<'sizeMin' | 'sizeMax' | 'sizeSpan'>) {
    this.filters.clearSizeOverrides(fields);
  }

  // Declutter cycle. detailPermits is the per-frame read path layers gate
  // on (effective = permitted AND the layer's instance gates).
  getDetailLevel(): DetailLevel { return this.filters.getDetailLevel(); }
  applyDetailPreset(level: DetailLevel, resetOverrides = true) {
    this.filters.applyDetailPreset(level, resetOverrides);
  }
  setSceneElementVisible(id: SceneElementId, on: boolean) {
    this.filters.setSceneElementVisible(id, on);
  }
  detailPermits(id: SceneElementId): boolean { return this.detailPermitted[id]; }

  // Per-element bind adapters (exhaustive over SceneElementId — a new
  // renderable that isn't wired fails tsc). Each writes the permitted
  // cache; the imperative layers (Milky Way / LG-emission enable, orbit
  // rings, heliopause shell) pass an `extra` push because they have no
  // per-frame gate that would pick the cache change up on its own.
  private buildSceneElementBinds(): SceneElementBinds {
    const set = (id: SceneElementId, extra?: (on: boolean) => void) =>
      (on: boolean) => { this.detailPermitted[id] = on; extra?.(on); };
    return {
      stars: set('stars'),
      planetBodies: set('planetBodies'),
      milkyWayBand: set('milkyWayBand', () => this.applyMilkywayEnabled()),
      milkyWayIsobar: set('milkyWayIsobar', (on) => {
        this.setMilkywayIsobar(on);
        this.applyMilkywayEnabled();
      }),
      lgEmissionGlow: set('lgEmissionGlow', () => this.applyLgEmissionEnabled()),
      galacticDiscWireframe: set('galacticDiscWireframe'),
      lgWireframes: set('lgWireframes'),
      orbitRings: set('orbitRings', (on) => this.orbitRingsLayer.setPermitted(on)),
      binaryOrbitRings: set('binaryOrbitRings', (on) => this.binaryOrbitPathLayer.setPermitted(on)),
      heliopauseShell: set('heliopauseShell', (on) => this.heliopause.setPermitted(on)),
      localBubbleShell: set('localBubbleShell', (on) => this.localBubbleShell.setPermitted(on)),
      constellationFigures: set('constellationFigures', (on) => this.constellationFigureLayer.setPermitted(on)),
      molecularCloudEllipsoids: set('molecularCloudEllipsoids'),
      dustParticles: set('dustParticles'),
      planetLabels: set('planetLabels'),
      heliopauseLabel: set('heliopauseLabel'),
      localBubbleLabel: set('localBubbleLabel'),
      mwLabel: set('mwLabel'),
      lgObjectLabels: set('lgObjectLabels'),
      chartStarNameLabels: set('chartStarNameLabels'),
      chartBayerGlyphs: set('chartBayerGlyphs'),
      chartVariableRings: set('chartVariableRings'),
      chartConstellationNames: set('chartConstellationNames'),
      chartCloudNames: set('chartCloudNames'),
    };
  }

  private applyMilkywayEnabled(): void {
    // The layer group carries both realistic treatments: the volumetric
    // band (realistic floor) and the chart isobar (chart floor). Exactly
    // one is permitted per render style; the user's mw toggle gates both.
    const permitted = this.detailPermitted.milkyWayBand || this.detailPermitted.milkyWayIsobar;
    this.milkyway.setEnabled(permitted && this.filter.showMilkyway);
  }
  private applyLgEmissionEnabled(): void {
    this.lgEmission?.setEnabled(this.detailPermitted.lgEmissionGlow && this.filter.showLgEmission);
  }

  setMonochrome(on: boolean) {
    if (this.monochrome === on) return;
    this.monochrome = on;
    this.starPipeline.discMaterial.uniforms.uMonochrome.value = on ? 1 : 0;
    this.starPipeline.setMonochromeBlend(on);
    this.renderer.setClearColor(on ? 0xf5f2ea : 0x000000, on ? 1 : 0);
    // Per-layer palette swaps fan out through the registry. The milky-way
    // layer has no monochrome hook: chart mode re-purposes it as an isobar
    // contour via the `milkyWayIsobar` detail bind (chart floor); the cloud
    // isobar is orchestrator-driven (`setCloudsIsobar`, no detail element).
    this.layers.setMonochromeAll(on);
    this.bus.emit('state');
  }

  /** Chart-mode isobar pass on/off for the molecular cloud layer.
   *  Wires the shader's uMaxAppMag uniform to the stellata's shared
   *  reference so the contour tracks the magnitude slider live. */
  setCloudsIsobar(on: boolean) {
    this.clouds?.setIsobar(on, this.starPipeline.discMaterial.uniforms.uMaxAppMag);
  }

  /** Chart-mode isobar pass on/off for the milky-way layer. Driven by the
   *  `milkyWayIsobar` detail bind, not called directly by chart-mode. */
  setMilkywayIsobar(on: boolean) {
    this.milkyway.setIsobar(on);
  }

  /** Focus a star — thin shim over FocusController.focusStar. The
   *  click FSM in `onPointerUp`, the typeahead, and URL state restore
   *  all call through here. */
  focusStar(starIndex: number, opts: { animate?: boolean } = {}) {
    this.focus.focusStar(starIndex, opts);
  }

  /** Orbit pivot moves to the object (any kind), the object becomes
   *  the focus, the camera stays put. See FocusController.setOrbitTarget. */
  setOrbitTarget(target: Target) { this.focus.setOrbitTarget(target); }

  // The FocusTarget factories (makeFocusTarget / currentFocusTarget)
  // live on FocusController — they close over the focus state, so they
  // belong where that state lives. WarpController consumes them through
  // the `FocusOps` seam.

  /** Start an animated journey from the currently focused thing to
   *  `target` (any kind). Thin shim over WarpController. */
  warpTo(target: Target) {
    this.warp.warpTo(target);
  }

  /** The cloud provider's localPositionInto leg: writes the cloud's
   *  local-frame centroid into `out` when the cloud exists, returns
   *  `true`. Returns `false` (and leaves `out` untouched) when no cloud
   *  layer is attached or the index is out of range. */
  private cloudLocalPositionInto(cloudIdx: number, out: THREE.Vector3): boolean {
    if (!this.clouds) return false;
    const c = this.clouds.clouds[cloudIdx];
    if (!c) return false;
    out.copy(c.centerAbs).sub(this.worldOffset);
    return true;
  }

  // Swing the camera to face the selected constellation while keeping the
  // orbit target and orbit radius unchanged — only the camera's position on
  // the orbit sphere moves. The aim point is the brightness-weighted
  // centroid of the figure stars as seen from the current target, so a
  // constellation looks "centered" on whichever of its members visually
  // dominate from the user's current vantage, even when the user has
  // travelled deep into 3D space.
  aimAtConstellation(conIndex: number) {
    this.cancelUnfocusLerp();
    this.cancelFocusLerp();
    if (this.isObserveTransitionActive()) return;
    const cons = this.catalog.constellations;
    const lines = conIndex >= 0 && conIndex < cons.length ? cons[conIndex].lines : undefined;
    if (!lines || lines.length === 0) return;

    const seen = new Set<number>();
    for (const polyline of lines) for (const i of polyline) seen.add(i);
    if (seen.size === 0) return;

    // Project in local frame so camera/target math stays internally
    // consistent under the floating origin.
    const positions = this._localPositions;
    const absmag = this.catalog.absmag;
    const t = this.controls.target;

    const scored: Array<{ idx: number; appMag: number }> = [];
    for (const i of seen) {
      const dx = positions[i * 3] - t.x;
      const dy = positions[i * 3 + 1] - t.y;
      const dz = positions[i * 3 + 2] - t.z;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), DCAM_LOG_FLOOR_PC);
      const appMag = apparentMagnitude(absmag[i], dist);
      scored.push({ idx: i, appMag });
    }
    scored.sort((a, b) => a.appMag - b.appMag);
    const top = scored.slice(0, Math.min(8, scored.length));

    const c = new THREE.Vector3();
    for (const { idx } of top) {
      c.x += positions[idx * 3];
      c.y += positions[idx * 3 + 1];
      c.z += positions[idx * 3 + 2];
    }
    c.divideScalar(top.length);

    if (this.focus.getCameraMode() === 'observe') {
      // Camera is parked at the focal star — just rotate the view to face
      // the centroid through the shared observe-mode aim slerp. Distance
      // doesn't matter; only the direction from camera to `c` is used.
      this.aimAt(c);
      return;
    }

    const dir = new THREE.Vector3().subVectors(c, t);
    if (dir.lengthSq() < 1e-6) return; // aim point coincides with target
    dir.normalize();

    const r = this.camera.position.distanceTo(t);
    // Put the camera on the opposite side of target from the centroid at the
    // current orbit radius — the forward vector (target − position) then
    // points toward the centroid.
    this.camera.position.copy(t).addScaledVector(dir, -r);
    this.controls.update();
  }

  /**
   * Smoothly rotate the camera so that `pointLocal` (a world point in
   * the renderer's local frame) ends up at the centre of the view.
   * Mode-aware: in navigate the orbit-pivot is held and the camera
   * sweeps around it; in observe the camera position is held and only
   * the quaternion rotates. Called by the Sol / GC label click handlers,
   * the constellation picker, the POI overlay, and the observe-mode
   * double-click.
   *
   * No-ops during warp, mid-aim, focus-lerp, or observe-transition. The
   * actual slerp + controls.enabled / observeControls handoff lives in
   * `AimController`; this dispatcher owns the composition-layer busy
   * gates the controller doesn't see.
   */
  aimAt(pointLocal: THREE.Vector3) {
    if (this.warp.isActive() || this.aim.isActive()) return;
    this.cancelUnfocusLerp();
    this.cancelFocusLerp();
    if (this.isObserveTransitionActive()) return;
    this.aim.aimAt(pointLocal);
  }

  // Star position in the renderer's local frame — i.e. in the same space
  // as `camera.position` and `controls.target`. This is what overlays want
  // for projection math and what the orbit camera operates in. It is NOT
  // the absolute (Sol-centric) catalog position when a star is focused;
  // use `catalog.positions[i*3..]` directly if you need absolute space
  // (e.g. distance-from-Sol labels).
  starLocalPosition(i: number): THREE.Vector3 {
    return this.starLocalPositionInto(i, new THREE.Vector3());
  }

  /** Non-allocating sibling of `starLocalPosition`: writes the local-frame
   *  position of star `i` into `out` and returns `out`. Use from per-frame
   *  callers (animate, updateWarp, overlay updates); the allocating shim
   *  above stays for cold paths and external API. */
  starLocalPositionInto(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this._localPositions;
    return out.set(p[i * 3 + 0], p[i * 3 + 1], p[i * 3 + 2]);
  }

  /** Lead (first-seen outermost primary) of `idx`'s collapsed cluster,
   *  or `idx` itself when nothing around it is suppressed. The Picker
   *  routes every star pick through this so hover, POI pin, vector,
   *  and focus all act on the object the system card names. */
  private collapsedClusterLead(idx: number): number {
    if (this.binariesData === null) return idx;
    return collapsedClusterIndices(
      this.binariesData,
      idx,
      (i) => this.isCompositeSuppressed(i),
    )[0];
  }

  /** True when BinaryOrbitField's sub-pixel LOD gate collapsed this
   *  star onto its primary this frame — the renderer's own "these read
   *  as one point" verdict. The star hover provider keys the
   *  system-card swap on it so card and rendering can't disagree. */
  isCompositeSuppressed(idx: number): boolean {
    return this._compositeSuppress[idx] === 1;
  }

  /** Cached PlanetSystem for an attached host, or null if the host
   *  isn't attached. Used by the planet hover formatter to resolve
   *  `(hostStarIdx, planetIdx)` from a pick back to a Planet record
   *  without re-running async `getPlanetSystem`. */
  getAttachedPlanetSystem(hostStarIdx: number): PlanetSystem | null {
    return this.planetBodyField.getAttachedPlanetSystem(hostStarIdx);
  }

  /** The global planet-body field — Target {kind:'planet'} identity
   *  (flat instance index ↔ host/planet) + per-body geometry accessors
   *  consumed by the focus card, search, and URL wiring in main.ts. */
  get planetField(): PlanetBodyField { return this.planetBodyField; }


  /** Live apparent V mag for `(hostStarIdx, planetIdx)`, matching the
   *  planet shader's reflected-light formula at the current camera
   *  position. Returns null when the host isn't attached or the index
   *  is out of range. Decoupled from focus state per the lo5
   *  visibility-only hover rule. */
  planetApparentMag(hostStarIdx: number, planetIdx: number): number | null {
    return this.planetBodyField.appMagFor(
      hostStarIdx,
      planetIdx,
      this.camera.position,
    );
  }

  /** Live camera→planet distance in the local frame, pc; null when the
   *  flat instance index isn't covered by an attached host. */
  planetCameraDistancePc(instanceIdx: number): number | null {
    if (!this.planetBodyField.planetLocalPositionInto(instanceIdx, this._tmpRenderLocal)) {
      return null;
    }
    return this._tmpRenderLocal.distanceTo(this.camera.position);
  }

  private attachEvents() {
    window.addEventListener('resize', this.onResize);
    this.input = new InputController({
      canvas: this.renderer.domElement,
      camera: this.camera,
      controls: this.controls,
      picker: this.picker,
      bus: this.bus,
      poiStore: this.poiStore,
      getCameraMode: () => this.focus.getCameraMode(),
      getFilter: () => this.filter,
      getFocusedTarget: () => this.focus.getFocusedTarget(),
      getVectorTarget: () => this.focus.getVectorTarget(),
      setVector: (target) => this.setVector(target),
      isWarpActive: () => this.warp.isActive(),
      isAimActive: () => this.aim.isActive(),
      isObserveTransitionActive: () => this.isObserveTransitionActive(),
      cancelUnfocusLerp: () => this.cancelUnfocusLerp(),
      cancelFocusLerp: () => this.cancelFocusLerp(),
      flyTo: (target) => this.flyTo(target),
      setOrbitTarget: (target) => this.setOrbitTarget(target),
      unfocus: () => this.unfocus(),
      togglePoi: (target) => this.togglePoi(target),
      aimAt: (p) => this.aimAt(p),
    });
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.starPipeline.discMaterial.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.starPipeline.discMaterial.uniforms.uViewport.value.set(w, h);
    // Aspect change → fov_minor moves → orbit floor needs a refresh while
    // a star is focused. (FOV-only changes go through setCameraFov, which
    // does its own recompute.)
    this.focus.refreshOrbitFloor();
    // Line2 needs the canvas resolution for its screen-space line width.
    this.galacticGrid.setResolution(w, h);
    // The Milky Way layer renders at native resolution via the main scene
    // pass, so no per-resize bookkeeping is needed here.
    // Recompute pixel sizes from the active preset so non-overridden
    // fields stay proportional to the bulge across screen sizes and
    // orientation changes. maxAppMag/sizeSpan don't depend on viewport
    // and are deliberately untouched here so a user's manual magnitude
    // slider value survives a window resize.
    this.filters.recomputePresetPxSizes();
  };

  // Pixel-per-radian conversion for the active viewport / FOV. Shared
  // by every screen-space size calc (star disc, cloud silhouette, peak-
  // amplitude disc, glsl `physSizePx` mirror).
  private angularToPx(): number {
    const u = this.starPipeline.discMaterial.uniforms;
    const viewport = u.uViewport.value as THREE.Vector2;
    return angularToPxPure(viewport.y, u.uFovYRad.value as number);
  }

  /** Cloud analogue of `renderedSizePx` — pixel diameter of the cloud's
   *  silhouette at the current camera distance, the cloud provider's
   *  renderedSizePx leg (the distance-vector chevron tip lands on the
   *  rendered edge instead of the user's `sizeMax` star-size knob).
   *  Returns 0 when no cloud layer is loaded or the index is out of
   *  range. */
  private renderedCloudSizePx(cloudIdx: number): number {
    if (!this.clouds) return 0;
    const cloud = this.clouds.clouds[cloudIdx];
    if (!cloud) return 0;
    const local = this._tmpRenderLocal;
    if (!this.cloudLocalPositionInto(cloudIdx, local)) return 0;
    const camPos = this.camera.position;
    const dx = local.x - camPos.x;
    const dy = local.y - camPos.y;
    const dz = local.z - camPos.z;
    const dCam = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dCam < 1e-12) {
      return renderedCloudSizePx(cloud, dCam, this.angularToPx());
    }
    // World-space unit direction from the cloud toward the camera. The
    // helper rotates this into the cloud's local frame so the silhouette
    // bound tightens for axis-aligned views (prolate end-on no longer
    // overshoots by the prolate axis ratio).
    this.tmpCloudDir.set(camPos.x - local.x, camPos.y - local.y, camPos.z - local.z)
      .multiplyScalar(1 / dCam);
    return renderedCloudSizePx(cloud, dCam, this.angularToPx(), this.tmpCloudDir);
  }
  private tmpCloudDir = new THREE.Vector3();
  // Scratch slots for the non-allocating *LocalPositionInto helpers.
  // Each is owned by one call-stack scope; values are valid only inside
  // that scope and must not be retained across method calls.
  //
  //  - _tmpAnimateLocal: owned by animate() and the methods it calls
  //    in sequence (the scene-layer update fan-out). Single writer in
  //    steady-state.
  //    Adding a new writer that retains the value across another
  //    animate-stack method violates the contract.
  //  - _tmpRenderLocal: owned by per-call read methods invoked outside
  //    the animate stack (renderedCloudSizePx, etc.). Independent of
  //    _tmpAnimateLocal; never observed by code that holds a reference
  //    across calls.
  private _tmpAnimateLocal = new THREE.Vector3();
  private _tmpRenderLocal = new THREE.Vector3();

  /** Public access to the HUD overlay — for the arrow-fade debug HUD only. */
  get hud(): HudOverlay { return this.hudOverlay; }

 // parkDistForStar moved to FocusController — used by
  // ObserveTransition's ObserveFocusOps seam and the focus-park lerp.

  /** Canonical per-mode click semantics for any point object — the POI
   *  overlay's on-screen labels route here alongside deferred canvas
   *  clicks. See InputController.applyObjectClick. */
  applyObjectClick(target: Target): boolean { return this.input.applyObjectClick(target); }

  // Camera-distance bound at which the catalog's largest star subtends
  // `px` pixels under the live FOV / viewport uniforms, so changing
  // exaggeration K, FOV, or viewport keeps the dependent gates honest.
  private discWindowFromUniformsPc(px: number): number {
    const u = this.starPipeline.discMaterial.uniforms;
    return discWindowPc(
      this.maxPhysicalRadiusPc,
      px,
      u.uFovYRad.value as number,
      (u.uViewport.value as THREE.Vector2).y,
    );
  }

  // Walk stars within `dThreshPc` of the camera. Uses the sorted-by-
  // distance-from-Sol index plus the triangle inequality: any star within
  // `dThreshPc` of the camera must have |distFromSol(star) −
  // distFromSol(camera)| ≤ dThreshPc. We binary-search that window in the
  // sorted array (typically tens to hundreds of candidates) and only do
  // the squared-distance check on those — replaces a full 313k-element
  // linear scan per frame. `cb` returns true to stop the walk early.
  private forEachStarNearCamera(dThreshPc: number, cb: (idx: number) => boolean): void {
    const dThreshSq = dThreshPc * dThreshPc;

    // Camera distance from Sol in absolute space (catalog frame).
    const camAbsX = this.camera.position.x + this.worldOffset.x;
    const camAbsY = this.camera.position.y + this.worldOffset.y;
    const camAbsZ = this.camera.position.z + this.worldOffset.z;
    const camDistFromSol = Math.sqrt(
      camAbsX * camAbsX + camAbsY * camAbsY + camAbsZ * camAbsZ,
    );
    // sortedDistFromSol holds load-epoch Sol distances; a scrubbed star can
    // sit up to _maxEpochDriftPc away from its sorted value, so the window
    // widens by that bound. The in-window test below reads live positions.
    const lo = camDistFromSol - dThreshPc - this._maxEpochDriftPc;
    const hi = camDistFromSol + dThreshPc + this._maxEpochDriftPc;

    const sortedIdx = this.sortedByDistFromSol;
    const { start, end } = sortedDistRange(this.sortedDistFromSol, lo, hi);

    const positions = this._localPositions;
    const cx = this.camera.position.x;
    const cy = this.camera.position.y;
    const cz = this.camera.position.z;
    for (let k = start; k < end; k++) {
      const i = sortedIdx[k];
      const dx = positions[i * 3] - cx;
      const dy = positions[i * 3 + 1] - cy;
      const dz = positions[i * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz < dThreshSq && cb(i)) return;
    }
  }

  // Should the core depth-mask render this frame? True iff at least one
  // star is close enough that its disc could reach RESOLVED_DISC_MIN_PX —
  // below that, bleed-through is too small to see.
  private shouldEnableCoreMask(): boolean {
    let found = false;
    this.forEachStarNearCamera(
      this.discWindowFromUniformsPc(RESOLVED_DISC_MIN_PX),
      () => { found = true; return true; },
    );
    return found;
  }

  private animate = () => {
    if (this.disposed) return;
    perfMark('frame.total');
    this.maybeReAdvanceEpoch();
    this.maybeRecenterOnFocalDrift();
    perfMark('controls.update');
    if (this.warp.isActive()) {
      this.warp.tick(performance.now());
    } else if (this.aim.isActive()) {
      this.aim.tick(performance.now());
    } else if (this.focus.isFocusLerpActive()) {
      this.focus.tick(performance.now());
    } else if (this.aim.isObserveAimActive()) {
      this.aim.tickObserve(performance.now());
      // Observe-mode aim slerps the camera quaternion in place. The
      // controls.target still needs the per-frame re-pin so URL state stays
      // truthful mid-flight.
      this.observeUpdateTarget();
    } else if (this.observe.isAnyActive()) {
      this.observe.tick(performance.now());
    } else if (this.focus.getCameraMode() === 'observe') {
      // Look-around input (yaw/pitch/roll/FOV) mutates the camera directly
      // via observeControls + the existing two-finger handlers. update()
      // here advances any post-release momentum from a flick. Per-frame
      // we also re-pin controls.target one parsec ahead of the camera so
      // URL state writers (which serialise camera.position + target)
      // still round-trip the look direction correctly.
      this.observeControls.update();
      this.observeUpdateTarget();
    } else {
      this.controls.update();
    }
    perfMeasure('controls.update');
    perfMark('pre-render');
    this.starPipeline.discMaterial.uniforms.uCameraPos.value.copy(this.camera.position);
    // Pin the focused star at NDC (0,0) only when the geometric
    // invariant holds: navigate mode, no warp/aim animation, and the
    // user hasn't panned the camera target away from the focused star
    // (target ≈ local origin). Pan moves target away from the star and
    // we want it to render at its actual projected position again.
    const pinTarget = this.focus.isPinEngaged() ? this.focus.getFocusedStar() : -1;
    this.starPipeline.discMaterial.uniforms.uPinFocusToCenter.value = pinTarget ?? -1;
    // Advance the variability clock on the model time base (shared with the
    // glow material via sharedUniforms). Days since J2000 from getT(), plus
    // the warp rate in model-days/real-second for the anti-strobe floor.
    const varUniforms = this.starPipeline.discMaterial.uniforms;
    varUniforms.uModelDays.value = tToJDE(this.getT()) - J2000_JD;
    varUniforms.uModelDaysPerRealSec.value = Math.abs(this.clock.getRate()) / 86400;
    if (this.extinctionPrepass !== null) {
      // Absolute camera position in JS float64 — same frame convention as
      // the shader-side iPosition + uWorldOffset reconstruction.
      perfMark('extinction.prepass');
      this.extinctionPrepass.update(
        this.camera.position.x + this.worldOffset.x,
        this.camera.position.y + this.worldOffset.y,
        this.camera.position.z + this.worldOffset.z,
      );
      perfMeasure('extinction.prepass');
    }
    // Per-frame layer fan-out through the registry. distFromSol is the
    // camera's absolute ICRS distance, summed in JS float64 so it stays
    // exact with kpc-scale worldOffset values (the disc-fade smoothstep
    // consuming it spans a small range, so precision matters).
    const cam = this.camera.position;
    const ax = cam.x + this.worldOffset.x;
    const ay = cam.y + this.worldOffset.y;
    const az = cam.z + this.worldOffset.z;
    this.frameCtx.distFromSol = Math.sqrt(ax * ax + ay * ay + az * az);
    this.frameCtx.t = this.getT();
    this.frameCtx.warpActive = this.warp.isActive();
    this.layers.updateAll(this.frameCtx);
    // After the layer fan-out so the star cluster's membership is
    // current-frame: a member's core-mask stamp must render even when
    // the physSize-only window misses an appSize-driven member disc.
    perfMark('coreMask');
    this.starPipeline.coreMaskMesh.visible =
      this.starLocalCluster.hasMembers() || this.shouldEnableCoreMask();
    perfMeasure('coreMask');
    perfMeasure('pre-render');
    perfMark('gpu.render');
    this.renderer.render(this.scene, this.camera);
    perfMeasure('gpu.render');
    perfMark('gpu.localDepth');
    this.localDepthPass.render(this.renderer, this.camera);
    perfMeasure('gpu.localDepth');
    perfMark('frame.handlers');
    this.bus.emit('frame');
    perfMeasure('frame.handlers');
    perfMeasure('frame.total');
    perfFrame();
    requestAnimationFrame(this.animate);
  };

  // HUD projection — hidden during warp (the camera is in motion and
  // its reference function is exactly the context warp suppresses,
  // same as the disc / grid / LG wireframe entries in the registry).
  private updateHud(warpActive: boolean) {
    if (warpActive) {
      this.hudOverlay.setVisible(false);
      return;
    }
    // Refresh camera matrices before any SVG projection — controls.update()
    // mutates camera.position/quaternion but doesn't propagate to
    // matrixWorld/matrixWorldInverse. The renderer would do this for us, but
    // we project arrow tips into screen space *before* renderer.render() runs,
    // so without this call the labels lag by one frame during fast moves.
    this.camera.updateMatrixWorld();

    // Kind-generic focal position: measuring HUD distances from
    // controls.target is only right in navigate — in observe the target
    // is parked 1 pc ahead of the camera (observeUpdateTarget), which
    // read as "Sol · 3.3 ly" from a planet-anchored observe.
    const focusedLocal = this.focus.focalLocalPositionInto(this._tmpAnimateLocal)
      ? this._tmpAnimateLocal
      : null;
    const focusedStar = this.focus.getFocusedStar();
    const isSolFocus = focusedStar !== null && focusedStar === this.catalog.solIndex;
    // HudOverlay computes its own fade alpha from THIS frame's shaft
    // geometry — no more one-frame-lag flash when the HUD toggles on
    // (ml8 symptom 1). The distance-vector overlay does the same in its
    // 'frame' handler against its own arrow length (ml8 symptom 2 / per-
    // arrow coverage from the bead's option B).
    this.hudOverlay.update({
      enabled: this.filter.showHud,
      camera: this.camera,
      target: this.controls.target,
      worldOffset: this.worldOffset,
      focusedLocal,
      hideSolArrow: isSolFocus,
      sizeMaxPx: this.filter.sizeMax,
      cameraMode: this.focus.getCameraMode(),
      transition: this.getObserveTransitionProgress(),
      focusedDiscRadiusPx: this.getFocusedDiscRadiusPx(),
      w: window.innerWidth,
      h: window.innerHeight,
    });
  }

  private observeTmpFwd = new THREE.Vector3();
  private observeUpdateTarget() {
    // 1 pc ahead of the camera in its current look direction. Choice of 1 pc
    // is arbitrary — controls.target is serialised but never used as an
    // orbit pivot while OBSERVE is active. Any non-zero distance yields a
    // valid forward direction on round-trip.
    this.observeTmpFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.controls.target.copy(this.camera.position).add(this.observeTmpFwd);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    // observeControls owns its own pointer + wheel listeners; disable() is
    // idempotent so it's safe regardless of current mode.
    this.observeControls.disable();
    this.aim.dispose();
    this.warp.dispose();
    this.observe.dispose();
    this.focus.dispose();
    this.controls.dispose();
    this.starPipeline.dispose();
    this.extinctionPrepass?.dispose();
    this.extinctionPrepass = null;
    // Every scene layer (eager or lazily attached) disposes through the
    // registry — a registered layer can't be missing here.
    this.layers.disposeAll();
    this.localDepthPass.dispose();
    this.lgEmission = null;
    // The dust voxel grid is the largest single GPU allocation in the app
    // (~128 MiB Data3DTexture). MilkyWay shares the same texture handle but
    // doesn't own it.
    this.dust?.dispose();
    this.dust = null;
    this.renderer.dispose();
    this.bus.clear();
  }
}
