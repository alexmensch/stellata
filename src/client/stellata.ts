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
import { CameraStep } from './camera/camera-step/camera-step';
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
  /** An unloaded module attaches to an empty roster. */
  kinds: BuiltKindModules;
  /** Built before the shell: only a live device can refuse itself, and
   *  that refusal is the gate page, not a fallback. */
  webgpu: WebGpuSeam;
  /** Null when the artifact is missing or invalid. */
  boundaries: BoundaryArtifact | null;
}

export interface NamedScene {
  readonly name: string;
  readonly scene: THREE.Scene;
}

// Payloads and the emit-then-`state` pairing every mutation owes:
// README.md#event-bus-on-stellata.
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
  readonly webgpu: WebGpuSeam;
  private readonly chromeLines: ChromeLineMaterials;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: TrackballControls;
  readonly hdr: HdrSeam;
  readonly roll = new RollController();

  private scene: THREE.Scene;
  // Every per-frame uniform write goes through this map, never a material's
  // own uniforms object (frame/README.md#shared-uniforms).
  private sharedUniforms!: SharedUniforms;

  readonly floatingOrigin: FloatingOrigin;
  readonly starFrame: StarFrame;
  private readonly _epochFollowDelta = new THREE.Vector3();
  readonly systemMembership = new SystemMembershipRegistry();
  readonly binaries: BinariesAttachment;

  private readonly focalRides: FocalRides;

  readonly filters!: FilterController;
  private get filter(): Readonly<FilterState> { return this.filters.getFilter(); }
  readonly exposure!: ExposureController;
  readonly adaptation!: SceneAdaptation;
  get reduction(): ReductionSeam { return this.hdr.reduction; }
  private readonly exposureFrame!: ExposureFrameStep;

  readonly declutter: SceneDeclutter;

  private disposed = false;
  private bus = new EventBus<StellataEventMap>();

  private readonly layers = new SceneLayerRegistry();
  private frameCtx!: Mutable<FrameCtx>;

  readonly observe!: ObserveTransition;
  private observeControls!: ObserveControls;

  private clock = new VirtualClock();

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
  readonly input!: InputController;

  readonly coordSpheres: CoordSpheres;
  readonly constellationFigure: ConstellationFigure;
  readonly constellationBoundaries: ConstellationBoundaries;
  readonly kinds: BuiltKindModules;
  private get planetBodyField(): PlanetBodyField { return this.kinds.planet.field; }
  readonly localDepthPass = new LocalDepthPass();
  readonly renderGate = new RenderGate();
  private readonly cameraStep: CameraStep;
  private readonly observeLookPin: ObserveLookPin;
  private glslResidentsChecked = false;
  private readonly cadence: ClockCadence;
  // Evaluated above the gate every tick — see refreshFrameCtx.
  private _realtimeFramesNeeded = false;
  readonly starPipeline: StarPipeline;
  readonly solarSystem: SolarSystemWiring;
  readonly occluders = new OccluderSet();

  /** Hover and click both gate on this, so no kind is visible to one and
   *  hidden from the other. */
  pickVisibility(): PickVisibility {
    return { occluders: this.occluders, cameraPos: this.camera.position };
  }
  readonly hud: HudOverlay;
  readonly chartLabels: ChartLabels;

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

    // Not OrbitControls: that clamps at the poles, and orbiting past them is wanted.
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
    // Before every consumer of the magnitude bounds: its constructor rewrites
    // all five slots, so buildSharedUniforms' seeds never reach a shader.
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
    // Closures deref lazily, so owners built below are fine; `binaries` is read now.
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

    // Ahead of the kind modules — galactic/README.md#wiring.
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
    // Registered before every other layer, so each moving-body field has
    // written this frame's positions before the moving-focal ride reads them.
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
    // Binaries FIRST: a collapsed pair's outer primary leads over a member's
    // planet-host role.
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
    this.aim = new AimController({
      camera: this.camera,
      controls: this.controls,
      observeControls: this.observeControls,
      getCameraMode: () => this.focus.getCameraMode(),
    });
    // getWarp / getObserve are lazy: both controllers are built from this one.
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

    this.scene.add(this.milkyway.group);

    this.filters = new FilterController({
      camera: this.camera,
      uniforms: sharedUniforms,
      bus: this.bus,
      onFilterApplied: (f) => {
        this.exposure.setInstrument(f.instrument);
        this.planetBodyField.setCullMag(sharedUniforms.uCullMag.value);
        this.declutter.refreshLgEmission();
      },
      refreshOrbitFloor: () => this.focus.refreshOrbitFloor(),
      declutter: this.declutter,
    });
    // setFocus, never a raw field write: Sol sits 5e-6 pc off the origin, so
    // only the recentre it runs satisfies the pin's lengthSq < 1e-12 guard.
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
    // DEFAULT_FILTER's pixel sizes are placeholders until this runs.
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
    // A layer that learns its permission only from a push sits at its
    // constructor's guess until this seeds it.
    this.filters.reapplyDetailFloors();
    window.addEventListener('resize', this.onResize);
    this.renderGate.attachDom(canvas);
    this.cameraStep = new CameraStep({
      canvas,
      camera: this.camera,
      controls: this.controls,
      observeControls: this.observeControls,
      observeLookPin: this.observeLookPin,
      roll: this.roll,
      warp: this.warp,
      aim: this.aim,
      focus: this.focus,
      observe: this.observe,
      pxPerRadian: () => this.angularToPx(),
      fovYRad: () => this.sharedUniforms.uFovYRad.value,
    });
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
    // The frame's last camera WRITE; every camera reader registers below it
    // (scene/README.md#camera-writes-then-camera-reads).
    this.layers.register({
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      update: () => {
        this.orbitFrameTick?.();
        this.frameCtx.frustum.refresh(this.camera);
      },
      dispose: () => {},
    });
    // A camera reader (it caches camera.matrixWorld), which is why the
    // planet module's own layer does not run it.
    this.layers.register(this.solarSystem.planetMeshEntry);
    // After the field, rings and mesh it reads.
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
      timeBehaviour: { kind: 'static' },
      contribution: {
        kind: 'gated',
        skip: (ctx) => ctx.exposure === null ? null : this.milkyway.contributionSkip(
          ctx.exposure, cameraAbsInto(ctx, milkyWayCameraAbs), ctx.warpActive),
        setContributing: (on) => this.milkyway.setContributing(on),
      },
      update: (ctx) => this.milkyway.update(ctx.camera, ctx.worldOffset),
      dispose: () => this.milkyway.dispose(),
    });
    this.layers.register(this.starPipeline.coreMaskEntry);
    this.layers.register({
      // Teardown only: its per-frame work rides the 'frame' event.
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      dispose: () => this.chartLabels.dispose(),
    });
  }

  on<K extends keyof StellataEventMap>(
    name: K,
    handler: (payload: StellataEventMap[K]) => void,
  ): () => void {
    return this.bus.on(name, handler);
  }
  /** Either already marks the focal object, so the focus ring suppresses itself. */
  anyOrbitRingVisible(): boolean {
    return this.solarSystem.orbitRings.anyOrbitRingVisible()
      || this.binaries.orbitPaths.anyOrbitRingVisible();
  }
  /** CSS px; 0 when nothing is focused. */
  getFocusedDiscRadiusPx(): number {
    const t = this.focus.getFocusedTarget();
    return t === null ? 0 : this.focusables[t.kind].peakDiscSizePx(t.idx) * 0.5;
  }

  get timeClock(): VirtualClock { return this.clock; }

  /** Unix seconds, re-read per call — snapshot it for a frame-stable value. */
  getT(): number {
    return this.clock.getT();
  }
  /** `null` returns to live tracking. */
  setT(t: number | null): void {
    if (t === null) {
      this.clock.reset();
    } else {
      this.clock.setRate(0);
      this.clock.setTimeAbsolute(t);
    }
    this.notifyClockJumped();
  }

  /** Owed by every discrete clock jump, whoever moved the clock — the
   *  scrubber's Jump and Reset bypass `setT`. */
  notifyClockJumped(): void {
    for (const kind of KIND_ROSTER) this.kinds[kind]?.clockJumped?.(this.getT());
    this.bus.emit('state');
  }
  getMonochrome(): boolean { return this.monochrome; }

  // camera/README.md#camera-activity-predicates
  isCameraTransitionActive(): boolean {
    return this.warp.isActive() || this.observe.isAnyActive();
  }

  /** Observe parks the camera inside the object. Null unhides every kind. */
  private setFocalBodyHidden(target: Target | null): void {
    for (const kind of KIND_ROSTER) {
      this.kinds[kind]?.setFocalHidden?.(target?.kind === kind ? target.idx : -1);
    }
  }

  private maybeReAdvanceEpoch(): void {
    const focal = this.focus.getFocusedStar();
    const d = this._epochFollowDelta;
    if (!this.starFrame.advanceEpochTo(this.getT(), focal, d)) return;
    this.renderGate.invalidate('epoch-bucket');
    this.extinction.refreshPositions();
    this.focalRides.followEpochStep(d);
  }

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

  /** Read-only: adding through these bypasses every registry fan-out. */
  get sceneGraphs(): readonly NamedScene[] {
    return [{ name: 'shell', scene: this.scene }];
  }

  /** Use this, not `filters.setCameraFov`: the pixel solid angle moves too. */
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
    // chart-mode/README.md#entry-and-exit-are-not-mirror-images
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

  /** A caller holding a direction rather than a point wants `aimAlong`. */
  aimAt(pointLocal: THREE.Vector3) {
    if (!this.cameraClaim.claim()) return;
    this.aim.aimAt(pointLocal);
  }

  /** camera/controls/README.md#aim-controller-cameracontrolsaim-controllerts */
  aimAlong(dirLocal: THREE.Vector3) {
    if (!this.cameraClaim.claim()) return;
    this.aim.aimAlong(dirLocal);
  }

  /** attitude/README.md#inverting-the-view */
  invertView() {
    if (!this.cameraClaim.claim()) return;
    this.aim.invert();
  }

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
    // TrackballControls caches the canvas rect at construction.
    this.controls.handleResize();
    this.hdr.syncSize();
    this.sharedUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.sharedUniforms.uViewport.value.set(w, h);
    this.focus.refreshOrbitFloor();
    this.syncPixelSolidAngle();
    this.filters.recomputeStarPxSizes();
  };

  // Resize and setCameraFov are the only writers of either input.
  private syncPixelSolidAngle(): void {
    this.hdr.setPixelSolidAngle(this.angularToPx());
  }

  private angularToPx(): number {
    const u = this.sharedUniforms;
    return angularToPxPure(u.uViewport.value.y, u.uFovYRad.value);
  }

  private orbitFrameTick: (() => void) | null = null;

  /** README.md#public-surface-of-stellata, install seams. */
  setOrbitFrameTick(tick: () => void): void {
    this.orbitFrameTick = tick;
  }

  private orbitFramePort: OrbitFramePort | null = null;

  /** util/url-state/README.md#orb-and-the-orbit-lock */
  setOrbitFramePort(port: OrbitFramePort): void {
    this.orbitFramePort = port;
  }

  /** Null: neither armed nor locked. */
  getOrbitFramePort(): OrbitFramePort | null {
    return this.orbitFramePort;
  }

  /** Owed by every gesture that arms, disarms or locks ORB; not by a URL
   *  restore (README.md#event-bus-on-stellata). */
  notifyOrbitFrameChanged(): void {
    this.bus.emit('state');
  }

  /** A per-frame camera writer declines any smaller turn, or it wakes the
   *  gate every tick (render-gate/cadence/README.md). */
  visibleCameraTurnRad(): number {
    return cadenceVisibleTurnRad(this.angularToPx(), this.renderer.getPixelRatio());
  }

  private animate = () => {
    if (this.disposed) return;
    perfMark('frame.total');
    // One wall-clock read per tick: every reader must agree on this frame.
    const nowMs = performance.now();
    this.maybeReAdvanceEpoch();
    if (this.floatingOrigin.tick()) this.focalRides.reseedMoving();
    // Before anything reads localPositions.
    this.starFrame.flushLocalPositions();
    perfMark('controls.update');
    const cameraAnimating = this.cameraStep.advance(nowMs);
    perfMeasure('controls.update');
    // Above the gate: a layer that starts needing wall-clock frames while the
    // gate idles would otherwise wait a whole cap, or forever when paused.
    this.refreshFrameCtx();
    this._realtimeFramesNeeded = this.layers.realtimeFramesNeeded(this.frameCtx);
    // render-gate/README.md#the-clock-cadence
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
    const pinTarget = this.focus.isPinEngaged() ? this.focus.getFocusedStar() : -1;
    this.sharedUniforms.uPinFocusToCenter.value = pinTarget ?? -1;
    this.sharedUniforms.uModelDays.value = tToJdUt(this.getT()) - J2000_JD;
    this.sharedUniforms.uModelDaysPerRealSec.value = Math.abs(this.clock.getRate()) / 86400;
    // Here, not by either publisher: each would drop the other's entries.
    this.occluders.beginFrame();
    this.layers.updateAll(this.frameCtx);
    this.extinction.update(this.frameCtx);
    this.cadence.refresh({
      t: this.frameCtx.t,
      pxPerRadian: this.frameCtx.pxPerRadian,
      pixelRatio: this.sharedUniforms.uPixelRatio.value,
      cadenceScheduled: this.renderGate.lastFrameWasCadenceScheduled,
    });
    // After the fan-out and before the first draw, so measurement and frame
    // are never one frame apart.
    const measurementParked = this.exposureFrame.measure(nowMs, this.frameCtx.warpActive);
    perfMeasure('pre-render');
    perfMark('submit.main');
    this.hdr.bind();
    // Ahead of the node sync that copies it.
    this.starFrame.syncPhysSizeWindow();
    this.webgpu.syncUniformNodes();
    // Between the sync it reads and the draws it feeds
    // (webgpu/star/compaction/README.md).
    perfMark('star.compaction');
    this.starPipeline.update(this.camera);
    perfMeasure('star.compaction');
    // webgpu/README.md#one-scene-per-boot
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
    // After the resolve, so it never delays the frame it measures.
    perfMark('submit.reduction');
    this.exposureFrame.reduce(measurementParked);
    perfMeasure('submit.reduction');
    // After the LAST pass, listened to or not: an unresolved pool overruns.
    resolveAndPublishGpuFrame(this.webgpu.renderer, this.webgpu.timestampsAvailable);
    perfMark('frame.handlers');
    this.bus.emit('frame');
    perfMeasure('frame.handlers');
    perfMeasure('frame.total');
    perfFrame();
    requestAnimationFrame(this.animate);
  };

  /** `distFromSol` sums in float64: kpc-scale worldOffset values. */
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
    // Refreshed after the frame's last camera write.
    this.frameCtx.frustum.invalidate();
  }

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
    this.cameraStep.dispose();
    this.cadence.dispose();
    this._realtimeFramesNeeded = false;
    this.frameCtx.frustum.invalidate();
    this.input.dispose();
    this.observeControls.disable();
    this.orbitFrameTick = null;
    this.orbitFramePort = null;
    this.aim.dispose();
    this.warp.dispose();
    this.observe.dispose();
    this.focus.dispose();
    this.controls.dispose();
    this.extinction.dispose();
    this.starPipeline.dispose();
    this.layers.disposeAll();
    this.floatingOrigin.dispose();
    this.localDepthPass.dispose();
    this.hdr.dispose();
    // After every layer (they hand texture slots back to it), before the
    // renderer (the releases need a live device).
    this.webgpu.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }
}
