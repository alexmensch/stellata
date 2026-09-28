import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { Catalog } from './loaders/catalog-loader';
import { createBinarySystemMembership } from './binaries/binary-system-membership';
import type { ChromeLineMaterials } from './chrome-lines/chrome-line-materials';
import { createPlanetSystemMembership } from './solar-system/planet-system-membership';
import { SystemMembershipRegistry } from './system-membership/system-membership';
import { galacticDiscSceneLayer } from './galactic/galactic-disc';
import { CoordSpheres } from './galactic/coord-spheres/coord-spheres';
import { MAX_DISTANCE_PC, CAMERA_FAR_PC } from '../../scripts/local-group/build-local-group-pure';
import type { OrbitFramePort } from './attitude/attitude-pure';
import { focusFrameInputs } from './attitude/focus-frame';
import { HudOverlay, hudElementsById } from './overlays/hud-overlay';
import { hudSceneLayer } from './overlays/hud-scene-layer';
import { ChartLabels } from './chart-mode/labels/chart-labels';
import { GALACTIC_NORTH_POLE_ICRS } from './galactic/galactic-coords';
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
import { cadenceVisibleTurnRad } from './render-gate/cadence/clock-cadence-pure';
import {
  ClockCadence,
  type ClockCadenceDebugState,
} from './render-gate/cadence/clock-cadence';
import type { HdrSeam, ReductionSeam } from './hdr/hdr-seam';
import { angularToPx as angularToPxPure } from './camera/controls/star-geometry';
import { paperClearColour } from './chart-mode/chart-palette';
import { applyChartPaletteSwap } from './chart-mode/chart-swap-pure';
import { Picker } from './camera/controls/picker';
import { AimController } from './camera/controls/aim-controller';
import { createCameraClaim } from './camera/camera-claim';
import { RollController } from './camera/controls/input/roll-controller';
import { WarpController } from './camera/warp/warp-controller';
import { ObserveTransition } from './camera/observe/observe-transition';
import { ObserveLookPin } from './camera/observe/observe-look-pin';
import { PoiStore } from './poi/poi-store';
import { InputController } from './camera/controls/input/input-controller';
import {
  type CameraMode,
  FocusController,
  GLOBAL_MIN_DIST_PC,
} from './camera/focus/focus-controller';
import type { FocusableProviders, Target } from './camera/focus/focus-target';
import type { KindContext } from './kinds/kind-module';
import {
  collectFocusables,
  collectKindDetailBinds,
  collectKindPicks,
  collectPinnable,
  KIND_ROSTER,
  type BuiltKindModules,
} from './kinds/kind-modules';
import { FocalRides } from './camera/focus/focal-ride/focal-rides';
import { makeFocalAnchorPolicy } from './camera/focus/focal-ride/focal-anchor-policy';
import type { StellataRenderer, WebGpuSeam } from './webgpu/seam';
import type { PlanetSystem } from './solar-system/planet-system';
import type { PlanetBodyField } from './solar-system/planets/planet-body-field';
import { LocalDepthPass } from './local-depth/local-depth-pass';
import { OccluderSet } from './occlusion/occluder-set';
import type { PickVisibility } from './hover/hover-pick-disambiguator';
import { SolarSystemWiring } from './solar-system/solar-system-wiring';
import { VirtualClock, tToJdUt } from './solar-system/time/time';
import { J2000_JD } from './util/astronomy-constants';
import { CAMERA_NEAR_PC } from './camera/timing';
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
  type ContributionCensus,
  type FrameCtx,
  type SceneLayer,
} from './scene/scene-layer';
import { FrameFrustum } from './scene/contribution/frame-frustum';
import { findGlslResidents } from './scene/glsl-residents-pure';
import { SceneDeclutter } from './scene/declutter/scene-declutter';
import { StarPipeline } from './star-pipeline/star-pipeline';
import { StarFrame } from './star-pipeline/star-frame/star-frame';
import { buildSharedUniforms, type SharedUniforms } from './frame/shared-uniforms';
import { FloatingOrigin } from './frame/floating-origin';
import { ExtinctionAttachment } from './star-pipeline/extinction/extinction-attachment';
import { BinariesAttachment } from './binaries/binaries-attachment';
import { ConstellationFigure } from './constellation-figure/constellation-figure';
import { ConstellationBoundaries } from './constellation-boundaries/constellation-boundaries';
import type { BoundaryArtifact } from '../../scripts/catalog/boundaries/boundaries-artifact-pure';

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
  /** The IAU boundary artifact, or null when it is missing or invalid. */
  boundaries: BoundaryArtifact | null;
}

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
// not URL-encoded state). Per-event list: /src/client/README.md#event-bus-on-stellata.
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

