// The statistic reduction on WebGPU: reduction-pass.ts's mip chain
// (reduction-pure is the executable spec) with the pixel-pack fence
// replaced by the renderer's mapAsync-staged readback. README.md § Reduction.

import {
  FloatType, HalfFloatType, NearestFilter, NoBlending, NodeMaterial,
  QuadMesh, RGBAFormat, RenderTarget,
  type Texture, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, If, float, int, ivec2, screenCoordinate, select, texture, vec3, vec4,
} from 'three/tsl';
import type { ReducedStatistic, ReductionSeam } from '../../hdr/hdr-seam';
import {
  createTileScratch,
  reduceTileLevel,
  reductionChainSizes,
  type TileScratch,
} from '../../hdr/exposure/reduction/reduction-pure';

interface Level {
  target: RenderTarget;
  material: NodeMaterial;
  quad: QuadMesh;
  sourceTex: ReturnType<typeof texture>;
  width: number;
  height: number;
}

/** One level of the chain (reduce.frag.glsl): the weighted 2x2 combine,
 *  with the masked-mean product formed on the statistic-reading level
 *  alone. Source size bakes as literals — the materials rebuild with the
 *  level chain on every resize anyway. */
function buildReduceFragment(
  src: ReturnType<typeof texture>,
  sourceWidth: number,
  sourceHeight: number,
  fromStatistic: boolean,
) {
  return Fn(() => {
    const base = ivec2(screenCoordinate).mul(2);
    const bound = ivec2(sourceWidth, sourceHeight);
    const weight = float(0.0).toVar();
    const numerator = vec3(0.0).toVar();
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const c = base.add(ivec2(int(dx), int(dy)));
      // The ragged edge of an odd level: out-of-bounds taps contribute
      // nothing to either the numerator or the weight.
      If(c.x.lessThan(bound.x).and(c.y.lessThan(bound.y)), () => {
        const t = src.load(c);
        const s = fromStatistic ? vec3(t.r, t.r.mul(t.g), t.g) : t.rgb;
        weight.addAssign(t.a);
        numerator.addAssign(s.mul(t.a));
      });
    }
    return vec4(
      select(weight.greaterThan(0.0), numerator.div(weight), vec3(0.0)),
      weight.mul(0.25));
  })();
}

export class WebGpuLuminanceReduction implements ReductionSeam {
  /** Debug kill switch (frame-cost differentials): false skips the
   *  chain's draws while still requesting the readback, so the statistic
   *  freezes at its last landed reading. */
  enabled = true;

  /** Interface parity with the WebGL reduction: keep issuing the readback
   *  while the statistic is unavailable. The ANGLE submission-barrier
   *  rationale has no WebGPU analogue, but the frame-cost harness's
   *  request accounting relies on the cadence either way. */
  fenceWhileParked = false;

