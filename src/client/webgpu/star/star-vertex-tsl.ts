// The per-star solve every WebGPU star stage runs (visibility, extinction,
// size, disc/glow routing) and the vertex stage built over it, compile-time
// specialized per pass (star-pass.ts).

import {
  Fn, If, atan, clamp, cos, distance, dot, float, fract, instanceIndex, int,
  log, max, min, mix, pow, select, smoothstep, sqrt, texture, uint,
  varyingProperty, vec2, vec4, cameraProjectionMatrix, modelViewMatrix,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type * as THREE from 'three';
import {
  BALLESTEROS_BV_SCALE, BALLESTEROS_DISC_K2, BALLESTEROS_QUAD_LINEAR, BALLESTEROS_T0,
} from '../../../../scripts/colour/blackbody-lut-pure';
import { BV_MAX, BV_MIN } from '../../star-pipeline/blackbody-lut';
import { GLOW_COLLAPSE_FLOOR_L } from '../../star-pipeline/collapse/glow-collapse-pure';
import {
  PHYS_RATIO_THRESHOLD,
} from '../../star-pipeline/local-pass/star-local-cluster-pure';
import {
  STAR_PASS_CORE_MASK, STAR_PASS_GLOW, type StarPass,
} from '../../star-pipeline/star-pass';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';
import { R_V } from '../../star-pipeline/extinction/dust-raymarch-pure';
import { kernelFluxPeakTsl, pointSourcePeakTsl } from '../emission-tsl';
import { dustRaymarchAvTsl, type DustTextureNode } from '../extinction/dust-raymarch-tsl';
import type { AvStorageNode } from '../extinction/extinction-nodes';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { lumaWeightsTsl } from '../tonemap-tsl';
import { attrFloat, attrVec2 } from '../tsl/tsl-shim';
import {
  perceptualAppSizePxTsl,
  perceptualDiscExponentTsl,
  perceptualDiscFluxIntegralTsl,
  perceptualDmEffTsl,
} from '../perceptual-disc-tsl';
import type { SurvivorsNode } from './compaction/star-compaction';
import type { StarTables } from './star-tables';
import { appMagAtTsl, starVisibilityTsl } from './star-visibility-tsl';

type NF = Node<'float'>;

/** How far inside the reversed-z near clip bound (z_ndc = 1) the member
 *  stamp lands. Exactly z = +w risks the primitive clipping on float
 *  rounding; one ulp-scale step inside is depth-indistinguishable from
 *  the GLSL build's absolute-nearest gl_FragDepth = 0.0 stamp. */
export const CORE_MASK_NEAR_PIN_EPS = 1e-6;

const ballesterosBvFromTeffTsl = /* @__PURE__ */ Fn(([teff]: [NF]) => {
  const k = teff.div(BALLESTEROS_T0);
  const disc = sqrt(k.mul(k).mul(BALLESTEROS_DISC_K2).add(4.0));
  const u = float(2.0).sub(k.mul(BALLESTEROS_QUAD_LINEAR)).add(disc).div(k.mul(2.0));
  return u.div(BALLESTEROS_BV_SCALE);
});

export interface StarTslDeps {
  u: SharedUniformNodes;
  tables: StarTables;
  /** The blackbody LUT, bound per layer — texture slots are not part of
   *  the shared uniform-node mirror (../shared-uniform-nodes.ts). */
  lut: THREE.DataTexture;
  /** The dust volume the raymarch fallback samples, and the star-indexed
   *  A_V buffer the prepass path indexes. Both nullable on the WebGL side,
   *  hence nodes over placeholders whose `.value` the prepass swaps — a
   *  node cannot carry a nullable texture or buffer. */
  dust: DustTextureNode;
  av: AvStorageNode;
}

/** Where a vertex stage finds its star: the compaction kernel's list for
 *  the pass's tier, or the mirror's per-slot `iSourceIdx` attribute. */
export type StarVertexSource =
  | { readonly kind: 'compacted'; readonly survivors: SurvivorsNode; readonly listBase: number }
  | { readonly kind: 'mirror' };

/** One set per material: the same varying node objects must be written by
 *  the vertex stage and read by the fragment stage of that material. */
export function buildStarVaryings() {
  return {
    vAppMag: varyingProperty('float', 'vAppMag'),
    vColor: varyingProperty('vec3', 'vColor'),
    vUv: varyingProperty('vec2', 'vUv'),
    vPhysRatio: varyingProperty('float', 'vPhysRatio'),
    vSoftness: varyingProperty('float', 'vSoftness'),
    /** One CSS pixel in vUv units — the chart fragment's edge-AA width.
     *  `fwidth(r)` cannot substitute: `length(vUv)`'s screen-space
     *  derivative is undefined at the quad centre, which left small quads
     *  a faint grey rather than solid ink. */
    vAaWidth: varyingProperty('float', 'vAaWidth'),
    vPeakL: varyingProperty('float', 'vPeakL'),
    vFluxPeakL: varyingProperty('float', 'vFluxPeakL'),
  };
}

export type StarVaryings = ReturnType<typeof buildStarVaryings>;

/** What the solve hands a survivor's consumer. `appMag` carries the pass's
 *  eclipse fold; `appMagRoute` never does. */
export interface StarSolve {
  dPc: NF;
  appMag: NF;
  appMagRoute: NF;
  absorbAV: NF;
  ciMod: NF;
  radiusFactor: NF;
  peakL: NF;
  pxSize: NF;
  physRatio: NF;
  chart: Node<'bool'>;
}

export interface StarSolveOptions {
  pass: StarPass;
  /** The glow pass's eclipse dim. Null folds nothing — every other pass,
   *  and the compaction kernel, which routes on the undimmed magnitude. */
  eclipseDim: NF | null;
}

/**
 * Calls `onAlive` inside the survivor branch. The compaction kernel and all
 * six vertex stages run THIS graph, so the disc/glow split resolves to the
 * same bits everywhere: a kernel that tiered a star differently from the pass
 * drawing it would drop the star from both lists' fragment partitions.
 */
export function solveStarTsl(
  deps: StarTslDeps,
  self: Node<'int'>,
  localPos: Node<'vec3'>,
  opts: StarSolveOptions,
  onAlive: (s: StarSolve) => void,
): void {
  const { u, tables, dust, av } = deps;
  const { pass } = opts;
  const stat = (name: Parameters<StarTables['stat']>[1]) => tables.stat(self, name);

  const dPc = max(distance(localPos, u.uCameraPos), 1e-30).toVar();
  const appMag = float(appMagAtTsl(stat('iAbsmag'), dPc)).toVar();

  const radiusFactor = float(1.0).toVar();
  const ciMod = float(0.0).toVar();
  const periodDays = stat('iPeriodDays');
  const pulsating = periodDays.greaterThan(0.0)
    .and(stat('iAmplitudeMag').greaterThan(0.0))
    .and(tables.scalar('iSuppressPulsation', self).lessThan(0.5));
  If(pulsating, () => {
    const minModelDays = u.uModelDaysPerRealSec.mul(u.uMinPeriodSec);
    const periodEff = max(periodDays, minModelDays);
    const phase = fract(u.uModelDays.div(periodEff));
    const c = cos(phase.mul(2 * Math.PI));
    appMag.addAssign(stat('iAmplitudeMag').mul(-0.5).mul(c));
    radiusFactor.assign(pow(stat('iPulsRho'), c.mul(-0.5)));
    ciMod.assign(stat('iPulsColorSwing').mul(-0.5).mul(c));
  });

  // appMagRoute stays undimmed all the way to the size solve: it is what
  // the disc/glow split routes on, and D3/D4 never fold the dim at all
  // (../../star-pipeline/README.md § Star rendering). Carrying it — rather
  // than subtracting the dim back off later — is what makes it bit-equal
  // to the appMag those pipelines derive, since it sees the identical
  // sequence of adds.
  const appMagRoute = float(0.0).toVar();
  appMagRoute.assign(appMag);
  const eclipseDim = pass === STAR_PASS_GLOW ? opts.eclipseDim : null;
  if (eclipseDim !== null) {
    // Glow pass only: the disc pass resolves an eclipse occlusion
    // geometrically in the local depth pass, so folding the dim there
    // would dim the back disc's non-occluded fragments too.
    If(eclipseDim.lessThan(1.0), () => {
      appMag.addAssign(log(eclipseDim).mul(-2.5 / Math.LN10));
    });
  }

  const vis = starVisibilityTsl(u, stat('iSpectClass'), stat('iDistSol'), appMag, pass);
  const chart = vis.chart;

  // The prepass kernel gates its march on these same four terms.
  If(vis.alive(), () => {
    // Survivors only. The prepass cache is one read of the star's own
    // float; the fallback marches camera→star in ABSOLUTE space, since
    // the dust grid is anchored to Sol rather than to the renderer's
    // floating local origin.
    const dustEffective = u.uDustEnabled.mul(u.uExtinctionStrength).toVar();
    const absorbAV = float(0.0).toVar();
    If(dustEffective.greaterThan(0.0), () => {
      If(u.uAvPrepassEnabled.greaterThan(0.5), () => {
        absorbAV.assign(av.element(self).mul(dustEffective));
      }).Else(() => {
        absorbAV.assign(dustRaymarchAvTsl(
          u, dust,
          u.uCameraPos.add(u.uWorldOffset),
          localPos.add(u.uWorldOffset),
        ).mul(dustEffective));
      });
    });
    appMag.addAssign(absorbAV);
    appMagRoute.addAssign(absorbAV);

    // Both bounds again on the extincted value. The taper bound is the
    // LIVE uThresholdMag, so the EV trim moves it exactly as it moves
    // the fragment taper — which is what makes the cull bit-exact.
    If(vis.magOk().and(vis.taperAlive()), () => {
      const pxSize = float(0.0).toVar();
      const physRatio = float(1.0).toVar();
      const peakL = float(0.0).toVar();
      If(chart, () => {
        // Chart-mode flat-disc sizing: pixel diameter spreads linearly
        // between [Max, Min] across [uChartMagBright, uLimitMag].
        // `appMag` already carries the variability shift, so a variable
        // breathes in pixel space the way Sky Atlas's glyph implies.
        // physRatio 1 forces the fragment's chart disc path; chart is
        // non-photometric and returns before the fragment touches
        // luminance, so the peak stays at zero.
        const chartT = clamp(
          appMag.sub(u.uChartMagBright)
            .div(max(u.uLimitMag.sub(u.uChartMagBright), 0.001)),
          0.0, 1.0);
        pxSize.assign(mix(u.uChartDiscMaxPx, u.uChartDiscMinPx, chartT));
      }).Else(() => {
        const dMEff = perceptualDmEffTsl(appMag, u.uLimitMag, u.uSizeSpan, u.uSizeKnee);
        const appSize = perceptualAppSizePxTsl(dMEff, u.uSizeMin, u.uSizeMax, u.uSizeSpan);

        // Past uPhysSizeWindowPc the catalog's largest star cannot reach
        // physSizeElisionBoundPx, where tiering and pxSize are exact and
        // the peak is bit-exact, so the pow / divide / atan are skipped
        // outright (../../star-pipeline/perceptual-disc/README.md
        // § Eliding the physical-size branch).
        const physSizeRaw = float(0.0).toVar();
        If(dPc.lessThanEqual(u.uPhysSizeWindowPc), () => {
          const rPc = pow(10.0, stat('iLogRadius')).mul(u.uRSunPc);
          const angularToPx = u.uViewport.y.div(max(u.uFovYRad, 1e-9));
          physSizeRaw.assign(atan(rPc.mul(radiusFactor).div(dPc)).mul(2.0).mul(angularToPx));
        });
        // The peak takes the UNCLAMPED physical radius (CSS px) — the
        // clamp below is display-only (../../star-pipeline/README.md
        // § Physical-luminance emission).
        peakL.assign(pointSourcePeakTsl(u.uExposure, appMag, physSizeRaw.mul(0.5)));

        const physSize = min(
          physSizeRaw, u.uMaxPhysFrac.mul(min(u.uViewport.x, u.uViewport.y)));
        pxSize.assign(max(appSize, physSize));

        // The size the pass split routes on. Only the glow pipeline
        // folds the eclipse dim into appMag, and a dim SHRINKS appSize,
        // which RAISES physSize / max(appSize, physSize). Let the dim
        // carry a star just under the split over it and glow discards it
        // as disc-owned while disc, reading the undimmed appMag, still
        // discards it as glow-owned — drawn by neither pipeline. Route on
        // the undimmed size so all three agree, matching the GLSL twin
        // and the CPU pick mirror
        // (../../camera/controls/star-pick-visibility-pure.ts). The
        // re-solve sits behind the same dim test the GLSL ternary uses,
        // so an undimmed star reuses appSize on both backends.
        const routeAppSize = float(0.0).toVar();
        routeAppSize.assign(appSize);
        if (eclipseDim !== null) {
          If(eclipseDim.lessThan(1.0), () => {
            routeAppSize.assign(perceptualAppSizePxTsl(
              perceptualDmEffTsl(
                appMagRoute, u.uLimitMag, u.uSizeSpan, u.uSizeKnee),
              u.uSizeMin, u.uSizeMax, u.uSizeSpan));
          });
        }
        physRatio.assign(
          clamp(physSize.div(max(max(routeAppSize, physSize), 0.001)), 0.0, 1.0));

        // Kernel collapse — must precede the flux renorm the vertex stage
        // takes over pxSize, so it divides the collapsed footprint.
        // ../../star-pipeline/collapse/README.md.
        const tap = float(1.0).sub(smoothstep(
          u.uThresholdMag, u.uThresholdMag.add(SOFT_TAPER_MARGIN_MAG), appMag));
        If(physRatio.lessThan(PHYS_RATIO_THRESHOLD)
          .and(peakL.mul(tap).mul(tap).lessThan(GLOW_COLLAPSE_FLOOR_L)), () => {
          pxSize.assign(u.uSizeMin);
        });
      });
      onAlive({
        dPc, appMag, appMagRoute, absorbAV, ciMod, radiusFactor, peakL, pxSize, physRatio, chart,
      });
    });
  });
}

/**
 * The compacted variant resolves the star through the survivor list for
 * the pass's tier; the mirror variant (star-local-mirror-tsl.ts) takes it
 * from the `iSourceIdx` slot attribute so hide/pin compares match the
 * source instance, has member collapse off (the mirror draws exactly the
 * members), and its core mask writes true bracket depth rather than the
 * main variant's near pin.
 */
export function buildStarVertexNode(
  deps: StarTslDeps,
  pass: StarPass,
  v: StarVaryings,
  source: StarVertexSource,
): Node {
  const { u, tables, lut } = deps;
  const localMirror = source.kind === 'mirror';

  const ciToColor = Fn(([bv]: [NF]) => {
    const t = clamp(bv.sub(BV_MIN).div(BV_MAX - BV_MIN), 0.0, 1.0);
    const chroma = texture(lut, vec2(t, 0.5)).rgb;
    return chroma.div(max(dot(chroma, lumaWeightsTsl()), 1e-6));
  });

  return Fn(() => {
    const corner = attrVec2('aCorner');
    const self = source.kind === 'mirror'
      ? int(attrFloat('iSourceIdx').add(0.5))
      : int(source.survivors.element(uint(source.listBase).add(instanceIndex)));
    const localPos = tables.position(self).toVar();

    // The off-screen clip sentinel of star.vert.glsl's early returns;
    // TSL has no value-carrying return, so the draw path assigns over it.
    const clipOut = vec4(2.0, 2.0, 2.0, 1.0).toVar();

    const m0 = u.uLocalMemberIdx0;
    const m1 = u.uLocalMemberIdx1;
    const isMember = localMirror ? null
      : self.equal(m0.x).or(self.equal(m0.y))
        .or(self.equal(m0.z)).or(self.equal(m0.w))
        .or(self.equal(m1.x)).or(self.equal(m1.y))
        .or(self.equal(m1.z)).or(self.equal(m1.w));
    const eclipseDim = tables.scalar('iEclipseDim', self).toVar();
    const compositeSuppress = tables.scalar('iCompositeSuppress', self);
    // A member keeps its core-mask draw (the stamp is what stops main-pass
    // background painting inside the core the local pass repaints); the two
    // colour passes collapse in favour of the mirror draws. Totality
    // collapses the glow quad alone, and iCompositeSuppress never gates
    // glow (README.md § Suppression semantics).
    const hidden = self.equal(u.uHideFocusIdx);
    const suppressed = (pass === STAR_PASS_GLOW
      ? (isMember === null ? hidden : hidden.or(isMember))
        .or(eclipseDim.lessThanEqual(0.0))
      : pass === STAR_PASS_CORE_MASK
        ? hidden.or(compositeSuppress.greaterThan(0.5))
        : (isMember === null ? hidden : hidden.or(isMember))
          .or(compositeSuppress.greaterThan(0.5)));

    If(suppressed.not(), () => {
      solveStarTsl(deps, self, localPos, {
        pass, eclipseDim: pass === STAR_PASS_GLOW ? eclipseDim : null,
      }, (s) => {
        const teff = tables.stat(self, 'iTeffApsis');
        const intrinsicBv = select(
          teff.greaterThan(0.0), ballesterosBvFromTeffTsl(teff), tables.stat(self, 'iCi'));
        // Dust reddening and the variability colour swing shift the same
        // LUT input; reddening applies to whichever colour tier won.
        const effectiveCi = intrinsicBv.add(s.absorbAV.div(R_V)).add(s.ciMod);

        const lumRaw = tables.stat(self, 'iLumClass');
        const lumClass = select(lumRaw.lessThan(100.0), lumRaw, 2.0);
        const softness = clamp(lumClass.div(9.0), 0.0, 1.0);

        v.vAppMag.assign(s.appMag);
        v.vColor.assign(ciToColor(effectiveCi));
        v.vUv.assign(corner);
        v.vSoftness.assign(softness);
        v.vPeakL.assign(s.peakL);
        v.vPhysRatio.assign(s.physRatio);
        v.vAaWidth.assign(float(1.0).div(max(s.pxSize, 0.5)));
        If(s.chart, () => {
          v.vFluxPeakL.assign(0.0);
        }).Else(() => {
          // The statistic's flux channel: the same kernel divided by its own
          // area integral so its frame integral returns the star's true flux.
          // pxSize is CSS pixels, which is what keeps the frame mean
          // devicePixelRatio-independent
          // (../../hdr/exposure/reduction/README.md § Pixel units).
          v.vFluxPeakL.assign(kernelFluxPeakTsl(
            u.uExposure, s.appMag, s.pxSize,
            perceptualDiscFluxIntegralTsl(perceptualDiscExponentTsl(
              softness, s.physRatio, u.uDistNMin, u.uDistNMax,
              u.uLumBiasMin, u.uLumBiasMax))));
        });

        const centreClip = cameraProjectionMatrix
          .mul(modelViewMatrix)
          .mul(vec4(localPos, 1.0))
          .toVar();
        If(self.equal(u.uPinFocusToCenter), () => {
          centreClip.assign(cameraProjectionMatrix.mul(vec4(0.0, 0.0, s.dPc.negate(), 1.0)));
        });
        // uPixelRatio cancels out of the GLSL's offset chain; both
        // uViewport and pxSize are CSS px.
        const ndcOffset = corner.mul(s.pxSize).div(u.uViewport).mul(2.0);
        clipOut.assign(centreClip.add(vec4(ndcOffset.mul(centreClip.w), 0.0, 0.0)));

        if (pass === STAR_PASS_CORE_MASK && isMember !== null) {
          // The member stamp, moved from the GLSL fragment stage
          // (gl_FragDepth = 0.0) to the vertex: per-instance, so the whole
          // quad pins to the near end of the reversed-z clip convention and
          // fixed-function depth writes the nearest value — no fragment
          // depth output, which is what keeps early-z alive
          // (../README.md § Early-z). The mirror's own mask never pins:
          // its stamp IS the member's true bracket depth.
          If(isMember, () => {
            clipOut.assign(vec4(
              clipOut.x, clipOut.y,
              clipOut.w.mul(1 - CORE_MASK_NEAR_PIN_EPS), clipOut.w));
          });
        }
      });
    });
    return clipOut;
  })();
}