export class Stellata {
  readonly catalog: Catalog;
  readonly renderer: StellataRenderer;
  /** The boot seam — layers reach their scene and the shared uniform
   *  nodes through it. */
  readonly webgpu: WebGpuSeam;
  private readonly chromeLines: ChromeLineMaterials;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: TrackballControls;
  readonly hdr: HdrSeam;
  readonly roll = new RollController();

  private scene: THREE.Scene;
  // The shared view/screen uniform map (frame/README.md#shared-uniforms)
  // — every per-frame write goes through this field, never
  // through a star material's uniforms object.
  private sharedUniforms!: SharedUniforms;

  readonly floatingOrigin: FloatingOrigin;
  readonly starFrame: StarFrame;
  // Scratch for the focused star's per-re-advance space-motion delta.
  private readonly _epochFollowDelta = new THREE.Vector3();
  /** Kind-generic system membership (multi-star clusters, planet
   *  systems) — hover roster cards and collapsed-pick resolution both
   *  consume this. See src/client/system-membership/README.md. */
  readonly systemMembership = new SystemMembershipRegistry();
  readonly binaries: BinariesAttachment;

  private readonly focalRides: FocalRides;

  // Filter / preset / render-knob state + mutations live in
  // FilterController (filters/README.md); the shell reads the live
  // state through this getter for per-frame gates and dep closures.
  readonly filters!: FilterController;
  private get filter(): Readonly<FilterState> { return this.filters.getFilter(); }
  // Owns the exposure scalar and the three magnitude bounds derived from
  // it — instrument limit, just-visible threshold, population cull
  // (hdr/exposure/README.md#one-writer-five-slots).
  readonly exposure!: ExposureController;
  // Per-frame scene-luminance measurement feeding the automatic exposure
  // cut (hdr/exposure/README.md#adaptation--the-frame-measures-itself).
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
  private readonly cameraClaim = createCameraClaim({
    isWarpActive: () => this.warp.isActive(),
    isAimActive: () => this.aim.isActive(),
    isObserveTransitionActive: () => this.observe.isActive(),
    cancelUnfocusLerp: () => this.focus.cancelUnfocusLerp(),
    cancelFocusLerp: () => this.focus.cancelFocusLerp(),
  });

  readonly pois!: PoiStore;
  // Canvas pointer input — click FSM (single/double, both modes) and the
  // roll gestures. See camera/controls/input/README.md#input-controller.
  readonly input!: InputController;

  readonly coordSpheres: CoordSpheres;
  readonly constellationFigure: ConstellationFigure;
  readonly constellationBoundaries: ConstellationBoundaries;
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
  readonly starPipeline: StarPipeline;
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
  readonly chartLabels: ChartLabels;

  // Milky Way analytic background. Constructed eagerly so the
  // band is on during first paint. Dust is wired in once the volumetric
  // texture attaches.
  readonly milkyway: MilkyWay;

  readonly extinction: ExtinctionAttachment;
  readonly picker!: Picker;

  readonly focusables!: FocusableProviders;