  private readonly renderer: WebGPURenderer;
  private levels: Level[] = [];
  private sourceWidth = 0;
  private sourceHeight = 0;
  private issued = 0;
  private inFlight = false;
  /** A readback already in flight at `dispose()` still resolves — the
   *  WebGL twin drops its fence object and cannot be landed on, so this
   *  is the same guarantee expressed for a promise. */
  private disposed = false;
  private landed: Float32Array | null = null;
  private landedCount = 0;
  private scratch: TileScratch = createTileScratch(0);
  private pendingExposure = 0;
  private pendingIsStale = false;
  private latest: ReducedStatistic | null = null;

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer;
  }

  get readbackRequests(): number {
    return this.issued;
  }

  /** One readback in flight at a time, exactly as the WebGL fence — the
   *  adaptation park reads it to open a probe on a frame the chain can
   *  actually draw. */
  get readbackPending(): boolean {
    return this.inFlight;
  }

  measure(
    source: Texture | null,
    width: number,
    height: number,
    renderExposure: number,
    parked: boolean,
  ): void {
    this.poll();
    if (this.inFlight) return;
    this.ensureLevels(width, height);
    if (this.levels.length === 0) return;

    const drawing = this.enabled && !parked && source !== null;
    if (drawing) {
      // The statistic attachment object changes when the HDR target
      // reallocates, so the first level re-points every measure.
      this.levels[0].sourceTex.value = source;
      for (const level of this.levels) {
        this.renderer.setRenderTarget(level.target);
        level.quad.render(this.renderer);
      }
    }
    // Disabled or parked, the tile level's texels are from an older frame:
    // the readback goes out anyway and poll() drops what it lands, so the
    // statistic holds still rather than pairing stale texels with a live
    // exposure (../../hdr/exposure/reduction/README.md § Where it runs).
    const last = this.levels[this.levels.length - 1];
    this.inFlight = true;
    this.issued++;
    this.pendingIsStale = !drawing;
    if (drawing) this.pendingExposure = renderExposure;
    const count = last.width * last.height;
    this.renderer
      .readRenderTargetPixelsAsync(last.target, 0, 0, last.width, last.height)
      .then((pixels) => {
        if (this.disposed) return;
        this.landed = pixels as Float32Array;
        this.landedCount = count;
        this.inFlight = false;
      })
      .catch(() => {
        if (this.disposed) return;
        this.inFlight = false;
        this.pendingIsStale = false;
      });
    this.renderer.setRenderTarget(null);
  }

  current(): ReducedStatistic | null {
    this.poll();
    return this.latest;
  }

  /** Chart mode measures nothing; dropping the last reading is what stops
   *  the frame that re-enters the scene adapting to a stale one. */
  reset(): void {
    this.latest = null;
  }

  dispose(): void {
    this.disposed = true;
    this.releaseLevels();
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.inFlight = false;
    this.landed = null;
    this.landedCount = 0;
    this.scratch = createTileScratch(0);
    this.latest = null;
    this.pendingExposure = 0;
    this.pendingIsStale = false;
  }

  private poll(): void {
    const landed = this.landed;
    if (landed === null) return;
    this.landed = null;
    if (this.pendingIsStale) {
      this.pendingIsStale = false;
      return;
    }
    this.latest = {
      ...reduceTileLevel(landed, this.landedCount, this.scratch),
      renderExposure: this.pendingExposure,
    };
  }

  /** The chain halves with `ceil` down to the tile level. Only that last
   *  level is float32 — the fp16 levels above it keep the chain's memory
   *  in the megabytes. */
  private ensureLevels(width: number, height: number): void {
    if (this.sourceWidth === width && this.sourceHeight === height) return;
    this.releaseLevels();
    this.sourceWidth = width;
    this.sourceHeight = height;
    const sizes = reductionChainSizes(width, height);
    const tile = sizes[sizes.length - 1];
    this.scratch = createTileScratch(tile === undefined ? 0 : tile[0] * tile[1]);
    let srcW = width;
    let srcH = height;
    this.levels = sizes.map(([w, h], i) => {
      const target = new RenderTarget(w, h, {
        type: i === sizes.length - 1 ? FloatType : HalfFloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      // Seeded self-referentially, then re-pointed: level 0 to the
      // statistic attachment on every measure, later levels to their
      // parent's target right after this map.
      const sourceTex = texture(target.texture);
      const material = new NodeMaterial();
      material.name = `statistic-reduce-l${i}-tsl`;
      material.fragmentNode = buildReduceFragment(sourceTex, srcW, srcH, i === 0);
      material.depthTest = false;
      material.depthWrite = false;
      material.blending = NoBlending;
      srcW = w;
      srcH = h;
      return { target, material, quad: new QuadMesh(material), sourceTex, width: w, height: h };
    });
    for (let i = 1; i < this.levels.length; i++) {
      this.levels[i].sourceTex.value = this.levels[i - 1].target.texture;
    }
  }

  // QuadMesh's geometry is a module-level shared triangle — materials and
  // targets are per level, the geometry is not disposable.
  private releaseLevels(): void {
    for (const level of this.levels) {
      level.target.dispose();
      level.material.dispose();
    }
    this.levels = [];
  }
}
