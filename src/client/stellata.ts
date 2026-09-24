import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { Catalog } from './loaders/catalog-loader';
import { createBinarySystemMembership } from './binaries/binary-system-membership';
import type { ChromeLineMaterials } from './chrome-lines/chrome-line-materials';
import { createPlanetSystemMembership } from './solar-system/planet-system-membership';
import { SystemMembershipRegistry } from './system-membership/system-membership';
import type { DustField, DustParticleData } from './loaders/dust-loader';
import {
  formatVerifyReports,
  verifyDustChunks,
  type ChunkVerifyReport,
} from './loaders/dust-voxel-readback';
import { DustParticleLayer } from './dust/dust-particle-layer';
import { GalacticDisc } from './galactic/galactic-disc';
import { GalacticReference } from './galactic/galactic-reference';
import { MAX_DISTANCE_PC, CAMERA_FAR_PC } from '../../scripts/local-group/build-local-group-pure';
import type { OrbitFramePort } from './attitude/attitude-pure';
import { focusFrameInputs } from './attitude/focus-frame';
import { HudOverlay, hudElementsById } from './overlays/hud-overlay';
import { hudSceneLayer } from './overlays/hud-scene-layer';
import { ChartLabels } from './chart-mode/labels/chart-labels';
import { GALACTIC_NORTH_POLE_ICRS } from './galactic/galactic-coords';
import type { CloudCatalog } from './molecular-clouds/cloud-loader';
import { MilkyWay } from './milkyway/milkyway';
import { ObserveControls } from './camera/observe/observe-controls';
import {
  mark as perfMark,
  measure as perfMeasure,
  frame as perfFrame,
} from './debug/perf-hud';
import { resolveAndPublishGpuFrame } from './debug/gpu-timing/gpu-frame-samples';
import { RenderGate } from './render-gate/render-gate';
import { TrackballSettle } from './camera/controls/input/trackball-settle';
import {
  CADENCE_REPORT_STILL,
  cadenceVisibleTurnRad,
  maxCadenceReport,
  pulsationCadenceBudgetS,
} from './render-gate/cadence/clock-cadence-pure';
import {
  ClockCadence,
  type ClockCadenceDebugState,
} from './render-gate/cadence/clock-cadence';
import type { HdrSeam, ReductionSeam } from './hdr/hdr-seam';
import {
  angularToPx as angularToPxPure,
  type ResolvedCandidate,
} from './camera/controls/star-geometry';
import * as starPhysics from './camera/controls/star-physics';
import { resolveStarPickVisibility } from './camera/controls/star-pick-visibility-pure';
import { chartDiscPxForAppMag } from './chart-mode/chart-disc-pure';
import { paperClearColour } from './chart-mode/chart-palette';
import { applyChartPaletteSwap } from './chart-mode/chart-swap-pure';
import { Picker } from './camera/controls/picker';
import { AimController } from './camera/controls/aim-controller';
import { RollController } from './camera/controls/input/roll-controller';
import { WarpController } from './camera/warp/warp-controller';
import { ObserveTransition } from './camera/observe/observe-transition';
import { ObserveLookPin } from './camera/observe/observe-look-pin';
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
  collectKindDetailBinds,
  collectKindPicks,
  KIND_ROSTER,
  type BuiltKindModules,
} from './kinds/kind-modules';
import type { ConstellationOfKind } from './focus-card/constellation-row';
import { focalRideStep } from './camera/focus/focal-ride-pure';
import { makeFocalAnchorPolicy } from './camera/focus/focal-anchor-policy';
import type { StellataRenderer, WebGpuSeam, WebGpuStarLayer } from './webgpu/seam';
import type { SurvivorCountsRead } from './debug/survivor-counts';
import type { PlanetSystem } from './solar-system/planet-system';
import type { PlanetBodyField } from './solar-system/planets/planet-body-field';
import { LocalDepthPass } from './local-depth/local-depth-pass';
import { OccluderSet } from './occlusion/occluder-set';
import type { PickVisibility } from './hover/hover-pick-disambiguator';
import { SolarSystemWiring } from './solar-system/solar-system-wiring';
import { StarLocalCluster } from './star-pipeline/local-pass/star-local-cluster';
import {
  PHYS_RATIO_THRESHOLD,
  RESOLVED_DISC_MIN_PX,
} from './star-pipeline/local-pass/star-local-cluster-pure';
import { type StarPassRouting, starPassRouting } from './star-pipeline/star-pass';
import { DIM_FLOOR } from './binaries/eclipse/eclipse-photometry-pure';
import { VirtualClock, tToJdUt } from './solar-system/time/time';
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
import { ExposureFrameStep } from './hdr/exposure/exposure-frame-step';
import type { Mutable } from './util/mutable';
import {
  cameraAbsInto,
  SceneLayerRegistry,
  updateWarpGatedRefLayer,
  type ContributionCensus,
  type FrameCtx,
} from './scene/scene-layer';
import { FrameFrustum } from './scene/contribution/frame-frustum';
import { findGlslResidents } from './scene/glsl-residents-pure';
import { SceneDeclutter } from './scene/declutter/scene-declutter';
import {
  buildStarSourceAttributes, type StarSourceAttributes,
} from './star-pipeline/star-source-attributes';
import { CATALOG_BOUNDING_RADIUS_PC } from './star-pipeline/shards/star-shards-pure';
import { StarFrame } from './star-pipeline/star-frame/star-frame';
import { buildSharedUniforms, type SharedUniforms } from './frame/shared-uniforms';
import { FloatingOrigin } from './frame/floating-origin';
import { formatAvParity, type AvParityReport } from './star-pipeline/extinction/av-parity-pure';
import type {
  ExtinctionPrepassSeam, ExtinctionView,
} from './star-pipeline/extinction/extinction-seam';
import { BinaryOrbitField } from './binaries/binary-orbit-field';
import { BinaryOrbitPathLayer } from './binaries/orbit-paths/binary-orbit-path-layer';
import { ConstellationFigureLayer } from './constellation-figure/constellation-figure-layer';
import { selectFigures } from './constellation-figure/constellation-figure-pure';
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
import { writePulsationSuppressMask } from './star-pipeline/pulsation/pulsation-suppress-pure';

export interface StellataOptions {
  canvas: HTMLCanvasElement;
  catalog: Catalog;
  /** Kind-module record with every artifact already loaded — the
   *  constructor attaches each module, and an unloaded one attaches to
   *  an empty roster (kinds/kind-modules.ts). */
  kinds: BuiltKindModules;
  /** The booted renderer and everything hung off it (webgpu/README.md).
   *  Built before the shell, because only a live device can refuse
   *  itself and that refusal is the gate page, not a fallback. */
  webgpu: WebGpuSeam;
}