  constructor({ canvas, catalog, kinds, webgpu, boundaries }: StellataOptions) {
    this.catalog = catalog;
    this.kinds = kinds;
    this.declutter = new SceneDeclutter({
      pushes: [
        {
          milkyWayIsobar: (on) => this.milkyway.setIsobar(on),
          orbitRings: (on) => this.solarSystem.orbitRings.setPermitted(on),
          binaryOrbitRings: (on) => this.binaries.orbitPaths.setPermitted(on),
          constellationFigures: (on) => this.constellationFigure.setPermitted(on),
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
      onLocalPositionsWritten: () => this.starPipeline.localPositionsWritten(),
    });
    this.chartLabels = new ChartLabels(this, this.starFrame.distSol);
    this.binaries = new BinariesAttachment({
      catalog,
      basePositions: this.starFrame.basePositions,
      localPositions: this.starFrame.localPositions,
      attributes: () => this.starPipeline.attributes,
      uniforms: sharedUniforms,
      chromeLines: this.chromeLines,
      camera: this.camera,
      worldOffset: this.floatingOrigin.worldOffset,
      getT: () => this.getT(),
      thresholdMag: () => this.exposure.getThresholdMag(),
      focusedStar: () => this.focus.getFocusedStar(),
      observeAnchorStar: () => this.observe.observeAnchorOf('star'),
      onFocus: (handler) => this.bus.on('focus', handler),
      rideFocal: (source) => this.focalRides.rideBinaryFocal(source),
      invalidate: (reason) => this.renderGate.invalidate(reason),
    });
    // The star kind module's legs deref these closures lazily, so the star
    // pipeline, picker and focus controller constructed below are fine. `binaries` is read now.
    this.kinds.star.setRuntime({
      localPositionInto: (idx, out) => this.starFrame.localPositionInto(idx, out),
      absolutePositionInto: (idx, out) => this.starFrame.absolutePositionInto(idx, out),
      parkDistForStar: (idx) => this.focus.parkDistForStar(idx),
      renderedSizePx: (idx) => this.starPipeline.renderedSizePx(idx),
      peakDiscSizePx: (idx) => this.starPipeline.peakDiscSizePx(idx),
      pickStarHit: (x, y, pxThreshold) => this.picker.pickStarHit(x, y, pxThreshold),
      binaries: this.binaries.data,
    });
    // Recentre fan-out, in load-bearing order: star buffer rewrite →
    // camera / orbit-target shift → scene-layer recenter hooks.
    this.floatingOrigin.onRecenter((origin) => this.starFrame.rewriteAt(origin));
    this.floatingOrigin.onRecenter((_origin, delta) => {
      this.camera.position.sub(delta);
      this.controls.target.sub(delta);
    });
    this.floatingOrigin.onRecenter((origin) => this.layers.recenterAll(origin));
    this.milkyway = new MilkyWay(this.webgpu.bandMaterials, catalog.count);
    this.extinction = new ExtinctionAttachment({
      catalog,
      uniforms: sharedUniforms,
      webgpu: this.webgpu,
      milkyway: this.milkyway,
      renderer: this.renderer,
      invalidate: (reason) => this.renderGate.invalidate(reason),
    });
    this.starPipeline = new StarPipeline({
      catalog,
      frame: this.starFrame,
      scene: this.scene,
      camera: this.camera,
      webgpu: this.webgpu,
      uniforms: sharedUniforms,
      emitterUniforms: this.hdr.emitterUniforms,
      binaries: this.binaries,
      extinction: this.extinction,
      exposure: this.exposure,
      cadence: this.cadence,
      occluders: this.occluders,
      filter: () => this.filter,
      focusedStar: () => this.focus.getFocusedStar(),
      monochrome: () => this.monochrome,
      invalidate: (reason) => this.renderGate.invalidate(reason),
    });

    // Galactic reference layers — disc is always added; grid hides itself
    // until enabled. The HUD (ring + Sol/GC arrows) is pure SVG inside the
    // existing #overlay so it shares the distance vector's stroke + halo
    // styling and inherits the `body.warping` hide rule for free.
    // Constructed here, ahead of the kind modules — galactic/README.md#wiring.
    const galacticDiscEntry = galacticDiscSceneLayer({
      scene: this.scene,
      chromeLines: this.chromeLines,
      worldOffset: this.floatingOrigin.worldOffset,
      detailPermits: (id) => this.declutter.permits(id),
    });
    this.localDepthPass.register(this.starPipeline.localCluster);
    this.constellationBoundaries = new ConstellationBoundaries({
      scene: this.scene,
      artifact: boundaries,
      constellations: catalog.constellations,
      uniforms: sharedUniforms,
      chromeLines: this.chromeLines,
      instrumentLimitMag: () => this.exposure.getLimitMag(),
      onFilter: (handler) => this.bus.on('filter', handler),
      permitted: () => this.declutter.permits('constellationBoundaries'),
      localPositionInto: (kind, idx, out) => this.focusables[kind].localPositionInto(idx, out),
      worldOffset: this.floatingOrigin.worldOffset,
    });
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
        if (catalog.solIndex < 0) return false;
        this.starFrame.absolutePositionInto(catalog.solIndex, out);
        return true;
      },
      angularToPx: () => this.angularToPx(),
      starPhotometry: (idx) => this.kinds.star.photometry(idx),
      systemMembership: this.systemMembership,
      getT: () => this.getT(),
      getWorldOffset: () => this.floatingOrigin.worldOffset,
      getFocusedTarget: () => this.focus.getFocusedTarget(),
      getMonochrome: () => this.monochrome,
      detailPermits: (id) => this.declutter.permits(id),
      constellationOf: (kind, idx) => this.constellationBoundaries.constellationOf(kind, idx),
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
      starCluster: this.starPipeline.localCluster,
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
        binaries: this.binaries.data,
        isCollapsed: (i) => this.binaries.isCompositeSuppressed(i),
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
      getLocalPositions: () => this.starFrame.localPositions,
      getFilter: () => this.filter,
      kindPicks: collectKindPicks(this.kinds),
      renderedSizePxFn: (idx) => this.starPipeline.pickPrefilterSizePx(idx),
      getSuppressPulsation: () => this.starPipeline.suppressPulsation,
      drawCutoffMagFn: (chart) => this.exposure.drawCutoffMag(chart),
      resolveStarPick: (idx) => this.starPipeline.resolveStarPick(idx),
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
      frameAnchor: { origin: this.floatingOrigin, stars: this.starFrame },
      aim: this.aim,
      roll: this.roll,
      setFocalBodyHidden: (target) => this.setFocalBodyHidden(target),
      getWarp: () => this.warp,
      getObserve: () => this.observe,
      getFocusables: () => this.focusables,
      focalPerturbation: this.binaries.focalPerturbation,
    });
    // see camera/focus/README.md#focusableproviders--the-kind-agnostic-geometry-registry
    this.focusables = collectFocusables(this.kinds);
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
      claim: this.cameraClaim,
      origin: this.floatingOrigin,
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
    this.focalRides = new FocalRides({
      cameraPosition: this.camera.position,
      orbitTarget: this.controls.target,
      focus: this.focus,
      observe: this.observe,
      focusables: this.focusables,
      starLocalPositionInto: (idx, out) => this.starFrame.localPositionInto(idx, out),
      warpActive: () => this.warp.isActive(),
      rebasePose: (delta) => this.renderGate.rebasePose(delta),
      noteRideStep: (delta) => this.cadence.noteRideStep(delta),
      planetRate: this.solarSystem.planetRate,
      onFocus: (handler) => this.bus.on('focus', handler),
    });
    this.on('cameraMode', () => this.observeLookPin.invalidate());
    this.coordSpheres = new CoordSpheres({
      scene: this.scene,
      chromeLines: this.chromeLines,
      coordSphere: () => this.filter.coordSphere,
      setCoordSphere: (frame) => this.filters.setFilter({ coordSphere: frame }),
      cameraMode: () => this.focus.getCameraMode(),
      focusedTarget: () => this.focus.getFocusedTarget(),
      focusFrameInputs: (target) => focusFrameInputs(this, target),
      onFocus: (handler) => this.bus.on('focus', handler),
    });
    this.hud = new HudOverlay({
      elements: hudElementsById(document),
      worldOffset: this.floatingOrigin.worldOffset,
      aimAt: (localPoint) => this.aimAt(localPoint),
    });

