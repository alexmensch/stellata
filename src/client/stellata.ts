import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { Catalog } from './loaders/catalog-loader';
import { createBinarySystemMembership } from './binaries/binary-system-membership';
import { createPlanetSystemMembership } from './solar-system/planet-system-membership';
import { SystemMembershipRegistry } from './system-membership/system-membership';
import type { DustField, DustParticleData } from './loaders/dust-loader';
import {
  formatVerifyReports,
  verifyDustChunks,
  type ChunkVerifyReport,
} from './loaders/dust-voxel-readback';
import vertexShader from './star-pipeline/star.vert.glsl?raw';
import fragmentShader from './star-pipeline/star.frag.glsl?raw';
import perceptualDiscChunk from './star-pipeline/perceptual-disc/perceptual-disc.glsl?raw';
import dustRaymarchChunk from './star-pipeline/extinction/dust-raymarch.glsl?raw';
import { DustParticleLayer } from './dust/dust-particle-layer';

// Register the perceptual-disc chunk so star.{vert,frag} (and any
// future point-source layer) can `#include <stellata_perceptual_disc>`
// via three.js's standard ShaderChunk preprocessor. Side-effect at
// module load — runs once before any material compiles.
(THREE.ShaderChunk as Record<string, string>)['stellata_perceptual_disc'] =
  perceptualDiscChunk;
(THREE.ShaderChunk as Record<string, string>)['stellata_dust_raymarch'] =
  dustRaymarchChunk;
import { GalacticDisc } from './galactic/galactic-disc';
import { MAX_DISTANCE_PC, CAMERA_FAR_PC } from '../../scripts/local-group/build-local-group-pure';
import { CoordSphere, type DrawnCoordSphereFrame } from './galactic/coord-spheres/coord-sphere';
import {
  COORD_SPHERE_SPECS,
  DRAWN_COORD_SPHERE_FRAMES,
  coordSphereFadeAt,
  coordSphereReachableAt,
} from './galactic/coord-spheres/coord-sphere-frames';
import { HudOverlay } from './overlays/hud-overlay';
import { ChartLabels } from './chart-mode/chart-labels';
import { GALACTIC_CENTRE_PC } from './galactic/galactic-coords';
import type { CloudCatalog } from './molecular-clouds/cloud-loader';
import { MilkyWay } from './milkyway/milkyway';
import { ObserveControls } from './camera/observe/observe-controls';
import {
  mark as perfMark,
  measure as perfMeasure,
  frame as perfFrame,
  gpuBegin as perfGpuBegin,
  gpuEnd as perfGpuEnd,
} from './debug/perf-hud';
import { GPU_WHOLE_FRAME_SCOPE } from './debug/gpu-timing/gpu-timer';
import { resolveAndPublishGpuFrame } from './debug/gpu-timing/gpu-frame-samples';
import { RenderGate } from './render-gate/render-gate';
import { TrackballSettle } from './camera/controls/input/trackball-settle';
import { exposureCutMoved } from './render-gate/render-gate-pure';
import {
  CADENCE_REPORT_STILL,
  cadenceSimBudgetS,
  clockFrameDue,
  maxCadenceReport,
  pulsationCadenceBudgetS,
  type CadenceReport,
} from './render-gate/cadence/clock-cadence-pure';
import {
  CADENCE_TRUST_INITIAL,
  auditCadenceFrame,
  type CadenceTrustState,
} from './render-gate/cadence/cadence-trust-pure';
import { HdrPipeline } from './hdr/hdr-pipeline';
import type { HdrSeam, ReductionSeam } from './hdr/hdr-seam';
import {
  angularToPx as angularToPxPure,
  type ResolvedCandidate,
} from './camera/controls/star-geometry';
import * as starPhysics from './camera/controls/star-physics';
import { resolveStarPickVisibility } from './camera/controls/star-pick-visibility-pure';
import { chartDiscPxForAppMag } from './chart-mode/chart-disc-pure';
import { paperClearColour } from './chart-mode/chart-palette';
import { Picker } from './camera/controls/picker';
import { AimController } from './camera/controls/aim-controller';
import { ReferenceUpController } from './camera/controls/input/reference-up';
import { WarpController } from './camera/warp/warp-controller';
import { ObserveTransition } from './camera/observe/observe-transition';
import { lookPinStale, writeLookPin } from './camera/observe/look-pin-pure';
import { PoiStore } from './poi/poi-store';
import { InputController } from './camera/controls/input/input-controller';
import {
  FocusController,
  type FrameAnchor,
  GLOBAL_MIN_DIST_PC,
} from './camera/focus/focus-controller';
import { KIND_TRAITS, type FocusableProviders, type Target } from './camera/focus/focus-target';
import type { KindContext } from './kinds/kind-module';
import {
  collectKindPicks,
  KIND_ROSTER,
  mergeKindDetailBinds,
  type BuiltKindModules,
} from './kinds/kind-modules';
import type { ConstellationOfKind } from './focus-card/constellation-row';
import { focalRideStep } from './camera/focus/focal-ride-pure';
import { makeFocalAnchorPolicy } from './camera/focus/focal-anchor-policy';
import type { StellataRenderer, WebGpuSeam, WebGpuStarLayer } from './webgpu/seam';
import type { PlanetSystem } from './solar-system/planet-system';
import { OrbitRingsLayer } from './solar-system/ephemerides/orbit-rings-layer';
import type { PlanetBodyField } from './solar-system/planets/planet-body-field';
import { LocalDepthPass } from './local-depth/local-depth-pass';
import { SolarSystemCluster } from './solar-system/local-cluster';
import { StarLocalMirror } from './star-pipeline/local-pass/star-local-mirror';
import { StarLocalCluster } from './star-pipeline/local-pass/star-local-cluster';
import {
  PHYS_RATIO_THRESHOLD,
  RESOLVED_DISC_MIN_PX,
} from './star-pipeline/local-pass/star-local-cluster-pure';
import { VirtualClock, tToJDE } from './solar-system/time/time';
import { J2000_JD } from './util/astronomy-constants';
import { uploadFull } from './util/attribute-upload';
import { apparentMagnitude } from './solar-system/perceptual-magnitude';
// Locally used subset; other warp-timing constants re-exported below
// for external import paths still pointing at './stellata'.
import { CAMERA_NEAR_PC, DCAM_LOG_FLOOR_PC } from './camera/timing';
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
} from './filters/filter-state';
import { FilterController } from './filters/filter-controller';
import { ExposureController } from './hdr/exposure/exposure-controller';
import { exposureForMagLimit } from './hdr/exposure/exposure-epoch';
import { SceneAdaptation } from './hdr/exposure/scene-adaptation';
import { LuminanceReduction } from './hdr/exposure/reduction/reduction-pass';
import { SceneLayerRegistry, updateWarpGatedRefLayer, type FrameCtx } from './scene/scene-layer';
import {
  type SceneElementBinds,
  type SceneElementId,
  SCENE_ELEMENT_IDS,
} from './scene/scene-elements';
import { StarPipeline } from './star-pipeline/star-pipeline';
import { CATALOG_BOUNDING_RADIUS_PC } from './star-pipeline/shards/star-shards-pure';
import { StarFrame } from './star-pipeline/star-frame/star-frame';
import { buildSharedUniforms, type SharedUniforms } from './frame/shared-uniforms';
import { FloatingOrigin } from './frame/floating-origin';
import { ExtinctionPrepass } from './star-pipeline/extinction/extinction-prepass';
import type {
  ExtinctionPrepassSeam,
} from './star-pipeline/extinction/extinction-seam';
import { BinaryOrbitField } from './binaries/binary-orbit-field';
import { BinaryOrbitPathLayer } from './binaries/binary-orbit-path-layer';
import { ConstellationFigureLayer } from './constellation-figure/constellation-figure-layer';
import { ConstellationBoundaryLayer } from './constellation-boundaries/constellation-boundary-layer';
import {
  createConstellationRegions,
  type ConstellationLabelAnchor,
  type ConstellationNamer,
} from './constellation-boundaries/constellation-regions';
import type { BoundaryArtifact } from '../../scripts/catalog/boundaries/boundaries-artifact-pure';
import {
  EclipsePhotometryField,
  type EclipseRelationDebugRow,
} from './binaries/eclipse/eclipse-photometry';
import { type BinariesData } from './binaries/binaries-loader';
import { buildPulsationSuppressMask } from './star-pipeline/pulsation/pulsation-suppress-pure';

export interface StellataOptions {
  canvas: HTMLCanvasElement;
  catalog: Catalog;
  /** Kind-module record with every artifact already loaded — the
   *  constructor attaches each module, and an unloaded one attaches to
   *  an empty roster (kinds/kind-modules.ts). */
  kinds: BuiltKindModules;
  /** Pre-initialised WebGPU boot seam (webgpu/README.md). Absent =
   *  the shipped WebGL2 boot, byte-identical to before the seam. */
  webgpu?: WebGpuSeam | null;
}

export type CameraMode = 'navigate' | 'observe';

/** One of the scenes a boot draws, named so a debug read can say which
 *  one a resource came from (`sceneGraphs`). */