export type CameraMode = 'navigate' | 'observe';

/** A scene a boot draws, named so a debug read can say which one a
 *  resource came from (`sceneGraphs`). */
export interface NamedScene {
  readonly name: string;
  readonly scene: THREE.Scene;
}

// Subscribers register via `Stellata.on(name, fn)` and the compiler enforces
// the payload type per event. `state` and `frame` are no-payload events.
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
  /** The boot seam — layers reach their scene and the shared uniform
   *  nodes through it. */
  readonly webgpu: WebGpuSeam;
  private webgpuStarLayer!: WebGpuStarLayer;
  private readonly chromeLines: ChromeLineMaterials;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: TrackballControls;
  readonly hdr: HdrSeam;
  readonly roll = new RollController();

  private scene: THREE.Scene;
  private starAttrs!: StarSourceAttributes;
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
  /** Records already folded into `_suppressPulsation` — the mask is written
   *  in place so the attribute bound over it keeps its array. */
  private absorbedSuppressCount = 0;
  /** Unsubscribe from the catalog's chunk-decode fan-out. */
  private offCatalogRecords: (() => void) | null = null;
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
  // cut (hdr/exposure/README.md § Adaptation).
  readonly adaptation!: SceneAdaptation;
  get reduction(): ReductionSeam { return this.hdr.reduction; }
  private readonly exposureFrame!: ExposureFrameStep;

  readonly declutter: SceneDeclutter;

  private disposed = false;
  private bus = new EventBus<StellataEventMap>();

  // Scene layers register once (registerSceneLayers) and the registry
  // fans out per-frame update / setMonochrome / recenter / dispose —
  // see scene/README.md. frameCtx is the shared per-frame input struct,
  // mutated in place each frame to avoid a per-frame allocation.
  private readonly layers = new SceneLayerRegistry();
  private frameCtx!: Mutable<FrameCtx>;

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

  readonly galactic: GalacticReference;
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
  private readonly observeLookPin: ObserveLookPin;
  private glslResidentsChecked = false;
  private readonly cadence: ClockCadence;
  // Read on the NEXT tick is NOT good enough for this one: a layer that
  // starts needing wall-clock frames while the gate idles would wait a
  // whole cap for them, and forever with the clock paused. Evaluated
  // above the gate, every tick (scene/scene-layer.ts LayerTimeBehaviour).
  private _realtimeFramesNeeded = false;
  private coreMaskEnabled = true;
  private starLocalCluster: StarLocalCluster;
  readonly solarSystem: SolarSystemWiring;
  /** The frame's near-solid-body set, published by the two local-depth
   *  clusters and read by every SVG label surface
   *  (`occlusion/README.md`). */
  readonly occluders = new OccluderSet();

  /** What every pick path gates on, in one place: the frame's solid
   *  bodies and the camera reading them. Hover and click both take it,
   *  so no kind can be visible to one and hidden from the other. */
  pickVisibility(): PickVisibility {
    return { occluders: this.occluders, cameraPos: this.camera.position };
  }
  readonly hud: HudOverlay;
  /** `chart-mode.ts` starts / stops it on the chart activation predicate;
   *  the shell owns its lifetime. */
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
  /** Built once — both members are stable identities mutated in place. */
  private _extinctionView: ExtinctionView | null = null;
  private extinctionRecomputeForced = false;
  private readonly pickSizeScratch: starPhysics.RenderedSizeComponents =
    { appMag: 0, appSizePx: 0, physSizePx: 0, physSizePxUncapped: 0 };
  // Separate from pickSizeScratch: the debug panel reads every frame and
  // must not clobber a pick walk mid-flight.
  private readonly passDebugScratch: starPhysics.RenderedSizeComponents =
    { appMag: 0, appSizePx: 0, physSizePx: 0, physSizePxUncapped: 0 };

  readonly picker!: Picker;

  // Per-kind geometry registry (camera/focus/focus-target.ts). Overlays
  // and pickers dispatch `focusables[target.kind].<leg>(target.idx)`
  // instead of per-kind shell methods.
  readonly focusables!: FocusableProviders;

  constructor({ canvas, catalog, kinds, webgpu }: StellataOptions) {
    this.catalog = catalog;
    this.kinds = kinds;
    this.declutter = new SceneDeclutter({
      pushes: [
        {
          milkyWayIsobar: (on) => this.milkyway.setIsobar(on),
          orbitRings: (on) => this.solarSystem.orbitRings.setPermitted(on),
          binaryOrbitRings: (on) => this.binaryOrbitPathLayer.setPermitted(on),
          constellationFigures: (on) => this.constellationFigureLayer.setPermitted(on),
        },
        ...collectKindDetailBinds(this.kinds),
      ],
      setMilkyWayEnabled: (on) => this.milkyway.setEnabled(on),
      setLgEmissionEnabled: (on) => this.kinds.lg.setEmissionEnabled(on),
      showLgEmission: () => this.filter.showLgEmission,
    });

    this.webgpu = webgpu;
    this.renderer = this.webgpu.renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setClearColor(0x000000, 0);
    this.hdr = this.webgpu.hdr;

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
    this.roll.levelTo(this.camera, GALACTIC_NORTH_POLE_ICRS);
    this.cadence = new ClockCadence({
      camera: this.camera,
      collectReport: (cc) => this.layers.cadenceReport(cc),
    });

    // TrackballControls (instead of OrbitControls) because we want
    // unconstrained rotation — no polar clamping at the zenith/nadir, so
    // the user can orbit past the poles continuously.
    this.controls = new TrackballControls(this.camera, canvas);
    this.observeLookPin = new ObserveLookPin(this.camera, this.controls.target);
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
    this.webgpu.bindSharedUniforms(sharedUniforms);
    // Must follow bindSharedUniforms: the TSL factory resolves the shared
    // uniform nodes on read and throws while the registry is unbound.
    this.chromeLines = this.webgpu.chromeLineMaterials;
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
        uploadFull(this.starAttrs.iPositionAttr);
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
      getBinaries: () => this.getBinaries(),
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
    this._suppressPulsation = new Float32Array(catalog.count);

    this.starAttrs = buildStarSourceAttributes({
      localPositions: this.starFrame.localPositions,
      compositeSuppress: this._compositeSuppress,
      eclipseDim: this._eclipseDim,
      suppressPulsation: this._suppressPulsation,
    });

    this.webgpuStarLayer = this.webgpu.attachStarLayer(this.scene, {
      catalog,
      logRadii: this.starFrame.logRadii,
      lumClassF32: this.starFrame.lumClassF32,
      distSol: this.starFrame.distSol,
      teffApsis: this.starFrame.teffApsis,
      boundingSphereRadiusPc: CATALOG_BOUNDING_RADIUS_PC,
      ...this.starAttrs,
    });

    // Chunk 0 is already decoded and the pipeline was constructed against
    // it, so this first call folds it in; every later one follows a
    // landing chunk.
    this.offCatalogRecords = this.catalog.onRecordsDecoded(
      () => this.absorbCatalogRecords());
    this.absorbCatalogRecords();

    this.dustParticles = new DustParticleLayer(
      this.scene,
      this.webgpu.dustParticleMaterials,
    );

    // Galactic reference layers — disc is always added; grid hides itself
    // until enabled. The HUD (ring + Sol/GC arrows) is pure SVG inside the
    // existing #overlay so it shares the distance vector's stroke + halo
    // styling and inherits the `body.warping` hide rule for free.
    // Constructed here, not by GalacticReference — galactic/README.md § Wiring.
    const galacticDisc = new GalacticDisc(this.chromeLines);
    this.scene.add(galacticDisc.group);
    this.binaryOrbitPathLayer = new BinaryOrbitPathLayer(this.chromeLines);
    this.starLocalCluster = new StarLocalCluster(
      this.webgpuStarLayer.localMirror,
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
        occluders: this.occluders,
        livePulsationRadiusFactor: (idx) => starPhysics.livePulsationRadiusFactor(
          catalog, idx, this._suppressPulsation, this.sharedUniforms),
        hiddenStarIdx: () => sharedUniforms.uHideFocusIdx.value,
      },
    );
    this.localDepthPass.register(this.starLocalCluster);
    this.constellationFigureLayer = new ConstellationFigureLayer(this.chromeLines);
    this.scene.add(this.constellationFigureLayer.group);
    this.constellationBoundaryLayer =
      new ConstellationBoundaryLayer(sharedUniforms, this.chromeLines);
    this.scene.add(this.constellationBoundaryLayer.group);
    // Measured against the instrument's OWN exposure, never the live
    // scalar the cut then writes — that would be a feedback loop.
    this.adaptation = new SceneAdaptation({
      baseExposure: () => exposureForMagLimit(this.exposure.getLimitMag()),
      reduced: () => this.reduction.current(),
      measurementReady: () => !this.reduction.readbackPending,
      whitePoint: () => this.hdr.emitterUniforms.uWhitePoint.value,
    });
    this.exposureFrame = new ExposureFrameStep({
      hdr: this.hdr,
      exposure: this.exposure,
      adaptation: this.adaptation,
      isChart: () => this.filter.chart,
      drawingBufferSizeInto: (out) => this.renderer.getDrawingBufferSize(out),
      noteExposureCut: (dm) => this.renderGate.noteExposureCut(dm),
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
      detailPermits: (id) => this.declutter.permits(id),
      constellationOf: (kind, idx) => this.constellationOf(kind, idx),
      onFrame: (handler) => this.bus.on('frame', handler),
      occluders: this.occluders,
      requestRender: (reason) => this.renderGate.invalidate(`kind:${reason}`),
      webgpu: this.webgpu,
    };
    for (const kind of KIND_ROSTER) {
      const layer = this.kinds[kind]?.attach(kindCtx);
      if (layer) this.layers.register(layer);
    }
    this.solarSystem = new SolarSystemWiring({
      chromeLines: this.chromeLines,
      planetField: this.kinds.planet.field,
      planetMesh: this.kinds.planet.meshLayer,
      probeField: this.kinds.probe.field,
      probeTrails: this.kinds.probe.pathLayer,
      starCluster: this.starLocalCluster,
      occluders: this.occluders,
      solIndex: catalog.solIndex,
      getT: () => this.getT(),
      focusedPlanetSystem: () => this.focus.getFocusedPlanetSystem(),
      observeAnchorPlanet: () => this.observe.observeAnchorOf('planet'),
      onPlanetSystem: (handler) => this.bus.on('planetSystem', handler),
    });
    this.localDepthPass.register(this.solarSystem.cluster);
    // System-membership registry: binaries FIRST so a collapsed pair's
    // outer primary leads the union over the member's planet-host role.
    this.systemMembership.register(
      createBinarySystemMembership({
        getBinaries: () => this.getBinaries(),
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
      visibility: () => this.pickVisibility(),
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
      roll: this.roll,
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
      roll: this.roll,
      setFocalBodyHidden: (target) => this.setFocalBodyHidden(target),
      bus: this.bus,
      focus: this.focus,
      getCameraMode: () => this.focus.getCameraMode(),
      setCameraModeValue: (mode) => this.focus.setCameraModeValue(mode),
    });
    this.buildFocalAnchorPolicy();
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
    // Every fine-grained mutation the figure's active set reads — focus,
    // filter, cameraMode — pairs with 'state', and so does the observe
    // transition's landing, which no fine-grained event covers.
    this.on('state', () => { this.refreshConstellationFigure(); });
    // The boundary fade window is a function of the magnitude limit — a
    // fainter limit admits stars nearer their walls — pushed rather than read
    // per frame so the table interpolation runs once per instrument change.
    // The layer draws in chart only, which hard-clips at the instrument limit
    // and inherits no exposure state, so the EV trim must not move the window.
    this.on('filter', () => {
      this.constellationBoundaryLayer.setMagnitudeLimit(this.exposure.getLimitMag());
    });
    this.on('cameraMode', () => this.observeLookPin.invalidate());
    this.galactic = new GalacticReference({
      disc: galacticDisc,
      scene: this.scene,
      chromeLines: this.chromeLines,
      worldOffset: this.worldOffset,
      detailPermits: (id) => this.declutter.permits(id),
      coordSphere: () => this.filter.coordSphere,
      setCoordSphere: (frame) => this.filters.setFilter({ coordSphere: frame }),
      cameraMode: () => this.focus.getCameraMode(),
      focusedTarget: () => this.focus.getFocusedTarget(),
      focusFrameInputs: (target) => focusFrameInputs(this, target),
      onFocus: (handler) => this.bus.on('focus', handler),
    });
    this.hud = new HudOverlay({
      elements: hudElementsById(document),
      worldOffset: this.worldOffset,
      aimAt: (localPoint) => this.aimAt(localPoint),
    });

    // Milky Way volumetric disc. A flattened ellipsoid mesh anchored at
    // the galactic centre; the fragment shader does a bounded raymarch
    // through its volume. renderOrder = -3 keeps it behind every other
    // layer.
    this.milkyway = new MilkyWay(this.webgpu.bandMaterials, catalog.count);
    this.scene.add(this.milkyway.group);

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
        this.declutter.refreshLgEmission();
      },
      refreshOrbitFloor: () => this.focus.refreshOrbitFloor(),
      declutter: this.declutter,
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
      pxPerRadian: 0,
      frustum: new FrameFrustum(),
      exposure: null,
    };
    this.registerSceneLayers();
    // Seed the declutter cycle: a layer that only learns its permission from
    // a push (both boundary shells, the orbit/probe overlays) otherwise sits
    // at whatever its constructor guessed until the level is cycled.
    this.filters.reapplyDetailFloors();
    window.addEventListener('resize', this.onResize);
    this.renderGate.attachDom(canvas);
    this.trackballSettle.attachDom(canvas);
    this.bus.on('state', () => this.renderGate.invalidate('bus:state'));
    this.bus.on('planetSystem', () => this.renderGate.invalidate('bus:planetSystem'));
    this.input = this.createInputController();
    this.animate();
  }

  // Push the figure's active set, skipping the rebuild when it is unchanged
  // ('state' fires on every discrete mutation, filter emits on every slider
  // drag). The selection rule itself is `selectFigures`.
  private refreshConstellationFigure(): void {
    const f = this.filter;
    const sel = selectFigures({
      chart: f.chart,
      highlightCon: f.highlightCon,
      constellationCount: this.catalog.constellations.length,
      inObserve: this.focus.getCameraMode() === 'observe',
      observeAnchorStar: this.observe.observeAnchorOf('star'),
    });
    if (sel.signature === this.conFigureSig) return;
    this.conFigureSig = sel.signature;
    this.constellationFigureLayer.setFigures(
      this.catalog.constellations, sel.conIndices, this.localPositions,
      sel.excludeStarIdx);
  }

  // Registration order is per-frame update order — scene/README.md § How the
  // shell uses it.
  private registerSceneLayers(): void {
    this.layers.register({
      timeBehaviour: { kind: 'clock', rate: this.solarSystem.planetRate },
      contribution: { kind: 'always' },
      // Ride runs right after every moving-body field wrote this
      // frame's positions — the whole module roster updates ahead of
      // this, the first inline entry — mirroring the binary ride's
      // placement after its orbit walk.
      update: () => this.applyMovingFocalRide(),
      dispose: () => {},
    });
    // AFTER the body field: a moon ring's centre is the parent's live
    // iLocalRel — reading it before the field's walk left the rings one frame
    // of sim-time behind the bodies, a visible lag under fast scrub.
    this.layers.register(this.solarSystem.orbitRingsEntry);
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => maxCadenceReport(
          this.binaryOrbitField?.cadenceReport(cc) ?? CADENCE_REPORT_STILL,
          this.eclipsePhotometryField?.cadenceReport(cc.simDtS) ?? CADENCE_REPORT_STILL,
        ),
      },
      contribution: { kind: 'always' },
      update: (ctx) => {
        this.updateBinaryOrbits();
        // After the walk wrote this frame's slots, so each path rides its
        // pair's live barycentre drift.
        this.binaryOrbitPathLayer.update(
          this.binaryOrbitField,
          this.localPositions,
          ctx.camera,
          window.innerHeight,
          this.observe.observeAnchorOf('star'),
        );
      },
      recenter: (newOrigin) => this.binaryOrbitField?.recenter(newOrigin),
      dispose: () => {
        this.binaryOrbitField?.dispose();
        this.eclipsePhotometryField?.dispose();
        this.binaryOrbitPathLayer.dispose();
      },
    });
    // Sequencing only, owning nothing — the second such entry, and the last
    // camera WRITE of the frame. Every camera reader is registered below it;
    // the argument for that, and for `static`, is scene/README.md § Not every
    // entry owns a layer and § Camera writes, then camera reads.
    this.layers.register({
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      update: () => {
        this.orbitFrameTick?.();
        // The frame's last camera write has landed: every frustum test
        // below reads this pose.
        this.frameCtx.frustum.refresh(this.camera);
      },
      dispose: () => {},
    });
    // Below every camera write in the frame — both focal rides and the
    // orbit lock — because it caches `camera.matrixWorld` for its view-space
    // sun, pole and caster uniforms, and sizes the mesh off camera distance
    // (scene/README.md § Camera writes, then camera reads). That is why the
    // planet module's own layer does not run this update.
    this.layers.register(this.solarSystem.planetMeshEntry);
    // After the field, rings and mesh updates it reads; before the main
    // render its suppression uniforms gate. Owns no GPU resources — the star
    // mirror it feeds is disposed with the star cluster.
    this.layers.register(this.solarSystem.clusterEntry);
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        rate: (cc) => maxCadenceReport(
          this.binaryOrbitField?.cadenceReport(cc) ?? CADENCE_REPORT_STILL,
          this.eclipsePhotometryField?.cadenceReport(cc.simDtS) ?? CADENCE_REPORT_STILL,
        ),
      },
      contribution: { kind: 'always' },
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
      contribution: { kind: 'always' },
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
      contribution: { kind: 'always' },
      // Chart-only — floor 'never' in the realistic column.
      update: (ctx) => updateWarpGatedRefLayer(
        this.constellationBoundaryLayer, ctx,
        this.declutter.permits('constellationBoundaries')),
      setMonochrome: (on) => this.constellationBoundaryLayer.setMonochrome(on),
      dispose: () => this.constellationBoundaryLayer.dispose(),
    });
    // Below the orbit lock — galactic/README.md § Wiring.
    this.layers.register(this.galactic.discEntry);
    this.layers.register(this.galactic.coordSpheresEntry);
    this.layers.register(hudSceneLayer({
      hud: this.hud,
      camera: this.camera,
      target: this.controls.target,
      solIndex: this.catalog.solIndex,
      focus: this.focus,
      filter: () => this.filter,
      observeProgress: () => this.observe.getProgress(),
      focusedDiscRadiusPx: () => this.getFocusedDiscRadiusPx(),
    }));
    const milkyWayCameraAbs = new THREE.Vector3();
    this.layers.register({
      // Skybox re-anchored to camera.position; the raymarch reads the
      // absolute camera. No `t` dependence.
      timeBehaviour: { kind: 'static' },
      contribution: {
        kind: 'gated',
        skip: (ctx) => ctx.exposure === null ? null : this.milkyway.contributionSkip(
          ctx.exposure, cameraAbsInto(ctx, milkyWayCameraAbs), ctx.warpActive),
        setContributing: (on) => this.milkyway.setContributing(on),
      },
      // Re-anchors the skybox mesh to camera.position and refreshes the
      // absolute-camera uniform for the raymarch. Visible during warp.
      update: (ctx) => this.milkyway.update(ctx.camera, ctx.worldOffset),
      dispose: () => this.milkyway.dispose(),
    });
    this.layers.register({
      timeBehaviour: {
        kind: 'clock',
        // Anchored content: the mask stamps the cores of the same stars the
        // local cluster mirrors, so it declares that subsystem's rate rather
        // than a global minimum (scene/README.md § Anchored content).
        rate: (cc) => maxCadenceReport(
          this.binaryOrbitField?.cadenceReport(cc) ?? CADENCE_REPORT_STILL,
          this.eclipsePhotometryField?.cadenceReport(cc.simDtS) ?? CADENCE_REPORT_STILL,
        ),
      },
      contribution: {
        kind: 'gated',
        // The star pipeline's own pass, registered here and nowhere else in
        // the registry, because this is the one part of it with a per-frame
        // visibility verdict. Its floor is `RESOLVED_DISC_MIN_PX` rather
        // than the shared one: below that the bleed-through it stamps
        // against is too small to see, and a wider floor would reject
        // frames the mask does change.
        skip: () => {
          // The `coreMask` lever's A/B prices this walk, and the walk is
          // now inside the predicate — so a disabled lever has to refuse
          // above it or both sides of the A/B pay it and the row prices
          // nothing (debug/frame-cost/passes/README.md).
          if (!this.coreMaskEnabled) return null;
          perfMark('coreMask');
          const on = this.starLocalCluster.hasMembers()
            || this.starFrame.shouldEnableCoreMask();
          perfMeasure('coreMask');
          return on ? null : 'legibility';
        },
        setContributing: (on) => { if (!on) this.setCoreMaskVisible(false); },
      },
      // After the star local cluster's entry: a member's stamp must render
      // even when the physSize-only window misses an appSize-driven member
      // disc, so membership has to be this frame's.
      update: () => this.setCoreMaskVisible(this.coreMaskEnabled),
      dispose: () => {},
    });
    this.layers.register({
      // Teardown leg only — the layer is shelved and draws nothing.
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      dispose: () => this.dustParticles.dispose(),
    });
    this.layers.register({
      // Teardown leg only; the per-frame work rides the 'frame' event, so
      // it runs on rendered frames and cannot need one of its own.
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
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
    return this.solarSystem.orbitRings.anyOrbitRingVisible()
      || this.binaryOrbitPathLayer.anyOrbitRingVisible();
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
    // The pass above rewrote catalog.positions; the A_V cache holds a copy.
    this.extinctionPrepass?.refreshPositions();
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
      this.webgpu.setDustTexture(null);
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
    this.webgpu.setDustTexture(dust.texture);
    if (this.extinctionPrepass === null) {
      this.extinctionPrepass = this.webgpu.attachExtinctionPrepass({
        catalog: this.catalog,
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

  /**
   * Fold a landing transport chunk's records into everything derived from
   * the catalogue, in dependency order, and wake the frame.
   *
   * Registered against `catalog.onRecordsDecoded` by the constructor, so the
   * shell never polls. The order matters: the star frame advances the new
   * records to the model epoch and rewrites the local-position buffer, and
   * only then do the GPU tables have current values to interleave.
   *
   * The render gate invalidation is not optional — a settled camera draws no
   * frame, so without it the newly-decoded stars would not appear until the
   * user moved.
   */
  private absorbCatalogRecords(): void {
    const absorbedFrom = this.absorbedSuppressCount;
    writePulsationSuppressMask(
      this.catalog.varType,
      this._suppressPulsation,
      this.absorbedSuppressCount,
      this.catalog.loadedCount,
    );
    this.absorbedSuppressCount = this.catalog.loadedCount;
    uploadFull(this.starAttrs.iSuppressPulsationAttr);

    this.starFrame.absorbRecords();
    this.webgpuStarLayer.absorbRecords();
    // Not markDirty — see webgpu/extinction/README.md § The cache gate.
    this.extinctionPrepass?.refreshPositions();

    // The fastest pulsating variable bounds how long any frame may idle
    // before some star's brightness moves a JND, so a chunk carrying a
    // faster one has to shorten the budget. A minimum over the window
    // alone: rescanning every record per chunk is main-thread time the
    // frame is waiting on, and the answer cannot rise.
    this.cadence.tightenPulsationBound(pulsationCadenceBudgetS(
      this.catalog.periodDays,
      this.catalog.amplitudeMag,
      this._suppressPulsation,
      absorbedFrom,
      this.catalog.loadedCount,
    ));
    this.renderGate.invalidate('catalog-chunk');
  }

  /** Numeric check that streamed dust really is in the volume texture where
   *  the uploader put it: samples voxels off the GPU and compares them
   *  against the chunk files — the only verification the upload has until
   *  something samples the volume.
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

  /** How many stars each tier's draw issued, and how many passed the
   *  prefilter (`webgpu/star/compaction/README.md` § Reading the counts
   *  back). The read waits on a dispatch to count into, which a settled
   *  camera has parked the gate out of. */
  async readSurvivorCounts(): Promise<SurvivorCountsRead | null> {
    this.renderGate.invalidate('debug:survivors');
    const counts = await this.webgpuStarLayer.readSurvivorCounts();
    if (counts === null) return null;
    return { ...counts, inFrame: this.extinctionPrepass?.countInFrame() ?? null };
  }

  /** Numeric check that the compute A_V kernel and a fragment march of the
   *  same integral agree bit for bit over the whole catalogue — the parity
   *  no pixel can show. Null with no dust.
   *  `webgpu/extinction/README.md` § The prepass kernel. */
  async verifyExtinction(): Promise<AvParityReport | null> {
    const report = await this.extinctionPrepass?.verifyParity() ?? null;
    if (report === null) {
      console.warn('verifyExtinction: no compute prepass active');
      return null;
    }
    console.log(formatAvParity(report));
    return report;
  }

  /** The attached binaries.bin runtime table, or null before it lands. */
  getBinaries(): BinariesData | null { return this.binariesData; }

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
      iPositionAttr: this.starAttrs.iPositionAttr,
      iCompositeSuppressAttr: this.starAttrs.iCompositeSuppressAttr,
    });
    this.binaryOrbitField.recenter(this.worldOffset);
    // Re-attach scrubs the prior attach's residual per-instance state.
    // EclipsePhotometryField tracks only the new binaries set's member
    // slots, so values written under the previous set would otherwise
    // persist on stars the new one doesn't touch.
    this._eclipseDim.fill(1);
    uploadFull(this.starAttrs.iEclipseDimAttr);
    this.eclipsePhotometryField = new EclipsePhotometryField({
      binaries,
      absolutePositions: this.catalog.positions,
      localPositions: this.localPositions,
      absoluteMags: this.catalog.absmag,
      physicalRadiusSolar: this.catalog.physicalRadius,
      eclipseDimBuffer: this._eclipseDim,
      iEclipseDimAttr: this.starAttrs.iEclipseDimAttr,
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
      cameraPosition: this.camera.position,
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
    this.cadence.noteRideStep(delta);
  }

  // Moving-body sibling of applyFocalFrameRide, over the shared
  // focalRideStep. For every hard focus kind whose object MOVES in the
  // local frame as `t` advances — a planet sweeping its orbit, a probe
  // running its trajectory — the object's full live local position plays
  // the role the star ride's perturbation does: its frame-to-frame delta
  // is what the camera / target / transition caches translate by, so the
  // object stays glued to controls.target, pan offsets survive, and the
  // camera rides the whole trajectory at any fast-forward rate. Seed
  // frames (focus change, warp) resync the baseline.
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
      cameraPosition: this.camera.position,
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

  /** Debug-HUD view of the disc/glow routing for one star at a given
   *  eclipse dim: the pass the shaders route it to, and the pass a
   *  dimmed quad would have picked (`star-pipeline/README.md` § Star
   *  rendering). The only way to see the trap band, which draws
   *  identically either side of it. */
  starPassRoutingFor(idx: number, eclipseDim: number): StarPassRouting {
    const c = this.renderedSizeComponentsFor(idx, this.passDebugScratch);
    const appSizeAtDim = (dim: number) => (dim >= 1
      ? c.appSizePx
      : starPhysics.appSizePxForMag(
        c.appMag - 2.5 * Math.log10(Math.max(dim, DIM_FLOOR)),
        this.filter,
        this.sharedUniforms.uSizeKnee.value,
      ));
    return starPassRouting(
      c.appSizePx, c.physSizePx, eclipseDim, DIM_FLOOR, appSizeAtDim,
    );
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
   *  `pickFromCandidatesResolved`'s eligibility pass requires of
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
   *  `drawCutoffMag`'s intrinsic-magnitude prefilter. Runs per pick
   *  candidate, never per frame
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
   *  attaches. */
  setExtinctionPrepassEnabled(on: boolean) {
    this.extinctionPrepass?.setEnabled(on);
  }

  /** Whether the A_V prepass cache is live this frame (dust attached,
   *  float target, not parked by the A/B switch) — the frame-cost
   *  harness's presence probe. */
  isExtinctionPrepassActive(): boolean {
    return this.extinctionPrepass?.isActive() ?? false;
  }

  /** Frame-cost lever: invalidate the A_V cache before every update, so the
   *  recompute the camera-displacement gate skips at a parked camera runs on
   *  every frame. Every canon vantage is camera-idle, so the kernel is
   *  otherwise unpriced — `debug/frame-cost/passes/README.md` § The
   *  extinction rows. Never leave it on outside a measurement dwell. */
  setExtinctionRecomputeForced(on: boolean) {
    this.extinctionRecomputeForced = on;
  }

  isExtinctionRecomputeForced(): boolean {
    return this.extinctionRecomputeForced;
  }

  /** A pointer event says a pick is coming: stage the per-star A_V table
   *  the star pick gates on, so `extinctionAvMagFor` is exact by the time
   *  the dwell fires (`webgpu/extinction/README.md` § Cold reads). */
  notifyPickImminent(): void {
    this.extinctionPrepass?.warmAvReadback();
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

  private tmpConstellationAbs = new THREE.Vector3();

  /** The core depth-mask's one visibility write. Whether it should be on
   *  is the layer's contribution verdict; this is only the apply. */
  private setCoreMaskVisible(on: boolean): void {
    this.webgpuStarLayer.setCoreMaskVisible(on);
  }

  /** The layer is shelved — see src/client/dust/README.md before
   *  re-enabling. */
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
   *  Adding or removing objects through these handles bypasses the
   *  scene-layer registry, so every update / monochrome / recenter /
   *  dispose fan-out misses them. */
  get sceneGraphs(): readonly NamedScene[] {
    return [{ name: 'shell', scene: this.scene }];
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

  setMonochrome(on: boolean) {
    if (this.monochrome === on) return;
    this.monochrome = on;
    this.sharedUniforms.uMonochrome.value = on ? 1 : 0;
    this.webgpuStarLayer.setMonochrome(on);
    this.renderer.setClearColor(
      on ? paperClearColour(this.renderer.outputColorSpace) : 0x000000, on ? 1 : 0);
    // Per-layer palette swaps fan out through the registry. The milky-way
    // layer has no monochrome hook: chart mode re-purposes it as an isobar
    // contour via the `milkyWayIsobar` detail bind (chart floor); the cloud
    // layer's stippled chart outline rides its registry setMonochrome hook.
    // The fan-out and the HDR swap run in opposite orders per direction —
    // chart-mode/README.md § Entry and exit are not mirror images.
    applyChartPaletteSwap(
      on,
      (v) => this.hdr.setChartMode(v),
      (v) => this.layers.setMonochromeAll(v),
    );
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
    if (!this.claimCameraForAim()) return;
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
   * the search typeahead, the distance-vector label, and the POI overlay.
   * A caller holding a direction rather than an object wants `aimAlong`.
   *
   * No-ops during warp, mid-aim, focus-lerp, or observe-transition. The
   * actual slerp + controls.enabled / observeControls handoff lives in
   * `AimController`; this dispatcher owns the composition-layer busy
   * gates the controller doesn't see.
   */
  aimAt(pointLocal: THREE.Vector3) {
    if (!this.claimCameraForAim()) return;
    this.aim.aimAt(pointLocal);
  }

  /**
   * Smoothly rotate the camera to look along `dirLocal` — the aim for a
   * caller that holds a direction rather than an object, where standing a
   * point up at some radius and aiming at that would land the boresight
   * elsewhere in navigate (`camera/controls/README.md` § Aim controller).
   *
   * Shares `aimAt`'s composition-layer busy gates.
   */
  aimAlong(dirLocal: THREE.Vector3) {
    if (!this.claimCameraForAim()) return;
    this.aim.aimAlong(dirLocal);
  }

  /** Take the camera for an aim, reporting whether it was free: false while
   *  warp, another aim, or an observe transition owns it. Cancels the focus
   *  lerps on the way through, so a granted claim hands the camera over with
   *  nothing else still driving it. */
  private claimCameraForAim(): boolean {
    if (this.warp.isActive() || this.aim.isActive()) return false;
    this.focus.cancelUnfocusLerp();
    this.focus.cancelFocusLerp();
    return !this.observe.isActive();
  }

  /**
   * Swing the camera to the reciprocal of the direction it holds — in
   * navigate around to the far side of the focused object at the same
   * distance, in observe a half turn in place. Bound to the instrument's
   * INV chip and `Shift`+`V` (`attitude/README.md` § Inverting the view).
   *
   * Shares `aimAt`'s composition-layer busy gates; the sweep itself lives in
   * `AimController`.
   */
  invertView() {
    if (!this.claimCameraForAim()) return;
    this.aim.invert();
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
      roll: this.roll,
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
      aimAlong: (d) => this.aimAlong(d),
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
    // Aspect change → fov_minor moves → the focused object's orbit floor
    // needs a refresh, whatever its kind. (FOV-only changes go through
    // setCameraFov, which does its own recompute.)
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

  private orbitFrameTick: (() => void) | null = null;

  /** Install the attitude indicator's per-frame ORB tick — the live datum
   *  re-read, and the orbit lock's camera write with it. The shell owns WHEN
   *  it runs, the registry being the only place that can express "after every
   *  camera write, before every camera read"; the indicator owns what it does
   *  (`attitude/orbit-frame/README.md` § The lock). Read through the field on
   *  every frame, so installing it after the layers are registered works,
   *  exactly as a lazily-attached layer does. */
  setOrbitFrameTick(tick: () => void): void {
    this.orbitFrameTick = tick;
  }

  private orbitFramePort: OrbitFramePort | null = null;

  /** Install the attitude instrument's URL seam. ORB and the orbit lock are
   *  the two pieces of view state the instrument holds itself rather than in
   *  `filter.coordSphere`, so the blob cannot reach them any other way
   *  (`util/url-state/README.md` § ORB and the orbit lock). Same lazy shape as
   *  the tick above: the instrument is built after the shell. */
  setOrbitFramePort(port: OrbitFramePort): void {
    this.orbitFramePort = port;
  }

  /** Null before the instrument is built, and on a boot that has none —
   *  callers treat that as "neither armed nor locked". */
  getOrbitFramePort(): OrbitFramePort | null {
    return this.orbitFramePort;
  }

  /** Owed by every gesture that arms, disarms, or locks ORB. Both are URL
   *  state held on the instrument rather than in `FilterState`, so no
   *  fine-grained event covers them and the URL writer would otherwise see a
   *  lock engaged on a still camera as nothing at all — the second case of the
   *  bare-'state' pairing `README.md` § Event bus documents, after
   *  `notifyClockJumped`. Not owed by a URL restore, which is applying the
   *  blob it would ask to rewrite. */
  notifyOrbitFrameChanged(): void {
    this.bus.emit('state');
  }

  /** The smallest camera turn two rendered frames could show apart, at the
   *  current viewport and FOV. A per-frame camera writer below the gate
   *  reads this and declines anything smaller, which is what keeps it from
   *  waking the gate on every tick — `render-gate/cadence/README.md`.
   *  The pixel ratio stays on this side of the call, as it does for the
   *  layers' rate reports. */
  visibleCameraTurnRad(): number {
    return cadenceVisibleTurnRad(this.angularToPx(), this.renderer.getPixelRatio());
  }

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
    // Observe's quaternion is the roll authority, so camera.up follows it
    // each frame, keeping the observe→navigate handover a no-op. Steady-state
    // navigate needs no step at all: camera.up IS the authority there and
    // TrackballControls transports it alongside the eye vector.
    // See camera/controls/input/README.md § Roll authority.
    if (this.focus.getCameraMode() === 'observe') {
      this.roll.adoptFromCamera(this.camera);
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
      this.observeLookPin.update();
    } else if (this.observe.isAnyActive()) {
      this.observe.tick(nowMs);
    } else if (this.focus.getCameraMode() === 'observe') {
      cameraAnimating = false;
      this.observeControls.update();
      this.observeLookPin.update();
    } else {
      cameraAnimating = false;
      this.trackballSettle.capture(this.camera);
      this.controls.update();
      this.trackballSettle.tick(
        this.camera, this.angularToPx(), this.sharedUniforms.uFovYRad.value,
      );
    }
    // A navigate animation drives orientation through lookAt while nothing
    // transports camera.up, so the view axis sweeps away from it and the two
    // can finish parallel — where the image-plane projection every lookAt and
    // roll measurement rides collapses, and TrackballControls then preserves
    // that angle indefinitely. Re-deriving per animating frame transports up
    // the way a drag does, without touching the pose just rendered. Gated on
    // an animation owning the camera: the steady state must still write on no
    // frame of its own (camera/controls/input/README.md § Roll authority).
    if (cameraAnimating && this.focus.getCameraMode() === 'navigate') {
      this.roll.adoptFromCamera(this.camera);
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
    const cadenceDue = this.cadence.isDue(this.clock.getRate(), this.frameCtx.t);
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
    this.sharedUniforms.uModelDays.value = tToJdUt(this.getT()) - J2000_JD;
    this.sharedUniforms.uModelDaysPerRealSec.value = Math.abs(this.clock.getRate()) / 86400;
    // Cleared here rather than by either publisher: both local-depth
    // clusters push into it during the fan-out below, and whichever ran
    // first would otherwise drop the other's entries.
    this.occluders.beginFrame();
    this.layers.updateAll(this.frameCtx);
    if (this.extinctionPrepass !== null) {
      // Between the ride fan-out and syncUniformNodes, and both edges bind
      // (webgpu/extinction/refill/README.md § Only what is in frame).
      // Absolute camera position in JS float64 — same frame convention as
      // the shader-side iPosition + uWorldOffset reconstruction.
      perfMark('extinction.prepass');
      if (this.extinctionRecomputeForced) this.extinctionPrepass.markDirty();
      this._extinctionView ??= { camera: this.camera, worldOffset: this.worldOffset };
      this.extinctionPrepass.update(
        this.camera.position.x + this.worldOffset.x,
        this.camera.position.y + this.worldOffset.y,
        this.camera.position.z + this.worldOffset.z,
        this._extinctionView,
      );
      perfMeasure('extinction.prepass');
    }
    this.cadence.refresh({
      t: this.frameCtx.t,
      pxPerRadian: this.frameCtx.pxPerRadian,
      pixelRatio: this.sharedUniforms.uPixelRatio.value,
      cadenceScheduled: this.renderGate.lastFrameWasCadenceScheduled,
    });
    // After the fan-out: the statistic reads this frame's ephemeris
    // positions, and the cut it writes has to land before the first draw
    // so measurement and frame can never be one frame apart.
    const measurementParked = this.exposureFrame.measure(nowMs, this.frameCtx.warpActive);
    perfMeasure('pre-render');
    perfMark('submit.main');
    this.hdr.bind();
    // Ahead of the node sync that copies it: the window moves with FOV,
    // viewport and the two distN sliders, so a stale one would elide the
    // physical-size branch against last frame's plate scale.
    this.starFrame.syncPhysSizeWindow();
    this.webgpu.syncUniformNodes();
    // Reads the scalars the sync above just copied, writes the lists every
    // star draw below reads — its own submit, so it has to sit between
    // the two (webgpu/star/compaction/README.md).
    perfMark('star.compaction');
    this.webgpuStarLayer.update(this.camera);
    perfMeasure('star.compaction');
    // One walk on the first rendered frame: every layer is parented by
    // then (the roster attach loop and registerSceneLayers both run in
    // this constructor, ahead of animate), and a GLSL material here
    // discards the whole submit rather than dropping one layer
    // (webgpu/README.md § One scene per boot).
    if (!this.glslResidentsChecked) {
      this.glslResidentsChecked = true;
      const residents = findGlslResidents(this.scene);
      if (residents.length > 0) {
        console.error(
          'GLSL materials in the rendered scene — the submit '
          + `will draw nothing: ${residents.join(', ')}`,
        );
      }
    }
    this.renderer.render(this.scene, this.camera);
    perfMeasure('submit.main');
    perfMark('submit.localDepth');
    this.localDepthPass.render(this.renderer, this.camera);
    perfMeasure('submit.localDepth');
    perfMark('submit.tonemap');
    this.hdr.resolve();
    perfMeasure('submit.tonemap');
    // After the resolve, so reducing the statistic attachment never delays
    // the frame it measures. The readback lands a frame or two later, far
    // inside the slew (hdr/exposure/reduction/README.md § Latency).
    perfMark('submit.reduction');
    this.exposureFrame.reduce(measurementParked);
    perfMeasure('submit.reduction');
    // After the frame's LAST pass, whatever is listening: a pool nothing
    // resolves overruns and stops sampling.
    resolveAndPublishGpuFrame(this.webgpu.renderer, this.webgpu.timestampsAvailable);
    perfMark('frame.handlers');
    this.bus.emit('frame');
    perfMeasure('frame.handlers');
    perfMeasure('frame.total');
    perfFrame();
    requestAnimationFrame(this.animate);
  };

  /** Runs ABOVE the gate: the `'realtime'` predicate needs it on skipped
   *  ticks too, and every input is available pre-render. `distFromSol` is the
   *  camera's absolute ICRS distance, summed in JS float64 so it stays exact
   *  with kpc-scale worldOffset values (the disc-fade smoothstep consuming it
   *  spans a small range, so precision matters). */
  private refreshFrameCtx(): void {
    const cam = this.camera.position;
    const ax = cam.x + this.worldOffset.x;
    const ay = cam.y + this.worldOffset.y;
    const az = cam.z + this.worldOffset.z;
    this.frameCtx.distFromSol = Math.sqrt(ax * ax + ay * ay + az * az);
    this.frameCtx.t = this.getT();
    this.frameCtx.warpActive = this.warp.isActive();
    this.frameCtx.pxPerRadian = this.angularToPx();
    this.frameCtx.exposure = this.exposureFrame.frameExposure();
    // Stale until the orbit-lock entry re-reads the camera after the
    // frame's last write (scene/README.md § Camera writes, then reads).
    this.frameCtx.frustum.invalidate();
  }

  /** Debug-scoped view of the clock-cadence state, joined with the clock,
   *  the pixel ratio and the layer census, for the render watcher
   *  (`debug/render-watch/README.md`). */
  get cadenceDebugState(): ClockCadenceDebugState & {
    clockRate: number;
    pixelRatio: number;
    realtimeNeeded: boolean;
    census: Record<string, number>;
    contribution: ContributionCensus;
  } {
    return {
      ...this.cadence.debugState,
      clockRate: this.clock.getRate(),
      pixelRatio: this.sharedUniforms.uPixelRatio.value,
      realtimeNeeded: this._realtimeFramesNeeded,
      census: this.layers.behaviourCensus(),
      contribution: this.layers.contributionCensus(),
    };
  }

  dispose() {
    this.disposed = true;
    this.offCatalogRecords?.();
    this.offCatalogRecords = null;
    this.observeLookPin.invalidate();
    window.removeEventListener('resize', this.onResize);
    this.renderGate.dispose();
    this.trackballSettle.dispose();
    this.cadence.dispose();
    this._realtimeFramesNeeded = false;
    this.frameCtx.frustum.invalidate();
    this.input.dispose();
    // observeControls owns its own pointer + wheel listeners; disable() is
    // idempotent so it's safe regardless of current mode.
    this.observeControls.disable();
    // The indicator has no dispose of its own, so the shell drops the closure
    // rather than holding its ball canvas for the instance's lifetime.
    this.orbitFrameTick = null;
    this.orbitFramePort = null;
    this.aim.dispose();
    this.warp.dispose();
    this.observe.dispose();
    this.focus.dispose();
    this.controls.dispose();
    // The prepass's refill kernel binds the compaction's dispatch buffer, so
    // it has to drop its bind groups before the star layer releases that
    // buffer (webgpu/extinction/refill/README.md § The kernel bounds itself
    // by the listed length).
    this.extinctionPrepass?.dispose();
    this.extinctionPrepass = null;
    this.webgpuStarLayer.dispose();
    // Every scene layer (eager or lazily attached) disposes through the
    // registry — a registered layer can't be missing here.
    this.layers.disposeAll();
    this.floatingOrigin.dispose();
    this.localDepthPass.dispose();
    this.hdr.dispose();
    // The dust voxel grid is the largest single GPU allocation in the app
    // (~128 MiB Data3DTexture). MilkyWay shares the same texture handle but
    // doesn't own it.
    this.dust?.dispose();
    this.dust = null;
    // After every layer and the prepass: those hand their texture slots
    // back to the seam's placeholders, which this frees. Before the
    // renderer, so the releases go through a live device.
    this.webgpu.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }
}