    // Milky Way volumetric disc. A flattened ellipsoid mesh anchored at
    // the galactic centre; the fragment shader does a bounded raymarch
    // through its volume. renderOrder = -3 keeps it behind every other
    // layer.
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
    // (5e-6, 0, 0) pc (not exactly zero), so the recentre shifts
    // target by 5e-6 and breaks the lengthSq < 1e-12 invariant. Safe
    // at this point in the constructor: handlers aren't subscribed yet
    // and camera/aspect are already initialised.
    if (catalog.solIndex >= 0) {
      this.focus.setFocus(catalog.solIndex);
    }
    // After filters, focus and observe: the figure seeds its active set from
    // all three at construction.
    this.constellationFigure = new ConstellationFigure({
      scene: this.scene,
      chromeLines: this.chromeLines,
      constellations: catalog.constellations,
      localPositions: this.starFrame.localPositions,
      localPositionInto: (idx, out) => this.starFrame.localPositionInto(idx, out),
      filter: () => this.filter,
      cameraMode: () => this.focus.getCameraMode(),
      observeAnchorStar: () => this.observe.observeAnchorOf('star'),
      onState: (handler) => this.bus.on('state', handler),
      rate: this.binaries.rate,
    });
    // No camera-position park here. The bare-URL pose is fully owned by
    // first-load.ts (`applyFirstLoadView`) and `?v=` URLs apply their
    // own cam — both run before first paint in main.ts.