export interface NamedScene {
  readonly name: string;
  readonly scene: THREE.Scene;
}

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
  readonly renderer: StellataRenderer;
  /** Narrowed WebGL2 renderer — null on a WebGPU boot. GL-only consumers
   *  (extinction prepass, GPU timer, frame pricing) gate on it instead of
   *  casting `renderer`. */
  readonly rendererGL: THREE.WebGLRenderer | null;
  /** WebGPU boot seam — null on the shipped WebGL2 boot. Port children
   *  reach their scene and the shared uniform nodes through it. */
  readonly webgpu: WebGpuSeam | null;
  private webgpuStarLayer: WebGpuStarLayer | null = null;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: TrackballControls;
  readonly hdr: HdrSeam;
  readonly referenceUp = new ReferenceUpController();

  private scene: THREE.Scene;
  // Star render pipeline — one InstancedBufferGeometry feeds three
  // ShaderMaterials (core depth-mask / disc / glow). Owns the dispose
  // contract for the densest resource cluster in the app.
  private starPipeline!: StarPipeline;
  // The shared view/screen uniform map (frame/README.md § Shared
  // uniforms) — every per-frame write goes through this field, never
  // through a star material's uniforms object.
  private sharedUniforms!: SharedUniforms;
  // Dust-particle render layer. Currently shelved — see
  // src/client/star-pipeline/extinction/README.md.
  private dustParticles!: DustParticleLayer;

  // The floating-origin service — worldOffset, the ordered recentre
  // fan-out, and the focal anchor policy (frame/README.md).
  private floatingOrigin!: FloatingOrigin;
  // Epoch advance, the derived per-instance buffers, and the
  // Sol-distance proximity queries — see star-pipeline/star-frame/README.md.
  // The shell reads `localPositions` through it and drives the
  // per-frame calls.
  private starFrame!: StarFrame;
  private get worldOffset(): THREE.Vector3 { return this.floatingOrigin.worldOffset; }
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
  // See src/client/binaries/eclipse/README.md § Pulsation gate for eclipsing binaries.
  private _suppressPulsation: Float32Array;
  // Lazily attached when main.ts loads public/binaries.bin. Null until
  // then — the renderer functions identically with the static catalog
  // positions; binary orbital evolution simply doesn't fire.
  private binaryOrbitField: BinaryOrbitField | null = null;
  private binariesData: BinariesData | null = null;

  /** Kind-generic system membership (multi-star clusters, planet
   *  systems) — hover roster cards and collapsed-pick resolution both
   *  consume this. See src/client/system-membership/README.md. */
  readonly systemMembership = new SystemMembershipRegistry();
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

  // Moving-focal ride state — the sibling of the binary ride above for
  // hard focus kinds whose object moves with `t` (a planet sweeping its
  // orbit, a probe running its trajectory; both fast under scrubber FF).
  // The camera + orbit target translate by the object's per-frame
  // local-position delta so it stays under the camera and user pan
  // offsets survive. `_movingRideIdx` reseeds on every 'focus' event,
  // which is what makes the shared slot safe across kinds — see
  // camera/focus/README.md § Moving-focal ride.
  private readonly _movingRideLast = new THREE.Vector3();
  private readonly _movingRideLive = new THREE.Vector3();
  private readonly _movingRideDelta = new THREE.Vector3();
  private _movingRideIdx: number | null = null;

  // Filter / preset / render-knob state + mutations live in
  // FilterController (filters/README.md); the shell reads the live
  // state through this getter for per-frame gates and dep closures.
  readonly filters!: FilterController;
  private get filter(): Readonly<FilterState> { return this.filters.getFilter(); }
  // Owns the exposure scalar and the three magnitude bounds derived from
  // it — instrument limit, just-visible threshold, population cull
  // (hdr/exposure/README.md § One writer, five slots).
  readonly exposure!: ExposureController;
  // Per-frame scene-luminance measurement feeding the automatic exposure
  // cut (hdr/README.md § Adaptation).
  readonly adaptation!: SceneAdaptation;
  readonly reduction: ReductionSeam;
  private readonly drawingBufferSize = new THREE.Vector2();

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

  readonly observe!: ObserveTransition;
  private observeControls!: ObserveControls;

  private clock = new VirtualClock();

  // Focus, distance-vector destination, and cameraMode all live on
  // FocusController (camera/focus/README.md) as Target sum types,
  // exposed as a readonly namespace like every controller below.
  readonly focus!: FocusController;
  private monochrome = false;
  readonly warp!: WarpController;
  readonly aim!: AimController;

  readonly pois!: PoiStore;
  // Canvas pointer input — click FSM (single/double, both modes) and the
  // roll gestures. See camera/controls/input/README.md § Input controller.
  readonly input!: InputController;

  // Galactic reference layers. Disc fades in by camera-distance
  // from Sol and is always-on. The coordinate spheres are gated by
  // `filter.coordSphere`, which admits only one of them at a time.
  // The HUD (Sol/GC arrows + OBSERVE-mode ring) is gated by
  // `filter.showHud`. Mono mode swaps strokes to a paper-chart palette via
  // setMonochrome on each layer (HUD is CSS-only).
  private galacticDisc: GalacticDisc;
  // Representational layer — only renders when the host is focused.
  private orbitRingsLayer: OrbitRingsLayer;
  private binaryOrbitPathLayer: BinaryOrbitPathLayer;
  private constellationFigureLayer: ConstellationFigureLayer;
  private constellationBoundaryLayer: ConstellationBoundaryLayer;
  // Empty / null until attachConstellationBoundaries lands the artifact, which
  // is optional — every consumer must read them as "not yet".
  private constellationLabels: readonly ConstellationLabelAnchor[] = [];
  private constellationNamer: ConstellationNamer | null = null;
  // Active-figure-set signature; skips a rebuild when a filter emit didn't
  // change which constellations draw. Poison '\0' forces the first refresh.
  private conFigureSig = '\0';
  /** Kind-module record — one module per migrated TargetKind, null while
   *  a kind's wiring is still inline (kinds/README.md). Public so search
   *  and overlays dispatch generic legs (displayName, searchEntries). */
  readonly kinds: BuiltKindModules;
  // Physical layer — renders for every attached host regardless of
  // focus, gated by per-planet apparent magnitude + per-host distance
  // cull. Owned by the planet module; read here for cross-kind wiring.
  private get planetBodyField(): PlanetBodyField { return this.kinds.planet.field; }
  readonly localDepthPass = new LocalDepthPass();
  readonly renderGate = new RenderGate();
  private readonly trackballSettle: TrackballSettle;
  private lastInvalidatedDm = Number.NaN;
  // Clock-cadence state (render-gate/README.md § The clock cadence).
  // The budget seeds 0 so the first tick under a running clock is due;
  // the NaN sim stamp makes clockFrameDue's first read due too and marks
  // the first frame's step as unmeasurable.
  private cadenceBudgetSimS = 0;
  private lastRenderedSimS = Number.NaN;
  private cadenceLastReport: CadenceReport = CADENCE_REPORT_STILL;
  private cadenceTrust: CadenceTrustState = CADENCE_TRUST_INITIAL;
  private pulsationCadenceBudgetS = Number.POSITIVE_INFINITY;
  /** Ride translation applied to the camera during THIS frame's fan-out,
   *  summed over both rides. Divided by the frame's sim step to give the
   *  camera velocity every layer differences its own content against. */
  private readonly _rideAccum = new THREE.Vector3();
  private cadenceFrameId = 0;
  private readonly cadenceCtx = {
    camera: null as unknown as THREE.PerspectiveCamera,
    frameId: 0,
    pxPerRadian: 0,
    simDtS: Number.NaN,
    cameraVelPcPerSimS: new THREE.Vector3(),
  };
  // Read on the NEXT tick is NOT good enough for this one: a layer that
  // starts needing wall-clock frames while the gate idles would wait a
  // whole cap for them, and forever with the clock paused. Evaluated
  // above the gate, every tick (scene/scene-layer.ts LayerTimeBehaviour).
  private _realtimeFramesNeeded = false;
  private coreMaskEnabled = true;
  private starLocalCluster: StarLocalCluster;
  private solarCluster: SolarSystemCluster;
  private coordSpheres: Record<DrawnCoordSphereFrame, CoordSphere>;
  readonly hud: HudOverlay;
  /** Chart-mode label + glyph engine. `chart-mode.ts` starts / stops it on
   *  the chart activation predicate; the shell owns its lifetime. */
  readonly chartLabels = new ChartLabels(this);

  // Milky Way analytic background. Constructed eagerly so the
  // band is on during first paint. Dust is wired in once the volumetric
  // texture attaches.
  readonly milkyway: MilkyWay;

  // Reference to the most recently attached DustField — kept solely so
  // dispose() can release the ~128 MiB Data3DTexture. attachDust(null)
  // clears it.
  private dust: DustField | null = null;

  // Per-star A_V cache, one implementation per backend behind the shared
  // seam. Constructed lazily on the first attachDust so a dust-less
  // session pays nothing; null again after attachDust(null).
  private extinctionPrepass: ExtinctionPrepassSeam | null = null;
  private readonly pickSizeScratch: starPhysics.RenderedSizeComponents =
    { appMag: 0, appSizePx: 0, physSizePx: 0, physSizePxUncapped: 0 };

  // Pure target resolver; the click FSM in onPointerUp + the observe
  // single/double-click dispatchers stay here as composition-layer
  // orchestration.
  readonly picker!: Picker;

  // Per-kind geometry registry (camera/focus/focus-target.ts). Overlays
  // and pickers dispatch `focusables[target.kind].<leg>(target.idx)`
  // instead of per-kind shell methods.
  readonly focusables!: FocusableProviders;

  constructor({ canvas, catalog, kinds, webgpu }: StellataOptions) {
    this.catalog = catalog;
    this.kinds = kinds;

    this.webgpu = webgpu ?? null;
    if (this.webgpu !== null) {
      this.renderer = this.webgpu.renderer;
      this.rendererGL = null;
    } else {
      this.rendererGL = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance',
        logarithmicDepthBuffer: true,
      });
      this.renderer = this.rendererGL;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x000000, 0);
    // Each boot owns one HDR chain: the WebGPU pipeline (and its
    // reduction) come pre-built on the seam, behind the import boundary.
    if (this.webgpu !== null) {
      this.hdr = this.webgpu.hdr;
      this.reduction = this.webgpu.hdr.reduction;
    } else {
      this.hdr = new HdrPipeline(this.rendererGL!);
      this.reduction = new LuminanceReduction(this.rendererGL!);
    }

    this.scene = new THREE.Scene();

    // `CAMERA_FAR_PC` is paired with `MAX_DISTANCE_PC` so the build filter
    // and camera can never drift; see build-local-group-pure.ts. Near-plane
    // derivation lives on `CAMERA_NEAR_PC` in camera/timing.ts.
    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR_PC,
      CAMERA_FAR_PC,
    );
    this.camera.position.set(0, 0, 30);
    this.camera.up.copy(this.referenceUp.get());

    // TrackballControls (instead of OrbitControls) because we want
    // unconstrained rotation — no polar clamping at the zenith/nadir, so
    // the user can orbit past the poles continuously.
    this.controls = new TrackballControls(this.camera, canvas);
    this.controls.rotateSpeed = 3.0;
    this.controls.zoomSpeed = 1.1;
    this.controls.staticMoving = false;
    this.controls.dynamicDampingFactor = 0.15;
    this.controls.minDistance = GLOBAL_MIN_DIST_PC;
    this.controls.maxDistance = MAX_DISTANCE_PC;
    this.controls.target.set(0, 0, 0);
    this.controls.noPan = true;
    // Empty drag-mode key slots: TrackballControls' A/S/D defaults would
    // otherwise claim the S grid / D debug shortcuts.
    this.controls.keys = ['', '', ''];
    this.trackballSettle = new TrackballSettle(this.controls);

    // OBSERVE-mode look-around controller. Starts disabled; enable() runs
    // when the camera mode flips, with TrackballControls.enabled toggled
    // off in the same step so the two schemes never compete for input.
    this.observeControls = new ObserveControls(
      canvas,
      this.camera,
      (fov) => this.setCameraFov(fov),
      () => this.camera.fov,
    );

    const sharedUniforms = buildSharedUniforms({
      pixelRatio: this.renderer.getPixelRatio(),
      fovYRad: (this.camera.fov * Math.PI) / 180,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      hdr: this.hdr.emitterUniforms,
    });
    this.sharedUniforms = sharedUniforms;
    this.webgpu?.bindSharedUniforms(sharedUniforms);
    // Constructed before every consumer of the magnitude bounds: it
    // rewrites all five slots from its own constructor, so the seeds in
    // buildSharedUniforms never reach a shader.
    this.exposure = new ExposureController({
      uniforms: {
        uExposure: this.hdr.emitterUniforms.uExposure,
        uOmegaSummationArcsec2: this.hdr.emitterUniforms.uOmegaSummationArcsec2,
        uLimitMag: sharedUniforms.uLimitMag,
        uThresholdMag: sharedUniforms.uThresholdMag,
        uCullMag: sharedUniforms.uCullMag,
      },
      onChange: () => {
        this.bus.emit('filter', this.filter);
        this.bus.emit('state');
      },
    }, DEFAULT_FILTER.instrument);

    this.floatingOrigin = new FloatingOrigin(sharedUniforms.uWorldOffset);
    // Advances catalog.positions to the model clock and derives every
    // per-instance buffer off the result, so the pipeline attributes
    // below and every consumer downstream read current-epoch positions
    // by construction.
    this.starFrame = new StarFrame({
      catalog,
      uniforms: sharedUniforms,
      worldOffset: this.floatingOrigin.worldOffset,
      cameraPosition: this.camera.position,
      t: this.getT(),
      onLocalPositionsWritten: () => {
        uploadFull(this.starPipeline.iPositionAttr);
        this.binaryOrbitField?.markBaselinesDirty();
      },
    });
    // The star kind module's legs read the shell-owned star machinery
    // through these closures — all deref lazily, so the picker and
    // focus controller constructed below are fine.
    this.kinds.star.setRuntime({
      localPositionInto: (idx, out) => this.starFrame.localPositionInto(idx, out),
      parkDistForStar: (idx) => this.focus.parkDistForStar(idx),
      renderedSizePx: (idx) => this.renderedSizePxFor(idx),
      pickStarHit: (x, y, pxThreshold) => this.picker.pickStarHit(x, y, pxThreshold),
      getBinaries: () => this.binariesData,
    });
    // Recentre fan-out, in load-bearing order: star buffer rewrite →
    // camera / orbit-target shift → scene-layer recenter hooks.
    this.floatingOrigin.onRecenter((origin) => this.starFrame.rewriteAt(origin));
    this.floatingOrigin.onRecenter((_origin, delta) => {
      this.camera.position.sub(delta);
      this.controls.target.sub(delta);
    });
    this.floatingOrigin.onRecenter((origin) => this.layers.recenterAll(origin));
    this._compositeSuppress = new Float32Array(catalog.count);
    this._eclipseDim = new Float32Array(catalog.count).fill(1);
    // Built here (not attachBinaries) because the gate is varType-driven
    // and binary-independent; see the field declaration for the rationale.
    this._suppressPulsation = buildPulsationSuppressMask(catalog.varType);

    this.starPipeline = new StarPipeline({
      scene: this.scene,
      catalog,
      logRadii: this.starFrame.logRadii,
      lumClassF32: this.starFrame.lumClassF32,
      distSol: this.starFrame.distSol,
      teffApsis: this.starFrame.teffApsis,
      localPositions: this.starFrame.localPositions,
      compositeSuppress: this._compositeSuppress,
      eclipseDim: this._eclipseDim,
      suppressPulsation: this._suppressPulsation,
      vertexShader,
      fragmentShader,
      sharedUniforms,
      boundingSphereRadiusPc: CATALOG_BOUNDING_RADIUS_PC,
    });

    // The TSL star layer renders in place of the GLSL pipeline above on a
    // WebGPU boot (the shell's scene is never rendered there). The GLSL
    // pipeline still constructs either way: its attributes are the live
    // source buffers this layer watches, and the writers keep writing them.
    this.webgpuStarLayer = this.webgpu?.attachStarLayer({
      catalog,
      logRadii: this.starFrame.logRadii,
      lumClassF32: this.starFrame.lumClassF32,
      distSol: this.starFrame.distSol,
      teffApsis: this.starFrame.teffApsis,
      boundingSphereRadiusPc: CATALOG_BOUNDING_RADIUS_PC,
      iPositionAttr: this.starPipeline.iPositionAttr,
      iPulsAttr: this.starPipeline.iPulsAttr,
      iCompositeSuppressAttr: this.starPipeline.iCompositeSuppressAttr,
      iEclipseDimAttr: this.starPipeline.iEclipseDimAttr,
      iSuppressPulsationAttr: this.starPipeline.iSuppressPulsationAttr,
    }) ?? null;

    // Shared uniforms passed by reference so floating-origin recenters,
    // resize updates, and dust loads propagate to the particle pass
    // automatically. On a WebGPU boot the sprite takes its slots off the
    // uniform-node mirror instead and lands in the scene that renders.
    this.dustParticles = new DustParticleLayer(
      this.webgpu?.scene ?? this.scene,
      sharedUniforms,
      this.webgpu?.dustParticleMaterials,
    );

    // Galactic reference layers — disc is always added; grid hides itself
    // until enabled. The HUD (ring + Sol/GC arrows) is pure SVG inside the
    // existing #overlay so it shares the distance vector's stroke + halo
    // styling and inherits the `body.warping` hide rule for free.
    this.galacticDisc = new GalacticDisc();
    this.scene.add(this.galacticDisc.group);
    this.orbitRingsLayer = new OrbitRingsLayer();
    this.binaryOrbitPathLayer = new BinaryOrbitPathLayer();
    // One mirror per boot: the pass scene renders on whichever backend
    // booted, so the mirror's materials must match it.
    const starMirror = this.webgpuStarLayer?.localMirror ?? new StarLocalMirror(
      this.starPipeline.geometry,
      vertexShader,
      fragmentShader,
      sharedUniforms,
    );
    this.starLocalCluster = new StarLocalCluster(
      starMirror,
      this.binaryOrbitPathLayer,
      sharedUniforms.uLocalMemberIdx as { value: Int32Array },
      {
        catalog,
        localPositions: () => this.localPositions,
        renderedSizeComponents: (idx, out) => this.renderedSizeComponentsFor(idx, out),
        forEachStarNearCamera: (d, cb) => this.starFrame.forEachStarNearCamera(d, cb),
        // Membership needs physSize ≥ PHYS_RATIO_THRESHOLD × pxSize with
        // pxSize ≥ RESOLVED_DISC_MIN_PX, so the widest useful window is
        // where the largest star's disc crosses the product.
        scanWindowPc: () =>
          this.starFrame.discWindowPcFor(RESOLVED_DISC_MIN_PX * PHYS_RATIO_THRESHOLD),
      },
    );
    this.localDepthPass.register(this.starLocalCluster);
    this.constellationFigureLayer = new ConstellationFigureLayer();
    this.scene.add(this.constellationFigureLayer.group);
    this.constellationBoundaryLayer = new ConstellationBoundaryLayer(sharedUniforms);
    this.scene.add(this.constellationBoundaryLayer.group);
    // Measured against the instrument's OWN exposure, never the live
    // scalar the cut then writes — that would be a feedback loop.
    this.adaptation = new SceneAdaptation({
      baseExposure: () => exposureForMagLimit(this.exposure.getLimitMag()),
      reduced: () => this.reduction.current(),
      measurementReady: () => !this.reduction.readbackPending,
      whitePoint: () => this.hdr.emitterUniforms.uWhitePoint.value,
    });
    // Kind-module attach, in roster order. Each returned scene layer
    // registers HERE — before every inline-wired layer — so every
    // moving-body field has written this frame's positions by the time
    // the first inline entry runs the moving-focal ride.
    const kindCtx: KindContext = {
      scene: this.scene,
      camera: this.camera,
      canvas: this.renderer.domElement,
      sharedUniforms,
      // WebGPU exposes no equivalent through three's public surface, so that
      // boot takes the spec's guaranteed floor for maxTextureDimension2D —
      // 8192, which is the texture ladder's top rung anyway, so nothing
      // clamps on a device whose real limit is only ever higher.
      maxTextureSize: this.rendererGL?.capabilities.maxTextureSize ?? 8192,
      solIndex: catalog.solIndex,
      solAbsInto: (out) => {
        const si = catalog.solIndex;
        if (si < 0) return false;
        out.set(
          catalog.positions[si * 3],
          catalog.positions[si * 3 + 1],
          catalog.positions[si * 3 + 2],
        );
        return true;
      },
      angularToPx: () => this.angularToPx(),
      starPhotometry: (idx) => this.kinds.star.photometry(idx),
      systemMembership: this.systemMembership,
      getT: () => this.getT(),
      getWorldOffset: () => this.worldOffset,
      getFocusedTarget: () => this.focus.getFocusedTarget(),
      getMonochrome: () => this.monochrome,
      detailPermits: (id) => this.detailPermits(id),
      constellationOf: (kind, idx) => this.constellationOf(kind, idx),
      onFrame: (handler) => this.bus.on('frame', handler),
      requestRender: (reason) => this.renderGate.invalidate(`kind:${reason}`),
      webgpu: this.webgpu,
    };
    for (const kind of KIND_ROSTER) {
      const layer = this.kinds[kind]?.attach(kindCtx);
      if (layer) this.layers.register(layer);
    }
    this.solarCluster = new SolarSystemCluster(
      this.kinds.planet.field,
      this.kinds.planet.meshLayer,
      this.orbitRingsLayer,
      this.kinds.probe.field,
      this.kinds.probe.pathLayer,
      this.starLocalCluster,
    );
    this.localDepthPass.register(this.solarCluster);
    if (this.webgpu !== null) {
      // The built-in line layers stay OUT of the pass scene on this boot:
      // LineBasicMaterial's lone fragment output fails WGSL pipeline
      // creation against the HDR target's three attachments, and one
      // invalid pipeline poisons the whole pass submit. They return with
      // the TSL line material (webgpu/README.md § Every park is a gate).
      this.solarCluster.group.remove(this.orbitRingsLayer.group);
      this.solarCluster.group.remove(this.kinds.probe.pathLayer.localGroup);
      this.starLocalCluster.group.remove(this.binaryOrbitPathLayer.group);
    }
    // System-membership registry: binaries FIRST so a collapsed pair's
    // outer primary leads the union over the member's planet-host role.
    this.systemMembership.register(
      createBinarySystemMembership({
        getBinaries: () => this.binariesData,
        isCollapsed: (i) => this.isCompositeSuppressed(i),
      }),
    );
    this.systemMembership.register(
      createPlanetSystemMembership({
        getAttachedPlanetSystem: (h) => this.planetBodyField.getAttachedPlanetSystem(h),
        hostPlanetOf: (i) => this.planetBodyField.hostPlanetOf(i),
        instanceIndexOf: (h, p) => this.planetBodyField.instanceIndexOf(h, p),
        isCollapsedOntoParent: (i) =>
          this.planetBodyField.isCollapsedOntoParent(i, this.camera),
      }),
    );

    // Picker resolves every layer's "what's under (x, y)?" — composed
    // by the click FSM in onPointerUp and by the hover providers.
    // Kind-module surfaces dispatch through `kindPicks`; the remaining
    // getters cover the inline-wired star path.
    this.picker = new Picker({
      domElement: this.renderer.domElement,
      camera: this.camera,
      catalog: this.catalog,
      sortedByDistFromSol: this.starFrame.sortedByDistFromSol,
      sortedDistFromSol: this.starFrame.sortedDistFromSol,
      getLocalPositions: () => this.localPositions,
      getFilter: () => this.filter,
      kindPicks: collectKindPicks(this.kinds),
      renderedSizePxFn: (idx) => this.pickPrefilterSizePxFor(idx),
      getSuppressPulsation: () => this._suppressPulsation,
      drawCutoffMagFn: (chart) => this.exposure.drawCutoffMag(chart),
      resolveStarPick: (idx) => this.resolveStarPick(idx),
      resolveCollapsedLead: (idx) => this.collapsedClusterLead(idx),
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
      referenceUp: this.referenceUp,
      setFocalBodyHidden: (target) => this.setFocalBodyHidden(target),
      getWarp: () => this.warp,
      getObserve: () => this.observe,
      getFocusables: () => this.focusables,
      focalPerturbationInto: (idx, out) =>
        this.binaryOrbitField?.focalPerturbationInto(idx, this.getT(), out) ?? false,
    });
    // Kind-agnostic geometry + focus-state registry — the shell's
    // per-kind knowledge in one exhaustive record. Lazily-attached
    // layers are read through closures, so attach cycles need no
    // re-registration. See camera/focus/README.md § FocusableProviders.
    this.focusables = {
      star: this.kinds.star.focusable(),
      cloud: this.kinds.cloud.focusable(),
      lg: this.kinds.lg.focusable(),
      shell: this.kinds.shell.focusable(),
      probe: this.kinds.probe.focusable(),
      planet: this.kinds.planet.focusable(),
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
        this.sharedUniforms.uChartMagBright.value,
      focus: this.focus,
    });
    this.observe = new ObserveTransition({
      camera: this.camera,
      controls: this.controls,
      observeControls: this.observeControls,
      aim: this.aim,
      referenceUp: this.referenceUp,
      setFocalBodyHidden: (target) => this.setFocalBodyHidden(target),
      bus: this.bus,
      focus: this.focus,
      getCameraMode: () => this.focus.getCameraMode(),
      setCameraModeValue: (mode) => this.focus.setCameraModeValue(mode),
    });
    this.buildFocalAnchorPolicy();
    // Orbit rings are representational layers gated on host-focus. Planet
    // bodies live in PlanetBodyField and render whenever inside the
    // per-host cull distance regardless of focus. (The heliopause is no
    // longer focus-coupled — the declutter cycle governs it, like the
    // Local Bubble.)
    this.on('planetSystem', (ps) => {
      this.orbitRingsLayer.setPlanetSystem(ps, this.catalog.solIndex, this.getT());
    });
    // Orbit paths rebuild on every focus mutation: the focused system's
    // Kepler pairs, or none when focus leaves a multi-star system.
    this.on('focus', () => {
      this.binaryOrbitPathLayer.setSystem(
        this.binariesData,
        this.focus.getFocusedStar(),
        this.catalog.positions,
      );
    });
    // Reseed the moving-focal ride on every focus mutation: a focus
    // change AND a same-object refocus both recentre the floating
    // origin, which stales the ride's cached last position. The seed
    // frame re-snaps against the fresh frame. This is also what keeps
    // the shared ride slot safe when the kind changes but the index
    // collides (planet 3 → probe 3).
    this.on('focus', () => { this._movingRideIdx = null; });
    // Constellation figure lines rebuild when the active set changes: the
    // highlighted figure, or chart ↔ navigate (chart draws all 88).
    // Detail-cycle permission is a separate push (buildSceneElementBinds).
    // The boundary fade window rides the same emit: it is a function of the
    // magnitude limit — a fainter limit admits stars nearer their walls —
    // pushed rather than read per frame so the table interpolation runs once
    // per instrument change. The layer draws in chart only, which hard-clips
    // at the instrument limit and inherits no exposure state, so the EV trim
    // must not move the window.
    this.on('filter', () => {
      this.refreshConstellationFigure();
      this.constellationBoundaryLayer.setMagnitudeLimit(this.exposure.getLimitMag());
    });
    this.on('cameraMode', () => {
      this.refreshConstellationFigure();
      // The observe transitions write controls.target directly, so the
      // look pin must be re-derived on the next observe frame even if the
      // camera never rotated across the switch.
      this.observePinQuat.set(Number.NaN, 0, 0, 0);
    });
    this.coordSpheres = {
      galactic: new CoordSphere(COORD_SPHERE_SPECS.galactic),
      equatorial: new CoordSphere(COORD_SPHERE_SPECS.equatorial),
    };
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
      this.scene.add(this.coordSpheres[frame].group);
    }
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
    this.hud = new HudOverlay(
      hudRing, solPath, solBg, gcPath, gcBg, solLabel, gcLabel,
      () => this.aimAt(this.tmpVec3b.copy(this.worldOffset).negate()),
      () => this.aimAt(this.tmpVec3b.copy(GALACTIC_CENTRE_PC).sub(this.worldOffset)),
    );

    // Milky Way volumetric disc. A flattened ellipsoid mesh anchored at
    // the galactic centre; the fragment shader does a bounded raymarch
    // through its volume. renderOrder = -3 keeps it behind every other
    // layer.
    this.milkyway = new MilkyWay({
      uLimitMag: sharedUniforms.uLimitMag,
      hdr: this.hdr.emitterUniforms,
    }, this.webgpu?.bandMaterials);
    // The band has ported, so on a WebGPU boot it belongs in the scene
    // that renders.
    (this.webgpu?.scene ?? this.scene).add(this.milkyway.group);

    this.filters = new FilterController({
      camera: this.camera,
      uniforms: sharedUniforms,
      bus: this.bus,
      onFilterApplied: (f) => {
        this.exposure.setInstrument(f.instrument);
        // Per-host distance cull on the planet body field is closed-form
        // in the population bound — refresh the cached cullDistancePc
        // whenever the instrument moves it.
        this.planetBodyField.setCullMag(sharedUniforms.uCullMag.value);
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

    // Compute initial pixel sizes for the instrument against the real
    // viewport. DEFAULT_FILTER carries placeholder pixel values; this call
    // replaces them with the right numbers before the first frame.
    this.filters.recomputeStarPxSizes();
    this.syncPixelSolidAngle();

    this.pois = new PoiStore({
      pinnable: {
        star: (idx) => this.kinds.star.pinnable(idx),
        // Pinnable ⊇ URL-encodable: any attached planet pins in-session,
        // but only Sol's SID domain is wired (main.ts planetDomainIndexOf),
        // so a future non-Sol host's pin works live yet won't round-trip
        // through ?v=.
        planet: (idx) => this.kinds.planet.pinnable(idx),
        probe: (idx) => this.kinds.probe.pinnable(idx),
        lg: (idx) => this.kinds.lg.pinnable(idx),
        shell: (idx) => this.kinds.shell.pinnable(idx),
        cloud: (idx) => this.kinds.cloud.pinnable(idx),
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
    // Catalog-wide constant: the fastest pulsating variable bounds how
    // long any frame may idle before some star's brightness moves a JND.
    // Allowed to be a constant only because it does not bind — see
    // `pulsationCadenceBudgetS`.
    this.pulsationCadenceBudgetS = pulsationCadenceBudgetS(
      catalog.periodDays, catalog.amplitudeMag, this._suppressPulsation,
    );
    this.registerSceneLayers();
    // Seed the declutter cycle so the imperative-push layers receive their
    // initial permission. `detailPermitted` starts all-true for the
    // per-frame readers, but a layer that only learns its permission from
    // a bind (both boundary shells, the orbit/probe overlays) would sit at
    // whatever its constructor guessed until the user cycled the level —
    // which is how the heliopause shell rendered nothing on a fresh load
    // while its label, a per-frame reader, showed. `resetOverrides: false`
    // so a later `?v=` restore still owns the within-scene toggles.
    this.filters.applyDetailPreset(this.filters.getDetailLevel(), false);
    window.addEventListener('resize', this.onResize);
    this.renderGate.attachDom(canvas);
    this.trackballSettle.attachDom(canvas);
    this.bus.on('state', () => this.renderGate.invalidate('bus:state'));
    this.bus.on('planetSystem', () => this.renderGate.invalidate('bus:planetSystem'));
    this.input = this.createInputController();
    this.animate();
  }

  // Rebuild the constellation figure geometry for the active set: the
  // highlighted figure, all 88 in chart mode, or none. Skips the rebuild when
  // the active set is unchanged (filter emits fire on every slider drag).
  private refreshConstellationFigure(): void {
    const f = this.filter;
    const chartActive = f.chart && this.focus.getCameraMode() === 'observe';
    const sig = `${chartActive ? 1 : 0}|${f.highlightCon}`;
    if (sig === this.conFigureSig) return;
    this.conFigureSig = sig;
    let indices: number[];
    if (chartActive) {
      indices = this.catalog.constellations.map((_, i) => i);
    } else if (f.highlightCon >= 0) {
      indices = [f.highlightCon];
    } else {
      indices = [];
    }
    this.constellationFigureLayer.setFigures(
      this.catalog.constellations, indices, this.localPositions);
  }

  // One adapter entry per scene layer; registration order is per-frame
  // update order (kind-module layers registered ahead of these in the
  // constructor's roster loop). Warp gating is per-entry: reference
  // layers hide during warp, physical/light layers keep ticking. See
  // scene/README.md.
  private registerSceneLayers(): void {
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => this.planetBodyField.cadenceReport(cc),
      },
      update: (ctx) => {
        // Ride runs right after every moving-body field wrote this
        // frame's positions — the whole module roster updates ahead of
        // this, the first inline entry — mirroring the binary ride's
        // placement after its orbit walk.
        this.applyMovingFocalRide();
        // Mesh LOD sizes off the post-ride camera: pre-ride it would
        // see the focused body a whole per-frame delta away and drop
        // the mesh under fast scrub. That is why this update lives on
        // the shell rather than inside the planet module's layer.
        this.kinds.planet.meshLayer.update(ctx.camera, ctx.t);
      },
      dispose: () => {},
    });
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => this.planetBodyField.cadenceReport(cc),
      },
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
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => this.planetBodyField.cadenceReport(cc),
      },
      // After the field + rings updates it reads; before the main
      // render its suppression uniforms gate. Owns no GPU resources —
      // the star mirror it feeds is disposed with the star cluster.
      update: (ctx) => this.solarCluster.update(ctx.camera),
      dispose: () => {},
    });
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => maxCadenceReport(
          this.binaryOrbitField?.cadenceReport(cc) ?? CADENCE_REPORT_STILL,
          this.eclipsePhotometryField?.cadenceReport(cc.simDtS) ?? CADENCE_REPORT_STILL,
        ),
      },
      update: (ctx) => {
        this.updateBinaryOrbits();
        // After the walk wrote this frame's slots, so each path rides its
        // pair's live barycentre drift.
        this.binaryOrbitPathLayer.update(this.localPositions, ctx.camera, window.innerHeight);
      },
      recenter: (newOrigin) => this.binaryOrbitField?.recenter(newOrigin),
      dispose: () => {
        this.binaryOrbitField?.dispose();
        this.eclipsePhotometryField?.dispose();
        this.binaryOrbitPathLayer.dispose();
      },
    });
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => maxCadenceReport(
          this.binaryOrbitField?.cadenceReport(cc) ?? CADENCE_REPORT_STILL,
          this.eclipsePhotometryField?.cadenceReport(cc.simDtS) ?? CADENCE_REPORT_STILL,
        ),
      },
      // After the binary walk + eclipse photometry + path-layer update:
      // membership reads this frame's positions and path visibility, and
      // the mirror sync re-copies the slots those fields just wrote.
      update: (ctx) => this.starLocalCluster.update(ctx.camera, {
        monochrome: this.monochrome,
        focalIdx: this.focus.getFocusedStar(),
        thresholdMag: this.exposure.getThresholdMag(),
      }),
      dispose: () => this.starLocalCluster.dispose(),
    });
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => maxCadenceReport(
          this.binaryOrbitField?.cadenceReport(cc) ?? CADENCE_REPORT_STILL,
          this.eclipsePhotometryField?.cadenceReport(cc.simDtS) ?? CADENCE_REPORT_STILL,
        ),
      },
      // After the binary + planet walks so a figure vertex that is a binary
      // member re-copies its live slot (orbital motion under scrub, epoch
      // advance, recentre — all land in localPositions with no separate signal).
      update: () => this.constellationFigureLayer.update(this.localPositions),
      setMonochrome: (on) => this.constellationFigureLayer.setMonochrome(on),
      dispose: () => this.constellationFigureLayer.dispose(),
    });
    this.layers.register({
      // B1875 boundary arcs on a Sol-centred sphere: a frozen-epoch
      // partition, camera-anchored. No term in it is a function of t.
      timeBehaviour: { kind: 'static' },
      // Chart-only — floor 'never' in the realistic column.
      update: (ctx) => updateWarpGatedRefLayer(
        this.constellationBoundaryLayer, ctx,
        this.detailPermits('constellationBoundaries')),
      setMonochrome: (on) => this.constellationBoundaryLayer.setMonochrome(on),
      dispose: () => this.constellationBoundaryLayer.dispose(),
    });
    this.layers.register({
      // Fixed galactic reference geometry, camera-anchored.
      timeBehaviour: { kind: 'static' },
      update: (ctx) => updateWarpGatedRefLayer(
        this.galacticDisc, ctx, this.detailPermits('galacticDiscWireframe')),
      setMonochrome: (on) => this.galacticDisc.setMonochrome(on),
      dispose: () => this.galacticDisc.dispose(),
    });
    this.layers.register({
      // Camera-tracked frames; the only distance-dependent behaviour is a
      // fade window, and distance only moves on a camera move, which
      // renders anyway.
      timeBehaviour: { kind: 'static' },
      // Both spheres are camera-tracked; a spec's optional fade window is the
      // only distance-dependent behaviour, and only the equatorial frame has
      // one (galactic/README.md § Coordinate spheres).
      update: (ctx) => {
        // `coordSphere` must never name a sphere that can't draw — travelling
        // out of a frame's fade deselects it rather than leaving the panel's
        // stop highlighted-yet-disabled, which reads as nothing selected.
        // Fires once per crossing, since the demotion clears its own trigger,
        // and it is the single owner of the gone-at-zero-alpha cut.
        const selected = this.filter.coordSphere;
        if (selected !== 'none' && !coordSphereReachableAt(selected, ctx.distFromSol)) {
          this.filters.setFilter({ coordSphere: 'none' });
        }
        for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
          const sphere = this.coordSpheres[frame];
          const on = !ctx.warpActive && this.filter.coordSphere === frame;
          sphere.group.visible = on;
          if (!on) continue;
          sphere.setOpacityScale(coordSphereFadeAt(frame, ctx.distFromSol));
          sphere.update(ctx.camera.position);
        }
      },
      setMonochrome: (on) => {
        for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
          this.coordSpheres[frame].setMonochrome(on);
        }
      },
      dispose: () => {
        for (const frame of DRAWN_COORD_SPHERE_FRAMES) this.coordSpheres[frame].dispose();
      },
    });
    this.layers.register({
      // Pure projection: it reads the focal position and projects arrow
      // tips, adding no motion of its own. Whatever it points at is
      // bounded by the layer that OWNS that object — which is why every
      // focusable kind has to declare a rate, not just the ones that
      // happen to be pinnable today.
      timeBehaviour: { kind: 'static' },
      update: (ctx) => this.updateHud(ctx.warpActive),
      setMonochrome: (on) => this.hud.setMonochrome(on),
      dispose: () => this.hud.dispose(),
    });
    this.layers.register({
      // Skybox re-anchored to camera.position; the raymarch reads the
      // absolute camera. No `t` dependence.
      timeBehaviour: { kind: 'static' },
      // Re-anchors the skybox mesh to camera.position and refreshes the
      // absolute-camera uniform for the raymarch. Visible during warp.
      update: (ctx) => this.milkyway.update(ctx.camera, ctx.worldOffset),
      dispose: () => this.milkyway.dispose(),
    });
    this.layers.register({
      // Teardown leg only — the layer is shelved and draws nothing.
      timeBehaviour: { kind: 'static' },
      dispose: () => this.dustParticles.dispose(),
    });
    this.layers.register({
      // Teardown leg only; the per-frame work rides the 'frame' event, so
      // it runs on rendered frames and cannot need one of its own.
      timeBehaviour: { kind: 'static' },
      // Per-frame work rides the 'frame' event (chart-mode.ts drives
      // start / stop on the activation predicate), so only the teardown
      // leg registers here.
      dispose: () => this.chartLabels.dispose(),
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
   *  local origin. Returns a fresh Float64Array copy each call (see
   *  `PlanetBodyField.getHostLocalPositions`) — safe to cache across
   *  frames; the value semantics survive attach grow / detach shift. */
  getFocusedPlanetLocalPositions(): Float64Array | null {
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
        localPositions: this.localPositions,
        uniforms: this.sharedUniforms,
      }) * 0.5;
    }
    if (t?.kind === 'planet') {
      return this.planetBodyField.renderedPlanetSizePx(t.idx, this.camera.position) * 0.5;
    }
    if (t?.kind === 'probe') return this.focusables.probe.renderedSizePx(t.idx) * 0.5;
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
    this.notifyClockJumped();
  }

  /** Owed by every discrete jump of the clock, whoever moved it — the
   *  scrubber's Jump and Reset mutate the `VirtualClock` directly to keep
   *  the current rate, so they cannot rely on `setT`. Reseeds t-sampled
   *  kind state at the NEW `t` (a URL restore applies its focus before the
   *  next frame, and a stale probe sample recentres onto where the object
   *  was at page load), then emits — which is also what repaints a jump
   *  made while the clock is paused (`render-gate/README.md`). */
  notifyClockJumped(): void {
    for (const kind of KIND_ROSTER) this.kinds[kind]?.clockJumped?.(this.getT());
    this.bus.emit('state');
  }
  getMonochrome(): boolean { return this.monochrome; }

  // True whenever a camera-position lerp is in flight — warp, observe
  // enter/exit, OR the navigate-mode unfocus zoom-out. URL-state writes
  // gate on this to avoid serialising transient mid-lerp poses; the end
  // of each animation schedules a final write with the settled pose.
  isCameraTransitionActive(): boolean {
    return this.warp.isActive() || this.observe.isAnyActive();
  }

  /** Hide/unhide the rendered body of a hard-focus target — observe
   *  parks the camera AT the object, whose disc would render from the
   *  interior. One choke point dispatching through every module's
   *  setFocalHidden leg (the star module's writes the uHideFocusIdx
   *  shader pin). Passing null (or a kind switch) unhides the other
   *  kinds' slots. */
  private setFocalBodyHidden(target: Target | null): void {
    for (const kind of KIND_ROSTER) {
      this.kinds[kind]?.setFocalHidden?.(target?.kind === kind ? target.idx : -1);
    }
  }

  private tmpRecenter = new THREE.Vector3();

  // Shift the renderer's local origin to `newOrigin` (an absolute-space
  // coordinate) — FloatingOrigin.recenterTo, whose listener fan-out
  // rewrites the star buffer, shifts camera + orbit target, and runs
  // the scene-layer recenter hooks (frame/README.md § Recentre fan-out).
  //
  // Triggered automatically from FocusController.setFocus() and
  // WarpController.tryMidFlyRecentre. Don't call externally — it
  // bypasses the state-change bookkeeping that setFocus threads through.
  // Returns the applied delta (shared scratch; null on no-op) so callers
  // can migrate auxiliary state captured in the old frame.
  recenterOrigin(newOrigin: THREE.Vector3): THREE.Vector3 | null {
    return this.floatingOrigin.recenterTo(newOrigin);
  }

  // Scrubber-time star motion: when the model clock crosses a re-advance
  // bucket, StarFrame re-runs the epoch-advance pass off the immutable
  // J2016.0 baseline. Runs at the top of animate() so BinaryOrbitField /
  // eclipse photometry rewrite their active slots on top of the fresh
  // baselines in the same frame. When a star is focused, the camera +
  // orbit target (+ any in-flight transition pose caches) translate by
  // the focal's space-motion delta — the same follow contract
  // applyFocalFrameRide implements for orbital drift — so the pin
  // invariant (target === focal live position) survives the move. Skipped
  // during warp: the warp owns the camera and re-snaps on arrival.
  private maybeReAdvanceEpoch(): void {
    const focal = this.focus.getFocusedStar();
    const d = this._epochFollowDelta;
    if (!this.starFrame.advanceEpochTo(this.getT(), focal, d)) return;
    // The rewrite changed what the frame would draw, and the cadence can
    // no longer assume nothing moved: a bucket crossing between cadence
    // frames must repaint.
    this.renderGate.invalidate('epoch-bucket');
    if (this.warp.isActive() || d.lengthSq() === 0) return;
    this.camera.position.add(d);
    this.controls.target.add(d);
    this.focus.translateFocusFrame(d);
    this.observe.translateFocusFrame(d);
  }

  // Which controllers constitute "the camera is busy" is the shell's to
  // know; the policy itself lives in camera/focus/ so frame/ imports no
  // camera code.
  private buildFocalAnchorPolicy(): void {
    this.floatingOrigin.setPolicy(makeFocalAnchorPolicy({
      hasHardFocus: () => this.focus.getFocusedHardTarget() !== null,
      isCameraBusy: () => this.warp.isActive()
        || this.aim.isActive()
        || this.aim.isObserveAimActive()
        || this.focus.isFocusLerpActive()
        || this.observe.isAnyActive(),
      cameraPosition: this.camera.position,
      orbitTarget: this.controls.target,
      worldOffset: this.floatingOrigin.worldOffset,
    }));
  }

  // Wire a loaded DustField into the star shader. Safe to call after the
  // Stellata is already rendering — uniforms flip atomically on the next
  // frame. Safe to call multiple times; the most recent dust wins. Pass
  // null to detach (e.g. to disable extinction for a mode toggle).
  attachDust(dust: DustField | null) {
    this.renderGate.invalidate('attach:dust');
    const u = this.sharedUniforms;
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
      this.webgpu?.setDustTexture(null);
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
    // Texture slots are not part of the WebGPU uniform-node mirror, so the
    // volume reaches the TSL march by call rather than by map write
    // (webgpu/tsl/README.md § Shared uniform nodes).
    this.webgpu?.setDustTexture(dust.texture);
    if (this.extinctionPrepass === null) {
      this.extinctionPrepass = this.webgpu !== null
        ? this.webgpu.attachExtinctionPrepass({
          positions: this.catalog.positions,
          count: this.catalog.count,
          uniforms: u,
        })
        : new ExtinctionPrepass({
          renderer: this.rendererGL!,
          positions: this.catalog.positions,
          count: this.catalog.count,
          uniforms: u,
        });
    }
    this.extinctionPrepass?.markDirty();
    // Each streamed voxel chunk changes sightline integrals — refresh the
    // cache as the texture densifies.
    dust.onProgress(() => {
      this.extinctionPrepass?.markDirty();
      this.renderGate.invalidate('dust-chunk');
    });
    // Share the same DustField with the Milky Way pass so the band's dust
    // attenuation shows the actual Edenhofer voxel structure (Great Rift,
    // Coalsack, etc.) rather than only the analytic slab.
    this.milkyway.attachDust(dust);
  }

  /** Numeric check that streamed dust really is in the volume texture where
   *  the uploader put it: samples voxels off the GPU and compares them
   *  against the chunk files. Identical on both backends, and the only
   *  verification a WebGPU boot has until something samples the volume.
   *  Logs a summary and returns the reports.
   *  `loaders/README.md` § Dust voxel readback. */
  async verifyDust(count?: number): Promise<ChunkVerifyReport[]> {
    if (this.dust === null) {
      console.warn('verifyDust: no dust attached');
      return [];
    }
    const reports = await verifyDustChunks({
      renderer: this.renderer,
      dust: this.dust,
      count,
    });
    for (const line of formatVerifyReports(reports)) console.log(line);
    return reports;
  }

  /** Attach (or replace) the parsed binaries.bin runtime table. Idempotent;
   *  passing null detaches. From the moment the field is attached every
   *  frame walks the binary relation list and perturbs the relevant
   *  star-pipeline `iPosition` slots against `getT()`. */
  attachBinaries(binaries: BinariesData | null): void {
    this.renderGate.invalidate('attach:binaries');
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
      basePositions: this.starFrame.basePositions,
      velocities: this.catalog.velocities,
      absoluteMags: this.catalog.absmag,
      localPositions: this.localPositions,
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
      localPositions: this.localPositions,
      absoluteMags: this.catalog.absmag,
      physicalRadiusSolar: this.catalog.physicalRadius,
      eclipseDimBuffer: this._eclipseDim,
      iEclipseDimAttr: this.starPipeline.iEclipseDimAttr,
    });
  }

  private updateBinaryOrbits(): void {
    if (!this.binaryOrbitField) return;
    const uniforms = this.sharedUniforms;
    const viewport = uniforms.uViewport.value;
    const fovYRad = uniforms.uFovYRad.value;
    this.binaryOrbitField.update(
      this.getT(),
      this.camera.position,
      this.exposure.getThresholdMag(),
      viewport.y,
      fovYRad,
      this.focus.getFocusedStar(),
    );
    this.applyFocalFrameRide();
    // Runs after the orbit walk so the camera→primary line of sight
    // reads post-perturbation positions; the pair-relative geometry is
    // evaluated independently in float64. See
    // src/client/binaries/eclipse/README.md.
    this.eclipsePhotometryField?.update(
      this.getT(),
      this.camera.position,
      this.exposure.getThresholdMag(),
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
    this.applyRideDelta(this._rideDelta);
  }

  /** Translate the camera, the look target and both transition caches by
   *  one ride step, tell the gate the step was not camera activity, and
   *  add it to the frame's camera velocity.
   *
   *  Shared by both rides because a delta that reaches the camera without
   *  reaching `rebasePose` reinstates the pin: the ride runs below the
   *  gate, so the next tick reads the write as a fresh camera move,
   *  renders, rides again, and never reaches a skipped tick
   *  (render-gate/README.md § The focal ride). */
  private applyRideDelta(delta: THREE.Vector3): void {
    if (delta.lengthSq() === 0) return;
    this.camera.position.add(delta);
    this.controls.target.add(delta);
    this.focus.translateFocusFrame(delta);
    this.observe.translateFocusFrame(delta);
    this.renderGate.rebasePose(delta);
    this._rideAccum.add(delta);
  }

  // Moving-body sibling of applyFocalFrameRide, over the shared
  // focalRideStep. For every hard focus kind whose object MOVES in the
  // local frame as `t` advances — a planet sweeping its orbit, a probe
  // running its trajectory — the object's full live local position plays
  // the role the star ride's perturbation does: its frame-to-frame delta
  // is what the camera / target / transition caches translate by, so the
  // object stays glued to controls.target, pan offsets survive, and the
  // camera rides the whole trajectory at any fast-forward rate. Seed
  // frames (focus change, warp) resync the baseline; the observe-mode
  // guard in focalRideStep suppresses the seed target re-snap, where
  // target is the parsec-ahead look pin rather than on the object.
  private applyMovingFocalRide(): void {
    const focused = this.focus.getFocusedTarget();
    if (focused === null || !KIND_TRAITS[focused.kind].moving) {
      this._movingRideIdx = null;
      return;
    }
    const idx = focused.idx;
    const live = this._movingRideLive;
    if (!this.focusables[focused.kind].localPositionInto(idx, live)) {
      this._movingRideIdx = null;
      return;
    }
    const step = focalRideStep({
      focal: idx,
      rideFocalIdx: this._movingRideIdx,
      warpActive: this.warp.isActive(),
      focalPert: live,
      lastAppliedPert: this._movingRideLast,
      liveLocal: live,
      target: this.controls.target,
      observeMode: this.focus.getCameraMode() === 'observe',
    });
    this._movingRideIdx = step.rideFocalIdx;
    this._movingRideLast.set(step.px, step.py, step.pz);
    this._movingRideDelta.set(step.dx, step.dy, step.dz);
    this.applyRideDelta(this._movingRideDelta);
  }

  /** Debug-HUD view into the eclipse field's per-relation walk for the
   *  current camera/filter/sim-time. Empty when no binaries attached. */
  eclipseDebugRows(starIdx: number | null): EclipseRelationDebugRow[] {
    return this.eclipsePhotometryField?.debugRows(
      this.getT(),
      this.camera.position,
      this.exposure.getThresholdMag(),
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
      localPositions: this.localPositions,
      uniforms: this.sharedUniforms,
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
      localPositions: this.localPositions,
      uniforms: this.sharedUniforms,
      filter: this.filter,
      suppressPulsation: this._suppressPulsation,
    }, out);
  }

  private chartDiscPxFor(appMag: number): number {
    return chartDiscPxForAppMag(
      appMag,
      starPhysics.getChartDiscParams(this.sharedUniforms),
      this.exposure.getLimitMag(),
    );
  }

  /** Upper bound on the radius `resolveStarPick` will report — what
   *  `pickFromCandidatesResolved`'s prime/fallback partition requires of
   *  the prefilter, and the reason the two can't just call the same
   *  function: chart inks a magnitude-mapped disc rather than the
   *  realistic footprint and either curve can be the larger, so the
   *  bound has to cover both. Extinction only dims, and a dimmer star
   *  maps to a smaller disc on both curves, so the resolved radius can
   *  only shrink from here. */
  private pickPrefilterSizePxFor(idx: number): number {
    const c = this.renderedSizeComponentsFor(idx, this.pickSizeScratch);
    const px = Math.max(c.appSizePx, c.physSizePx);
    return this.filter.chart ? Math.max(px, this.chartDiscPxFor(c.appMag)) : px;
  }

  /** Dust extinction the shader will apply to this star, in magnitudes.
   *  Zero when the prepass is inert — the in-vertex fallback still dims
   *  the star, but reproducing its march on the CPU would need the
   *  ~128 MiB voxel grid the loader uploads and drops. Erring toward
   *  "pickable" there keeps the fallback path's behaviour unchanged. */
  private extinctionAvMagFor(idx: number): number {
    const raw = this.extinctionPrepass?.readAvMag(idx);
    if (raw === null || raw === undefined) return 0;
    return raw * this.sharedUniforms.uDustEnabled.value
      * this.sharedUniforms.uExtinctionStrength.value;
  }

  /** Whether the renderer puts a pixel on screen for this star, and the
   *  disc radius it actually draws — the pick gate proper, as against
   *  `drawCutoffMag`'s intrinsic-magnitude prefilter. Costs a GPU
   *  readback, so it runs per pick candidate and never per frame
   *  (`camera/controls/star-geometry.ts` `pickFromCandidatesResolved`). */
  private resolveStarPick(idx: number): ResolvedCandidate {
    const c = starPhysics.renderedSizeComponents({
      catalog: this.catalog,
      idx,
      camPos: this.camera.position,
      localPositions: this.localPositions,
      uniforms: this.sharedUniforms,
      filter: this.filter,
      suppressPulsation: this._suppressPulsation,
      extinctionAvMag: this.extinctionAvMagFor(idx),
    }, this.pickSizeScratch);
    return resolveStarPickVisibility({
      focalHidden: this.sharedUniforms.uHideFocusIdx.value === idx,
      eclipseDim: this._eclipseDim[idx],
      chartDiscPx: this.filter.chart ? this.chartDiscPxFor(c.appMag) : null,
      limitMag: this.exposure.getLimitMag(),
      components: c,
      appSizePxForMag: (m) =>
        starPhysics.appSizePxForMag(m, this.filter, this.sharedUniforms.uSizeKnee.value),
      exposure: this.hdr.emitterUniforms.uExposure.value,
      thresholdMag: this.exposure.getThresholdMag(),
      whitePoint: this.hdr.emitterUniforms.uWhitePoint.value,
    });
  }

  /** User-facing extinction multiplier scaling the A_V re-added on top of
   *  the intrinsic (build-time de-extincted) catalog. 0 = dust-free
   *  universe (stars at intrinsic brightness/colour everywhere, not
   *  "observed from Sol"); 1 = physical realism; values above 1 amplify
   *  dust visually. Independent of attachDust — if no dust is loaded, this
   *  has no effect. Also drives the Milky Way background so the
   *  dust-darkened regions of the band track the same knob. */
  setExtinctionStrength(x: number) {
    this.sharedUniforms.uExtinctionStrength.value = Math.max(0, x);
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

  /** Whether the A_V prepass cache is live this frame (dust attached,
   *  float target, not parked by the A/B switch) — the frame-cost
   *  harness's presence probe. */
  isExtinctionPrepassActive(): boolean {
    return this.extinctionPrepass?.isActive() ?? false;
  }

  /** Debug kill switch for the star core depth-mask draw AND the
   *  per-frame near-camera scan that gates it (frame-cost
   *  differentials). Backgrounds bleed through close star cores while
   *  false — never leave it off outside a measurement dwell. */
  setCoreMaskEnabled(on: boolean) {
    this.coreMaskEnabled = on;
  }

  /** Attach the IAU boundary arcs. The layer is constructed in the ctor and
   *  already in the scene; this builds its geometry and seeds the fade window
   *  once the async load resolves, then binds the artifact's other two
   *  readings — the chart label anchors, and the membership lookup every
   *  non-stellar focus card resolves through. */
  attachConstellationBoundaries(artifact: BoundaryArtifact): void {
    this.renderGate.invalidate('attach:boundaries');
    this.constellationBoundaryLayer.attach(artifact, this.exposure.getLimitMag());
    this.constellationBoundaryLayer.setMonochrome(this.monochrome);
    const regions = createConstellationRegions(artifact, this.catalog.constellations);
    this.constellationLabels = regions.labelAnchors;
    this.constellationNamer = regions.namer;
  }

  /** Latin-name anchors for the chart-mode label engine — one per IAU region,
   *  so Serpens carries two. Empty until the boundary artifact loads. */
  get constellationLabelAnchors(): readonly ConstellationLabelAnchor[] {
    return this.constellationLabels;
  }

  /** The IAU constellation a focusable object's own position falls in, in the
   *  Sol frame — the convention every catalogue, almanac and observing guide
   *  reports, and one of the two exceptions the focus card's camera-relative
   *  rule admits. For the bodies that move it is an ephemeris statement, not a
   *  property: a planet's answer tracks `getT()` because its position does.
   *
   *  Null before the boundary artifact loads, for Sol at the origin, and for
   *  an object with no resolvable position this frame.
   *
   *  `star` is excluded because byte 34 is the shipped authority there — it
   *  survives a missing artifact and carries the designation-constellation
   *  split beside it — and `shell` because the Local Bubble and the heliopause
   *  are centred on Sol, so a direction from Sol says nothing about them. */
  constellationOf(kind: ConstellationOfKind, idx: number): string | null {
    const namer = this.constellationNamer;
    if (!namer) return null;
    const abs = this.tmpConstellationAbs;
    if (!this.focusables[kind].localPositionInto(idx, abs)) return null;
    return namer.nameAt(abs.add(this.worldOffset));
  }

  /** Catalog of clouds, or null when the cloud module has no layer.
   *  Exposed for chart-mode name rows. */
  getCloudCatalog(): CloudCatalog | null {
    const layer = this.kinds.cloud.layer;
    return layer ? { count: layer.clouds.length, clouds: layer.clouds } : null;
  }

  private tmpVec3b = new THREE.Vector3();
  private tmpHostLocal = new THREE.Vector3();
  private tmpConstellationAbs = new THREE.Vector3();

  /** Build the dust-particle mesh from loaded data. The layer is shelved
   *  — see src/client/dust/README.md before re-enabling. */
  attachDustParticles(data: DustParticleData) {
    this.renderGate.invalidate('attach:dustParticles');
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
        this.renderGate.invalidate('dust-particles:loaded');
      });
    }
    this.dustParticles.setStrength(x);
    this.renderGate.invalidate('dust-particles:strength');
  }


  // Read-only view of the local-frame star positions, bound to the GPU
  // iPosition attribute. Overlays should project through this rather than
  // catalog.positions so their math runs in the same frame as the camera.
  get localPositions(): Float32Array { return this.starFrame.localPositions; }

  /** Bucketised Julian epoch year the catalog positions currently sit at.
   *  Changes exactly when a re-advance rewrote the positions buffers —
   *  overlays that skip stationary frames must key on it alongside the
   *  camera transform. */
  get advancedEpochJyr(): number { return this.starFrame.advancedEpochJyr; }

  /** Every scene graph this boot draws, for debug-scoped READS — the
   *  memory inventory walks them (`debug/memory/README.md`).
   *
   *  Plural because a dual boot renders the SEAM's scene and not the
   *  shell's, so an inventory of either alone prices a scene that is not
   *  on screen. Adding or removing objects through these handles bypasses
   *  the scene-layer registry, so every update / monochrome / recenter /
   *  dispose fan-out misses them. */
  get sceneGraphs(): readonly NamedScene[] {
    if (this.webgpu === null) return [{ name: 'shell', scene: this.scene }];
    return [
      { name: 'shell', scene: this.scene },
      { name: 'webgpu', scene: this.webgpu.scene },
    ];
  }

  // Read-only view of the pulsation-suppress mask. Overlays (focus ring,
  // distance vector tip) thread this through renderedSizePx so
  // the SVG estimate tracks the rendered disc on eclipsing-binary
  // primaries whose pulsation has been gated off.
  get suppressPulsation(): Float32Array { return this._suppressPulsation; }

  // Read-only view of the shared uniform map, typed against the subsets
  // consumed by star-physics.ts. Overlays / chart / debug surfaces that
  // call the per-star geometry helpers thread these through.
  get uniforms(): starPhysics.StarPhysicsUniforms & starPhysics.ChartDiscUniforms {
    return this.sharedUniforms;
  }

  /** FOV mutations stay a shell dispatcher (not `filters.setCameraFov`
   *  directly): every surface-brightness emitter scales by the pixel
   *  solid angle, so a FOV write must reach the HDR seam in the same
   *  call. */
  setCameraFov(fov: number) {
    this.filters.setCameraFov(fov);
    this.syncPixelSolidAngle();
  }

  /** Stroke alpha `frame`'s sphere draws at from the camera's current distance
   *  from Sol. Its SVG edge labels ride the same value. */
  coordSphereFade(frame: DrawnCoordSphereFrame): number {
    return coordSphereFadeAt(frame, this.frameCtx.distFromSol);
  }

  /** Is `frame`'s sphere visible at all from here? The `S` cycle and the
   *  panel's 3-stop control both gate on this so neither can select a sphere
   *  that has faded to nothing. */
  coordSphereReachable(frame: DrawnCoordSphereFrame): boolean {
    return this.coordSphereFade(frame) > 0;
  }

  // Declutter cycle. detailPermits is the per-frame read path layers gate
  // on (effective = permitted AND the layer's instance gates).
  detailPermits(id: SceneElementId): boolean { return this.detailPermitted[id]; }

  // Per-element bind adapters (exhaustive over SceneElementId — a new
  // renderable that isn't wired fails tsc). Each writes the permitted
  // cache; the imperative layers (Milky Way / LG-emission enable, orbit
  // rings) pass an `extra` push because they have no per-frame gate that
  // would pick the cache change up on its own — the shells take theirs
  // from the shell module's `detailBinds` instead.
  // Kind-module pushes route by element id, so migrating a kind needs no
  // edit here.
  private buildSceneElementBinds(): SceneElementBinds {
    const kindPush = mergeKindDetailBinds(this.kinds);
    const set = (id: SceneElementId, extra?: (on: boolean) => void) =>
      (on: boolean) => {
        this.detailPermitted[id] = on;
        extra?.(on);
        kindPush[id]?.(on);
      };
    return {
      stars: set('stars'),
      planetBodies: set('planetBodies'),
      probeMarkers: set('probeMarkers'),
      milkyWayBand: set('milkyWayBand', () => this.applyMilkywayEnabled()),
      milkyWayIsobar: set('milkyWayIsobar', (on) => {
        this.milkyway.setIsobar(on);
        this.applyMilkywayEnabled();
      }),
      lgEmissionGlow: set('lgEmissionGlow', () => this.applyLgEmissionEnabled()),
      galacticDiscWireframe: set('galacticDiscWireframe'),
      lgWireframes: set('lgWireframes'),
      orbitRings: set('orbitRings', (on) => this.orbitRingsLayer.setPermitted(on)),
      binaryOrbitRings: set('binaryOrbitRings', (on) => this.binaryOrbitPathLayer.setPermitted(on)),
      probeTrails: set('probeTrails'),
      heliopauseShell: set('heliopauseShell'),
      localBubbleShell: set('localBubbleShell'),
      constellationFigures: set('constellationFigures', (on) => this.constellationFigureLayer.setPermitted(on)),
      molecularCloudEllipsoids: set('molecularCloudEllipsoids'),
      dustParticles: set('dustParticles'),
      planetLabels: set('planetLabels'),
      probeLabels: set('probeLabels'),
      heliopauseLabel: set('heliopauseLabel'),
      localBubbleLabel: set('localBubbleLabel'),
      molecularCloudLabels: set('molecularCloudLabels'),
      mwLabel: set('mwLabel'),
      lgObjectLabels: set('lgObjectLabels'),
      chartStarNameLabels: set('chartStarNameLabels'),
      chartBayerGlyphs: set('chartBayerGlyphs'),
      chartVariableRings: set('chartVariableRings'),
      chartConstellationNames: set('chartConstellationNames'),
      chartCloudNames: set('chartCloudNames'),
      constellationBoundaries: set('constellationBoundaries'),
    };
  }

  private applyMilkywayEnabled(): void {
    // The layer group carries both realistic treatments: the volumetric
    // band (realistic floor) and the chart isobar (chart floor). Exactly
    // one is permitted per render style, and the floor is the only gate —
    // the band is physical light, not a user-toggleable overlay.
    this.milkyway.setEnabled(
      this.detailPermitted.milkyWayBand || this.detailPermitted.milkyWayIsobar);
  }
  private applyLgEmissionEnabled(): void {
    this.kinds.lg.setEmissionEnabled(
      this.detailPermitted.lgEmissionGlow && this.filter.showLgEmission);
  }

  setMonochrome(on: boolean) {
    if (this.monochrome === on) return;
    this.monochrome = on;
    this.sharedUniforms.uMonochrome.value = on ? 1 : 0;
    this.starPipeline.setMonochromeBlend(on);
    this.webgpuStarLayer?.setMonochrome(on);
    this.renderer.setClearColor(
      on ? paperClearColour(this.renderer.outputColorSpace) : 0x000000, on ? 1 : 0);
    this.hdr.setChartMode(on);
    // Per-layer palette swaps fan out through the registry. The milky-way
    // layer has no monochrome hook: chart mode re-purposes it as an isobar
    // contour via the `milkyWayIsobar` detail bind (chart floor); the cloud
    // layer's stippled chart outline rides its registry setMonochrome hook.
    this.layers.setMonochromeAll(on);
    this.bus.emit('state');
  }

  // Swing the camera to face the selected constellation while keeping the
  // orbit target and orbit radius unchanged — only the camera's position on
  // the orbit sphere moves. The aim point is the brightness-weighted
  // centroid of the figure stars as seen from the current target, so a
  // constellation looks "centered" on whichever of its members visually
  // dominate from the user's current vantage, even when the user has
  // travelled deep into 3D space.
  aimAtConstellation(conIndex: number) {
    this.focus.cancelUnfocusLerp();
    this.focus.cancelFocusLerp();
    if (this.observe.isActive()) return;
    const cons = this.catalog.constellations;
    const lines = conIndex >= 0 && conIndex < cons.length ? cons[conIndex].lines : undefined;
    if (!lines || lines.length === 0) return;

    const seen = new Set<number>();
    for (const polyline of lines) for (const i of polyline) seen.add(i);
    if (seen.size === 0) return;

    // Project in local frame so camera/target math stays internally
    // consistent under the floating origin.
    const positions = this.localPositions;
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
    this.focus.cancelUnfocusLerp();
    this.focus.cancelFocusLerp();
    if (this.observe.isActive()) return;
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
    return this.starFrame.localPositionInto(i, out);
  }

  /** Lead (first-seen outermost primary) of `idx`'s collapsed cluster,
   *  or `idx` itself when nothing around it is suppressed. The Picker
   *  routes every star pick through this so hover, POI pin, vector,
   *  and focus all act on the object the system card names. A host
   *  star always leads its own planet cluster, so the resolved lead is
   *  star-kind by construction. */
  private collapsedClusterLead(idx: number): number {
    const lead = this.systemMembership.collapsedLeadOf({ kind: 'star', idx });
    return lead.kind === 'star' ? lead.idx : idx;
  }

  /** True when BinaryOrbitField's sub-pixel LOD gate collapsed this
   *  star onto its primary this frame — the renderer's own "these read
   *  as one point" verdict. The star hover provider keys the
   *  system-card swap on it so card and rendering can't disagree. */
  isCompositeSuppressed(idx: number): boolean {
    return this._compositeSuppress[idx] === 1;
  }

  private createInputController(): InputController {
    return new InputController({
      canvas: this.renderer.domElement,
      camera: this.camera,
      controls: this.controls,
      picker: this.picker,
      bus: this.bus,
      poiStore: this.pois,
      referenceUp: this.referenceUp,
      getCameraMode: () => this.focus.getCameraMode(),
      getFilter: () => this.filter,
      getFocusedTarget: () => this.focus.getFocusedTarget(),
      getVectorTarget: () => this.focus.getVectorTarget(),
      setVector: (target) => this.focus.setVector(target),
      isWarpActive: () => this.warp.isActive(),
      isAimActive: () => this.aim.isActive(),
      isObserveTransitionActive: () => this.observe.isActive(),
      cancelUnfocusLerp: () => this.focus.cancelUnfocusLerp(),
      cancelFocusLerp: () => this.focus.cancelFocusLerp(),
      flyTo: (target) => this.focus.flyTo(target),
      setOrbitTarget: (target) => this.focus.setOrbitTarget(target),
      unfocus: () => this.focus.unfocus(),
      togglePoi: (target) => this.pois.toggle(target),
      aimAt: (p) => this.aimAt(p),
    });
  }

  private onResize = () => {
    this.renderGate.invalidate('resize');
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    // TrackballControls caches the canvas rect once, in its constructor, and
    // its rotate math measures the drag against that cached centre and width.
    this.controls.handleResize();
    this.hdr.syncSize();
    this.sharedUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.sharedUniforms.uViewport.value.set(w, h);
    // Aspect change → fov_minor moves → orbit floor needs a refresh while
    // a star is focused. (FOV-only changes go through setCameraFov, which
    // does its own recompute.)
    this.focus.refreshOrbitFloor();
    this.syncPixelSolidAngle();
    // Recompute pixel sizes from the instrument's plate scale so
    // non-overridden fields stay proportional to the bulge across screen
    // sizes and orientation changes. sizeSpan doesn't depend on the
    // viewport and is deliberately untouched here.
    this.filters.recomputeStarPxSizes();
  };

  // Every surface-brightness emitter scales by the pixel's solid angle,
  // so both of its inputs — viewport height and FOV — have to reach the
  // HDR seam. Resize and setCameraFov are the only writers of either.
  private syncPixelSolidAngle(): void {
    this.hdr.setPixelSolidAngle(this.angularToPx());
  }

  // Pixel-per-radian conversion for the active viewport / FOV. Shared
  // by every screen-space size calc (star disc, cloud silhouette, peak-
  // amplitude disc, glsl `physSizePx` mirror).
  private angularToPx(): number {
    const u = this.sharedUniforms;
    return angularToPxPure(u.uViewport.value.y, u.uFovYRad.value);
  }

  // Scratch slot for the non-allocating *LocalPositionInto helpers.
  // Owned by animate() and the methods it calls in sequence (the
  // scene-layer update fan-out); values are valid only inside that
  // scope. Adding a writer that retains the value across another
  // animate-stack method violates the contract.
  private _tmpAnimateLocal = new THREE.Vector3();

  private animate = () => {
    if (this.disposed) return;
    perfMark('frame.total');
    // One wall-clock read for the whole tick — the camera transitions,
    // the gate's activity stamp, and the adaptation slew all have to
    // agree on when this frame is. (`getT()` is the SIM clock and a
    // separate quantity; see solar-system/time/README.md.)
    const nowMs = performance.now();
    this.maybeReAdvanceEpoch();
    if (this.floatingOrigin.tick()) {
      // Policy recentre shifted the frame under the moving ride's cached
      // position — reseed to skip a one-frame jump. Keyed on tick()'s
      // return, never a recentre listener: a warp mid-fly recentre must
      // NOT reseed (focalRideStep owns that transition). The binary ride
      // tracks baseline-relative perturbation (frame-invariant) and
      // needs none.
      this._movingRideIdx = null;
    }
    // Both can invalidate the local-position buffer; StarFrame
    // coalesces them into a single rewrite. Must run before anything
    // downstream reads localPositions.
    this.starFrame.flushLocalPositions();
    perfMark('controls.update');
    // Roll bookkeeping, ahead of every orientation source: navigate-mode
    // `lookAt`s read camera.up, so the correction has to land before the
    // dispatch below. In observe the quaternion is the roll authority and
    // the reference follows it instead. See camera/controls/input/README.md
    // § Reference up axis.
    if (this.focus.getCameraMode() === 'observe') {
      this.referenceUp.adoptFromCamera(this.camera);
    } else {
      this.referenceUp.correct(this.camera);
    }
    // Cleared by the two steady-state branches alone, so a transition
    // added to this chain renders every frame by default — the safe
    // direction: a gate that guesses wrong here freezes the animation
    // it cannot see (render-gate/README.md).
    let cameraAnimating = true;
    if (this.warp.isActive()) {
      this.warp.tick(nowMs);
    } else if (this.aim.isActive()) {
      this.aim.tick(nowMs);
    } else if (this.focus.isFocusLerpActive()) {
      this.focus.tick(nowMs);
    } else if (this.aim.isObserveAimActive()) {
      this.aim.tickObserve(nowMs);
      // Observe-mode aim slerps the camera quaternion in place. The
      // controls.target still needs the per-frame re-pin so URL state stays
      // truthful mid-flight.
      this.observeUpdateTarget();
    } else if (this.observe.isAnyActive()) {
      this.observe.tick(nowMs);
    } else if (this.focus.getCameraMode() === 'observe') {
      cameraAnimating = false;
      // Look-around input (yaw/pitch/roll/FOV) mutates the camera directly
      // via observeControls + the existing two-finger handlers. update()
      // here advances any post-release momentum from a flick. Per-frame
      // we also re-pin controls.target one parsec ahead of the camera so
      // URL state writers (which serialise camera.position + target)
      // still round-trip the look direction correctly.
      this.observeControls.update();
      this.observeUpdateTarget();
    } else {
      cameraAnimating = false;
      this.trackballSettle.capture(this.camera);
      this.controls.update();
      this.trackballSettle.tick(
        this.camera, this.angularToPx(), this.sharedUniforms.uFovYRad.value,
      );
    }
    perfMeasure('controls.update');
    // The frame context is built ABOVE the gate now, because the
    // 'realtime' predicate has to be asked every tick: a layer that
    // starts needing wall-clock frames while the gate idles would
    // otherwise wait a whole cap for one, and forever with the clock
    // paused, which fires no cadence frame at all. Every input it needs
    // (camera, distance from Sol, t) is available pre-render.
    this.refreshFrameCtx();
    this._realtimeFramesNeeded = this.layers.realtimeFramesNeeded(this.frameCtx);
    // A running clock is no longer continuous by itself: the cadence
    // decides when elapsed sim time could visibly move anything drawn,
    // from the rate the layers reported on the LAST rendered frame
    // (render-gate/README.md § The clock cadence).
    const continuous = cameraAnimating || this._realtimeFramesNeeded;
    const cadenceDue = clockFrameDue(
      this.clock.getRate(), this.frameCtx.t, this.lastRenderedSimS, this.cadenceBudgetSimS,
    );
    if (!this.renderGate.tick(
      this.camera, this.controls.target, this.worldOffset,
      { continuous, cadenceDue, nowMs },
    )) {
      requestAnimationFrame(this.animate);
      return;
    }
    perfMark('pre-render');
    this.sharedUniforms.uCameraPos.value.copy(this.camera.position);
    // Pin the focused star at NDC (0,0) only when the geometric
    // invariant holds: navigate mode, no warp/aim animation, and the
    // user hasn't panned the camera target away from the focused star
    // (target ≈ local origin). Pan moves target away from the star and
    // we want it to render at its actual projected position again.
    const pinTarget = this.focus.isPinEngaged() ? this.focus.getFocusedStar() : -1;
    this.sharedUniforms.uPinFocusToCenter.value = pinTarget ?? -1;
    // Advance the variability clock on the model time base (shared with the
    // glow material via sharedUniforms). Days since J2000 from getT(), plus
    // the warp rate in model-days/real-second for the anti-strobe floor.
    this.sharedUniforms.uModelDays.value = tToJDE(this.getT()) - J2000_JD;
    this.sharedUniforms.uModelDaysPerRealSec.value = Math.abs(this.clock.getRate()) / 86400;
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
    // Per-frame layer fan-out through the registry. The context was
    // built above the gate; the extinction prepass and the pin above may
    // have moved nothing it reads, but the rides inside the fan-out do
    // move the camera, which is why the accumulator is cleared here and
    // read straight after.
    this._rideAccum.set(0, 0, 0);
    this.layers.updateAll(this.frameCtx);
    this.refreshCadence();
    // After the layer fan-out so the star cluster's membership is
    // current-frame: a member's core-mask stamp must render even when
    // the physSize-only window misses an appSize-driven member disc.
    perfMark('coreMask');
    const coreMaskOn = this.coreMaskEnabled &&
      (this.starLocalCluster.hasMembers() || this.starFrame.shouldEnableCoreMask());
    this.starPipeline.coreMaskMesh.visible = coreMaskOn;
    this.webgpuStarLayer?.setCoreMaskVisible(coreMaskOn);
    perfMeasure('coreMask');
    // Also after the fan-out: the statistic reads this frame's ephemeris
    // positions, and the cut it writes has to land before the first draw
    // so measurement and frame can never be one frame apart.
    const appliedDm = this.adaptation.measure(
      this.filter.chart, nowMs, this.frameCtx.warpActive,
    );
    this.exposure.setAdaptation(appliedDm);
    // One read for both halves of the park: the writes this frame draws and
    // the chain that reduces what they wrote have to gate together, or the
    // frame pays one without the other.
    const measurementParked = this.adaptation.isMeasurementParked();
    this.hdr.setStatisticWritesParked(measurementParked);
    // A moved cut changes the next frame's scene, so a slew in flight
    // must keep frames coming until it snaps — the gate cannot see it
    // otherwise.
    if (exposureCutMoved(appliedDm, this.lastInvalidatedDm)) {
      this.lastInvalidatedDm = appliedDm;
      this.renderGate.invalidate('exposure-cut');
    }
    perfMeasure('pre-render');
    perfGpuBegin(GPU_WHOLE_FRAME_SCOPE);
    perfMark('submit.main');
    perfGpuBegin('main');
    this.hdr.bind();
    if (this.webgpu !== null) {
      // Dual boot renders the seam's own scene — the shell's scene holds
      // GLSL materials that would fail WebGPU pipeline creation
      // (webgpu/README.md § What the flag boots today).
      this.webgpu.syncUniformNodes();
      this.renderer.render(this.webgpu.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    perfGpuEnd('main');
    perfMeasure('submit.main');
    perfMark('submit.localDepth');
    perfGpuBegin('localDepth');
    this.localDepthPass.render(this.renderer, this.camera);
    perfGpuEnd('localDepth');
    perfMeasure('submit.localDepth');
    perfMark('submit.tonemap');
    perfGpuBegin('tonemap');
    this.hdr.resolve();
    perfGpuEnd('tonemap');
    perfMeasure('submit.tonemap');
    // After the resolve, so reducing the statistic attachment never delays
    // the frame it measures. The readback lands a frame or two later, far
    // inside the slew (hdr/exposure/reduction/README.md § Latency).
    perfMark('submit.reduction');
    perfGpuBegin('reduction');
    this.measureAdaptationStatistic(measurementParked);
    perfGpuEnd('reduction');
    perfMeasure('submit.reduction');
    perfGpuEnd(GPU_WHOLE_FRAME_SCOPE);
    if (this.webgpu !== null) {
      // After the frame's LAST pass, so gpu.frame sums the whole stack.
      // Every rendered frame must resolve: the resolve is what recycles
      // the timestamp query pool, and trackTimestamp allocates a pair per
      // render pass whether or not anyone reads them. Skipping it while
      // the HUD is closed overruns the 2048-query pool in ~1024 frames.
      resolveAndPublishGpuFrame(
        this.webgpu.renderer, this.webgpu.timestampsAvailable);
    }
    perfMark('frame.handlers');
    this.bus.emit('frame');
    perfMeasure('frame.handlers');
    perfMeasure('frame.total');
    perfFrame();
    requestAnimationFrame(this.animate);
  };

  /** Refresh the shared per-frame context. Runs ABOVE the gate: the
   *  `'realtime'` predicate needs it on skipped ticks too, and every
   *  input is available pre-render. `distFromSol` is the camera's
   *  absolute ICRS distance, summed in JS float64 so it stays exact with
   *  kpc-scale worldOffset values (the disc-fade smoothstep consuming it
   *  spans a small range, so precision matters). */
  private refreshFrameCtx(): void {
    const cam = this.camera.position;
    const ax = cam.x + this.worldOffset.x;
    const ay = cam.y + this.worldOffset.y;
    const az = cam.z + this.worldOffset.z;
    this.frameCtx.distFromSol = Math.sqrt(ax * ax + ay * ay + az * az);
    this.frameCtx.t = this.getT();
    this.frameCtx.warpActive = this.warp.isActive();
  }

  /** Collect this frame's rate report, audit what actually moved against
   *  what the last budget promised, and set the budget the next tick's due
   *  test reads (render-gate/README.md § The clock cadence).
   *
   *  Runs after the fan-out, so every position a report divides by is this
   *  frame's and the rides have already moved the camera. The result is
   *  valid until the next rendered frame: between frames the camera is
   *  static — a camera move renders — so the distances hold. */
  private refreshCadence(): void {
    const simDtS = this.frameCtx.t - this.lastRenderedSimS;
    this.lastRenderedSimS = this.frameCtx.t;
    this.cadenceFrameId++;
    this.cadenceCtx.camera = this.camera;
    this.cadenceCtx.frameId = this.cadenceFrameId;
    this.cadenceCtx.pxPerRadian = this.angularToPx();
    this.cadenceCtx.simDtS = simDtS;
    if (Number.isFinite(simDtS) && simDtS !== 0) {
      this.cadenceCtx.cameraVelPcPerSimS.copy(this._rideAccum).divideScalar(simDtS);
    } else {
      this.cadenceCtx.cameraVelPcPerSimS.set(0, 0, 0);
    }
    const report = this.layers.cadenceReport(this.cadenceCtx);
    this.cadenceLastReport = report;
    const pixelRatio = this.sharedUniforms.uPixelRatio.value;
    this.cadenceTrust = auditCadenceFrame(this.cadenceTrust, {
      cadenceScheduled: this.renderGate.lastFrameWasCadenceScheduled,
      observedPx: report.observedPx,
      observedFluxFrac: report.observedFluxFrac,
      pixelRatio,
    });
    this.cadenceBudgetSimS = cadenceSimBudgetS(
      report, this.pulsationCadenceBudgetS, pixelRatio, this.cadenceTrust.trust,
    );
  }

  /** Debug-scoped view of the clock-cadence state the shell owns, for the
   *  render watcher (`debug/render-watch/README.md`). Every field is what
   *  the LAST rendered frame left behind, which is what the gate's next
   *  due test reads. */
  get cadenceDebugState(): {
    clockRate: number;
    budgetSimS: number;
    report: CadenceReport;
    /** Sim seconds the report's OBSERVED channels were measured over —
     *  without it those two numbers are per-gap while `report`'s rate
     *  channels are per-sim-second, and a readout printing both invites
     *  the comparison that units mismatch makes meaningless. */
    observedSimDtS: number;
    lastRenderedSimS: number;
    pulsationBudgetS: number;
    pixelRatio: number;
    trust: CadenceTrustState;
    realtimeNeeded: boolean;
    census: Record<string, number>;
  } {
    return {
      clockRate: this.clock.getRate(),
      budgetSimS: this.cadenceBudgetSimS,
      report: this.cadenceLastReport,
      observedSimDtS: this.cadenceCtx.simDtS,
      lastRenderedSimS: this.lastRenderedSimS,
      pulsationBudgetS: this.pulsationCadenceBudgetS,
      pixelRatio: this.sharedUniforms.uPixelRatio.value,
      trust: this.cadenceTrust,
      realtimeNeeded: this._realtimeFramesNeeded,
      census: this.layers.behaviourCensus(),
    };
  }

  /** Reduce the statistic attachment the frame just wrote. Chart and the
   *  fallback path render nothing into it, so the reduction is dropped
   *  rather than run over a stale attachment. */
  private measureAdaptationStatistic(parked: boolean) {
    const statistic = this.hdr.statisticTexture();
    if (statistic === null) {
      this.reduction.reset();
      if (!this.reduction.fenceWhileParked) return;
    }
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    this.reduction.measure(
      statistic,
      this.drawingBufferSize.x, this.drawingBufferSize.y,
      this.hdr.emitterUniforms.uExposure.value,
      parked,
    );
  }

  // HUD projection — hidden during warp (the camera is in motion and
  // its reference function is exactly the context warp suppresses,
  // same as the disc / grid / LG wireframe entries in the registry).
  private updateHud(warpActive: boolean) {
    if (warpActive) {
      this.hud.setVisible(false);
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
    this.hud.update({
      enabled: this.filter.showHud,
      camera: this.camera,
      target: this.controls.target,
      worldOffset: this.worldOffset,
      focusedLocal,
      hideSolArrow: isSolFocus,
      sizeMaxPx: this.filter.sizeMax,
      cameraMode: this.focus.getCameraMode(),
      transition: this.observe.getProgress(),
      focusedDiscRadiusPx: this.getFocusedDiscRadiusPx(),
      w: window.innerWidth,
      h: window.innerHeight,
    });
  }

  private observeTmpFwd = new THREE.Vector3();
  // Orientation the look pin was last derived at. x=NaN forces the first
  // call through, since NaN never equals itself.
  private readonly observePinQuat = new THREE.Quaternion(Number.NaN, 0, 0, 0);
  private observeUpdateTarget() {
    if (!lookPinStale(this.observePinQuat, this.camera.quaternion)) return;
    this.observePinQuat.copy(this.camera.quaternion);
    this.observeTmpFwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    writeLookPin(this.camera.position, this.observeTmpFwd, this.controls.target);
  }

  dispose() {
    this.disposed = true;
    this.observePinQuat.set(Number.NaN, 0, 0, 0);
    window.removeEventListener('resize', this.onResize);
    this.renderGate.dispose();
    this.trackballSettle.dispose();
    this.lastInvalidatedDm = Number.NaN;
    this.lastRenderedSimS = Number.NaN;
    this.cadenceBudgetSimS = 0;
    this.cadenceLastReport = CADENCE_REPORT_STILL;
    this.cadenceTrust = CADENCE_TRUST_INITIAL;
    this.pulsationCadenceBudgetS = Number.POSITIVE_INFINITY;
    this.cadenceFrameId = 0;
    this._rideAccum.set(0, 0, 0);
    this._realtimeFramesNeeded = false;
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
    this.webgpuStarLayer?.dispose();
    this.webgpuStarLayer = null;
    this.extinctionPrepass?.dispose();
    this.extinctionPrepass = null;
    // Every scene layer (eager or lazily attached) disposes through the
    // registry — a registered layer can't be missing here.
    this.layers.disposeAll();
    this.floatingOrigin.dispose();
    this.localDepthPass.dispose();
    // Whoever built the chain releases it: on a WebGPU boot the pipeline
    // constructed its own reduction and disposes it from hdr.dispose().
    if (this.webgpu === null) this.reduction.dispose();
    this.hdr.dispose();
    // The dust voxel grid is the largest single GPU allocation in the app
    // (~128 MiB Data3DTexture). MilkyWay shares the same texture handle but
    // doesn't own it.
    this.dust?.dispose();
    this.dust = null;
    // After every layer and the prepass: those hand their texture slots
    // back to the seam's placeholders, which this frees. Before the
    // renderer, so the releases go through a live device.
    this.webgpu?.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }
}