    // Compute initial pixel sizes for the instrument against the real
    // viewport. DEFAULT_FILTER carries placeholder pixel values; this call
    // replaces them with the right numbers before the first frame.
    this.filters.recomputeStarPxSizes();
    this.syncPixelSolidAngle();

    this.pois = new PoiStore({
      pinnable: collectPinnable(this.kinds),
      onChange: (pois) => {
        this.bus.emit('pois', pois);
        this.bus.emit('state');
      },
    });

    this.frameCtx = {
      camera: this.camera,
      worldOffset: this.floatingOrigin.worldOffset,
      distFromSol: 0,
      t: 0,
      warpActive: false,
      pxPerRadian: 0,
      frustum: new FrameFrustum(),
      exposure: null,
    };
    this.registerSceneLayers(galacticDiscEntry);
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

  // Registration order is per-frame update order —
  // scene/README.md#how-the-shell-uses-it.
  private registerSceneLayers(galacticDiscEntry: SceneLayer): void {
    this.layers.register(this.focalRides.movingEntry);
    // AFTER the body field: a moon ring's centre is the parent's live
    // iLocalRel — reading it before the field's walk left the rings one frame
    // of sim-time behind the bodies, a visible lag under fast scrub.
    this.layers.register(this.solarSystem.orbitRingsEntry);
    this.layers.register(this.binaries.entry);
    // Sequencing only, owning nothing — the second such entry, and the last
    // camera WRITE of the frame. Every camera reader is registered below it;
    // the argument for that, and for `static`, is scene/README.md#not-every-entry-owns-a-layer
    // and scene/README.md#camera-writes-then-camera-reads.
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
    // (scene/README.md#camera-writes-then-camera-reads). That is why the
    // planet module's own layer does not run this update.
    this.layers.register(this.solarSystem.planetMeshEntry);
    // After the field, rings and mesh updates it reads; before the main
    // render its suppression uniforms gate. Owns no GPU resources — the star
    // mirror it feeds is disposed with the star cluster.
    this.layers.register(this.solarSystem.clusterEntry);
    // see star-pipeline/README.md#the-pipeline for both entries' places.
    this.layers.register(this.starPipeline.localClusterEntry);
    // After the binary + planet walks, so a figure vertex that is a binary
    // member re-copies its live slot.
    this.layers.register(this.constellationFigure.entry);
    this.layers.register(this.constellationBoundaries.entry);
    // Below the orbit lock — galactic/README.md#wiring.
    this.layers.register(galacticDiscEntry);
    this.layers.register(this.coordSpheres.entry);
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
    this.layers.register(this.starPipeline.coreMaskEntry);
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
      || this.binaries.orbitPaths.anyOrbitRingVisible();
  }
  /** Peak opaque-disc radius (CSS px) of the focused object, via its kind's
   *  `peakDiscSizePx`; 0 when nothing is focused. Single source for every
   *  arrow fade's disc coverage. */
  getFocusedDiscRadiusPx(): number {
    const t = this.focus.getFocusedTarget();
    return t === null ? 0 : this.focusables[t.kind].peakDiscSizePx(t.idx) * 0.5;
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

  private maybeReAdvanceEpoch(): void {
    const focal = this.focus.getFocusedStar();
    const d = this._epochFollowDelta;
    if (!this.starFrame.advanceEpochTo(this.getT(), focal, d)) return;
    // The rewrite changed what the frame would draw, and the cadence can
    // no longer assume nothing moved: a bucket crossing between cadence
    // frames must repaint.
    this.renderGate.invalidate('epoch-bucket');
    this.extinction.refreshPositions();
    this.focalRides.followEpochStep(d);
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

  /** Every scene graph this boot draws, for debug-scoped READS — the
   *  memory inventory walks them (`debug/memory/README.md`).
   *
   *  Adding or removing objects through these handles bypasses the
   *  scene-layer registry, so every update / monochrome / recenter /
   *  dispose fan-out misses them. */
  get sceneGraphs(): readonly NamedScene[] {
    return [{ name: 'shell', scene: this.scene }];
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
    this.starPipeline.setMonochrome(on);
    this.renderer.setClearColor(
      on ? paperClearColour(this.renderer.outputColorSpace) : 0x000000, on ? 1 : 0);
    // Per-layer palette swaps fan out through the registry. The milky-way
    // layer has no monochrome hook: chart mode re-purposes it as an isobar
    // contour via the `milkyWayIsobar` detail bind (chart floor); the cloud
    // layer's stippled chart outline rides its registry setMonochrome hook.
    // The fan-out and the HDR swap run in opposite orders per direction —
    // chart-mode/README.md#entry-and-exit-are-not-mirror-images.
    applyChartPaletteSwap(
      on,
      (v) => this.hdr.setChartMode(v),
      (v) => this.layers.setMonochromeAll(v),
    );
    this.bus.emit('state');
  }

  aimAtConstellation(conIndex: number) {
    // In OBSERVE controls.target is the look pin, 1 pc down the view axis.
    const from = this.focus.getCameraMode() === 'observe'
      ? this.camera.position : this.controls.target;
    const dir = this.constellationFigure.aimDirection(conIndex, from);
    if (dir !== null) this.aimAlong(dir);
  }

  /**
   * Smoothly rotate the camera so that `pointLocal` (a world point in
   * the renderer's local frame) ends up at the centre of the view.
   * Mode-aware: in navigate the orbit-pivot is held and the camera
   * sweeps around it; in observe the camera position is held and only
   * the quaternion rotates. Called by the Sol / GC label click handlers,
   * the search typeahead, the distance-vector label, and the POI overlay.
   * A caller holding a direction rather than an object wants `aimAlong`.
   */
  aimAt(pointLocal: THREE.Vector3) {
    if (!this.cameraClaim.claim()) return;
    this.aim.aimAt(pointLocal);
  }

  /**
   * Smoothly rotate the camera to look along `dirLocal` — the aim for a
   * caller that holds a direction rather than an object, where standing a
   * point up at some radius and aiming at that would land the boresight
   * elsewhere in navigate (`camera/controls/README.md#aim-controller-cameracontrolsaim-controllerts`).
   *
   * Shares `aimAt`'s composition-layer busy gates.
   */
  aimAlong(dirLocal: THREE.Vector3) {
    if (!this.cameraClaim.claim()) return;
    this.aim.aimAlong(dirLocal);
  }

  /**
   * Swing the camera to the reciprocal of the direction it holds — in
   * navigate around to the far side of the focused object at the same
   * distance, in observe a half turn in place. Bound to the instrument's
   * INV chip and `Shift`+`V` (`attitude/README.md#inverting-the-view`).
   *
   * Shares `aimAt`'s composition-layer busy gates; the sweep itself lives in
   * `AimController`.
   */
  invertView() {
    if (!this.cameraClaim.claim()) return;
    this.aim.invert();
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
      claim: this.cameraClaim,
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
   *  (`attitude/orbit-frame/README.md#the-lock`). Read through the field on
   *  every frame, so installing it after the layers are registered works,
   *  exactly as a lazily-attached layer does. */
  setOrbitFrameTick(tick: () => void): void {
    this.orbitFrameTick = tick;
  }

  private orbitFramePort: OrbitFramePort | null = null;

  /** Install the attitude instrument's URL seam. ORB and the orbit lock are
   *  the two pieces of view state the instrument holds itself rather than in
   *  `filter.coordSphere`, so the blob cannot reach them any other way
   *  (`util/url-state/README.md#orb-and-the-orbit-lock`). Same lazy shape as
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
   *  bare-'state' pairing `README.md#event-bus-on-stellata` documents, after
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
    if (this.floatingOrigin.tick()) this.focalRides.reseedMoving();
    // Both can invalidate the local-position buffer; StarFrame
    // coalesces them into a single rewrite. Must run before anything
    // downstream reads localPositions.
    this.starFrame.flushLocalPositions();
    perfMark('controls.update');
    // Observe's quaternion is the roll authority, so camera.up follows it
    // each frame, keeping the observe→navigate handover a no-op. Steady-state
    // navigate needs no step at all: camera.up IS the authority there and
    // TrackballControls transports it alongside the eye vector.
    // See camera/controls/input/README.md#roll-authority.
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
    // frame of its own (camera/controls/input/README.md#roll-authority).
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
    // (render-gate/README.md#the-clock-cadence).
    const continuous = cameraAnimating || this._realtimeFramesNeeded;
    const cadenceDue = this.cadence.isDue(this.clock.getRate(), this.frameCtx.t);
    if (!this.renderGate.tick(
      this.camera, this.controls.target, this.floatingOrigin.worldOffset,
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
    this.extinction.update(this.frameCtx);
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
    this.starPipeline.update(this.camera);
    perfMeasure('star.compaction');
    // One walk on the first rendered frame: every layer is parented by
    // then (the roster attach loop and registerSceneLayers both run in
    // this constructor, ahead of animate), and a GLSL material here
    // discards the whole submit rather than dropping one layer
    // (webgpu/README.md#one-scene-per-boot).
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
    // inside the slew (hdr/exposure/reduction/README.md#latency).
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
    const ax = cam.x + this.floatingOrigin.worldOffset.x;
    const ay = cam.y + this.floatingOrigin.worldOffset.y;
    const az = cam.z + this.floatingOrigin.worldOffset.z;
    this.frameCtx.distFromSol = Math.sqrt(ax * ax + ay * ay + az * az);
    this.frameCtx.t = this.getT();
    this.frameCtx.warpActive = this.warp.isActive();
    this.frameCtx.pxPerRadian = this.angularToPx();
    this.frameCtx.exposure = this.exposureFrame.frameExposure();
    // Stale until the orbit-lock entry re-reads the camera after the
    // frame's last write (scene/README.md#camera-writes-then-camera-reads reads).
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
    this.extinction.dispose();
    this.starPipeline.dispose();
    // Every scene layer (eager or lazily attached) disposes through the
    // registry — a registered layer can't be missing here.
    this.layers.disposeAll();
    this.floatingOrigin.dispose();
    this.localDepthPass.dispose();
    this.hdr.dispose();
    // After every layer and the prepass: those hand their texture slots
    // back to the seam's placeholders, which this frees. Before the
    // renderer, so the releases go through a live device.
    this.webgpu.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }
}
